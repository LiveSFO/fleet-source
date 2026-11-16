// A headless Chrome page over the DevTools protocol, for the fleet tools that render in a page (bake.mjs, reverse.mjs,
// the trace's projection, tools/research/fleet): a throwaway profile in the system's temporary folder, never the user's
// own; WebGL on the real GPU. CHROME overrides the browser's path.
//   launch({ w, h, dpr, mobile }) → { eval(expr), send(method, params), nav(url), shot(file), logs, close() }
// Its own browser only: Chrome picks a free debugging port (--remote-debugging-port=0) and writes it into this profile's
// DevToolsActivePort, which is where we read it. (A random port in a shared range let two sessions' scripts draw the same
// one, and the second then drove the first one's browser: on 15 Nov a TV capture took over a reverse bake's page.)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const sleep = ms => new Promise(r => setTimeout(r, ms));
const CHROME = process.env.CHROME || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');

export async function launch({ w = 1280, h = 800, dpr = 1, mobile = false } = {}) {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-cdp-'));
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${prof}`, `--window-size=${w},${h}`,
    '--no-first-run', '--no-default-browser-check', '--enable-webgl', '--ignore-gpu-blocklist', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  // the browser and its profile go with this process, however it ends
  const reap = () => { try { chrome.kill('SIGKILL'); } catch { /* gone */ } try { fs.rmSync(prof, { recursive: true, force: true }); } catch { /* */ } };
  process.once('exit', reap);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(sig, () => { reap(); process.exit(130); });
  let ws = null, port = 0;
  for (let i = 0; i < 100 && !ws; i++) {
    await sleep(200);
    try {
      if (!port) { const l = fs.readFileSync(path.join(prof, 'DevToolsActivePort'), 'utf8').split('\n'); port = +l[0] || 0; if (!port) continue; }
      const t = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const p = t.find(x => x.type === 'page'); if (p) ws = p.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
  }
  if (!ws) { reap(); throw new Error('Chrome did not start'); }
  const sock = new WebSocket(ws); await new Promise((res, rej) => { sock.onopen = res; sock.onerror = rej; });
  let id = 0; const pending = new Map(), logs = [];
  sock.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    else if (d.method === 'Runtime.consoleAPICalled') logs.push(`[${d.params.type}] ` + d.params.args.map(a => a.value ?? a.description ?? '').join(' '));
    else if (d.method === 'Runtime.exceptionThrown') logs.push('[exception] ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
  };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); sock.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile });
  if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const evalJs = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) throw new Error('page: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  return {
    send, logs, port, eval: evalJs,
    async nav(url, timeout = 90000) {
      await send('Page.navigate', { url });
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) { await sleep(500); if (await evalJs('!!window.__app').catch(() => false)) return (Date.now() - t0) / 1000; }
      throw new Error('page not ready');
    },
    async shot(file, quality = 82) {
      const r = await send('Page.captureScreenshot', { format: 'jpeg', quality });
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'));
      return file;
    },
    close() { try { sock.close(); } catch { /* */ } reap(); }
  };
}

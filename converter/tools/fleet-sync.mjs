#!/usr/bin/env node
// @ts-check
/**
 * Unpacks what the fleet converter needs from the SFO aircraft library's release zip (read only: nothing is ever written
 * there) into data/fleet/src, after checking the zip against the SHA-256 its release record pins.
 *
 *   node tools/fleet-sync.mjs [--zip <sfo-fleet-….zip>] [--only b38m,e75l] [--out data/fleet/src]
 *   node tools/fleet-sync.mjs --bundle [--only …]     the GPL source bundle for what's converted (docs/FLEET.md)
 *
 * Unpacked: the library's records (asset-handoff-manifest.json, sfo-build-coverage.json, the catalogue, READMEs) and,
 * per airframe, lights.json and each export's .glb and .rig.json: about 1.6 GB for everything, a few hundred MB for
 * the first batch. Not unpacked: the .blend scenes, the upstream source trees and the paint sources (the bundle takes
 * those), the review sheets. data/fleet/ is not in git.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BATCH, EXCLUDE_AIRFRAMES, converterFiles } from './fleet/config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes('--' + k) ? argv[argv.indexOf('--' + k) + 1] : d);
// the release zip: --zip, or data/fleet/library.zip (a link to it, kept out of git); its release record sits beside the
// real file, so the link is resolved first
const ZIP = fs.realpathSync(path.resolve(opt('zip', path.join(ROOT, 'data/fleet/library.zip'))));
const OUT = path.resolve(opt('out', path.join(ROOT, 'data/fleet/src')));
const ONLY = opt('only', '') ? opt('only', '').split(',') : BATCH;
const PREFIX = 'sfo-aircraft-library/';
fs.mkdirSync(OUT, { recursive: true });

// ---- the release record and the zip's hash (checked once per zip size and date)
const recFile = ZIP.replace(/\.zip$/, '.json');
const rec = fs.existsSync(recFile) ? JSON.parse(fs.readFileSync(recFile, 'utf8')) : null;
const st = fs.statSync(ZIP), syncFile = path.join(OUT, 'sync.json');
let sync = fs.existsSync(syncFile) ? JSON.parse(fs.readFileSync(syncFile, 'utf8')) : {};
if (sync.zipSize !== st.size || sync.zipMtime !== st.mtimeMs || !sync.sha256) {
  process.stdout.write(`checking ${path.basename(ZIP)} (${(st.size / 1e9).toFixed(2)} GB)… `);
  const h = crypto.createHash('sha256'), fd = fs.openSync(ZIP, 'r'), buf = Buffer.alloc(8 << 20);
  for (let n; (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0;) h.update(buf.subarray(0, n));
  fs.closeSync(fd);
  sync = { zip: path.basename(ZIP), zipSize: st.size, zipMtime: st.mtimeMs, sha256: h.digest('hex') };
  console.log(sync.sha256.slice(0, 16));
}
if (rec && rec.sha256 && rec.sha256 !== sync.sha256) { console.error(`SHA-256 differs from ${path.basename(recFile)}: ${sync.sha256} ≠ ${rec.sha256}`); process.exit(1); }
if (!rec) console.warn(`no release record next to the zip (${path.basename(recFile)}): hash not checked against one`);

// ---- what's in it
const names = execFileSync('unzip', ['-Z1', ZIP], { maxBuffer: 64 << 20 }).toString().split('\n').filter(Boolean);
const lib = n => n.startsWith(PREFIX + 'assets/airliners/') ? n.slice((PREFIX + 'assets/airliners/').length) : null;
const want = new Set(ONLY.filter(a => !EXCLUDE_AIRFRAMES.has(a)));
function unpack(list, dest) {
  for (let i = 0; i < list.length; i += 200) execFileSync('unzip', ['-o', '-q', ZIP, ...list.slice(i, i + 200), '-d', dest], { maxBuffer: 64 << 20 });
}

if (argv.includes('--bundle')) {
  // ---- the source bundle: for each converted export, its source packages as the library pinned them (upstream
  // trees, licences, download records), the airframe's generated paint maps and upstream folders, the library's
  // build scripts and records; plus livesfo's converter. What the GPL asks to accompany the converted models.
  const handoff = JSON.parse(fs.readFileSync(path.join(OUT, 'assets/airliners/asset-handoff-manifest.json'), 'utf8'));
  const assets = handoff.assets.filter(a => want.has(a.selector.split('/')[0]));
  const pkgs = new Set(assets.flatMap(a => a.sourcePackages || []));
  const keep = names.filter(n => {
    const r = lib(n); if (r === null) return /^sfo-aircraft-library\/(README\.md|PACKAGE-MANIFEST\.json|package\.json|scripts\/.*\.(py|mjs)|viewer\/airliner-runtime\.js)$/.test(n);
    if (/^[^/]+\.(json|md)$/.test(r)) return true;                                   // the library's records
    const top = r.split('/')[0];
    if (top === 'preparation') return pkgs.has(r.split('/').slice(0, 2).join('/'));   // the source packages used
    if (!want.has(top)) return false;
    return /\/(generated|upstream)\//.test(r) || /\/lights\.json$/.test(r) || /\/exports\/[^/]+\.(rig\.json|validation\.json)$/.test(r);
  });
  const dest = path.join(ROOT, 'data/fleet/source-bundle');
  fs.rmSync(dest, { recursive: true, force: true }); fs.mkdirSync(dest, { recursive: true });
  unpack(keep, path.join(dest, 'library'));
  // livesfo's converter, as it is in this checkout: every file it runs, and a package.json pinning its one dependency
  for (const f of converterFiles(ROOT, d => fs.readdirSync(d))) {
    fs.mkdirSync(path.dirname(path.join(dest, 'livesfo', f)), { recursive: true }); fs.copyFileSync(path.join(ROOT, f), path.join(dest, 'livesfo', f));
  }
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8')), mo = lock.packages?.['node_modules/meshoptimizer']?.version;
  fs.writeFileSync(path.join(dest, 'livesfo/package.json'), JSON.stringify({ name: 'livesfo-fleet-converter', private: true, devDependencies: { meshoptimizer: mo } }, null, 2) + '\n');
  let bytes = 0; const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else bytes += fs.statSync(p).size; } }; walk(dest);
  fs.writeFileSync(path.join(dest, 'README.md'), `# Corresponding source for livesfo's hi-fi aircraft\n\nThe converted models served at livesfo.com/m/ (glTF, meshopt geometry, KTX2 textures) are adapted from the\nmodels below. Each keeps its licence: see library/…/preparation/<package>/upstream/ for the notices and the source\nas the library pinned it (repository and revision in asset-handoff-manifest.json), and livesfo/ for the converter\nthat made the web files (node tools/fleet-sync.mjs && node tools/fleet-convert.mjs).\n\nLibrary: ${sync.zip}, SHA-256 ${sync.sha256}.\nAirframes: ${[...want].join(', ')}. Source packages: ${[...pkgs].join(', ')}.\n`);
  console.log(`source bundle: ${keep.length} library files + the converter, ${(bytes / 1e6).toFixed(0)} MB in ${path.relative(ROOT, dest)}`);
  process.exit(0);
}

// ---- the converter's inputs
const keep = names.filter(n => {
  const r = lib(n); if (r === null) return false;
  if (/^[^/]+\.(json|md)$/.test(r)) return true;
  const [af] = r.split('/');
  if (!want.has(af)) return false;
  return /^[^/]+\/lights\.json$/.test(r) || /^[^/]+\/exports\/[^/]+\.(glb|rig\.json)$/.test(r);
});
const sizes = new Map(execFileSync('unzip', ['-Zl', ZIP], { maxBuffer: 64 << 20 }).toString().split('\n').map(l => l.trim().split(/\s+/)).filter(p => p.length >= 10).map(p => [p.slice(9).join(' '), +p[3]]));
const missing = keep.filter(n => { const f = path.join(OUT, n.slice(PREFIX.length)); return !fs.existsSync(f) || fs.statSync(f).size !== sizes.get(n); });
if (missing.length) {
  const tmp = path.join(OUT, '.unzip'); fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`unpacking ${missing.length} of ${keep.length} files…`);
  unpack(missing, tmp);
  for (const n of missing) { const to = path.join(OUT, n.slice(PREFIX.length)); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(path.join(tmp, n), to); }
  fs.rmSync(tmp, { recursive: true, force: true });
} else console.log(`all ${keep.length} files already unpacked`);
// every export as the handoff manifest hashed it
const handoff = JSON.parse(fs.readFileSync(path.join(OUT, 'assets/airliners/asset-handoff-manifest.json'), 'utf8'));
let checked = 0;
for (const a of handoff.assets) {
  if (!want.has(a.selector.split('/')[0])) continue;
  const f = path.join(OUT, 'assets/airliners', a.glb);
  const h = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  if (h !== a.sha256) { console.error(`${a.glb}: SHA-256 differs from the handoff manifest`); process.exit(1); }
  checked++;
}
fs.writeFileSync(syncFile, JSON.stringify({ ...sync, airframes: [...want], files: keep.length, at: new Date().toISOString() }, null, 1));
console.log(`${checked} exports match the handoff manifest; ${path.relative(ROOT, OUT)} ready (node tools/fleet-convert.mjs)`);

#!/usr/bin/env node
// Where each hi-fi livery paints its registration (LS-106, D-203), so the page can paint it out and draw the aircraft's
// own in its place (libmodel.js marks). For every asset in shared/fleet.json, in the app's page (headless Chrome, the
// app's own renderer: the models' compressed textures live in its context):
//   1. the model drawn unlit (its paint as it is, no light or shade) from each side, orthographic, about 130 pixels a
//      metre (8,000 across), so a picture's pixels are the paint's colours and its axes the model's station and height;
//   2. the text in each picture read by macOS's Vision (tools/fleet/ocr.swift), and a registration picked out by its
//      form (an N-number, or a nationality mark, a hyphen and the rest: VT-JRI, 4X-EDH, B-2001, C-FIUA; JA, HL);
//   3. for each side: the registration's box in the model's frame (station and height, metres), how far out the skin
//      there is (the depth a decal applies at), the paint round it and the lettering's colour (from the picture), and
//      the texture's texels a metre there (from the model's UVs: the new lettering is drawn as fine as the paint).
// A side with none read takes the other side's place (the paint-out still applies there, and the aircraft's own
// registration goes there). Neither: listed, and the page leaves that model's paint as it is.
// Out: shared/fleet-marks.json (asset → { port, starboard }), the pictures in data/fleet/marks/ (not in git).
// tools/fleet/marks-fix.json marks a side by hand where the reader can't (lettering half behind windows, italic, faint):
// { "<asset>": { "starboard": { "px": [x0, y0, x1, y1], "text": "N3102J" } } } in that side's picture's pixels, measured
// as a read one is. The lettering's colour: as painted, unless a bake has washed it out (light grey), then the airline's
// (INK: black, JetBlue's navy, from the photos).
//   node tools/fleet/marks.mjs [--port 8083] [--only key,…] [--keep]   (--keep: keep the entries already there)
// The page must serve the converter's output at /m/ (the server with FLEET_DIR=data/fleet/out).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launch, sleep } from './cdp.mjs';
import { asReg } from './regform.mjs';
import { regLayout } from '../../client/js/reglayout.js';

const args = process.argv.slice(2), opt = (k, d) => (args.includes('--' + k) ? args[args.indexOf('--' + k) + 1] : d), flag = k => args.includes('--' + k);
const HERE = path.dirname(new URL(import.meta.url).pathname), ROOT = path.resolve(HERE, '../..');
const PORT = +opt('port', 8083), WORK = path.join(ROOT, 'data/fleet/marks'), OCR = path.join(WORK, 'ocr');
const IX = JSON.parse(fs.readFileSync(path.join(ROOT, 'shared/fleet.json'), 'utf8'));
const OUTF = path.join(ROOT, 'shared/fleet-marks.json'), FIXF = path.join(HERE, 'marks-fix.json');
const OLD = fs.existsSync(OUTF) ? JSON.parse(fs.readFileSync(OUTF, 'utf8')) : { assets: {} };
const FIX = fs.existsSync(FIXF) ? JSON.parse(fs.readFileSync(FIXF, 'utf8')) : {};
const ONLY = opt('only') ? new Set(opt('only').split(',')) : null;
/** each asset's airline (the index's types: ICAO → airline → asset) */
const AL = {}; for (const [, byAl] of Object.entries(IX.types)) for (const [al, k] of Object.entries(byAl)) if (!AL[k]) AL[k] = al;
/** the lettering's colour where the bake's is washed out: the airline's, from the traced photos (black for most) */
const INK = { JBU: '#26306e', default: '#17181b' };
const lum = hex => { const n = parseInt(hex.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
fs.mkdirSync(WORK, { recursive: true });
if (!fs.existsSync(OCR)) execFileSync('swiftc', ['-O', path.join(HERE, 'ocr.swift'), '-o', OCR]);

const page = `(async (KEY) => {
  const L = __app.traffic.lib, ix = await L.loadIndex();
  const H = await L.load({ key: KEY, a: ix.assets[KEY], base: ix.base || '/m/' });
  await L.upload(H, () => true);
  H.pose({ gear: 1, flaps: 0, spoilers: 0, reversers: 0, fanDeg: 0, wow: 1 }, true);
  const sc = new THREE.Scene(), BG = new THREE.Color('#7f9cc0'); sc.background = BG;
  const mats = new Map(), basic = m => {
    if (mats.has(m)) return mats.get(m);
    const b = m.userData.glaze ? new THREE.MeshBasicMaterial({ color: '#202a33', side: THREE.DoubleSide })
      : new THREE.MeshBasicMaterial({ map: m.map || null, color: m.color, transparent: m.transparent, opacity: m.opacity, alphaTest: m.alphaTest, side: THREE.DoubleSide });
    mats.set(m, b); return b;
  };
  const rigged = new Set(H.rigged.map(r => r.mesh)), g2 = new THREE.Group();
  for (const p of H.parts) { if (!p.visible) continue; const m = new THREE.Mesh(p.geometry, basic(p.material)); m.matrixAutoUpdate = false; m.matrix.copy(p.matrix); m.userData.src = p; g2.add(m); }
  sc.add(g2); g2.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(g2), zc = (bb.min.z + bb.max.z) / 2, yc = (bb.min.y + bb.max.y) / 2;
  const zr = (bb.max.z - bb.min.z) * 1.02, yr = (bb.max.y - bb.min.y) * 1.04, r = __app.r;
  const W = Math.min(8000, r.capabilities.maxTextureSize), Hp = Math.round(W * yr / zr);
  const rt = new THREE.WebGLRenderTarget(W, Hp); rt.texture.colorSpace = THREE.SRGBColorSpace;
  const out = { L: H.dims.L, W, Hp, zc, yc, zr, yr, sides: {} };
  window.__mk = { H, g2, rigged, sides: {} };
  const ac = r.autoClear; r.autoClear = true;
  for (const side of ['port', 'starboard']) {
    const sx = side === 'port' ? -1 : 1, cam = new THREE.OrthographicCamera(-zr / 2, zr / 2, yr / 2, -yr / 2, 0.1, 400);
    cam.position.set(sx * (Math.abs(sx > 0 ? bb.max.x : bb.min.x) + 50), yc, zc); cam.up.set(0, 1, 0); cam.lookAt(0, yc, zc); cam.updateMatrixWorld(true);
    r.setRenderTarget(rt); r.setClearColor(BG, 1); r.clear(); r.render(sc, cam);
    const px = new Uint8Array(W * Hp * 4); r.readRenderTargetPixels(rt, 0, 0, W, Hp, px); r.setRenderTarget(null);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = Hp; const g = cv.getContext('2d'), id = g.createImageData(W, Hp);
    for (let y = 0; y < Hp; y++) id.data.set(px.subarray((Hp - 1 - y) * W * 4, (Hp - y) * W * 4), y * W * 4);
    g.putImageData(id, 0, 0);
    window.__mk.sides[side] = id.data;
    out.sides[side] = cv.toDataURL('image/png');
  }
  r.autoClear = ac; rt.dispose();
  return out;
})`;

/** step 3, in the page: a side's registration (its reader's box, picture pixels) measured in the model */
const measure = `((SIDE, BOX, G, EXACT) => {
  const { H, g2, rigged } = window.__mk, D = window.__mk.sides[SIDE], { W, Hp, zc, yc, zr, yr } = G, port = SIDE === 'port';
  const [x0, y0, x1, y1] = BOX;
  const zAt = px => port ? zc - zr / 2 + (px + 0.5) / W * zr : zc + zr / 2 - (px + 0.5) / W * zr, yAt = py => yc + yr / 2 - (py + 0.5) / Hp * yr;
  const at = (x, y) => { const k = 4 * (Math.min(Hp - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))); return [D[k], D[k + 1], D[k + 2]]; };
  const med = px => [0, 1, 2].map(i => px.map(p => p[i]).sort((a, b) => a - b)[px.length >> 1]);
  const bg = [127, 156, 192], isBg = c => Math.abs(c[0] - bg[0]) + Math.abs(c[1] - bg[1]) + Math.abs(c[2] - bg[2]) < 12;
  // the paint round it: the band just over the lettering (a fuselage's plain paint, mostly), else just under it
  const band = (ya, yb) => { const l = []; for (let y = ya; y <= yb; y++) for (let x = x0; x <= x1; x++) { const c = at(x, y); if (!isBg(c)) l.push(c); } return l; };
  const bh = y1 - y0;
  let ring = band(y0 - Math.round(0.45 * bh), y0 - Math.round(0.1 * bh));
  if (ring.length < 50) ring = band(y1 + Math.round(0.25 * bh), y1 + Math.round(0.5 * bh));
  const paint = med(ring), dist = c => Math.hypot(c[0] - paint[0], c[1] - paint[1], c[2] - paint[2]);
  // ink: pixels far from that paint, judged against the box's darkest (windows in it are darker than grey lettering)
  const ds = []; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) ds.push(dist(at(x, y)));
  ds.sort((a, b) => a - b); const thr = Math.max(28, 0.25 * ds[Math.floor(ds.length * 0.97)]);
  // its own rows (the reader's box has room round the letters, and windows can sit right under them): runs of rows
  // with ink (a one-row gap bridged), the heaviest run at least a third of the box tall; cut where a row turns several
  // times denser than the letters' (a row of windows touching them)
  const ya = y0, yb = Math.min(Hp - 1, y1 + Math.round(0.05 * bh));
  const cnt = []; for (let y = ya; y <= yb; y++) { let n = 0; for (let x = x0; x <= x1; x++) if (dist(at(x, y)) > thr) n++; cnt.push(n); }
  const min = Math.max(2, 0.03 * (x1 - x0)), runs = [];
  for (let i = 0; i < cnt.length;) {
    if (cnt[i] < min) { i++; continue; }
    let j = i; while (j + 1 < cnt.length && (cnt[j + 1] >= min || (j + 2 < cnt.length && cnt[j + 2] >= min))) j++;
    runs.push([i, j, cnt.slice(i, j + 1).reduce((p, q) => p + q, 0)]); i = j + 1;
  }
  const good = EXACT ? [] : runs.filter(r => r[1] - r[0] + 1 >= 0.33 * bh && r[0] <= 0.35 * bh).sort((p, q) => q[2] - p[2]);
  let r0, r1;
  if (good.length) {
    [r0, r1] = good[0];
    const head = cnt.slice(r0, r0 + Math.max(3, Math.round(0.6 * (r1 - r0 + 1)))).sort((p, q) => p - q), m = head[head.length >> 1];
    for (let i = r0 + Math.round(0.6 * bh); i <= r1; i++) if (cnt[i] > 3 * m) { r1 = i - 1; break; }   // (a bold letter's bar is dense too: not before 60 % of the box)
  } else if (EXACT) { r0 = y0 - ya; r1 = y1 - ya; } else { r0 = y0 - ya; r1 = r0 + Math.round(0.8 * bh); }
  const capTop = ya + r0, base = ya + r1, capH = base - capTop + 1;
  // the lettering's colour: the eighth of its band's pixels least like the paint
  const ink = []; for (let y = capTop; y <= base; y++) for (let x = x0; x <= x1; x++) { const c = at(x, y); ink.push([dist(c), c]); }
  ink.sort((p, q) => q[0] - p[0]);
  const inkC = med(ink.slice(0, Math.max(1, ink.length >> 3)).map(q => q[1]));
  const za = zAt(x0), zb = zAt(x1), box = [Math.min(za, zb), Math.max(za, zb), yAt(base), yAt(capTop)];
  // the skin there: its static parts' triangles over the box (station and height) on this side, facing out: how far out
  // (the decal's depth), and their texels a metre (UVs × the map's transform × its size against their edges' lengths)
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), xs = [], tpm = [];
  for (const m of g2.children) {
    const p = m.userData.src; if (rigged.has(p)) continue;
    const geo = p.geometry, pos = geo.attributes.position, uv = geo.attributes.uv, idx = geo.index, map = p.material.map;
    if (!idx) continue;
    for (let t = 0; t < idx.count; t += 3) {
      for (let j = 0; j < 3; j++) { const i = idx.getX(t + j); v[j].set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(p.matrix); }
      const zmin = Math.min(v[0].z, v[1].z, v[2].z), zmax = Math.max(v[0].z, v[1].z, v[2].z), ymin = Math.min(v[0].y, v[1].y, v[2].y), ymax = Math.max(v[0].y, v[1].y, v[2].y);
      if (zmax < box[0] || zmin > box[1] || ymax < box[2] || ymin > box[3]) continue;
      const cx = (v[0].x + v[1].x + v[2].x) / 3; if (port ? cx > 0 : cx < 0) continue;
      const nx = e1.subVectors(v[1], v[0]).cross(e2.subVectors(v[2], v[0])).normalize().x; if (Math.abs(nx) < 0.35) continue;   // (facing the side)
      xs.push(Math.max(Math.abs(v[0].x), Math.abs(v[1].x), Math.abs(v[2].x)));
      if (!uv || !map || !map.image || !map.image.width) continue;
      for (let j = 0; j < 3; j++) {
        const a = idx.getX(t + j), b = idx.getX(t + (j + 1) % 3), dP = v[j].distanceTo(v[(j + 1) % 3]);
        if (dP < 0.02) continue;
        const du = (uv.getX(a) - uv.getX(b)) * map.repeat.x * map.image.width, dv = (uv.getY(a) - uv.getY(b)) * map.repeat.y * map.image.height;
        tpm.push(Math.hypot(du, dv) / dP);
      }
    }
  }
  xs.sort((a, b) => a - b); tpm.sort((a, b) => a - b);
  const xOut = xs.length ? xs[xs.length - 1] : 0, hex = c => '#' + c.map(n => n.toString(16).padStart(2, '0')).join('');
  return { box: box.map(n => +n.toFixed(3)), skin: +xOut.toFixed(3), paint: hex(paint), ink: hex(inkC), tpm: tpm.length ? Math.round(tpm[tpm.length >> 1]) : 0, tris: xs.length, capPx: capH, px: [x0, capTop, x1, base] };
})`;

/** a side's paint over its paint-out box (the page's own layout: reglayout.js), the old lettering filled in down each
 * column from the paint just above it to the paint just below (from above only where what's below is far darker:
 * windows); one colour (its median) where it is one (PATCH_SD), else a small picture of it (JPEG) at the livery's texels a metre, its x
 * running aft (the right side's picture mirrored), for the page to judge the old ink against */
const PATCH_SD = 20;   // (the paint's spread, 0–255, from which it's more than one colour: panel lines and door outlines stay under it)
const patchFn = `((SIDE, R, K, G, PW, PH) => {
  const PATCH_SD = ${PATCH_SD};
  const D = window.__mk.sides[SIDE], { W } = G, port = SIDE === 'port', [rx0, ry0, rx1, ry1] = R, w = Math.max(1, rx1 - rx0), h = Math.max(1, ry1 - ry0);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d'), id = g.createImageData(w, h), A = id.data;
  for (let y = 0; y < h; y++) A.set(D.subarray(4 * ((ry0 + y) * W + rx0), 4 * ((ry0 + y) * W + rx0 + w)), 4 * y * w);
  const px = (x, y) => { const k = 4 * (Math.min(h - 1, Math.max(0, y)) * w + x); return [A[k], A[k + 1], A[k + 2]]; };
  const avg = (x, ys) => { const t = [0, 0, 0]; for (const y of ys) { const c = px(x, y); t[0] += c[0]; t[1] += c[1]; t[2] += c[2]; } return t.map(v => v / ys.length); };
  const lum = c => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  if (K) {
    const d = 2, a0 = Math.max(0, K[1] - d - ry0), a1 = Math.min(h - 1, K[3] + d - ry0), c0 = Math.max(0, K[0] - d - rx0), c1 = Math.min(w - 1, K[2] + d - rx0);
    for (let x = c0; x <= c1; x++) {
      const up = avg(x, [a0 - 1, a0 - 2, a0 - 3]), dn = avg(x, [a1 + 1, a1 + 2, a1 + 3]), lo = lum(dn) < lum(up) - 60 ? up : dn;
      for (let y = a0; y <= a1; y++) { const t = (y - a0 + 1) / (a1 - a0 + 2), k = 4 * (y * w + x); for (let i = 0; i < 3; i++) A[k + i] = Math.round(up[i] + (lo[i] - up[i]) * t); A[k + 3] = 255; }
    }
  }
  g.putImageData(id, 0, 0);
  const ch = [0, 1, 2].map(i => { const v = []; for (let k = 0; k < A.length; k += 4) v.push(A[k + i]); v.sort((p, q) => p - q); const m = v.reduce((p, q) => p + q, 0) / v.length; return { med: v[v.length >> 1], sd: Math.sqrt(v.reduce((p, q) => p + (q - m) * (q - m), 0) / v.length) }; });
  const hex = '#' + ch.map(c => c.med.toString(16).padStart(2, '0')).join(''), sd = Math.max(...ch.map(c => c.sd));
  if (sd < PATCH_SD) return { paint: hex, sd: +sd.toFixed(1) };
  const o = document.createElement('canvas'); o.width = PW; o.height = PH; const og = o.getContext('2d'); og.imageSmoothingEnabled = true; og.imageSmoothingQuality = 'high';
  if (!port) { og.translate(PW, 0); og.scale(-1, 1); }
  og.drawImage(cv, 0, 0, w, h, 0, 0, PW, PH);
  return { paint: hex, sd: +sd.toFixed(1), patch: o.toDataURL('image/jpeg', 0.88) };
})`;
/** a side's box in its picture's pixels (sorted) @param {number[]} b [z0, z1, y0, y1] */
const pxOfBox = (b, side, G) => {
  const xOf = z => side === 'port' ? (z - (G.zc - G.zr / 2)) / G.zr * G.W : ((G.zc + G.zr / 2) - z) / G.zr * G.W, yOf = y => ((G.yc + G.yr / 2) - y) / G.yr * G.Hp;
  const xa = xOf(b[0]), xb = xOf(b[1]);
  return [Math.max(0, Math.floor(Math.min(xa, xb))), Math.max(0, Math.floor(yOf(b[3]))), Math.min(G.W, Math.ceil(Math.max(xa, xb))), Math.min(G.Hp, Math.ceil(yOf(b[2])))];
};
/** the paint patches for an asset's sides (its marks done): the page's layout, then each side's paint over its box */
async function patches(P, key, out, G, ink) {
  const lay = regLayout(out, key); if (!lay) return;
  for (const [i, side] of ['port', 'starboard'].entries()) {
    if (!out[side]) continue;
    const b = lay.sides[i].out, R = pxOfBox(b, side, G), PW = Math.max(4, Math.round((b[1] - b[0]) * lay.tpm)), PH = Math.max(4, Math.round((b[3] - b[2]) * lay.tpm));
    const r = await P.eval(`${patchFn}(${JSON.stringify(side)}, ${JSON.stringify(R)}, ${JSON.stringify(ink[side] || null)}, ${JSON.stringify(G)}, ${PW}, ${PH})`);
    out[side].paint = r.paint; out[side].paintSd = r.sd;
    if (r.patch) out[side].patch = r.patch; else delete out[side].patch;
  }
}

/** for the review: the side's picture round the box at its own pixels, the box outlined */
const crop = `((SIDE, PX, G) => {
  const D = window.__mk.sides[SIDE], { W, Hp } = G, [x0, y0, x1, y1] = PX, bw = x1 - x0, bh = Math.max(8, y1 - y0);
  const cx0 = Math.max(0, Math.round(x0 - 0.6 * bw)), cx1 = Math.min(W, Math.round(x1 + 0.6 * bw)), cy0 = Math.max(0, Math.round(y0 - 2.5 * bh)), cy1 = Math.min(Hp, Math.round(y1 + 2.5 * bh));
  const cv = document.createElement('canvas'); cv.width = cx1 - cx0; cv.height = cy1 - cy0; const g = cv.getContext('2d'), id = g.createImageData(cv.width, cv.height);
  for (let y = cy0; y < cy1; y++) id.data.set(D.subarray(4 * (y * W + cx0), 4 * (y * W + cx1)), 4 * (y - cy0) * cv.width);
  g.putImageData(id, 0, 0); g.strokeStyle = '#ff2050'; g.lineWidth = 2; g.strokeRect(x0 - cx0 - 1, y0 - cy0 - 1, bw + 2, (y1 - y0) + 2);
  return cv.toDataURL('image/png');
})`;
const REVIEW = path.join(WORK, 'review'); fs.mkdirSync(REVIEW, { recursive: true });
const keys = Object.keys(IX.assets).filter(k => !ONLY || ONLY.has(k));
const result = { v: 1, about: 'Where each hi-fi livery paints its registration: tools/fleet/marks.mjs (LS-106). Per side: box [z0, z1, y0, y1] (station and height, metres, the kit frame), skin (how far out the skin is there, metres), paint and ink (the paint round it and the lettering, sRGB), tpm (the texture\'s texels a metre there), text (what it reads), from (read, the other side, or by hand).', assets: flag('keep') ? { ...OLD.assets } : {} };
const missing = [], unread = [];
const P = await launch({ w: 1280, h: 800 });
try {
  await P.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/?hd=1` });
  for (let i = 0; i < 240; i++) { if (await P.eval('!!(window.__app && __app.frameN > 60 && __app.traffic.lib)').catch(() => false)) break; await sleep(500); }
  for (const key of keys) {
    const t0 = Date.now();
    let G;
    try { G = await P.eval(`${page}(${JSON.stringify(key)})`); } catch (e) { console.log(key, 'failed to draw:', e.message); missing.push(key); continue; }
    const found = {};
    for (const side of ['port', 'starboard']) {
      const f = path.join(WORK, `${key}-${side}.png`);
      fs.writeFileSync(f, Buffer.from(G.sides[side].split(',')[1], 'base64'));
      const readOf = extra => execFileSync(OCR, [f, ...extra.map(String)], { encoding: 'utf8' }).split('\n').filter(Boolean).map(l => { const [text, conf, b] = l.split('\t'); return { text, conf: +conf, box: b.split(',').map(Number) }; }).map(l => ({ ...l, reg: asReg(l.text) })).filter(l => l.reg && l.conf >= 0.5);
      // the whole side, and its aft part in tiles (Vision reads a big picture scaled down: small lettering is missed)
      const regs = [...readOf([]), ...readOf(side === 'port' ? [Math.round(0.3 * G.W), 0, G.W, G.Hp, 1600, 800] : [0, 0, Math.round(0.7 * G.W), G.Hp, 1600, 800])];
      // readings of one place clustered; the place with the most readings; there, a full-length reading before a partial
      // one (N44 of N449UA), then the one made most, then the longest; its box, the middle one of those readings
      const near = (p, q) => { const ix = Math.max(0, Math.min(p[2], q[2]) - Math.max(p[0], q[0])), iy = Math.max(0, Math.min(p[3], q[3]) - Math.max(p[1], q[1])); return ix * iy > 0.3 * Math.min((p[2] - p[0]) * (p[3] - p[1]), (q[2] - q[0]) * (q[3] - q[1])); };
      const groups = []; for (const r of regs) { const g = groups.find(gr => gr.some(q => near(q.box, r.box))); if (g) g.push(r); else groups.push([r]); }
      groups.sort((p, q) => q.length - p.length || Math.max(...q.map(r => r.box[3] - r.box[1])) - Math.max(...p.map(r => r.box[3] - r.box[1])));
      if (groups.length) {
        const g = groups[0], by = new Map(); for (const r of g) by.set(r.reg, (by.get(r.reg) || 0) + 1);
        const reg = [...by.entries()].sort((p, q) => (q[0].length >= 4) - (p[0].length >= 4) || q[1] - p[1] || q[0].length - p[0].length)[0][0];
        const hits = g.filter(r => r.reg === reg).sort((p, q) => (p.box[3] - p.box[1]) - (q.box[3] - q.box[1]));
        found[side] = { reg, box: hits[hits.length >> 1].box, n: g.length };
      }
    }
    const out = {};
    for (const side of ['port', 'starboard']) {
      const fix = FIX[key] && FIX[key][side];
      const r = fix ? { box: fix.px, reg: fix.text } : found[side] || found[side === 'port' ? 'starboard' : 'port'];
      if (!r) continue;
      let box = r.box;
      if (!fix && !found[side]) box = [G.W - r.box[2], r.box[1], G.W - r.box[0], r.box[3]];   // the other side's, mirrored along the station
      const m = await P.eval(`${measure}(${JSON.stringify(side)}, ${JSON.stringify(box)}, ${JSON.stringify(G)}, ${!!(fix && fix.exact)})`);
      const h = m.box[3] - m.box[2];
      // the other side's place with no lettering found there (a 4 cm "box"): this side's own is elsewhere, unread
      if (!fix && !found[side] && (h < 0.12 || !m.tris)) { console.log(`  ${key} ${side}: unread, and not where the other side's is`); continue; }
      const washed = lum(m.ink) > 0.12 && lum(m.paint) > 0.45;   // (light lettering on light paint: a bake's blur; on dark paint it's painted light)
      out[side] = { ...m, ink: washed ? INK[AL[key]] || INK.default : m.ink, ...(washed ? { inkPainted: m.ink } : {}), ...(fix && fix.capH ? { capH: fix.capH } : {}), text: r.reg, from: fix ? 'by hand' : found[side] ? 'read' : 'other side' };
      const url = await P.eval(`${crop}(${JSON.stringify(side)}, ${JSON.stringify(m.px)}, ${JSON.stringify(G)})`);
      fs.writeFileSync(path.join(REVIEW, `${key}-${side}.png`), Buffer.from(url.split(',')[1], 'base64'));
    }
    const ink = {}; for (const side of ['port', 'starboard']) if (out[side]) { ink[side] = out[side].px; delete out[side].px; }
    await patches(P, key, out, G, ink);
    await P.eval(`(() => { const L = __app.traffic.lib; for (const [k, h] of L.cache) { h.dispose(); } L.cache.clear(); return 1; })()`);
    if (!out.port && !out.starboard) { missing.push(key); console.log(key.padEnd(34), 'no registration read'); unread.push(key); continue; }
    result.assets[key] = out;
    const s = side => out[side] ? `${out[side].text} ${out[side].from === 'read' ? '' : '(' + out[side].from + ') '}${(out[side].box[3] - out[side].box[2]).toFixed(2)} m ${out[side].tpm}/m` : '—';
    console.log(key.padEnd(34), 'port', s('port').padEnd(32), 'starboard', s('starboard').padEnd(32), `${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
  // liveries with no registration painted (marks-none.json: checked by eye on their pictures): nothing to paint out,
  // and the aircraft's own goes where another livery of the same airframe paints its (the same model, so the same frame)
  const NONEF = path.join(HERE, 'marks-none.json'), NONE = fs.existsSync(NONEF) ? JSON.parse(fs.readFileSync(NONEF, 'utf8')) : {};
  const airframeOf = k => { const a = IX.assets[k]; return a && a.reverse ? a.reverse.template : k; };
  for (const key of unread.filter(k => NONE[k])) {
    const donors = Object.keys(result.assets).filter(k => airframeOf(k) === airframeOf(key) || (IX.assets[k].label === IX.assets[key].label && (IX.assets[k].credits || '').split('+').some(c => (IX.assets[key].credits || '').includes(c))));
    const donor = NONE[key].donor || donors.find(k => AL[k] === AL[key]) || donors[0];
    if (!donor) { console.log(key.padEnd(34), 'none painted, and no other livery of its airframe to place one from'); continue; }
    let G; try { G = await P.eval(`${page}(${JSON.stringify(key)})`); } catch (e) { console.log(key, 'failed to draw:', e.message); continue; }
    const out = {};
    for (const side of ['port', 'starboard']) {
      const d = result.assets[donor][side] || result.assets[donor][side === 'port' ? 'starboard' : 'port'], [z0, z1, y0, y1] = d.box;
      const xOf = z => side === 'port' ? (z - (G.zc - G.zr / 2)) / G.zr * G.W : ((G.zc + G.zr / 2) - z) / G.zr * G.W, yOf = y => ((G.yc + G.yr / 2) - y) / G.yr * G.Hp;
      const px = [Math.round(Math.min(xOf(z0), xOf(z1))), Math.round(yOf(y1)), Math.round(Math.max(xOf(z0), xOf(z1))), Math.round(yOf(y0))];
      const m = await P.eval(`${measure}(${JSON.stringify(side)}, ${JSON.stringify(px)}, ${JSON.stringify(G)}, true)`);
      // at the donor's place (its lettering's middle and foot), as tall as the US minimum and six characters wide (no old
      // lettering here to size it by)
      const zm = (d.box[0] + d.box[1]) / 2, w6 = 0.305 * (5 * 2 / 3 + 1 / 6) + (0.305 / 6) * 5;
      out[side] = { ...m, box: [+(zm - w6 / 2).toFixed(3), +(zm + w6 / 2).toFixed(3), d.box[2], +(d.box[2] + 0.305).toFixed(3)], ink: INK[AL[key]] || INK.default, text: null, from: `none painted: placed as ${donor}` };
      const url = await P.eval(`${crop}(${JSON.stringify(side)}, ${JSON.stringify(m.px)}, ${JSON.stringify(G)})`);
      fs.writeFileSync(path.join(REVIEW, `${key}-${side}.png`), Buffer.from(url.split(',')[1], 'base64'));
      delete out[side].px;
    }
    await patches(P, key, out, G, {});   // (no old lettering to fill in)
    await P.eval(`(() => { const L = __app.traffic.lib; for (const [k, h] of L.cache) { h.dispose(); } L.cache.clear(); return 1; })()`);
    result.assets[key] = out; missing.splice(missing.indexOf(key), 1);
    console.log(key.padEnd(34), `none painted: placed as ${donor}`);
  }
} finally { P.close(); await sleep(400); }
result.none = flag('keep') ? [...new Set([...(OLD.none || []).filter(k => !keys.includes(k)), ...missing])] : missing;   // (--keep: the others' as they were)
fs.writeFileSync(OUTF, JSON.stringify(result, null, 1) + '\n');
console.log(`${Object.keys(result.assets).length} of ${keys.length} assets with a registration; none read: ${missing.join(', ') || '—'}`);
process.exit(0);

#!/usr/bin/env node
// Our crowd's liveries on the library's airframes (the reverse bake; D-149, prototype 29845d1; D-155 "Yes, as a
// stop-gap"): a pair the crowd wears a sibling bake or a traced livery for (shared/fleet-bakes.json), of a type the
// library has an airframe of but no livery for that airline, gets a hi-fi model in that same paint. The bake writes a
// library livery into the kit's layout; this writes the crowd's kit-layout livery into one of the library's liveries of
// the type (the template), so the swap on selection keeps the paint.
//
// Since the size match the hi-fi bodies lie on the kit's (kitFit), so each texel of a template image has a surface point
// with a station and an angle on the kit's body, or a place in the kit fin's box. In the app's page (headless Chrome,
// through the app's own renderer: the template's compressed textures live in its context), each image the template's
// materials map is redrawn in its own UV space at its own size: the template copied (alpha kept), then every part using
// it drawn at its UVs, its fuselage texels from the crowd's body image (station, angle), its fin's from the fin image
// (the fin's box), the engines' cowls and the winglets in the crowd's flat colours; the rest (wings, gear, the engines'
// cores, decal parts off the skin) keep the template's.
//
// Licences: a combined image carries both. GPL paint combines with GPL paint of a version both allow; CC BY 4.0 and CC0
// with any GPL; CC BY-SA 4.0 only into GPL-3.0 (config.mjs GPL_VERSIONS and gplVersions: each package's own notice).
// A pair whose licences don't combine is left out and listed; one that could only go out as GPL-3.0 too, unless --gpl3
// (the credits page and the source say GPL-2.0 today). --or-later reads the library's "gpl-2.0-or-later" records as
// they are. --painted ICAO|AL,… draws listed pairs from the crowd painter's recreation (liveries.js: ours) instead of
// their bake or trace.
//
// Out: per pair the redrawn images (PNG, the preferred form: data/fleet/reverse/src/, carried by the source bundle), their
// KTX2 (the converter's rule: ETC1S where it keeps 37 dB, else UASTC), the template's glTF and lite glTF with the images
// swapped (content-hashed, with .br/.gz twins), all in data/fleet/out (/m/); the asset in data/fleet/out/report.json and
// shared/fleet.json with `reverse` and `livery`, and types[ICAO][airline] → it. Cached by everything a drawing reads (the
// template's files, the livery's images and colours, the kit's files, this tool): an unchanged pair isn't redrawn. The
// converter keeps these assets while their template is unchanged (fleet-convert.mjs) and drops them when it changes.
//   node tools/fleet/reverse.mjs [--port 8083] [--only ICAO|AL,…] [--list] [--gpl3] [--or-later] [--painted ICAO|AL,…]
// The page must serve the converter's output at /m/ (the server with FLEET_DIR=data/fleet/out). Needs basisu 2.50.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { launch, sleep } from './cdp.mjs';
import { decodePNG, encodePNG } from './image.mjs';
import { unwindow } from './unwindow.mjs';
import { kitFor, isFreighter } from './kitkey.mjs';
import { TEX, gplVersions, GPL_VERSIONS } from './config.mjs';
import { CARGO_OPS } from '../../server/src/core/registry.js';
import { LIVERIES } from '../../client/js/liveries.js';

const args = process.argv.slice(2), opt = (k, d) => (args.includes('--' + k) ? args[args.indexOf('--' + k) + 1] : d), flag = k => args.includes('--' + k);
const HERE = path.dirname(new URL(import.meta.url).pathname), ROOT = path.resolve(HERE, '../..');
const PORT = +opt('port', 8083), OUT = path.join(ROOT, 'data/fleet/out'), WORK = path.join(ROOT, 'data/fleet/reverse'), SRC = path.join(WORK, 'src'), CACHE = path.join(WORK, 'cache');
const GPL3 = flag('gpl3'), OR_LATER = flag('or-later'), LIST = flag('list');
const ONLY = opt('only') ? new Set(opt('only').split(',')) : null, PAINTED = new Set((opt('painted', '') || '').split(',').filter(Boolean));
const IXF = path.join(ROOT, 'shared/fleet.json'), RPF = path.join(OUT, 'report.json'), BKF = path.join(ROOT, 'shared/fleet-bakes.json');
const IX = JSON.parse(fs.readFileSync(IXF, 'utf8')), RP = JSON.parse(fs.readFileSync(RPF, 'utf8')), BK = JSON.parse(fs.readFileSync(BKF, 'utf8'));
for (const d of [SRC, CACHE]) fs.mkdirSync(d, { recursive: true });
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const fileSha = f => sha(fs.readFileSync(f));

/* ---------------- the pairs ---------------- */
const ours = k => !!(RP.assets[k] && RP.assets[k].reverse);
const own = (code, al) => { const k = IX.types[code] && IX.types[code][al]; return k && RP.assets[k] && !ours(k) ? k : null; };
const templatesOf = code => [...new Set(Object.values(IX.types[code] || {}))].filter(k => RP.assets[k] && !ours(k) && !RP.assets[k].special);
const credOf = k => IX.credits[RP.assets[k].credits] || RP.credits[RP.assets[k].credits] || { sources: [], licences: [] };
/** the GPL versions an asset's paint may go out under: every source package's, intersected ([] if one is unknown) */
// (a package the library records as unknown counts where its own notice is read into config.mjs GPL_VERSIONS: CRJ700-family)
const versionsOf = k => { const c = credOf(k); if (!c.sources.length || c.sources.some(s => !/^gpl/.test(s.licence || '') && !GPL_VERSIONS[s.repo])) return []; return c.sources.reduce((v, s) => v.filter(x => gplVersions(s.repo, s.licence, OR_LATER).includes(x)), [2, 3]); };
const cands = [];
for (const [bkey, e] of Object.entries(BK.liveries)) {
  if (!e || (!e.sibling && !e.traced)) continue;   // an own-type bake: the library has the pair
  const [kit, al] = bkey.split('|'), cargo = CARGO_OPS.has(al);
  for (const code of Object.keys(IX.types).sort()) {
    if (own(code, al) || kitFor(code, cargo) !== kit) continue;   // the library has it, or the client draws this code otherwise
    const tpls = templatesOf(code); if (!tpls.length) continue;
    const id = `${code}|${al}`; if (ONLY && !ONLY.has(id)) continue;
    const painted = PAINTED.has(id);
    // the livery's own licence: ours (the painter's), a trace's photos, or the library paint a sibling was baked from
    cands.push(candidate(id, code, al, kit, bkey, e, cargo, painted, tpls));
  }
}
// --painted pairs the bakes have no entry for (16 Nov: an airline the library has no livery of in the type's family,
// at the other regions' airports: Delta's A330-900, JetBlue's A220-300, El Al's 787-9, American's 777-300ER): drawn
// from the painter alone, as the crowd paints them (no bake), until a trace replaces them
for (const id of PAINTED) {
  if (cands.some(c => c.id === id)) continue;
  const [code, al] = id.split('|'), cargo = CARGO_OPS.has(al), kit = kitFor(code, cargo), tpls = templatesOf(code);
  if (own(code, al) || !tpls.length || (ONLY && !ONLY.has(id))) { console.log(`  ${id}: ${own(code, al) ? 'the library has it' : 'no library airframe of the type'}`); continue; }
  cands.push(candidate(id, code, al, kit, `${kit}|${al}`, { src: `painted:${al}`, painted: true }, cargo, true, tpls));
}
/** a pair's template and licence: the airframe a cargo airline flies (a freighter) or a passenger one; a licence both
 * allow, GPL-2.0 first; the fewest packages (the simplest credits); then by name */
function candidate(id, code, al, kit, bkey, e, cargo, painted, tpls) {
  const sv = painted ? [2, 3] : e.traced ? (/SA/i.test(e.licence || '') ? [3] : [2, 3]) : versionsOf(e.src);
  const lic = painted ? 'ours (liveries.js)' : e.traced ? `${e.licence} (traced from photos)` : `GPL paint of ${e.src}`;
  const scored = tpls.map(k => { const v = versionsOf(k).filter(x => sv.includes(x)); return { k, v, fr: isFreighter(k, RP.assets[k].label) === cargo ? 1 : 0, n: credOf(k).sources.length }; });
  const fit = scored.filter(s => s.v.length).sort((p, q) => q.fr - p.fr || +q.v.includes(2) - +p.v.includes(2) || p.n - q.n || p.k.localeCompare(q.k));
  const pick = fit.find(s => s.v.includes(2)) || (GPL3 ? fit[0] : null);
  const why = pick ? null : fit.length ? `only as GPL-3.0 (${lic} onto ${fit[0].k}; --gpl3)` : `licences don't combine (${lic} onto ${tpls.map(k => `${k}: GPL-${versionsOf(k).join('/') || '?'}`).join(', ')})`;
  return { id, code, al, kit, bkey, e, cargo, painted, lic, tpl: pick && pick.k, gpl: pick ? (pick.v.includes(2) ? 2 : 3) : null, why };
}
const todo = cands.filter(c => c.tpl), held = cands.filter(c => !c.tpl);
console.log(`reverse bake: ${cands.length} pairs the crowd has a livery for and the library an airframe of; ${todo.length} to draw, ${held.length} held`);
for (const c of cands) console.log(`  ${c.id.padEnd(10)} ${c.bkey.padEnd(18)} ${c.painted ? 'painted' : c.e.traced ? 'traced ' : 'sibling'} → ${c.tpl ? `${c.tpl} (GPL-${c.gpl})` : `held: ${c.why}`}`);
if (LIST) process.exit(0);

/* ---------------- the livery's images, the cache key ---------------- */
const traceDir = (kit, al) => {
  const base = path.join(ROOT, 'data/fleet/trace/out');
  for (const d of fs.readdirSync(base)) { if (!d.startsWith(al + '-')) continue; try { if (JSON.parse(fs.readFileSync(path.join(base, d, 'project.json'), 'utf8')).kit === kit) return path.join(base, d); } catch { /* no project */ } }
  throw new Error(`no trace folder for ${kit}|${al} in data/fleet/trace/out`);
};
const imagesOf = c => {
  if (c.painted) return null;
  if (c.e.traced) { const d = traceDir(c.kit, c.al); return { body: path.join(d, 'body-clean.png'), fin: path.join(d, 'fin-clean.png') }; }
  return { body: path.join(ROOT, 'data/fleet/bake/src', c.e.srcPng.body), fin: path.join(ROOT, 'data/fleet/bake/src', c.e.srcPng.fin) };
};
const kitDir = path.join(ROOT, 'client/vendor/airliners');
const kitHash = sha(fs.readdirSync(kitDir).filter(f => f.endsWith('.js')).sort().map(f => fileSha(path.join(kitDir, f))).join() + fileSha(path.join(ROOT, 'client/js/kitfix.js')));
const selfHash = sha(fileSha(new URL(import.meta.url).pathname) + fileSha(path.join(HERE, 'unwindow.mjs'))), painterHash = fileSha(path.join(ROOT, 'client/js/liveries.js'));
const assetKey = c => `${RP.assets[c.tpl].airframe || c.tpl.split('-')[0]}-${c.al.toLowerCase()}-rb`;
for (const c of todo) {
  c.key = assetKey(c); c.imgs = imagesOf(c);
  if (c.imgs) for (const f of Object.values(c.imgs)) if (!fs.existsSync(f)) throw new Error(`${c.id}: ${path.relative(ROOT, f)} missing (bake or trace it first)`);
  const T = RP.assets[c.tpl], colors = { cowl: c.e.cowl, winglet: c.e.winglet };
  c.hash = sha(JSON.stringify([selfHash, kitHash, c.painted ? painterHash : '', T.gltf, T.lite, c.imgs ? [fileSha(c.imgs.body), fileSha(c.imgs.fin)] : null, colors, c.kit, c.al]));
  const f = path.join(CACHE, `${c.key}.json`), m = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
  c.cached = m && m.hash === c.hash && [m.entry.gltf, m.entry.lite, ...m.images].every(p => fs.existsSync(path.join(OUT, p))) ? m : null;
}

/* ---------------- drawing, in the page ---------------- */
async function pageReverse(o) {
  const app = window.__app, M = app.models;
  { const { kitFiles } = await import('/js/models.js'); if (kitFiles.pending(o.kit) && !(await kitFiles.ready(o.kit, true))) throw new Error('kit file for ' + o.kit + ' failed to load'); }   // (a type whose kit file loads late: kitondemand.js)
  const { LibModels } = await import('/js/libmodel.js');
  const { liveryFor, registerLivery, paintTail } = await import('/js/liveries.js');
  const lib = new LibModels(M, app.r, { keep: 2 }), ix = await lib.loadIndex();
  const H = await lib.load({ key: o.tpl, a: ix.assets[o.tpl], base: ix.base || '/m/' });
  H.pose({ gear: 1, flaps: 0, spoilers: 0, reversers: 0, fanDeg: 0, wow: 1 }, true);
  // the kit's type (its section, fin box, engines, span) and, when drawn from the painter, its body and fin canvases
  const L = liveryFor(o.al, o.name); registerLivery(L.key, L.spec);
  const G = AIRLINER.build(o.kit, L.key, o.painted ? { tw: 4096, th: 1024 } : { tw: 512, th: 128 }), Pn = G.userData.paint, T = G.userData.T;
  if (o.painted && T.builder !== 'small') paintTail(T, L.spec, Pn.canvases.fin);
  const ct = c => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.needsUpdate = true; return t; };
  // a bake's or trace's images (PNG, the canvas's row order: flipY as a canvas texture)
  const it = async url => { const im = new Image(); im.src = url; await im.decode(); const t = new THREE.Texture(im); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.needsUpdate = true; return t; };
  let bodyT = o.body ? await it(o.body) : ct(Pn.canvases.body); const finT = o.fin ? await it(o.fin) : ct(Pn.canvases.fin), box = Pn.finBox;
  // the kit's section along the body (bake.mjs's): hw, tp, bt, md from the centreline at yc, and the superellipse's n
  const p = M.proto(o.kit), fn = p.fn, Lk = T.L, yc = T.fus.yc, eAt = fn.eAt || (() => 2 / (T.fus.n || 2)), N = 2048, sec = new Float32Array(N * 2 * 4);
  for (let i = 0; i < N; i++) { const s = (i + 0.5) / N * Lk; sec.set([fn.hw(s), fn.tp(s), fn.bt(s), fn.md(s)], i * 4); sec[(N + i) * 4] = eAt(s); }
  const secTex = new THREE.DataTexture(sec, N, 2, THREE.RGBAFormat, THREE.FloatType); secTex.needsUpdate = true;
  const SA = `uniform sampler2D uSec; uniform float uL; uniform float uN; uniform float uYc;
    vec4 bkSec(float s) { float i = min(floor(clamp(s / uL, 0.0, 1.0) * uN), uN - 1.0); return texture2D(uSec, vec2((i + 0.5) / uN, 0.25)); }
    float bkE(float s) { float i = min(floor(clamp(s / uL, 0.0, 1.0) * uN), uN - 1.0); return texture2D(uSec, vec2((i + 0.5) / uN, 0.75)).x; }
    vec3 bkSA(vec3 p) {   // station, angle round the kit's section (0 at the belly, pi at the crown), radius in its units
      float s = p.z; vec4 sc = bkSec(s); float e = bkE(s), y = p.y - uYc;
      float X = p.x / max(sc.x, 0.02), Y = y >= sc.w ? (y - sc.w) / max(sc.y - sc.w, 0.02) : (y - sc.w) / max(sc.w - sc.z, 0.02);
      float sa = sign(X) * pow(abs(X), 1.0 / e), nc = sign(Y) * pow(abs(Y), 1.0 / e);
      float a = atan(sa, -nc); if (a < 0.0) a += 6.28318531;
      return vec3(s, a, length(vec2(sa, nc)));
    }
    vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }\n`;
  // the engines (the kit's, at the published stations: the hi-fi's lie on them; up to two pairs, T.engines on four-engine
  // types) take the cowl colour; the winglets (not on raked tips, which the kit doesn't paint apart) the winglet colour
  const Es = (T.engines && T.engines.length ? T.engines : T.engine ? [T.engine] : []).slice(0, 2);
  // ... measured on the hi-fi itself (15 Nov): on its fans' spin axes (the library's engines can sit a little off the
  // kit's: the A320neo's 0.10 m further out and 0.16 m higher, which left the template's paint, Avianca's red, JetBlue's
  // blue, on the nacelles' tops), from its own inlet lips (the front of what lies within the kit's nacelle radius of the
  // axis), the kit's nacelle length aft; within them only the cowl's outside takes the colour: the lip (its first 9 % of
  // the nacelle's diameter) and the inlet's inside keep the template's bare metal, as on the real engines
  const axes = []; for (const m of H.L.motions || []) if (m.t === 's' && m.p && m.p[0] > 1.5 && !axes.some(b => Math.abs(b[0] - m.p[0]) < 0.5)) axes.push([m.p[0], m.p[1]]);
  axes.sort((a, b) => a[0] - b[0]);
  const lipOf = (E, ax) => {
    const v = new THREE.Vector3(), R = (E.dMax || 0) / 2 + 0.1; let z = Infinity;
    for (const part of H.parts) { const pos = part.geometry.attributes.position; if (!pos) continue; for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(part.matrix); if (v.x < 0 || v.z < E.lipZ - 2.5 || v.z > E.lipZ + 0.5 * E.len) continue; if (Math.hypot(v.x - ax[0], v.y - ax[1]) < R) z = Math.min(z, v.z); } }
    return z < Infinity ? z : E.lipZ;
  };
  const engs = Es.map((E, i) => { const ax = axes.length === Es.length ? axes[i] : [E.x || 0, E.y || 0], z0 = lipOf(E, ax); return { x: ax[0], y: ax[1], z0, z1: z0 + (E.len || 0), R: (E.dMax || 0) / 2 + 0.3, lip: z0 + 0.09 * (E.dMax || 0) }; });
  const eng = i => { const e = engs[i]; return e ? new THREE.Vector4(e.x, e.y, e.z0 - 0.3, e.z1 + 0.3) : new THREE.Vector4(0, -99, 0, 0); };
  const engR = i => (engs[i] ? engs[i].R : 0);
  const cw = new THREE.Color(o.cowl || L.spec.cowl || '#c9ced4'), wl = new THREE.Color(o.winglet || L.spec.winglet || L.spec.tail || '#c9ced4');
  const tipKind = T.wing && T.wing.tip && T.wing.tip.kind, uTip = tipKind && tipKind !== 'raked' ? T.span / 2 - 1.0 : 1e9;
  // the fins, each measured on its own (bake.mjs's way, the other direction): the hi-fi's leading and trailing edges as
  // lines over its height, fitted to its points above the kit's crown (the root's fillet left out), its root and top;
  // the kit's from its type (T.fin). A hi-fi fin texel maps onto the kit's fin by span and chord fraction, so the art
  // lands where the crowd shows it even where the two fins stand apart (the library's 777 fins stood half a metre forward
  // of the kit's after its v0.8 batch 3, the ACAP's, until the converter's FIN_FIX)
  const Fi = T.fin, ybK = yc + Fi.yBase, tanS = Math.tan(Fi.sweepLE * Math.PI / 180), kRoot = yc + fn.tp(Math.min(Lk, Fi.rootZ + Fi.rootChord * 0.5)), kTop = ybK + Fi.height;
  const finH = (() => {
    // (points sampled every 25 cm across each triangle: a fin is a few large quads, its vertices only at the root and tip)
    const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), P = new THREE.Vector3(), pts = [];
    const finPt = q => Math.abs(q.x) < 0.6 && q.z > 0.55 * Lk && q.y > yc + fn.tp(Math.min(q.z, Lk * 0.999)) + 0.3;
    for (const part of H.parts) {
      const g = part.geometry, pos = g.attributes.position, idx = g.index; if (!pos) continue;
      const n = idx ? idx.count : pos.count, at = k => (idx ? idx.getX(k) : k);
      for (let q = 0; q < n; q += 3) {
        A.fromBufferAttribute(pos, at(q)).applyMatrix4(part.matrix); B.fromBufferAttribute(pos, at(q + 1)).applyMatrix4(part.matrix); C.fromBufferAttribute(pos, at(q + 2)).applyMatrix4(part.matrix);
        if (!(finPt(A) || finPt(B) || finPt(C))) continue;
        const K = Math.min(60, Math.max(1, Math.ceil(Math.max(A.distanceTo(B), B.distanceTo(C), C.distanceTo(A)) / 0.25)));
        for (let i = 0; i <= K; i++) for (let j = 0; j <= K - i; j++) { P.copy(A).addScaledVector(B.clone().sub(A), i / K).addScaledVector(C.clone().sub(A), j / K); if (finPt(P)) pts.push(P.y, P.z); }
      }
    }
    if (pts.length < 60) return null;
    let y0 = 1e9, y1 = -1e9; for (let i = 0; i < pts.length; i += 2) { y0 = Math.min(y0, pts[i]); y1 = Math.max(y1, pts[i]); }
    const NB = 24, le = new Array(NB).fill(1e9), te = new Array(NB).fill(-1e9);
    for (let i = 0; i < pts.length; i += 2) { const b = Math.min(NB - 1, Math.floor((pts[i] - y0) / (y1 - y0) * NB)); le[b] = Math.min(le[b], pts[i + 1]); te[b] = Math.max(te[b], pts[i + 1]); }
    const fit = arr => { let n = 0, sy = 0, sz = 0, syy = 0, syz = 0; for (let b = Math.floor(NB * 0.15); b < NB - 1; b++) { if (arr[b] > 1e8 || arr[b] < -1e8) continue; const y = y0 + (b + 0.5) / NB * (y1 - y0); n++; sy += y; sz += arr[b]; syy += y * y; syz += y * arr[b]; } const k = (n * syz - sy * sz) / Math.max(1e-9, n * syy - sy * sy); return [k, (sz - k * sy) / Math.max(1, n)]; };
    const [kL, cL] = fit(le), [kT, cT] = fit(te);
    return { kL, cL, kT, cT, y0, y1 };
  })();
  // the hi-fi's tail cone tip: its furthest point aft near the centreline, about the height of the kit's tail axis (its
  // overall length can run to the tailplanes' tips, the 777's 73.86 m, or to the rudder)
  const tailTip = () => {
    const v = new THREE.Vector3(), yAx = yc + fn.md(Lk * 0.999); let z = 0;
    for (const part of H.parts) { const pos = part.geometry.attributes.position; if (!pos) continue; for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(part.matrix); if (Math.abs(v.x) < 0.4 && Math.abs(v.y - yAx) < 1.2 && v.z > z) z = v.z; } }
    return z > Lk - 0.8 && z < Lk + 3 ? z : Lk;   // (outside that, the window missed the tip: the kit's own length)
  };
  // the template's own cabin windows (16 Nov, the user: "a lot of livery issues like this - the windows"): its panes are
  // geometry of their own, drawn over the paint, so the crowd's painted windows (a sibling's at its own spacing, a
  // photo's, the painter's) copied into the paint doubled them: uneven blobs, over the titles. Where the template has
  // panes in its cabin, the crowd's windows go from its body image first (unwindow.mjs, its source put in this page: each
  // flank's row of window-like blobs on one line, filled from the paint round them; a title's letters, a logo, a stripe
  // stay), and the panes are the windows. A template whose windows are painted (no panes: the A330s', the A380's cabin
  // masks) or a freighter keeps the crowd's as they are.
  const win = (() => {
    const v = new THREE.Vector3(), Lh = H.dims.L, panes = H.parts.filter(pt => H.cabinFlat.includes(pt.material)); let n = 0;
    for (const pt of panes) { const pos = pt.geometry.attributes.position; for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(pt.matrix); if (v.z > 0.15 * Lh && v.z < 0.85 * Lh) n++; } }
    return n >= 100 ? { n } : null;
  })();
  if (win) {
    const src = bodyT.image, cv = document.createElement('canvas'); cv.width = src.width; cv.height = src.height;
    const g = cv.getContext('2d'); g.drawImage(src, 0, 0);
    const id = g.getImageData(0, 0, cv.width, cv.height); win.removed = unwindow(id.data, cv.width, cv.height).removed; g.putImageData(id, 0, 0);
    bodyT.dispose(); bodyT = new THREE.CanvasTexture(cv); bodyT.colorSpace = THREE.SRGBColorSpace; bodyT.anisotropy = 8; bodyT.needsUpdate = true;
  }
  const U = { uSec: { value: secTex }, uL: { value: Lk }, uN: { value: N }, uYc: { value: yc }, uBody: { value: bodyT }, uFin: { value: finT },
    uEng0: { value: eng(0) }, uEngR0: { value: engR(0) }, uEng1: { value: eng(1) }, uEngR1: { value: engR(1) }, uLip: { value: new THREE.Vector2(engs[0] ? engs[0].lip : 0, engs[1] ? engs[1].lip : 0) },
    uCowl: { value: new THREE.Vector3(cw.r, cw.g, cw.b) }, uWl: { value: new THREE.Vector3(wl.r, wl.g, wl.b) }, uTip: { value: uTip }, uLh: { value: tailTip() }, uMask: { value: 0 },
    uFinH: { value: finH ? new THREE.Vector4(finH.kL, finH.cL, finH.kT, finH.cT) : new THREE.Vector4(tanS, Fi.rootZ - tanS * ybK, tanS, Fi.rootZ + Fi.rootChord - tanS * ybK) }, uFinHy: { value: finH ? new THREE.Vector2(finH.y0, finH.y1) : new THREE.Vector2(kRoot, kTop) },
    uFinK: { value: new THREE.Vector4(Fi.rootZ, ybK, Fi.height, tanS) }, uFinKc: { value: new THREE.Vector4(Fi.rootChord, Fi.tipChord, kRoot, kTop) },
    uBox: { value: new THREE.Vector4(box.z0, box.z1, box.y0, box.y1) }, uXf: { value: new THREE.Matrix3() }, uTpl: { value: null }, uSize: { value: new THREE.Vector2() } };
  const paintMat = new THREE.ShaderMaterial({
    uniforms: U, side: THREE.DoubleSide, depthTest: false, depthWrite: false,
    vertexShader: `uniform mat3 uXf; varying vec3 vW; varying vec3 vN; void main() { vW = (modelMatrix * vec4(position, 1.0)).xyz; vN = normalize(mat3(modelMatrix) * normal); vec2 t = (uXf * vec3(uv, 1.0)).xy; gl_Position = vec4(t * 2.0 - 1.0, 0.0, 1.0); }`,
    fragmentShader: SA + `uniform sampler2D uBody; uniform sampler2D uFin; uniform sampler2D uTpl; uniform vec2 uSize; uniform vec4 uBox; uniform vec4 uEng0; uniform float uEngR0; uniform vec4 uEng1; uniform float uEngR1;
      uniform vec3 uCowl; uniform vec3 uWl; uniform float uTip; uniform float uLh; uniform float uMask; uniform vec4 uFinH; uniform vec2 uFinHy; uniform vec4 uFinK; uniform vec4 uFinKc; uniform vec2 uLip; varying vec3 vW; varying vec3 vN;
      // a station on the kit's body: the tail cone (behind 85 % of the kit's length) laid onto the kit's in proportion, as
      // the library's ends a little elsewhere (its tail cones within about 0.5 m of the kit's)
      float kitS(float z) { float zs = 0.85 * uL; return z <= zs ? z : zs + (z - zs) * (uL - zs) / max(uLh - zs, 0.1); }
      // an engine's texel: 1 its cowl's outside (the cowl colour), 2 its lip or inside (the template's own), 0 not this engine's
      int inEng(vec4 E, float R, float lip) {
        if (R < 0.2 || vW.z < E.z || vW.z > E.w) return 0;
        vec2 d = vec2(abs(vW.x) - E.x, vW.y - E.y); float r = length(d); if (r > R) return 0;
        float nr = dot(d / max(r, 0.001), vec2(vN.x * sign(vW.x), vN.y));   // the surface facing out from the axis, or in
        return vW.z < lip || nr < 0.25 ? 2 : 1;
      }
      // (uMask: the same drawing, writing white where it paints: the edge padding below grows the painted texels)
      vec4 put(vec3 c, float a) { return uMask > 0.5 ? vec4(1.0) : vec4(toSRGB(c), a); }
      void main() {
        float a = texture2D(uTpl, gl_FragCoord.xy / uSize).a;   // (the template's alpha stays: a decal keeps its shape)
        int e = max(inEng(uEng0, uEngR0, uLip.x), inEng(uEng1, uEngR1, uLip.y));
        if (e == 1) { gl_FragColor = put(uCowl, a); return; }   // a cowl's outside
        if (e == 2) discard;   // its lip and the inlet's inside: the template's bare metal
        if (abs(vW.x) > uTip) { gl_FragColor = put(uWl, a); return; }   // a winglet
        float s = kitS(vW.z); vec3 b = bkSA(vec3(vW.x, vW.y, s)); vec4 sc = bkSec(s);
        float y = vW.y - uYc;
        // the fin: by its box (the kit's planarUV), above the crown, within the box's length and down to a little below
        // its root; between the crown and that, at the tail, the body's (the library's fin roots sit lower than some of
        // the kit's)
        // the fin: a point of the hi-fi's fin (above the crown, within its planform: span fraction eta from its root, chord
        // fraction xi between its edges) maps to the same fractions on the kit's fin, sampled in the fin canvas's box
        float eta = (vW.y - uFinHy.x) / max(uFinHy.y - uFinHy.x, 0.5), leH = uFinH.x * vW.y + uFinH.y, teH = uFinH.z * vW.y + uFinH.w, xi = (vW.z - leH) / max(teH - leH, 0.3);
        bool finZone = abs(vW.x) < 0.8 && y > sc.y + 0.05 && vW.z > 0.55 * uL && eta > -0.15 && eta < 1.1 && xi > -0.12 && xi < 1.12;
        if (finZone) {
          float yk = uFinKc.z + clamp(eta, 0.0, 1.0) * (uFinKc.w - uFinKc.z), ek = (yk - uFinK.y) / uFinK.z;
          float zk = uFinK.x + (yk - uFinK.y) * uFinK.w + clamp(xi, 0.0, 1.0) * mix(uFinKc.x, uFinKc.y, clamp(ek, 0.0, 1.0));
          gl_FragColor = put(texture2D(uFin, vec2((zk - uBox.x) / (uBox.y - uBox.x), (yk - uBox.z) / (uBox.w - uBox.z))).rgb, a); return; }
        // the body: by station and angle (the painter's layout), within a quarter of the kit's radius. At the nose and the
        // tail cone the two models' shapes part (the library's tail cones up to 0.7 m off the kit's, at the station kitS
        // maps them to) and the kit's section shrinks to a point, so there a texel within the body's span is the body's: 1.4
        // times the kit's half-width (the tailplanes reach far beyond it) and its height with a margin
        bool body = b.z > 0.8 && b.z < 1.25 && s > -0.4 && s < uL + 0.2;
        if (!body && s < 0.12 * uL && s > -1.0) body = abs(vW.x) < max(1.4 * sc.x, 0.6) && y > sc.z - 0.6 && y < sc.y + 0.8;   // the nose
        if (!body && s > 0.85 * uL && s < uL + 0.5) body = abs(vW.x) < max(1.4 * sc.x, 0.9) && y > sc.z - 1.2 && (y < sc.y + 0.8 || eta < 0.1 || (xi > 1.0 && eta < 0.4) || abs(vW.x) >= 0.8);   // the tail cone and what rises from it outside the fin (behind it, or wider than a fin) (the kit's tip sits higher and narrower than some of the library's, its crown lower)
        if (body) {
          gl_FragColor = put(texture2D(uBody, vec2(clamp(b.x / uL, 0.0, 1.0), b.y / 6.28318531)).rgb, a); return;
        }
        discard;
      }`
  });
  // every texel any part of the image covers (its triangles at their UVs): the edge padding grows painted texels only into
  // texels no part uses (the template's own padding round its islands, whose colours bleed into the mips and the edges)
  const coverMat = new THREE.ShaderMaterial({ uniforms: U, side: THREE.DoubleSide, depthTest: false, depthWrite: false,
    vertexShader: `uniform mat3 uXf; void main() { vec2 t = (uXf * vec3(uv, 1.0)).xy; gl_Position = vec4(t * 2.0 - 1.0, 0.0, 1.0); }`,
    fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }' });
  const copyMat = new THREE.ShaderMaterial({ uniforms: U, depthTest: false, depthWrite: false,
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `uniform sampler2D uTpl; uniform vec2 uSize; vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
      void main() { vec4 t = texture2D(uTpl, gl_FragCoord.xy / uSize); gl_FragColor = vec4(toSRGB(t.rgb), t.a); }` });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), copyMat); quad.frustumCulled = false;
  // the app's own renderer (the hi-fi's compressed textures live in its context; a new renderer's samples them black),
  // its target, clear colour and auto-clear put back after
  const R = app.r, prevRT = R.getRenderTarget(), prevCC = R.getClearColor(new THREE.Color()), prevCA = R.getClearAlpha(), prevAC = R.autoClear;
  R.autoClear = false;
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const imgOf = tex => H.texs.findIndex(t => t === tex || (tex && t.source === tex.source));
  const byImg = new Map();
  for (const part of H.parts) { const m = part.material, map = m && m.map; if (!map) continue; const i = imgOf(map); if (i < 0) continue; (byImg.get(i) || byImg.set(i, []).get(i)).push(part); }
  const out = {}, stats = {};
  // an image comes back as PNGs from a 2D canvas: its colour (opaque, so the canvas's premultiplied alpha can't touch
  // it) and, where the template has transparency, its alpha as grey (merged again outside)
  const png = (px, w, h, alpha) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'), im = g.createImageData(w, h);
    for (let r = 0; r < h; r++) for (let x = 0; x < w; x++) { const s = (r * w + x) * 4, d = s; if (alpha) { const a = px[s + 3]; im.data[d] = im.data[d + 1] = im.data[d + 2] = a; } else { im.data[d] = px[s]; im.data[d + 1] = px[s + 1]; im.data[d + 2] = px[s + 2]; } im.data[d + 3] = 255; }
    g.putImageData(im, 0, 0); const u = c.toDataURL('image/png'); c.width = c.height = 1; return u;
  };
  for (const [i, parts] of byImg) {
    const t = H.texs[i], w = (t.image && t.image.width) || (t.mipmaps && t.mipmaps[0] && t.mipmaps[0].width), h = (t.image && t.image.height) || (t.mipmaps && t.mipmaps[0] && t.mipmaps[0].height);
    const rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false }), mk = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false }), cv = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false });
    for (const x of [mk, cv]) { R.setRenderTarget(x); R.setClearColor(0x000000, 0); R.clear(); }
    R.setRenderTarget(rt); R.setClearColor(0x000000, 1); R.clear();
    U.uTpl.value = t; U.uSize.value.set(w, h);
    const sq = new THREE.Scene(); sq.add(quad); R.render(sq, cam);   // the template as it is
    let painted = 0;
    for (const part of parts) {
      const map = part.material.map; map.updateMatrix(); U.uXf.value.copy(map.matrix);
      // without the slivers whose UVs span much of the image (a stray or wrapped coordinate): drawn at their UVs they'd
      // paint a wedge across it (a decal's quad spans its whole image but is metres across: kept)
      const geo = part.geometry, uv = geo.attributes.uv, pos = geo.attributes.position, idx = geo.index, e = map.matrix.elements, keep = [];
      const tu = k => e[0] * uv.getX(k) + e[3] * uv.getY(k) + e[6], tv = k => e[1] * uv.getX(k) + e[4] * uv.getY(k) + e[7];
      const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
      for (let q = 0; q < idx.count; q += 3) {
        const a = idx.getX(q), b = idx.getX(q + 1), c2 = idx.getX(q + 2);
        const du = Math.max(tu(a), tu(b), tu(c2)) - Math.min(tu(a), tu(b), tu(c2)), dv = Math.max(tv(a), tv(b), tv(c2)) - Math.min(tv(a), tv(b), tv(c2));
        if (du < 0.25 && dv < 0.25) { keep.push(a, b, c2); continue; }
        A.fromBufferAttribute(pos, a).applyMatrix4(part.matrix); B.fromBufferAttribute(pos, b).applyMatrix4(part.matrix); C.fromBufferAttribute(pos, c2).applyMatrix4(part.matrix);
        if (B.clone().sub(A).cross(C.clone().sub(A)).length() / 2 > 0.3) keep.push(a, b, c2);
      }
      const g2 = new THREE.BufferGeometry(); for (const [n, at] of Object.entries(geo.attributes)) g2.setAttribute(n, at); g2.setIndex(keep);
      const m = new THREE.Mesh(g2, paintMat); m.matrixAutoUpdate = false; m.matrix.copy(part.matrix); m.matrixWorldNeedsUpdate = true; m.frustumCulled = false;
      const sc = new THREE.Scene(); sc.add(m);
      R.setRenderTarget(rt); U.uMask.value = 0; R.render(sc, cam);     // the paint
      R.setRenderTarget(mk); U.uMask.value = 1; R.render(sc, cam);     // where it painted
      m.material = coverMat; R.setRenderTarget(cv); R.render(sc, cam); // where the part lies at all
      U.uMask.value = 0; painted++; g2.dispose();
    }
    const px = new Uint8Array(w * h * 4), pm = new Uint8Array(w * h * 4), pc = new Uint8Array(w * h * 4);
    R.readRenderTargetPixels(rt, 0, 0, w, h, px); R.readRenderTargetPixels(mk, 0, 0, w, h, pm); R.readRenderTargetPixels(cv, 0, 0, w, h, pc);
    R.setRenderTarget(prevRT); rt.dispose(); mk.dispose(); cv.dispose();
    // edge padding: painted colours grow 8 texels into texels no part covers (each pass, a texel takes the mean of its
    // painted neighbours), so the template's padding colours don't bleed into the edges of our paint or its mips
    let grownN = 0;
    { const N = w * h, done = new Uint8Array(N), free = new Uint8Array(N);
      for (let k = 0; k < N; k++) { done[k] = pm[4 * k] > 127 ? 1 : 0; free[k] = pc[4 * k] > 127 ? 0 : 1; }
      let grown = 0;
      for (let pass = 0; pass < 8; pass++) {
        const add = [];
        for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
          const k = yy * w + xx; if (done[k] || !free[k]) continue;
          let r = 0, g = 0, b = 0, n = 0;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const x2 = xx + dx, y2 = yy + dy; if (x2 < 0 || y2 < 0 || x2 >= w || y2 >= h) continue; const k2 = y2 * w + x2; if (!done[k2]) continue; r += px[4 * k2]; g += px[4 * k2 + 1]; b += px[4 * k2 + 2]; n++; }
          if (n) add.push(k, r / n, g / n, b / n);
        }
        for (let q = 0; q < add.length; q += 4) { const k = add[q]; px[4 * k] = add[q + 1]; px[4 * k + 1] = add[q + 2]; px[4 * k + 2] = add[q + 3]; done[k] = 1; grown++; }
      }
      grownN = grown; }
    // RT row r (from the bottom) is the texture's row r (t = 0 at the first row: glTF's top), written as image row r
    let alpha = false; for (let k = 3; k < px.length; k += 4) if (px[k] < 255) { alpha = true; break; }
    out[i] = { rgb: png(px, w, h, false), a: alpha ? png(px, w, h, true) : null }; stats[i] = { w, h, parts: painted, name: t.name, grown: grownN };
  }
  R.setRenderTarget(prevRT); R.setClearColor(prevCC, prevCA); R.autoClear = prevAC; lib.release(H);
  for (const x of [bodyT, finT, secTex]) x.dispose(); paintMat.dispose(); copyMat.dispose(); coverMat.dispose(); quad.geometry.dispose();
  G.traverse(n => { if (n.geometry) n.geometry.dispose(); });
  return { images: out, stats, texs: H.texs.length, tail: [+U.uLh.value.toFixed(2), +Lk.toFixed(2)], win: win ? win.removed : null };
}

/* ---------------- encoding, files ---------------- */
const run = (cmd, a) => new Promise((res, rej) => execFile(cmd, a, { maxBuffer: 64 << 20 }, (e, o, se) => (e ? rej(new Error(`${cmd}: ${e.message}\n${se}`)) : res(o))));
/** the converter's rule (fleet-convert.mjs ktx2): ETC1S if it keeps TEX.etc1sPsnrPaint dB on this paint, else UASTC */
async function ktx2(pngFile) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-rb-')), enc = async (codec, out) => {
    const a = ['-ktx2', '-mipmap', '-stats', '-file', pngFile, '-output_file', out];
    if (codec === 'uastc') a.push('-uastc', '-uastc_level', String(TEX.uastc.level), '-uastc_rdo_l', String(TEX.uastc.rdo), '-uastc_rdo_d', String(TEX.uastc.dict), '-ktx2_zstandard_level', String(TEX.uastc.zstd));
    else a.push('-comp_level', String(TEX.etc1s.comp), '-q', String(TEX.etc1s.q));
    const m = /RGB Avg:.*?PSNR:\s*([\d.]+)/.exec(await run('basisu', a)); return m ? +m[1] : 0;
  };
  let codec = 'etc1s', psnr = await enc('etc1s', path.join(tmp, 'etc1s.ktx2'));
  if (psnr < TEX.etc1sPsnrPaint) { codec = 'uastc'; psnr = await enc('uastc', path.join(tmp, 'uastc.ktx2')); }
  const buf = fs.readFileSync(path.join(tmp, `${codec}.ktx2`)); fs.rmSync(tmp, { recursive: true, force: true });
  return { buf, codec, psnr };
}
/** a content-hashed output (the converter's put): its .br/.gz twins when it compresses */
function put(dir, ext, buf, compress) {
  const rel = `${dir}/${sha(buf).slice(0, 16)}${ext}`, f = path.join(OUT, rel);
  if (!fs.existsSync(f)) {
    fs.writeFileSync(f, buf);
    if (compress) { fs.writeFileSync(f + '.br', zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } })); fs.writeFileSync(f + '.gz', zlib.gzipSync(buf, { level: 9 })); }
  }
  return rel;
}
const wireOf = rel => { const f = path.join(OUT, rel); return Math.min(fs.statSync(f).size, fs.existsSync(f + '.br') ? fs.statSync(f + '.br').size : Infinity); };
/** a KTX2's GPU bytes on a desktop, from its header: BC1 for opaque ETC1S, else 1 byte a texel (BC3, BC7); mips 4/3.
 * Its data format descriptor says the codec (colour model 163 ETC1S, 166 UASTC) and alpha (ETC1S: a second sample, the
 * alpha slice; UASTC: the first sample's channel RGBA, 3) */
function ktxGpu(rel) {
  const b = fs.readFileSync(path.join(OUT, rel)), w = b.readUInt32LE(20), h = b.readUInt32LE(24), dfd = b.readUInt32LE(48) + 4;
  const size = b.readUInt16LE(dfd + 6), model = b.readUInt8(dfd + 8), samples = (size - 24) / 16, ch0 = b.readUInt8(dfd + 24 + 3) & 0x0f;
  const etc1s = model === 163, alpha = etc1s ? samples > 1 : ch0 === 3;
  return Math.round(w * h * (etc1s && !alpha ? 0.5 : 1) * 4 / 3);
}
/** the credits of a pair drawn from a sibling's library paint: the template's packages and the paint's, as one entry */
function creditsFor(c, T) {
  if (c.painted || c.e.traced || !RP.assets[c.e.src] || RP.assets[c.e.src].credits === T.credits) return T.credits;
  const a = T.credits, b = RP.assets[c.e.src].credits, key = [...new Set([...a.split('+'), ...b.split('+')])].join('+');
  if (!RP.credits[key]) {
    const A = RP.credits[a] || IX.credits[a], B = RP.credits[b] || IX.credits[b], src = new Map();
    for (const s of [...(A ? A.sources : []), ...(B ? B.sources : [])]) if (!src.has(s.id)) src.set(s.id, s);
    RP.credits[key] = { ...(A || {}), id: key, licences: [...new Set([...(A ? A.licences : []), ...(B ? B.licences : [])])], sources: [...src.values()] };
  }
  const C = RP.credits[key];
  IX.credits[key] = { licences: C.licences, sources: C.sources.map(s => ({ id: s.id, repo: s.repo, url: s.url, rev: s.rev, licence: s.licence })) };
  return key;
}

/* ---------------- run ---------------- */
const misses = todo.filter(c => !c.cached);
console.log(`${todo.length - misses.length} cached, ${misses.length} to draw`);
const results = new Map(todo.filter(c => c.cached).map(c => [c.id, { key: c.key, ...c.cached }]));
for (const c of todo) if (c.cached) creditsFor(c, RP.assets[c.tpl]);   // (a combined credits entry the index may lack)
if (misses.length) {
  const P = await launch({ w: 1200, h: 800 });
  try {
    await P.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/?hd=1` });
    for (let i = 0; i < 240; i++) { if (await P.eval('!!(window.__app && __app.models && __app.frameN > 30)').catch(() => false)) break; await sleep(500); }
    for (const c of misses) {
      const t0 = Date.now(), data = f => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
      let r;
      try { r = await P.eval(`${unwindow.toString()}; (${pageReverse.toString()})(${JSON.stringify({ tpl: c.tpl, kit: c.kit, al: c.al, name: null, painted: c.painted, body: c.imgs ? data(c.imgs.body) : null, fin: c.imgs ? data(c.imgs.fin) : null, cowl: c.e.cowl, winglet: c.e.winglet })})`); }
      catch (e) { console.log(`${c.id}: failed, ${e.message.split('\n')[0]}`); continue; }
      const lg = P.logs.splice(0).filter(l => /exception|error/i.test(l)).slice(0, 3); if (lg.length) console.log(lg.join('\n'));
      // the glTF and its lite twin: the template's, with the redrawn images swapped in (the lite shares the images)
      const T = RP.assets[c.tpl], g = JSON.parse(fs.readFileSync(path.join(OUT, T.gltf), 'utf8')), gl = JSON.parse(fs.readFileSync(path.join(OUT, T.lite), 'utf8'));
      if ((g.images || []).length !== r.texs) throw new Error(`${c.id}: ${c.tpl} has ${(g.images || []).length} images, the page ${r.texs}`);
      const images = [], swap = {}, info = [];
      for (const [i, im] of Object.entries(r.images)) {
        const rgb = decodePNG(Buffer.from(im.rgb.split(',')[1], 'base64'));
        if (im.a) { const a = decodePNG(Buffer.from(im.a.split(',')[1], 'base64')); for (let k = 0; k < rgb.data.length; k += 4) rgb.data[k + 3] = a.data[k]; }
        const srcPng = path.join(SRC, `${c.key}-${i}.png`); fs.writeFileSync(srcPng, encodePNG(rgb, !!im.a));
        const k = await ktx2(srcPng), rel = put('t', '.ktx2', k.buf, false);
        swap[g.images[+i].uri] = path.posix.relative(path.posix.dirname(T.gltf), rel); images.push(rel);
        info.push(`${i} ${r.stats[i].w}×${r.stats[i].h} ${k.codec} ${k.psnr.toFixed(1)} dB`);
      }
      for (const im of g.images) if (swap[im.uri]) im.uri = swap[im.uri];
      for (const im of gl.images || []) if (swap[im.uri]) im.uri = swap[im.uri];
      const name = (LIVERIES[c.al] && LIVERIES[c.al].name) || c.e.airline || c.al, from = c.painted ? 'painted' : c.e.traced ? c.e.src : `bake:${c.e.src}`;
      for (const x of [g, gl]) if (x.extras && x.extras.livesfo) Object.assign(x.extras.livesfo, { livery: `${name} (livesfo's crowd livery, from ${from}, written onto ${c.tpl})`, reverseBake: { template: c.tpl, kit: c.kit, al: c.al, from } });
      const gltf = put('a', '.gltf', Buffer.from(JSON.stringify(g)), true), lite = put('a', '.gltf', Buffer.from(JSON.stringify(gl)), true);
      // its wire bytes (the files a selection fetches) and GPU memory: the template's, its images' share swapped
      const files = new Set([gltf]); for (const x of [...(g.buffers || []), ...(g.images || [])]) if (x.uri) files.add(path.posix.normalize(path.posix.join(path.posix.dirname(gltf), x.uri)));
      const tplImgs = Object.keys(swap).map(u => path.posix.normalize(path.posix.join(path.posix.dirname(T.gltf), u)));
      const gpu = T.gpu - tplImgs.reduce((s, f) => s + ktxGpu(f), 0) + images.reduce((s, f) => s + ktxGpu(f), 0);
      const entry = { ...T, gltf, lite, selector: `reverse:${T.selector || c.tpl}`, livery: name, wire: [...files].reduce((s, f) => s + wireOf(f), 0), gpu, special: undefined, credits: creditsFor(c, T),
        reverse: { template: c.tpl, templateGltf: T.gltf, type: c.code, al: c.al, kit: c.kit, from, licence: c.gpl === 2 ? 'GPL-2.0' : 'GPL-3.0', livery: c.lic, photos: c.e.traced ? c.e.credits : undefined } };
      results.set(c.id, { key: c.key, hash: c.hash, entry, images });
      fs.writeFileSync(path.join(CACHE, `${c.key}.json`), JSON.stringify({ hash: c.hash, entry, images }, null, 1));
      console.log(`${c.id} → ${c.key} on ${c.tpl}: ${((Date.now() - t0) / 1000).toFixed(1)} s; tail cone ${r.tail[0]} m (kit ${r.tail[1]}); windows ${r.win !== null ? `${r.win} of the crowd's painted out (its panes are the windows)` : 'the crowd\'s (no panes)'}; images ${info.join(', ')}; wire ${(entry.wire / 1e6).toFixed(2)} MB, GPU ${(gpu / 1e6).toFixed(1)} MB (template ${(T.wire / 1e6).toFixed(2)}, ${(T.gpu / 1e6).toFixed(1)})`);
    }
  } finally { P.close(); await sleep(300); }
}

/* ---------------- the indexes ---------------- */
// earlier runs' assets go (a pair now the library's, held, failed, or no longer a crowd pair: not with --only), then
// this run's are written
const now = new Map([...results.values()].map(x => [x.key, x]));
for (const k of Object.keys(RP.assets)) if (ours(k) && !now.has(k) && !ONLY) { delete RP.assets[k]; delete IX.assets[k]; console.log(`${k}: dropped`); }
for (const T of [RP.types, IX.types]) for (const als of Object.values(T)) for (const [al, k] of Object.entries(als)) if (!RP.assets[k] && !now.has(k)) delete als[al];
// shared/fleet.json's lean entry (fleet-convert.mjs's, with what the credits page and the coverage report read)
const lean = a => ({ gltf: a.gltf, lite: a.lite, label: a.label, wire: a.wire, gpu: a.gpu, tris: a.tris, draws: a.draws, credits: a.credits, livery: a.livery, reverse: { template: a.reverse.template, from: a.reverse.from, licence: a.reverse.licence } });
for (const [k, x] of now) {
  RP.assets[k] = x.entry; IX.assets[k] = lean(x.entry);
  for (const T of [RP.types, IX.types]) (T[x.entry.reverse.type] ||= {})[x.entry.reverse.al] = k;
}
fs.writeFileSync(RPF, JSON.stringify(RP, null, 1) + '\n');
fs.writeFileSync(IXF, JSON.stringify(IX) + '\n');
console.log(`indexes: ${now.size} of ours in shared/fleet.json (${[...now.keys()].join(', ')}); held ${held.length}: ${held.map(c => c.id).join(', ')}`);
process.exit(0);

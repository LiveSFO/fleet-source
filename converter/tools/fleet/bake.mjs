// Baked liveries (LS-086; D-107, D-116): every fleet library livery baked onto the kit model's own fuselage and fin
// textures, so the crowd (and the kit's hero on a phone) wears the paint the hi-fi model shows when selected. Part of the
// converter: the textures derive from the library's GPL paint, and ship with its source (tools/fleet/bundle-min.mjs).
//
// The hi-fi model and the kit model share the kit frame (fleet-convert.mjs puts each library model on the kit's axes),
// so a bake is a projection, run in the app's page on the GPU (2–4 s a livery):
//   - the fuselage texture (u = station, v = angle round the body, 30_livery.js bodyTexture) is rendered directly:
//     every hi-fi triangle drawn at its (station, angle) on the kit's own section, the outermost surface kept, anything
//     far from the skin (wings, engines, fin, gear bays) cut off. A first pass measures the hi-fi body's own section
//     (crown, belly, flanks) against the kit's, station by station, so the colour pass can cut close to its skin;
//   - a sibling type (tools/fleet/bake-siblings.json: a type the library lacks, baked from the airline's closest type)
//     is mapped by station, anchored at the nose (the first 40 %: titles, the forward door) and at the tail (the last
//     32 %: the tail's art), the middle stretched or squeezed between them;
//   - the fin canvas (30_livery.js fin's box) is filled from a side view of the hi-fi fin, matched by span and chord
//     fraction from each fin's own root (fins differ in sweep and height);
//   - the flat colours the kit keeps (engine cowls, the wing-body fairing, winglets) are the median of the hi-fi's
//     pixels there; the kit's cockpit panes are painted over, as the kit paints them for the crowd.
// Sizes: L (body 2048 × 512, fin 80 px a metre) is baked; M (1024 × 256, 40) and S (512 × 128, 20) are its exact 2× and
// 4× box averages in linear light. Each is a KTX2 (ETC1S, mipmapped, flipped to the GPU's row order: bakes.js uploads it
// as it is), named by its content; the index (shared/fleet-bakes.json) is keyed "kit model|airline". The L images are kept as
// the textures' source (data/fleet/bake/src: the bundle carries them).
//   node tools/fleet/bake.mjs [--port 8083] [--out data/fleet/bake] [--emit data/fleet/out] [--only kit|AL,…] [--q 255]
// The page must serve the converter's output at /m/ (the server with FLEET_DIR=data/fleet/out). Needs basisu 2.50.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { launch, sleep } from './cdp.mjs';
import { decodePNG, encodePNG, resize } from './image.mjs';
import { kitFor, isFreighter } from './kitkey.mjs';

const args = process.argv.slice(2), opt = (k, d) => (args.includes('--' + k) ? args[args.indexOf('--' + k) + 1] : d);
const HERE = path.dirname(new URL(import.meta.url).pathname), ROOT = path.resolve(HERE, '../..');
const PORT = +opt('port', 8083), OUT = path.resolve(opt('out', path.join(ROOT, 'data/fleet/bake'))), EMIT = path.resolve(opt('emit', path.join(ROOT, 'data/fleet/out'))), Q = +opt('q', 255);
const SIZES = { L: [2048, 512, 80], M: [1024, 256, 40], S: [512, 128, 20] };
// the pairs: every (type, airline) the library has, on the kit model the client draws it as (kitkey.mjs: the registry's
// rule; a freighter on the kit's freighter model of its type, CAL's 777F on b777f); then the siblings
const IX = JSON.parse(fs.readFileSync(path.join(ROOT, 'shared/fleet.json'), 'utf8'));
const kitOfAsset = (type, asset) => kitFor(type, isFreighter(asset, IX.assets[asset] && IX.assets[asset].label));
// kit types whose bakes come out wrong, left to the painter until fixed: the library's 767 sits lower and deeper than
// the kit's (its crown at 0.92 of the kit's, its belly 1.1 times as deep), and the colour pass loses most of its skin,
// so the hole fill smears what's left (15 Nov)
// (the 767s smeared: not their bodies' offset but stray UVs, which the converter now wraps back: wrapStrayUVs, D-149;
// --with <kit> bakes a kit listed here anyway, to look at it)
const SKIP_KITS = new Set([].filter(k => !(opt('with', '') || '').split(',').includes(k)));
const pairs = new Map();
// (not our liveries on the library's airframes, tools/fleet/reverse.mjs: drawn from the crowd's own bake or trace, baking
// one back onto the kit would go round in a circle)
for (const [type, als] of Object.entries(IX.types)) for (const [al, asset] of Object.entries(als)) { if (IX.assets[asset] && IX.assets[asset].reverse) continue; const kit = kitOfAsset(type, asset); if (kit && !SKIP_KITS.has(kit)) pairs.set(`${kit}|${al}`, { kit, al, asset, type, sibling: false }); }
for (const s of JSON.parse(fs.readFileSync(path.join(HERE, 'bake-siblings.json'), 'utf8')).pairs) {
  const kit = kitOfAsset(s.type, s.src); if (!kit || SKIP_KITS.has(kit) || pairs.has(`${kit}|${s.al}`) || !IX.assets[s.src]) continue;
  pairs.set(`${kit}|${s.al}`, { kit, al: s.al, asset: s.src, type: s.type, sibling: true });
}
// traced liveries (tools/fleet/trace/emit.mjs, live since D-155) share the index: a run keeps them. A trace is truer to
// its type than a sibling bake (the airline's paint off another type), so a traced pair isn't sibling-baked; the
// library's own livery of the type, once it has one, replaces the trace (its hi-fi model then wears that paint)
const idxFile0 = path.join(ROOT, 'shared/fleet-bakes.json'), prev0 = fs.existsSync(idxFile0) ? JSON.parse(fs.readFileSync(idxFile0, 'utf8')) : null;
const tracedKeys = new Set(Object.entries((prev0 && prev0.liveries) || {}).filter(([, e]) => e && e.traced).map(([k]) => k));
for (const [k, j] of pairs) if (j.sibling && tracedKeys.has(k)) { console.log(`${k}: traced, not sibling-baked`); pairs.delete(k); }
const only = opt('only'), JOBS = [...pairs.values()].filter(j => !only || only.split(',').includes(`${j.kit}|${j.al}`));

/* ------------------------------------------------------------------------------------------------------------------ */
/* in the page (window.__app): returns data URLs and numbers                                                           */
async function pageBake(o) {
  const app = window.__app, M = app.models;
  { const { kitFiles } = await import('/js/models.js'); if (kitFiles.pending(o.kit) && !(await kitFiles.ready(o.kit, true))) throw new Error('kit file for ' + o.kit + ' failed to load'); }   // (a type whose kit file loads late: kitondemand.js)
  const { LibModels } = await import('/js/libmodel.js');
  const lib = window.__bakeLib || (window.__bakeLib = new LibModels(M, app.r, { keep: 2 }));
  const ix = await lib.loadIndex();
  if (!ix || !ix.assets[o.asset]) throw new Error('no asset ' + o.asset);
  const H = await lib.load({ key: o.asset, a: ix.assets[o.asset], base: ix.base || '/m/' });
  H.pose({ gear: 0, flaps: 0, spoilers: 0, reversers: 0, fanDeg: 0 }, true);   // doors shut, bays hidden
  const p = M.proto(o.kit), T = p.T, fn = p.fn, L = T.L, yc = T.fus.yc;
  const eAt = fn.eAt || (() => 2 / (T.fus.n || 2));
  const [TW, TH, P] = o.sizes.L, SS = o.ss;
  // stations: the hi-fi's (Ls) to the kit's (L), anchored at the nose and the tail (identity for the type's own model)
  const Ls = H.dims.L, Nz = 0.40 * Math.min(Ls, L), Tz = 0.32 * Math.min(Ls, L);
  const fTS = s => (s <= Nz ? s : s >= L - Tz ? Ls - (L - s) : Nz + (s - Nz) * (Ls - Tz - Nz) / (L - Tz - Nz));   // the kit's station → the hi-fi's
  const diag = { L, Ls: +Ls.toFixed(2), yc, sibling: !!o.sibling };   // (diag.twin: the section measured on the hi-fi's twin)

  // the section the angles round the body are measured in: hw, tp, bt, md (from the centreline at yc) and the
  // superellipse's exponent. The kit's own, along its stations; for a sibling, the section of the hi-fi model's twin (the
  // kit type the converter fitted it to: its body lies on that section) along the hi-fi's own stations, so a body much
  // wider or taller than the kit's (an E175 onto the ERJ-145: 1.3 and 1.5 times) is measured as it is and only its
  // stations are mapped onto the kit's (D-149: the E175 siblings had lost all but the tail)
  if (o.sibling && H.dims.twin && H.dims.twin !== o.kit) { const { kitFiles } = await import('/js/models.js'); if (kitFiles.pending(H.dims.twin)) await kitFiles.ready(H.dims.twin, true); }   // (the twin's kit file too, if late)
  const twinP = o.sibling && H.dims.twin && H.dims.twin !== o.kit ? M.proto(H.dims.twin) : null;
  const pS = twinP && twinP.fn ? twinP : p, fnS = pS.fn, LS = pS === p ? L : Ls, ycS = pS.T.fus.yc, eAtS = fnS.eAt || (() => 2 / (pS.T.fus.n || 2)), onTwin = pS !== p;
  const N = 2048, sec = new Float32Array(N * 2 * 4);
  for (let i = 0; i < N; i++) { const s = (i + 0.5) / N * LS; sec.set([fnS.hw(s), fnS.tp(s), fnS.bt(s), fnS.md(s)], i * 4); sec[(N + i) * 4] = eAtS(s); }
  const secTex = new THREE.DataTexture(sec, N, 2, THREE.RGBAFormat, THREE.FloatType); secTex.needsUpdate = true;
  // (a sibling is unwrapped along the hi-fi's own stations and its columns mapped onto the kit's afterwards, on the CPU: a
  // station map done per vertex bends nothing inside a triangle, so a big one across an anchor (a title decal over the
  // first 40 %: Air New Zealand's, its 787-9 onto the 777-300ER) drifted against the skin's own copy and doubled it)
  const SIB = o.sibling ? 1 : 0, colOfKit = sk => (o.sibling ? fTS(sk) / Ls : sk / L);   // a kit station → the unwrap's column, 0..1
  const U = { uSec: { value: secTex }, uL: { value: L }, uLS: { value: LS }, uTw: { value: onTwin ? 1 : 0 }, uSib: { value: SIB }, uN: { value: N }, uYc: { value: ycS }, uMap: { value: new THREE.Vector4(Ls, L, Nz, Tz) }, uRho: { value: new THREE.Vector2(0.6, 1.16) },
    uMode: { value: 0 }, uOut: { value: 0 }, uBoxMin: { value: new THREE.Vector3() }, uBoxMax: { value: new THREE.Vector3() }, uFin: { value: new THREE.Vector3(1.2, 0.03, 0.5 * Ls) } };
  const SA = `uniform sampler2D uSec; uniform float uL; uniform float uLS; uniform float uTw; uniform float uSib; uniform float uN; uniform float uYc; uniform vec4 uMap;
    float bkS(float z) {   // the hi-fi's station → the kit's (anchored at the nose and the tail)
      float Ls = uMap.x, Lt = uMap.y, Nz = uMap.z, Tz = uMap.w;
      if (z <= Nz) return z;
      if (z >= Ls - Tz) return Lt - (Ls - z);
      return Nz + (z - Nz) * (Lt - Tz - Nz) / max(0.001, Ls - Tz - Nz);
    }
    float bkT(float z) { return uTw > 0.5 ? z : bkS(z); }   // the section table's station of a hi-fi point (the twin's: its own)
    vec4 bkSec(float s) { float i = min(floor(clamp(s / uLS, 0.0, 1.0) * uN), uN - 1.0); return texture2D(uSec, vec2((i + 0.5) / uN, 0.25)); }
    float bkE(float s) { float i = min(floor(clamp(s / uLS, 0.0, 1.0) * uN), uN - 1.0); return texture2D(uSec, vec2((i + 0.5) / uN, 0.75)).r; }
    vec3 bkSA(vec3 p) {   // (the kit's station, angle round the section, radius in units of that section)
      float s = bkS(p.z), st = bkT(p.z); vec4 sc = bkSec(st); float e = bkE(st), y = p.y - uYc;
      float X = p.x / max(sc.x, 0.02), Y = y >= sc.w ? (y - sc.w) / max(sc.y - sc.w, 0.02) : (y - sc.w) / max(sc.w - sc.z, 0.02);
      float sa = sign(X) * pow(abs(X), 1.0 / e), nc = sign(Y) * pow(abs(Y), 1.0 / e);
      float a = atan(sa, -nc); if (a < 0.0) a += 6.28318531;
      return vec3(s, a, length(vec2(sa, nc)));
    }\n`;
  // the unwrap: each triangle drawn at its (s, a), the outermost kept; a triangle across the belly's seam (a 0 ↔ 2π) is
  // dropped where its interpolated angle disagrees with its own
  const unwrap = src => {
    const m = new THREE.MeshBasicMaterial({ color: src.color.clone(), map: src.map || null, side: THREE.DoubleSide, alphaTest: src.alphaTest || 0 });
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = SA + 'varying vec3 vBk; varying float vBkA;\n' + sh.vertexShader.replace('#include <project_vertex>', `vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
        vec4 bkW = modelMatrix * vec4(transformed, 1.0); vBk = bkW.xyz; vec3 bk = bkSA(bkW.xyz); vBkA = bk.y;
        gl_Position = vec4((uSib > 0.5 ? 2.0 * bkW.z / uMap.x : 2.0 * bk.x / uL) - 1.0, bk.y / 3.14159265 - 1.0, 0.5 - 0.25 * bk.z, 1.0);`);
      sh.fragmentShader = SA + 'uniform vec2 uRho; uniform float uOut; varying vec3 vBk; varying float vBkA;\n' + sh.fragmentShader.replace('void main() {', `void main() {
        vec3 bkf = bkSA(vBk); if (bkf.z < uRho.x || bkf.z > uRho.y || abs(bkf.y - vBkA) > 0.6) discard;`)
        .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n  if (uOut > 0.5) gl_FragColor = vec4(bkf.z, 0.0, 0.0, 1.0);');
    };
    m.customProgramCacheKey = () => 'bake-unwrap';
    return m;
  };
  // orthographic views: mode 1 the fin (near the plane of symmetry, above the body's top, aft half), mode 2 a box
  const view = src => {
    const m = new THREE.MeshBasicMaterial({ color: src.color.clone(), map: src.map || null, side: THREE.DoubleSide, alphaTest: src.alphaTest || 0 });
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = 'varying vec3 vBk;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n vBk = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = SA + 'uniform float uMode; uniform vec3 uBoxMin; uniform vec3 uBoxMax; uniform vec3 uFin; varying vec3 vBk;\n' + sh.fragmentShader.replace('void main() {', `void main() {
        if (uMode > 0.5 && uMode < 1.5) { vec4 sc = bkSec(bkT(vBk.z)); if (abs(vBk.x) > uFin.x || vBk.y - uYc < sc.y + uFin.y || vBk.z < uFin.z) discard; }
        if (uMode > 1.5 && (any(lessThan(vBk, uBoxMin)) || any(greaterThan(vBk, uBoxMax)))) discard;`);
    };
    m.customProgramCacheKey = () => 'bake-view';
    return m;
  };
  const skip = mat => mat.userData.glaze || /light|strobe|beacon|lamp/i.test(mat.name);
  const parts = H.parts.filter(m => m.visible && !skip(m.material));
  const sceneOf = mk => {
    const sc = new THREE.Scene(), cache = new Map();
    for (const part of parts) {
      let mat = cache.get(part.material); if (!mat) { mat = mk(part.material); cache.set(part.material, mat); }
      const m = new THREE.Mesh(part.geometry, mat); m.matrixAutoUpdate = false; m.matrix.copy(part.matrix); m.matrixWorldNeedsUpdate = true; m.frustumCulled = false; sc.add(m);
    }
    return sc;
  };
  const cv = document.createElement('canvas'); cv.width = cv.height = 4;
  const R = new THREE.WebGLRenderer({ canvas: cv, antialias: false, alpha: true }); R.setPixelRatio(1); R.setClearColor(0x000000, 0);
  const target = (w, h) => new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, depthBuffer: true, magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter, generateMipmaps: false });
  const readF = (rt, w, h) => { const a = new Float32Array(w * h * 4); R.readRenderTargetPixels(rt, 0, 0, w, h, a); return a; };
  const enc = x => { x = Math.max(0, Math.min(1, x)); return Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055)); };
  const hex = c => '#' + c.map(v => enc(v).toString(16).padStart(2, '0')).join('');
  // a linear RGB image (Float32, 3 a texel) averaged over f × f boxes; edges that don't fill a box are dropped
  const boxDown = (img, w, h, f) => {
    const w2 = Math.floor(w / f), h2 = Math.floor(h / f), out = new Float32Array(w2 * h2 * 3), n = f * f;
    for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) {
      let r = 0, g = 0, b = 0; for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) { const k = 3 * ((y * f + j) * w + x * f + i); r += img[k]; g += img[k + 1]; b += img[k + 2]; }
      const q = 3 * (y * w2 + x); out[q] = r / n; out[q + 1] = g / n; out[q + 2] = b / n;
    }
    return { img: out, w: w2, h: h2 };
  };
  const toCanvas = (img, w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'), im = g.createImageData(w, h); for (let q = 0; q < w * h; q++) { im.data[4 * q] = enc(img[3 * q]); im.data[4 * q + 1] = enc(img[3 * q + 1]); im.data[4 * q + 2] = enc(img[3 * q + 2]); im.data[4 * q + 3] = 255; } g.putImageData(im, 0, 0); return c; };
  const median = list => { if (!list.length) return null; const ch = c => { const v = list.map(x => x[c]).sort((a, b) => a - b); return v[v.length >> 1]; }; return [ch(0), ch(1), ch(2)]; };

  /* ---- the fuselage ---- */
  const W2 = TW * SS, H2 = TH * SS, rtB = target(W2, H2), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const sB = sceneOf(unwrap);
  // pass A: the outermost surface's radius (in units of the kit's section) round each station, over a wide window;
  // its median over the crown, the belly and the two flanks is the hi-fi's own section there. The section table is
  // then rebuilt from it, so the colour pass finds the hi-fi's skin at radius ≈ 1 and can cut everything else close
  // (bodies differ: the hi-fi 737's sits about 0.4 m higher than the kit's)
  const AW = 512, AH = 256, rtA = target(AW, AH);
  U.uOut.value = 1; U.uRho.value.set(0.6, 1.45);
  R.setRenderTarget(rtA); R.clear(); R.render(sB, cam); R.setRenderTarget(null);
  const ra = readF(rtA, AW, AH); rtA.dispose();
  const med = l => { if (!l.length) return NaN; l.sort((a, b) => a - b); return l[l.length >> 1]; };
  const sectorAt = (col, ac, half) => { const l = []; for (let r = 0; r < AH; r++) { let d = Math.abs(2 * Math.PI * (r + 0.5) / AH - ac); d = Math.min(d, 2 * Math.PI - d); if (d > half) continue; const k = 4 * (r * AW + col); if (ra[k + 3] > 0.5) l.push(ra[k]); } return med(l); };
  const prof = { top: [], bot: [], side: [] };
  for (let col = 0; col < AW; col++) { prof.top.push(sectorAt(col, Math.PI, 0.35)); prof.bot.push(sectorAt(col, 0, 0.35)); const l = sectorAt(col, Math.PI / 2, 0.25), r = sectorAt(col, 1.5 * Math.PI, 0.25); prof.side.push(isNaN(l) ? r : isNaN(r) ? l : (l + r) / 2); }
  const clean = a => {   // gaps from the nearest station measured, a running median over ±3.5 % of the length, clamped; the middle one value
    const n = a.length, b = a.slice(); let last = NaN; for (let i = 0; i < n; i++) { if (!isNaN(b[i])) last = b[i]; else b[i] = last; } last = NaN; for (let i = n - 1; i >= 0; i--) { if (!isNaN(a[i])) last = a[i]; else if (isNaN(b[i])) b[i] = last; }
    const w = Math.round(0.035 * n), out = []; for (let i = 0; i < n; i++) { const l = []; for (let j = Math.max(0, i - w); j <= Math.min(n - 1, i + w); j++) if (!isNaN(b[j])) l.push(b[j]); out.push(Math.max(0.6, Math.min(1.45, isNaN(med(l)) ? 1 : med(l)))); }
    const i0 = Math.round(0.18 * n), i1 = Math.round(0.8 * n), mid = med(out.slice(i0, i1 + 1));
    for (let i = 0; i < n; i++) { const t = i < i0 ? Math.max(0, 1 - (i0 - i) / (0.06 * n)) : i > i1 ? Math.max(0, 1 - (i - i1) / (0.06 * n)) : 1; out[i] = mid * t + out[i] * (1 - t); }
    return out;
  };
  const rT = clean(prof.top), rB = clean(prof.bot), rS = clean(prof.side);
  for (let i = 0; i < N; i++) {
    const s = (i + 0.5) / N * LS, c = Math.max(0, Math.min(AW - 1, Math.floor((o.sibling ? (onTwin ? s : fTS(s)) / Ls : s / L) * AW))), hw = fnS.hw(s), tp = fnS.tp(s), bt = fnS.bt(s), md = fnS.md(s);
    const T2 = md + (tp - md) * rT[c], B2 = md - (md - bt) * rB[c], M2 = B2 + (md - bt) / Math.max(1e-6, tp - bt) * (T2 - B2);
    sec.set([hw * rS[c], T2, B2, M2], i * 4);
  }
  secTex.needsUpdate = true;
  const pick = a => [0.1, 0.25, 0.5, 0.75, 0.9].map(f => +a[Math.floor(f * AW)].toFixed(3));
  diag.section = { top: pick(rT), bottom: pick(rB), side: pick(rS) }; if (onTwin) diag.twin = H.dims.twin;
  // the colour pass: the skin only
  U.uOut.value = 0; U.uRho.value.set(0.8, 1.14);
  R.setRenderTarget(rtB); R.clear(); R.render(sB, cam); R.setRenderTarget(null);
  const raw = readF(rtB, W2, H2);
  const lin = new Float32Array(TW * TH * 3), have = new Uint8Array(TW * TH);
  let covered = 0;
  const xs = []; for (let col = 0; col < TW; col++) { if (!o.sibling) { xs.push([col * SS, col * SS + SS]); continue; } const x0 = Math.max(0, Math.floor(colOfKit(col / TW * L) * W2)), x1 = Math.min(W2, Math.max(x0 + 1, Math.ceil(colOfKit((col + 1) / TW * L) * W2))); xs.push([x0, x1]); }   // (the raw columns under each kit column: its own SS, a sibling's mapped)
  for (let row = 0; row < TH; row++) for (let col = 0; col < TW; col++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let j = 0; j < SS; j++) for (let x = xs[col][0]; x < xs[col][1]; x++) {
      const k = 4 * (((TH - 1 - row) * SS + j) * W2 + x);   // GL rows run up from v = 0; the painter's from v = 1
      if (raw[k + 3] > 0.5) { r += raw[k]; g += raw[k + 1]; b += raw[k + 2]; n++; }
    }
    const q = row * TW + col; if (n) { lin[3 * q] = r / n; lin[3 * q + 1] = g / n; lin[3 * q + 2] = b / n; have[q] = 1; covered++; }
  }
  diag.bodyCoverage = +(covered / (TW * TH)).toFixed(4);
  // holes (the nose tip and tail cone beyond the hi-fi's skin, the seam, the cockpit glass left out): from the
  // neighbours, round the body (rows wrap) and along it
  for (let pass = 0, left = TW * TH - covered; left > 0 && pass < 800; pass++) {
    const add = [];
    for (let row = 0; row < TH; row++) for (let col = 0; col < TW; col++) {
      const q = row * TW + col; if (have[q]) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const rr = (row + dr + TH) % TH, cc = col + dc; if (cc < 0 || cc >= TW) continue;
        const k = rr * TW + cc; if (have[k] === 1) { r += lin[3 * k]; g += lin[3 * k + 1]; b += lin[3 * k + 2]; n++; }
      }
      if (n) add.push([q, r / n, g / n, b / n]);
    }
    for (const [q, r, g, b] of add) { lin[3 * q] = r; lin[3 * q + 1] = g; lin[3 * q + 2] = b; have[q] = 1; }
    left -= add.length; if (!add.length) break;
  }
  // each size, the kit's cockpit panes painted over as 30_livery.js cockpit() paints them (the kit's glass sits over them)
  const bodies = {};
  for (const [k, [tw, th]] of Object.entries(o.sizes)) {
    const d = tw === TW ? { img: lin, w: TW, h: TH } : boxDown(lin, TW, TH, TW / tw), c = toCanvas(d.img, d.w, d.h), g = c.getContext('2d');
    const uv = sa => { g.beginPath(); sa.forEach(([s, a], i) => { const X = s / L * d.w, Y = (1 - a / (2 * Math.PI)) * d.h; if (i) g.lineTo(X, Y); else g.moveTo(X, Y); }); g.closePath(); };
    for (const pn of (p.panes || []).filter(q => q.mask)) { g.fillStyle = pn.color || '#16191c'; uv(pn.sa); g.fill(); }
    for (const pn of (p.panes || []).filter(q => !q.mask)) { uv(pn.sa); g.fillStyle = '#12161a'; g.fill(); }
    bodies[k] = c.toDataURL('image/png');
  }

  /* ---- an orthographic view along an axis over a box: { img (Float32, rows up), w, h } ---- */
  const sV = sceneOf(view);
  const ortho = (axis, box, ppm, mode) => {
    const [a0, a1, b0, b1] = axis === 'x' ? [box.min.z, box.max.z, box.min.y, box.max.y] : axis === 'y' ? [box.min.x, box.max.x, box.min.z, box.max.z] : [box.min.x, box.max.x, box.min.y, box.max.y];
    const w = Math.max(8, Math.round((a1 - a0) * ppm)), h = Math.max(8, Math.round((b1 - b0) * ppm)), c = box.getCenter(new THREE.Vector3());
    const oc = new THREE.OrthographicCamera(-(a1 - a0) / 2, (a1 - a0) / 2, (b1 - b0) / 2, -(b1 - b0) / 2, 0.1, 400);
    // looking +x from the left (image right = +z), +y from below (image right = +x, up = +z)
    if (axis === 'x') { oc.position.set(c.x - 200, c.y, c.z); oc.up.set(0, 1, 0); }
    else if (axis === 'y') { oc.position.set(c.x, c.y - 200, c.z); oc.up.set(0, 0, 1); }
    else { oc.position.set(c.x, c.y, c.z - 200); oc.up.set(0, 1, 0); }
    oc.lookAt(c); oc.updateProjectionMatrix(); oc.updateMatrixWorld();
    U.uMode.value = mode; U.uBoxMin.value.copy(box.min); U.uBoxMax.value.copy(box.max);
    const rt = target(w, h); R.setRenderTarget(rt); R.clear(); R.render(sV, oc); R.setRenderTarget(null);
    const out = { img: readF(rt, w, h), w, h }; rt.dispose(); return out;
  };
  const boxMedian = (box, axis) => { const v = ortho(axis, box, 40, 2), list = []; for (let k = 0; k < v.w * v.h; k++) if (v.img[4 * k + 3] > 0.5) list.push([v.img[4 * k], v.img[4 * k + 1], v.img[4 * k + 2]]); return { c: median(list), n: list.length }; };

  /* ---- the flat colours: cowls round the hi-fi's own fan, the fairing over the kit's (mapped to the hi-fi's stations), the hi-fi's wingtip ---- */
  // the crowd's own geometry by role (the clean configuration, gear down): the same whether the type was built here or
  // in the model worker (p.G differs between the two)
  const roles = {}, set = (p.variants && p.variants.get('gd0')) || (p.variant && p.variant('gd0'));
  if (set) for (const [r, g] of Object.entries(set)) { if (!g || !g.attributes) continue; g.computeBoundingBox(); roles[r] = g.boundingBox.clone(); }
  // the cowl: the left nacelle's outer flank, measured on the hi-fi itself: round its fan's spin axis (the inner one on
  // four engines), from its own inlet (the front of what lies within 0.6–1.25 of the kit's nacelle radius of that axis)
  // a seventh of the nacelle's length back to seven tenths (the fan cowl and the reverser's sleeve: not the lip or the
  // nozzle; the length the kit's engine's, or three radii). A spin motion's centre lies anywhere on its axis (the E175's
  // 5 m behind its inlet), and a sibling's or a tail-mounted engine isn't where the kit's is, so a box placed by either
  // missed the nacelle until 15 Nov: no cowl colour for many pairs (the crowd fell back on the painter's: Alaska's navy
  // under the hi-fi's white nacelles), the wing's or the pylon's for others
  const colors = {}, fans = (H.L.motions || []).filter(m => m.t === 's' && m.p[0] < -1.5).sort((a, b) => b.p[0] - a.p[0]);
  if (fans.length) {
    const [fx, fy] = fans[0].p, Rn = roles.cowl ? (roles.cowl.max.y - roles.cowl.min.y) / 2 : 0.055 * H.dims.span, E = T.engine;
    const v = new THREE.Vector3(); let lip = Infinity;
    for (const part of H.parts) { const pos = part.geometry.attributes.position; if (!pos) continue; for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(part.matrix); if (v.x > 0) continue; const r = Math.hypot(v.x - fx, v.y - fy); if (r >= 0.6 * Rn && r <= 1.25 * Rn && v.z < lip) lip = v.z; } }
    const len = E && E.len ? E.len : 3 * Rn;
    if (lip < Infinity) colors.cowl = boxMedian(new THREE.Box3(new THREE.Vector3(fx - 1.1 * Rn, fy - 0.9 * Rn, lip + len / 7), new THREE.Vector3(fx - 0.2 * Rn, fy + 0.5 * Rn, lip + 0.7 * len)), 'x');
  }
  if (roles.belly) { const b = roles.belly.clone().expandByScalar(0.15); b.min.z = fTS(b.min.z); b.max.z = fTS(b.max.z); colors.belly = boxMedian(b, 'y'); }
  if (roles.winglet) { const sp = H.dims.span / 2; colors.winglet = boxMedian(new THREE.Box3(new THREE.Vector3(-sp - 0.6, roles.winglet.min.y - 0.5, 0.25 * Ls), new THREE.Vector3(-sp + 1.2, H.dims.H, 0.85 * Ls)), 'x'); }
  const bellyRows = []; for (let row = TH - 3; row < TH; row++) for (let col = Math.round(TW * 0.35); col < TW * 0.65; col++) { const q = row * TW + col; bellyRows.push([lin[3 * q], lin[3 * q + 1], lin[3 * q + 2]]); }
  const tailFill = median(bellyRows) || [1, 1, 1];

  /* ---- the fin ---- */
  const Fi = T.fin, yb = yc + Fi.yBase, tanS = Math.tan(Fi.sweepLE * Math.PI / 180);
  const z0 = Math.min(Fi.dorsal ? Fi.dorsal.z0 : Fi.rootZ, Fi.rootZ) - 0.3, z1 = Fi.rootZ + Fi.height * tanS + Fi.tipChord + 0.5;
  const y0 = yb - 0.9, y1 = yb + Fi.height + 0.3, FW = Math.round((z1 - z0) * P), FH = Math.round((y1 - y0) * P);
  const PP = 160, fbox = new THREE.Box3(new THREE.Vector3(-3, yb - 1.5, Math.max(0.45 * Ls, fTS(z0) - 4)), new THREE.Vector3(3, H.dims.H + 0.5, Ls + 0.5));
  const sv = ortho('x', fbox, PP, 1);   // the hi-fi fin, its left side: image x = z, rows up = y
  const zAt = i => fbox.min.z + (i + 0.5) / PP, yAt = j => fbox.min.y + (j + 0.5) / PP;
  const sRoot = Fi.rootZ + Fi.rootChord / 2, iRoot = Math.min(N - 1, Math.floor((onTwin ? fTS(sRoot) : sRoot) / LS * N));   // (the table's stations)
  const kRoot = yc + fn.tp(sRoot), hRoot = ycS + sec[iRoot * 4 + 1];   // where each fin leaves its body
  let top = -1; for (let j = sv.h - 1; j >= 0 && top < 0; j--) for (let i = 0; i < sv.w; i++) if (sv.img[4 * (j * sv.w + i) + 3] > 0.5) { top = j; break; }
  const hTop = top >= 0 ? yAt(top) : yb + Fi.height, hH = Math.max(0.5, hTop - hRoot), kH = Math.max(0.5, yb + Fi.height - kRoot);
  // leading and trailing edges row by row, fitted as straight lines over 25–92 % of the span (a fin is a trapezoid)
  const le = [], te = [];
  for (let j = 0; j < sv.h; j++) {
    const y = yAt(j), eta = (y - hRoot) / hH; if (eta < 0.25 || eta > 0.92) continue;
    let a = -1, b = -1; for (let i = 0; i < sv.w; i++) if (sv.img[4 * (j * sv.w + i) + 3] > 0.5) { if (a < 0) a = i; b = i; }
    if (a >= 0) { le.push([y, zAt(a)]); te.push([y, zAt(b)]); }
  }
  const fit = pts => { const n = pts.length, sx = pts.reduce((s, q) => s + q[0], 0), sy = pts.reduce((s, q) => s + q[1], 0), sxx = pts.reduce((s, q) => s + q[0] * q[0], 0), sxy = pts.reduce((s, q) => s + q[0] * q[1], 0); const k = (n * sxy - sx * sy) / Math.max(1e-9, n * sxx - sx * sx); return [k, (sy - k * sx) / n]; };
  const [kL, cL] = le.length > 4 ? fit(le) : [tanS, fTS(Fi.rootZ) - tanS * yb], [kT, cT] = te.length > 4 ? fit(te) : [tanS, fTS(Fi.rootZ + Fi.rootChord) - tanS * yb];
  diag.fin = { kitHeight: Fi.height, hifiHeight: +hH.toFixed(2), roots: { kit: +kRoot.toFixed(2), hifi: +hRoot.toFixed(2) }, rows: le.length };
  const sample = (z, y) => {   // bilinear over covered pixels, the row's nearest covered pixel where it misses
    const fx = (z - fbox.min.z) * PP - 0.5, fy = (y - fbox.min.y) * PP - 0.5, j = Math.max(0, Math.min(sv.h - 1, Math.round(fy)));
    let i = Math.max(0, Math.min(sv.w - 1, Math.round(fx)));
    if (sv.img[4 * (j * sv.w + i) + 3] <= 0.5) { let best = -1; for (let d = 1; d < sv.w && best < 0; d++) for (const ii of [i - d, i + d]) if (ii >= 0 && ii < sv.w && sv.img[4 * (j * sv.w + ii) + 3] > 0.5) { best = ii; break; } if (best < 0) return null; i = best; return [sv.img[4 * (j * sv.w + i)], sv.img[4 * (j * sv.w + i) + 1], sv.img[4 * (j * sv.w + i) + 2]]; }
    const x0 = Math.max(0, Math.min(sv.w - 2, Math.floor(fx))), y0b = Math.max(0, Math.min(sv.h - 2, Math.floor(fy))), tx = Math.max(0, Math.min(1, fx - x0)), ty = Math.max(0, Math.min(1, fy - y0b));
    const out = [0, 0, 0]; let wsum = 0;
    for (const [dx, dy, w] of [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)], [0, 1, (1 - tx) * ty], [1, 1, tx * ty]]) { const k = 4 * ((y0b + dy) * sv.w + x0 + dx); if (sv.img[k + 3] > 0.5 && w > 0) { out[0] += sv.img[k] * w; out[1] += sv.img[k + 1] * w; out[2] += sv.img[k + 2] * w; wsum += w; } }
    return wsum > 0 ? out.map(v => v / wsum) : [sv.img[4 * (j * sv.w + i)], sv.img[4 * (j * sv.w + i) + 1], sv.img[4 * (j * sv.w + i) + 2]];
  };
  const finLin = new Float32Array(FW * FH * 3);
  for (let row = 0; row < FH; row++) for (let col = 0; col < FW; col++) {
    const z = z0 + (col + 0.5) / P, y = y1 - (row + 0.5) / P;
    // span fraction from each fin's own root; the kit's outline (30_livery.js fin) against the hi-fi's fitted edges
    const eta = Math.max(0, Math.min(1, (y - kRoot) / kH)), yk = kRoot + eta * kH, ek = (yk - yb) / Fi.height;
    const zle = Fi.rootZ + ek * Fi.height * tanS, ch = Fi.rootChord + (Fi.tipChord - Fi.rootChord) * ek;
    const xi = Math.max(0, Math.min(1, (z - zle) / ch)), yh = hRoot + eta * hH, zh = kL * yh + cL + xi * ((kT - kL) * yh + cT - cL);
    const c = sample(zh, Math.max(yh, hRoot + 0.05)) || tailFill, q = 3 * (row * FW + col);
    finLin[q] = c[0]; finLin[q + 1] = c[1]; finLin[q + 2] = c[2];
  }
  const fins = {};
  for (const [k, [tw]] of Object.entries(o.sizes)) { const d = tw === TW ? { img: finLin, w: FW, h: FH } : boxDown(finLin, FW, FH, TW / tw); fins[k] = toCanvas(d.img, d.w, d.h).toDataURL('image/png'); }

  R.dispose(); rtB.dispose(); secTex.dispose(); cv.width = cv.height = 1; lib.release(H);
  const outColors = Object.fromEntries(Object.entries(colors).filter(([, v]) => v && v.c).map(([k, v]) => [k, hex(v.c)]));
  return { body: bodies, fin: fins, colors: outColors, finBox: { z0, z1, y0, y1 }, diag };
}

/* ------------------------------------------------------------------------------------------------------------------ */
const run = (cmd, a) => new Promise((res, rej) => execFile(cmd, a, { maxBuffer: 64 << 20 }, (e, o, se) => (e ? rej(new Error(`${cmd}: ${e.message}\n${se}`)) : res(o))));
const pool = async (jobs, n) => { const out = []; let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < jobs.length) { const k = i++; out[k] = await jobs[k](); } })); return out; };
const dirPng = path.join(OUT, 'png'), dirSrc = path.join(OUT, 'src'), dirOut = path.join(EMIT, 'bake'), tmpK = path.join(OUT, 'ktx2');
for (const d of [dirPng, dirSrc, dirOut, tmpK]) fs.mkdirSync(d, { recursive: true });
const idxFile = path.join(ROOT, 'shared/fleet-bakes.json');   // with the site's files (shared/fleet.json's way): a fixed name can't be cached as immutable, as /m/'s files are
const prev = fs.existsSync(idxFile) ? JSON.parse(fs.readFileSync(idxFile, 'utf8')) : null;
const liveries = only && prev && prev.v === 2 ? prev.liveries : {}, report = {};
// (a partial run keeps the other liveries, but not one whose key the pairs no longer have: a pair moved to another kit
// model, as CAL's 777F did from b777-200lr to b777f, D-149; traced liveries aren't bake pairs and stay, in a full run
// too, unless the library now has the pair itself)
for (const [k, e] of Object.entries((prev && prev.liveries) || {})) if (e && e.traced) { if (pairs.has(k)) console.log(`${k}: the library has it now, the trace gives way`); else liveries[k] = e; }
for (const k of Object.keys(liveries)) if (!pairs.has(k) && !(liveries[k] && liveries[k].traced)) { console.log(`${k}: no longer a pair, dropped`); delete liveries[k]; }
const P = await launch({ w: 1400, h: 900 });
try {
  await P.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
  for (let i = 0; i < 240; i++) { if (await P.eval('!!(window.__app && __app.models && __app.frameN > 30)').catch(() => false)) break; await sleep(500); }
  for (const j of JOBS) {
    const key = `${j.kit}|${j.al}`, stem = `${j.kit}@${j.al}`, t0 = Date.now();
    let r;
    try { r = await P.eval(`(${pageBake.toString()})(${JSON.stringify({ asset: j.asset, kit: j.kit, sibling: j.sibling, sizes: SIZES, ss: 2 })})`); }
    catch (e) { console.log(`${key}: failed, ${e.message.split('\n')[0]}`); report[key] = { error: e.message.split('\n')[0] }; continue; }
    const pngs = [];
    for (const k of Object.keys(SIZES)) for (const part of ['body', 'fin']) {
      const f = path.join(dirPng, `${stem}-${k}-${part}.png`); let png = Buffer.from(r[part][k].split(',')[1], 'base64');
      if (k === 'L') fs.writeFileSync(path.join(dirSrc, `${stem}-L-${part}.png`), png);   // (the source as baked, at 80 px a metre)
      // the fin's canvas is the fin's box at so many pixels a metre (535 × 345 for a 737's M): a compressed texture's
      // levels must be whole 4 × 4 blocks, so an odd size uploads as nothing and the fin draws black. The kit maps the fin
      // by its box (planarUV, 0–1 across it), so the image is resampled to the nearest powers of two (every mip level
      // then whole blocks), in linear light
      if (part === 'fin') { const img = decodePNG(png), pot = x => 2 ** Math.max(2, Math.round(Math.log2(x))); png = encodePNG(resize(img, pot(img.w), pot(img.h))); }
      fs.writeFileSync(f, png); pngs.push({ k, part, f });
    }
    // KTX2: ETC1S, mipmapped, flipped to the GPU's row order (a compressed texture can't be flipped as it uploads)
    const e = { src: j.asset, type: j.type, sibling: j.sibling, ...r.colors, srcPng: { body: `${stem}-L-body.png`, fin: `${stem}-L-fin.png` } }, bytes = {};
    await pool(pngs.map(x => async () => {
      const k2 = path.join(tmpK, path.basename(x.f).replace(/\.png$/, '.ktx2'));
      await run('basisu', ['-ktx2', '-mipmap', '-y_flip', '-comp_level', '2', '-q', String(Q), '-file', x.f, '-output_file', k2]);
      const b = fs.readFileSync(k2), name = crypto.createHash('sha256').update(b).digest('hex').slice(0, 16) + '.ktx2';
      fs.writeFileSync(path.join(dirOut, name), b);
      (e[x.k] = e[x.k] || {})[x.part] = 'bake/' + name; bytes[x.k] = (bytes[x.k] || 0) + b.length;
    }), 4);
    liveries[key] = e;
    report[key] = { asset: j.asset, sibling: j.sibling, ms: Date.now() - t0, kb: Object.fromEntries(Object.entries(bytes).map(([k, v]) => [k, +(v / 1024).toFixed(1)])), colors: r.colors, diag: r.diag };
    console.log(`${key} ← ${j.asset}${j.sibling ? ' (sibling)' : ''}: ${((Date.now() - t0) / 1000).toFixed(1)} s, KB ${JSON.stringify(report[key].kb)}`);
  }
} finally { P.close(); await sleep(300); }
// the index; files no livery names any more go (a full run's leftovers)
const index = { v: 2, made: new Date().toISOString(), sizes: SIZES, q: Q, liveries };
fs.writeFileSync(idxFile, JSON.stringify(index, null, 1));
const named = new Set(Object.values(liveries).flatMap(e => Object.keys(SIZES).flatMap(k => (e[k] ? [e[k].body, e[k].fin] : []))).map(p => path.basename(p)));
for (const f of fs.readdirSync(dirOut)) if (!named.has(f)) fs.rmSync(path.join(dirOut, f));
fs.writeFileSync(path.join(OUT, 'bake-report.json'), JSON.stringify(report, null, 1));
const all = Object.values(report).filter(x => x.kb), sum = k => all.reduce((s, x) => s + (x.kb[k] || 0), 0);
console.log(`baked ${all.length} of ${JOBS.length} (${all.filter(x => x.sibling).length} siblings); KB per livery, mean S ${(sum('S') / all.length).toFixed(1)}, M ${(sum('M') / all.length).toFixed(1)}, L ${(sum('L') / all.length).toFixed(1)}; index ${idxFile}`);
process.exit(0);

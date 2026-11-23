#!/usr/bin/env node
// @ts-check
/**
 * Converts the SFO aircraft library (release sfo-fleet-2026-11-11, unpacked by tools/fleet-sync.mjs) into web
 * assets for livesfo's selected-aircraft hero: per airframe and geometry variant, one meshopt-compressed geometry
 * buffer shared by its liveries, and per livery a small glTF that points at it and at the livery's KTX2 textures.
 *
 *   node tools/fleet-convert.mjs [--only b38m,e75l] [--livery alaska] [--src data/fleet/src] [--out data/fleet/out]
 *                                [--tex ktx2|png|none] [--jobs 4] [--fits <table> | --kit-root <checkout>]
 *                                [--write-fits <table> [--fits-only]]
 *
 * Per variant (the liveries of an airframe whose geometry is byte-identical):
 *   1. drop what's never seen from outside (the 777 cabin interior, the spinning-fan discs, the stowed RAT);
 *   2. into the kit's frame (geometry.mjs): nose at z = 0, tyres on y = 0, levelled about the main gear's contact;
 *   3. merge: static parts by material, moving parts by identical motion (the rig's motions re-expressed in the kit
 *      frame), each merged mesh welded and cleaned; over GEO.heroTris, simplified within 5 mm;
 *   4. LODs at 2 cm and 8 cm (the later phone tier and a possible near crowd);
 *   5. quantized (KHR_mesh_quantization), reordered and meshopt-compressed (EXT_meshopt_compression);
 *   6. materials: metal/rough PBR, clearcoat folded into the base roughness, single-colour images as colours, cabin-
 *      light masks dropped; textures as KTX2 (UASTC for flat paint, ETC1S for noisy maps) within a GPU budget;
 *   7. content-hashed files, precompressed (.br, .gz), and shared/fleet.json: the index the page loads on the first
 *      hi-fi selection (type + airline → asset), with sizes, GPU memory and the credits and licences of each.
 * The library is read only, never written. Outputs (data/fleet/out) are not in git; shared/fleet.json is.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readGLB, accessor, imageBytes, meshopt, MeshoptPacker } from './fleet/gltf.mjs';
import { decodePNG, encodePNG, resize, stats } from './fleet/image.mjs';
import { kitTransform, kitFit, applyKitFit, compressLeg, splitBelow, transformMesh, concat, weld, simplify, reorder, quantize, bounds, apply, capHoles } from './fleet/geometry.mjs';
import vm from 'node:vm';
import { matches, chainFor, motionOut, lightsOut, valueAt } from './fleet/rig.mjs';
import { BATCH, EXCLUDE_AIRFRAMES, convertibleSelector, SPECIAL, IATA_ICAO, INTERIOR_TEXTURES, HIDDEN_NODES, DETENTS, TEX, GEO, PACKAGE_INFO, ENGINE_FIX, GEAR_FIX, STRETCH_FIX, FIN_FIX, COCKPIT_PANES, DROP_FINISH, TEX_FIX, MAT_FIX, WING_ATLAS_FIX } from './fleet/config.mjs';
import { kitLookup, isFreighter } from './fleet/kit-lookup.mjs';
import { fitInputKey, fitTableJSON, readFitTable } from './fleet/fit-table.mjs';
import { isCargoDoorBacking, isCargoDoorShell, withoutCargoDoorShells } from './fleet/cargo-doors.mjs';
import { repairA220WingPaint } from './fleet/wing-paint.mjs';
import * as DECAL_PAINT from './fleet/decal-paint.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes('--' + k) ? argv[argv.indexOf('--' + k) + 1] : d);
const SRC = path.resolve(opt('src', path.join(ROOT, 'data/fleet/src')));
const OUT = path.resolve(opt('out', path.join(ROOT, 'data/fleet/out')));
const CACHE = path.resolve(opt('cache', path.join(ROOT, 'data/fleet/cache')));
const KIT_ROOT = path.resolve(opt('kit-root', ROOT));   // used for local runs with a twin
const FITS = opt('fits', ''), WRITE_FITS = opt('write-fits', ''), FITS_ONLY = argv.includes('--fits-only');
for (const flag of ['fits', 'write-fits']) {
  if (argv.includes('--' + flag) && (!opt(flag, '') || opt(flag, '').startsWith('--'))) throw new Error(`--${flag} needs a path`);
}
if (FITS && WRITE_FITS) throw new Error('--write-fits needs a local kit; remove --fits');
if (FITS_ONLY && !WRITE_FITS) throw new Error('--fits-only needs --write-fits <table>');
const savedFits = FITS ? readFitTable(FITS) : null;
const writtenFits = WRITE_FITS ? { v: 1, airframes: {} } : null;
const ONLY = opt('only', '') ? opt('only', '').split(',') : BATCH;
const ONLY_LIVERY = opt('livery', '') ? new Set(opt('livery', '').split(',')) : null;
const TEXMODE = opt('tex', 'ktx2');
const JOBS = +opt('jobs', String(Math.max(1, Math.min(6, os.cpus().length - 2))));
if (opt('psnr-paint', '')) TEX.etc1sPsnrPaint = +opt('psnr-paint', '');   // trials: the quality bar for ETC1S paint
if (opt('psnr-other', '')) TEX.etc1sPsnrOther = +opt('psnr-other', '');
// trials, which leave shared/fleet.json and the report as they are and write data/fleet/trial.json instead (--trial):
// --codec uastc|etc1s encodes every map in that codec, at the sizes today's rule budgets; --emit a,b writes only those
// liveries, while the airframe's other liveries still decide which maps are paint and how meshes merge, as in a full run
const FORCE_CODEC = opt('codec', '');
if (FORCE_CODEC && !['uastc', 'etc1s'].includes(FORCE_CODEC)) throw new Error('--codec takes uastc or etc1s');
const EMIT = opt('emit', '') ? new Set(opt('emit', '').split(',')) : null;
const NO_INDEX = argv.includes('--no-index') || !!FORCE_CODEC || !!EMIT;
const TRIAL = path.resolve(opt('trial', path.join(ROOT, 'data/fleet/trial.json')));
const LIB = path.join(SRC, 'assets/airliners');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const r4 = v => Math.round(v * 1e4) / 1e4;
const log = (...a) => console.log(...a);


/** a content-hashed output file (and its precompressed twins when it compresses) → its path under /m/ */
function put(dir, ext, buf, compress = true) {
  const h = sha(buf).slice(0, 16), rel = `${dir}/${h}${ext}`, f = path.join(OUT, rel);
  if (!fs.existsSync(f)) {
    fs.writeFileSync(f, buf);
    if (compress) {
      fs.writeFileSync(f + '.br', zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } }));
      fs.writeFileSync(f + '.gz', zlib.gzipSync(buf, { level: 9 }));
    }
  }
  const wire = compress ? Math.min(buf.length, fs.statSync(f + '.br').size) : buf.length;
  return { rel, bytes: buf.length, wire };
}

/* ---------------- the library's records ---------------- */
const handoff = JSON.parse(fs.readFileSync(path.join(LIB, 'asset-handoff-manifest.json'), 'utf8'));
const coverage = JSON.parse(fs.readFileSync(path.join(LIB, 'sfo-build-coverage.json'), 'utf8'));
// the kit's types (client/vendor/airliners, read only), for each airframe's twin: the crowd model a selection swaps it
// for, found as the crowd finds it (the type's ICAO code → shared/aircraft-types.json → the kit key)
function loadTwins() {
  const dir = path.join(KIT_ROOT, 'client/vendor/airliners'), ctx = vm.createContext({ console });
  vm.runInContext(fs.readFileSync(path.join(KIT_ROOT, 'client/vendor/three/three.iife.js'), 'utf8'), ctx);
  const files = fs.readdirSync(dir).filter(f => /^1\d_.*\.js$/.test(f)).sort();
  vm.runInContext(files.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n;') + '\n;this.AL_TYPES = AL_TYPES;', ctx);
  // A freighter uses the kit's cargo model where it has one. The 777F's body sits 8 cm above the -200LR's.
  const kitFor = kitLookup(JSON.parse(fs.readFileSync(path.join(KIT_ROOT, 'shared/aircraft-types.json'), 'utf8')).types);
  const keys = {};
  for (const c of coverage.combinations) {
    const a = c.asset, key = a && kitFor(c.canonicalType, isFreighter(a.aircraft));
    if (key && !keys[a.aircraft]) keys[a.aircraft] = key;
  }
  return { kit: ctx.AL_TYPES, keys };
}
const twins = savedFits ? null : loadTwins();
const libPkg = (() => { try { return JSON.parse(fs.readFileSync(path.join(SRC, 'sync.json'), 'utf8')); } catch { return {}; } })();

/** the licence of a source package, from the library's evidence string */
function licenceOf(evidence) {
  const e = String(evidence || '');
  if (/NC-SA|noncommercial/i.test(e)) return 'cc-by-nc-sa-3.0';
  if (/version 3/i.test(e) && !/version 2/i.test(e)) return 'gpl-3.0';
  if (/version 3/i.test(e)) return 'gpl-2.0-or-later+gpl-3.0';
  if (/GPL/i.test(e)) return 'gpl-2.0-or-later';
  return 'unknown';
}

/* ---------------- one livery's GLB ---------------- */
function loadLivery(asset) {
  const f = path.join(LIB, asset.glb), buf = fs.readFileSync(f);
  if (asset.sha256 && sha(buf) !== asset.sha256) throw new Error(`${asset.glb}: sha256 differs from the handoff manifest`);
  const { json, bin } = readGLB(buf);
  // an operator's paint finish set aside where photos show the airline's real paint otherwise (config.mjs DROP_FINISH):
  // its parts take the material the finish was laid over (its name less the finish)
  const drop = DROP_FINISH[asset.selector];
  if (drop) {
    let n = 0;
    const plain = name => json.materials.findIndex(x => x.name === name && !(x.extras && x.extras.operatorPaintFinish));
    for (const me of json.meshes) for (const p of me.primitives) {
      const m = json.materials[p.material], fin = m && m.extras && m.extras.operatorPaintFinish;
      if (!fin || !drop.includes(fin)) continue;
      const base = m.name.replace(' ' + fin, ''), bi = plain(base) >= 0 ? plain(base) : plain(base.replace(/\.\d+$/, ''));
      if (bi < 0) throw new Error(`${asset.selector}: no material under the finish ${fin} (${m.name})`);
      p.material = bi; n++;
    }
    if (!n) throw new Error(`${asset.selector}: DROP_FINISH ${drop} matched no part`);
  }
  // a material's colour corrected (config.mjs MAT_FIX)
  const mf = MAT_FIX[asset.selector];
  if (mf) {
    let n = 0; for (const m of json.materials) if (mf[m.name]) { m.pbrMetallicRoughness = { ...(m.pbrMetallicRoughness || {}), baseColorFactor: mf[m.name] }; n++; }
    if (!n) throw new Error(`${asset.selector}: MAT_FIX matched no material`);
  }
  // an image's paint corrected (config.mjs TEX_FIX): the corrected PNG appended to the buffer, the image pointed at it
  let binOut = bin, wingPaintImage = -1;
  const tf = TEX_FIX[asset.selector];
  if (tf) {
    const i = (json.images || []).findIndex(x => x.name === tf.image);
    if (i < 0) throw new Error(`${asset.selector}: TEX_FIX image ${tf.image} not found`);
    const png = decodePNG(imageBytes(json, bin, i)), ch = png.data.length / (png.w * png.h);
    let n = 0, how = '';
    if (tf.lift) {
      const L = tf.lift, k = L.to / L.from;
      for (let q = 0; q < png.w * png.h; q++) {
        const o = q * ch, r = png.data[o], g = png.data[o + 1], b = png.data[o + 2], v = (r + g + b) / 3;
        if (Math.max(r, g, b) - Math.min(r, g, b) > L.sat || v < L.lo || v > L.hi) continue;
        png.data[o] = Math.min(255, Math.round(r * k)); png.data[o + 1] = Math.min(255, Math.round(g * k)); png.data[o + 2] = Math.min(255, Math.round(b * k)); n++;
      }
      how = 'lifted';
    }
    if (tf.repair) {   // (a named repair, decal-paint.mjs: F-29's decal)
      const fn = DECAL_PAINT[tf.repair];
      if (typeof fn !== 'function') throw new Error(`${asset.selector}: TEX_FIX repair ${tf.repair} not in decal-paint.mjs`);
      n = fn(png); how = tf.repair + ':';
      if (!n) throw new Error(`${asset.selector}: TEX_FIX repair ${tf.repair} changed nothing`);
    }
    const enc = encodePNG(png);
    json.bufferViews.push({ buffer: 0, byteOffset: bin.length, byteLength: enc.length });
    json.images[i] = { ...json.images[i], bufferView: json.bufferViews.length - 1, mimeType: 'image/png' };
    binOut = Buffer.concat([bin, enc]);
    // (the corrected image, the GPL source's preferred form: the bundle carries it, as the A220 wings' below)
    if (tf.repair && !FITS_ONLY) { const dir = path.join(CACHE, 'repair-source'); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, `${asset.selector.replace('/', '-')}-${tf.image}.png`), enc); }
    log(`  ${asset.selector}: ${tf.image} corrected (${how} ${n} texels, ${(100 * n / (png.w * png.h)).toFixed(1)} %)`);
  }
  const wingAtlas = WING_ATLAS_FIX[asset.selector];
  if (wingAtlas) {
    const i = json.images.findIndex(im => im.name === wingAtlas.image);
    if (i < 0) throw new Error(`${asset.selector}: wing atlas ${wingAtlas.image} not found`);
    const png = decodePNG(imageBytes(json, binOut, i));
    repairA220WingPaint(png);
    const enc = encodePNG(png);
    // The vertical stabilizer shares these UVs. Give the wing and its moving parts their own copy of the atlas.
    wingPaintImage = json.images.length;
    const mats = new Map();
    for (const node of json.nodes) {
      if (node.mesh === undefined || !/^(wings$|flap|spoiler)/.test(node.name)) continue;
      for (const primitive of json.meshes[node.mesh].primitives) {
        const m = json.materials[primitive.material], pbr = m.pbrMetallicRoughness, tex = json.textures[pbr?.baseColorTexture?.index];
        if (tex?.source !== i) continue;
        if (!mats.has(primitive.material)) {
          mats.set(primitive.material, json.materials.length);
          const index = json.textures.push({ ...tex, source: wingPaintImage }) - 1;
          json.materials.push({ ...m, name: m.name + ' plain wing', pbrMetallicRoughness: { ...pbr, baseColorTexture: { ...pbr.baseColorTexture, index } } });
        }
        primitive.material = mats.get(primitive.material);
      }
    }
    if (!mats.size) throw new Error(`${asset.selector}: no wing parts use ${wingAtlas.image}`);
    const bufferView = json.bufferViews.push({ buffer: 0, byteOffset: binOut.length, byteLength: enc.length }) - 1;
    json.images.push({ ...json.images[i], name: wingAtlas.image + '-plain-wing', bufferView, mimeType: 'image/png' });
    binOut = Buffer.concat([binOut, enc]);
    if (!FITS_ONLY) {
      const dir = path.join(CACHE, 'repair-source');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${asset.selector.replace('/', '-')}-plain-wing.png`), enc);
    }
    log(`  ${asset.selector}: ${wingAtlas.image} corrected on the wings (${mats.size} materials)`);
  }
  const rig = JSON.parse(fs.readFileSync(path.join(LIB, asset.rig), 'utf8'));
  const imgHash = (json.images || []).map((_, i) => sha(imageBytes(json, binOut, i)).slice(0, 20));
  return { asset, json, bin: binOut, rig, imgHash, wingPaintImage, livery: asset.selector.split('/')[1] };
}
/** the geometry's identity, materials aside: liveries with equal signatures share one geometry buffer */
function geoSignature(L) {
  const h = crypto.createHash('sha1'), { json, bin } = L;
  const bytes = ai => { const a = json.accessors[ai], bv = json.bufferViews[a.bufferView], o = (bv.byteOffset || 0) + (a.byteOffset || 0); const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type] * a.count * ({ 5126: 4, 5125: 4, 5123: 2 }[a.componentType] || 1); return bin.subarray(o, o + n); };
  for (const n of json.nodes) { if (n.mesh === undefined) continue; h.update(n.name); for (const p of json.meshes[n.mesh].primitives) { for (const k of Object.keys(p.attributes).sort()) h.update(bytes(p.attributes[k])); h.update(bytes(p.indices)); } }
  return h.digest('hex').slice(0, 12);
}

/* ---------------- materials ---------------- */
const texOf = (json, t) => (t ? json.textures[t.index].source : -1);
/** what makes a material look the way it does, with its images by content: equal keys draw the same */
function matKey(L, k) {
  const m = L.json.materials[k], pbr = m.pbrMetallicRoughness || {}, cc = (m.extensions || {}).KHR_materials_clearcoat;
  const img = i => (i >= 0 ? L.imgHash[i] : null);
  return JSON.stringify({
    bc: img(texOf(L.json, pbr.baseColorTexture)), f: (pbr.baseColorFactor || [1, 1, 1, 1]).map(r4), m: r4(pbr.metallicFactor ?? 1), r: r4(pbr.roughnessFactor ?? 1),
    mr: img(texOf(L.json, pbr.metallicRoughnessTexture)), n: img(texOf(L.json, m.normalTexture)), e: (m.emissiveFactor || [0, 0, 0]).map(r4),
    cc: cc ? [r4(cc.clearcoatFactor || 0), r4(cc.clearcoatRoughnessFactor || 0)] : null, a: m.alphaMode || 'OPAQUE', ac: m.alphaCutoff, ds: !!m.doubleSided,
    g: !!(m.extras && m.extras.cockpitGlazing), w: !!(m.extras && m.extras.cabinWindow && !pbr.baseColorTexture),
    ...(m.extras && m.extras.cabinWindow && m.emissiveTexture ? { cm: img(texOf(L.json, m.emissiveTexture)) } : {})   // a cabin-window mask (737 MAX)
  });
}

/* ---------------- textures ---------------- */
const srgbToLin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const pot = n => 1 << Math.round(Math.log2(n));
/** bytes on a desktop GPU: BC7/BC3/ASTC 1 B/px, BC1/ETC1 0.5 B/px; mipmaps add a third */
const gpuBytes = (w, h, codec, alpha) => Math.round(w * h * (codec === 'etc1s' && !alpha ? 0.5 : 1) * 4 / 3);

let basisuPath = null;
function basisu() {
  if (basisuPath !== null) return basisuPath;
  for (const p of [process.env.BASISU, '/opt/homebrew/bin/basisu', '/usr/local/bin/basisu']) if (p && fs.existsSync(p)) return (basisuPath = p);
  try { return (basisuPath = execFileSync('which', ['basisu']).toString().trim()); } catch { return (basisuPath = ''); }
}
/**
 * One texture as KTX2 (basisu), cached by its source pixels and settings: UASTC (+RDO, zstd) keeps flat paint and
 * lettering sharp at 1 byte a pixel; ETC1S (BasisLZ) is far smaller for noisy maps and half the GPU memory opaque.
 */
async function basisuEncode(png, codec, srgb, out) {
  const args = ['-ktx2', '-mipmap', '-stats', '-file', png, '-output_file', out];
  if (!srgb) args.push('-linear');
  if (codec === 'uastc') args.push('-uastc', '-uastc_level', String(TEX.uastc.level), '-uastc_rdo_l', String(TEX.uastc.rdo), '-uastc_rdo_d', String(TEX.uastc.dict), '-ktx2_zstandard_level', String(TEX.uastc.zstd));
  else args.push('-comp_level', String(TEX.etc1s.comp), '-q', String(TEX.etc1s.q));
  const so = await new Promise((res, rej) => { import('node:child_process').then(({ execFile }) => execFile(basisu(), args, { maxBuffer: 64 << 20 }, (e, o, se) => (e ? rej(new Error(`basisu: ${e.message}\n${se}`)) : res(o)))); });
  const m = /RGB Avg:.*?PSNR:\s*([\d.]+)/.exec(so);
  return m ? +m[1] : 0;
}
/**
 * One texture as KTX2 (basisu), cached by its source pixels and settings. 'auto' tries ETC1S first (BasisLZ: about a
 * quarter of UASTC's bytes, and half the GPU memory when opaque) and keeps it if its PSNR clears the bar (40 dB for
 * paint, where lettering lives; 36 dB for the rest); otherwise UASTC with RDO and zstd, which keeps paint and lettering
 * sharp at 1 byte a pixel. Noisy maps (photos, grime) go straight to ETC1S.
 * @returns {Promise<{buf: Buffer, codec: string, psnr: number}>}
 */
async function ktx2(getRGBA, codec, alpha, srgb, key, minPsnr) {
  const meta = path.join(CACHE, 'ktx', `${key}.json`);
  if (fs.existsSync(meta)) { const m = JSON.parse(fs.readFileSync(meta, 'utf8')), f = path.join(CACHE, 'ktx', `${key}.${m.codec}.ktx2`); if (fs.existsSync(f)) return { buf: fs.readFileSync(f), codec: m.codec, psnr: m.psnr }; }
  if (!basisu()) throw new Error('basisu not found (brew install basis_universal), or run with --tex png');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-')), png = path.join(tmp, 'in.png');
  fs.writeFileSync(png, encodePNG(getRGBA(), alpha));
  let pick = codec === 'uastc' ? 'uastc' : 'etc1s', psnr = 0, tried = {};
  if (pick === 'etc1s') { psnr = tried.etc1s = await basisuEncode(png, 'etc1s', srgb, path.join(tmp, 'etc1s.ktx2')); if (codec === 'auto' && psnr < minPsnr) pick = 'uastc'; }
  if (pick === 'uastc') psnr = tried.uastc = await basisuEncode(png, 'uastc', srgb, path.join(tmp, 'uastc.ktx2'));
  const buf = fs.readFileSync(path.join(tmp, `${pick}.ktx2`));
  fs.writeFileSync(path.join(CACHE, 'ktx', `${key}.${pick}.ktx2`), buf); fs.writeFileSync(meta, JSON.stringify({ codec: pick, psnr, tried }));
  fs.rmSync(tmp, { recursive: true, force: true });
  return { buf, codec: pick, psnr };
}
/** an image's size and statistics (image.mjs stats), cached by content: liveries share most of their maps */
const statCache = new Map();
function imageStats(json, bin, i, hash) {
  let s = statCache.get(hash);
  if (!s) {
    const f = path.join(CACHE, 'ktx', `${hash}.stats.json`);
    if (fs.existsSync(f)) s = JSON.parse(fs.readFileSync(f, 'utf8'));
    else { const png = decodePNG(imageBytes(json, bin, i)); s = { w: png.w, h: png.h, ...stats(png) }; fs.writeFileSync(f, JSON.stringify(s)); }
    statCache.set(hash, s);
  }
  return s;
}
/** run jobs a few at a time */
async function pool(items, n, fn) { const out = new Array(items.length); let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } })); return out; }

/** a mesh's surface area (m²) and the area its UVs cover (in units of the image, tiling counted) */
/**
 * A few of the library's vertices carry UVs hundreds or thousands of units out (the 767's fuselage ±1,555 while 98 %
 * lie in 0–1; some engine cones ±60): stray, on slivers nobody sees, but each slot's UVs are quantized over their full
 * range (GEO.uvBits), so one stray vertex spread the 767's paint over thousands of repeats and smeared it into
 * stripes (its hi-fi model and so its bakes, D-149). Coordinates outside the middle 98 % (± half a unit) are moved by
 * whole repeats toward the median (the sampler repeats), then clamped. Returns how many moved. In place.
 */
function wrapStrayUVs(m) {
  const U = m.uv; if (!U || U.length < 8) return 0;
  const n = U.length / 2, us = new Float64Array(n), vs = new Float64Array(n);
  for (let i = 0; i < n; i++) { us[i] = U[2 * i]; vs[i] = U[2 * i + 1]; }
  us.sort(); vs.sort();
  const at = (a, f) => a[Math.min(n - 1, Math.floor(f * n))];
  const lo = [at(us, 0.01) - 0.5, at(vs, 0.01) - 0.5], hi = [at(us, 0.99) + 0.5, at(vs, 0.99) + 0.5], mid = [at(us, 0.5), at(vs, 0.5)];
  let moved = 0;
  for (let i = 0; i < U.length; i += 2) for (let c = 0; c < 2; c++) {
    let x = U[i + c]; if (x >= lo[c] && x <= hi[c]) continue;
    x -= Math.round(x - mid[c]); U[i + c] = Math.max(lo[c], Math.min(hi[c], x)); moved++;
  }
  return moved;
}

function surfaceOf(m) {
  let area = 0, uvArea = 0; const P = m.pos, U = m.uv, I = m.idx;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    area += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    if (U) { const A = I[t] * 2, B = I[t + 1] * 2, C = I[t + 2] * 2; uvArea += 0.5 * Math.abs((U[B] - U[A]) * (U[C + 1] - U[A + 1]) - (U[C] - U[A]) * (U[B + 1] - U[A + 1])); }
  }
  return { area, uvArea };
}

/* ---------------- one variant ---------------- */
async function convertVariant(af, liveries, MO, report) {
  const ref = liveries[0], { json, bin, rig } = ref;
  // the rig is the airframe's: every livery of a variant must carry the same motions
  for (const L of liveries.slice(1)) if (JSON.stringify(L.rig.motions) !== JSON.stringify(rig.motions)) log(`  ! ${L.asset.selector}: rig motions differ from ${ref.asset.selector}; using the first`);
  const motions = rig.motions || [];
  const internalIds = new Set(rig.gearInternalPartIds || []), internalNames = new Set(rig.gearInternalParts || []);
  const imgName = i => (i >= 0 ? json.images[i].name : '');

  // ---- parts: what's kept, what moves
  const parts = [];
  let droppedTris = 0;
  for (const n of json.nodes) {
    if (n.mesh === undefined) continue;
    const x = n.extras || {}, prims = json.meshes[n.mesh].primitives;
    const tris = prims.reduce((s, p) => s + json.accessors[p.indices].count / 3, 0);
    const interior = prims.every(p => INTERIOR_TEXTURES.has(imgName(texOf(json, (json.materials[p.material].pbrMetallicRoughness || {}).baseColorTexture))));
    if (interior || HIDDEN_NODES.test(n.name) || HIDDEN_NODES.test(x.sourceName || '')) { droppedTris += tris; continue; }
    const all = []; motions.forEach((m, i) => { if (matches(m, x)) all.push(i); });
    const mi = chainFor(motions, all, x);   // FlightGear's nesting, outermost first; a motion listed twice, once
    const internal = x.sourcePartId !== undefined && internalIds.size ? internalIds.has(x.sourcePartId) : internalNames.has(x.sourceName || n.name);
    parts.push({ node: n, mi, internal, prims: prims.map((p, j) => ({ j, mat: p.material, mesh: { pos: accessor(json, bin, p.attributes.POSITION), nrm: accessor(json, bin, p.attributes.NORMAL), uv: p.attributes.TEXCOORD_0 !== undefined ? accessor(json, bin, p.attributes.TEXCOORD_0) : null, idx: Uint32Array.from(accessor(json, bin, p.indices)) } })) });
  }
  // ---- into the kit frame: fitted to its kit twin where it has one (levelled at the twin's height, each gear leg
  // compressed onto the ground: geometry.mjs kitFit, D-149), else levelled on its own gear (kitTransform)
  const entries = parts.flatMap((p, pi) => p.prims.map((q, qi) => ({ pi, qi, pos: q.mesh.pos, idx: q.mesh.idx, gear: p.internal || p.mi.some(i => motions[i].control === 'gear') })));
  const inputKey = (savedFits || writtenFits) ? fitInputKey(entries) : null;
  const saved = savedFits?.airframes[af];
  const twinKey = savedFits ? saved?.twin : twins.keys[af] || null;
  const twinT = twins && twinKey && twins.kit.get(twinKey);
  const gear = entries.map(e => e.gear);
  let fit = null;
  if (savedFits) {
    if (!saved || !Object.hasOwn(saved.variants, inputKey)) {
      throw new Error(`${ref.asset.selector}: no matching geometry in ${FITS}; regenerate the fleet fit table for this source`);
    }
    const record = saved.variants[inputKey];
    if (record) fit = applyKitFit(entries, gear, record);
  } else if (twinT?.fus && twinT.gear) {
    fit = kitFit(entries, gear, twinT);
  }
  if (writtenFits) {
    const row = writtenFits.airframes[af] ??= { twin: twinKey, variants: {}, liveries: {} };
    row.variants[inputKey] = fit?.record ?? null;
    for (const L of liveries) row.liveries[L.livery] = inputKey;
  }
  if (FITS_ONLY) return;
  const entryOf = new Map(entries.map((e, k) => [`${e.pi}:${e.qi}`, k]));
  const { P, pitchDeg, floatM, contacts } = fit ? { P: fit.P, pitchDeg: fit.pitchDeg, floatM: fit.dyM, contacts: fit.contacts } : kitTransform(entries.map(e => e.pos));
  const legOf = new Map(); if (fit) for (const leg of fit.legs) for (const k of leg.parts) legOf.set(k, leg);
  // a leg that has to shorten (the library's stand on unloaded struts, fully extended as in flight) keeps its length in
  // the geometry: its lower part (below a cut just over the tyres) is a mesh of its own, moved up by a motion of its own,
  // 'wow' (weight on wheels: 1 on the ground, 0 in the air; traffic.js libState). So in flight the strut hangs extended
  // as drawn and retracts into its bay as the rig was made, and on the ground it's compressed by what the tyres sank, as
  // an oleo is. A leg that has to lengthen (the library's is short of the kit's stance) is stretched in the geometry.
  const motionsX = motions.slice(), wowOf = new Map();
  // a gear motion that isn't at rest with the gear down and moves a leg's wheels (the 787's and others' bogie tilt:
  // FlightGear levels it by the strut's compression, the rig only by the gear's position) turns only in the air: on
  // the ground the wheels lie as drawn, which is where the fit put them on the kit's ground
  if (fit) {
    const wheelParts = new Set(); for (const leg of fit.legs) for (const k of leg.parts) wheelParts.add(entries[k].pi);
    const tilts = new Set();
    for (const pi of wheelParts) for (const i of parts[pi].mi) { const m = motions[i]; if (m.control === 'gear' && Math.abs(valueAt(m, 1)) > (m.type === 'translate' ? 0.01 : 0.5)) tilts.add(i); }
    for (const i of tilts) motionsX[i] = { ...motions[i], wowZero: true };
    if (tilts.size) log(`  ${tilts.size} gear motion${tilts.size > 1 ? 's' : ''} not at rest with the gear down on the wheels (${[...tilts].map(i => `${motions[i].type} ${valueAt(motions[i], 1).toFixed(1)}`).join(', ')}): level on the ground`);
  }
  if (fit) for (const leg of fit.legs) if (leg.d > 0.01) wowOf.set(leg, motionsX.push({ control: 'wow', type: 'translate', property: 'livesfo/wow', axis: [P.R[3], P.R[4], P.R[5]], factor: +leg.d.toFixed(4), offset: 0, targets: [] }) - 1);
  if (fit) log(`  fitted to ${twinKey}: pitched ${fit.pitchDeg.toFixed(2)}°, raised ${fit.dyM.toFixed(2)} m (body ${fit.depthM === null ? '?' : (fit.depthM >= 0 ? '+' : '') + fit.depthM.toFixed(2)} m deeper than the kit's, spread ${fit.spreadM.toFixed(3)} m); legs ${fit.legs.map(l => `${l.name} ${l.d >= 0 ? 'compressed' : 'extended'} ${Math.abs(l.d).toFixed(2)} m`).join(', ') || 'none'}`);
  if (fit?.debug && process.env.FIT_DEBUG) { fs.mkdirSync(process.env.FIT_DEBUG, { recursive: true }); fs.writeFileSync(path.join(process.env.FIT_DEBUG, `${af}--${String(ref.asset.selector || "").replace(/[^a-z0-9-]+/gi, "_")}.json`), JSON.stringify({ af, twin: twinKey, pitchDeg: fit.pitchDeg, dyM: fit.dyM, depthM: fit.depthM, spreadM: fit.spreadM, legs: fit.legs.map(l => ({ name: l.name, d: l.d, cut: l.cut, R: l.R, parts: l.parts.size, axles: l.axles, tiltDeg: l.tiltDeg })), kit: { yc: twinT.fus.yc, w: twinT.fus.w, h: twinT.fus.h, L: twinT.L, nose: twinT.gear.nose.z, main: twinT.gear.main.z }, ...fit.debug })); }
  // ---- merge: by motion group, then by what each livery draws there
  const matIds = liveries.map(() => new Map());   // per livery: material key → id
  const keyOf = (li, k) => { const L = liveries[li], mk = matKey(L, k), M = matIds[li]; if (!M.has(mk)) M.set(mk, { id: M.size, k, mk }); return M.get(mk).id; };
  const groups = new Map();
  // engines moved to the published stations (config.mjs ENGINE_FIX): per side, the fans' spin centres (kit frame)
  // give the move across; the parts named for the engine move, and the motions turning only them
  const EF = ENGINE_FIX[af], shiftOf = new Map(), motionShift = new Map(); let nearFix = null;
  if (EF) {
    const side = x => (x < 0 ? 'L' : 'R'), fanX = {};
    for (const m of motions) if (m.type === 'spin') { const c = apply(P, m.center || [0, 0, 0]); fanX[side(c[0])] = c[0]; }
    const dxOf = s => (EF.x === undefined || fanX[s] === undefined ? 0 : (s === 'L' ? -EF.x : EF.x) - fanX[s]);
    const moved = new Set();
    parts.forEach((part, pi) => {
      const name = part.node.name || '';
      if (!EF.parts.test(name)) return;
      let sx = 0, n = 0; for (const pr of part.prims) for (let i = 0; i < pr.mesh.pos.length; i += 3) { sx += apply(P, [pr.mesh.pos[i], pr.mesh.pos[i + 1], pr.mesh.pos[i + 2]])[0]; n++; }
      const s = side(sx / Math.max(1, n)); shiftOf.set(pi, [dxOf(s), 0, EF.dz]); moved.add(pi);
    });
    motions.forEach((m, i) => {
      const on = parts.map((p, pi) => (p.mi.includes(i) ? pi : -1)).filter(pi => pi >= 0);
      if (on.length && on.every(pi => moved.has(pi))) motionShift.set(i, shiftOf.get(on[0]));
    });
    // the engine's extent per side (the moved parts round the fan's axis), for `near`'s vertices
    if (EF.near) {
      const axis = {}; for (const m of motions) if (m.type === 'spin') { const c = apply(P, m.center || [0, 0, 0]); axis[side(c[0])] = c; }
      const ext = {}; for (const pi of moved) { const t = shiftOf.get(pi); for (const pr of parts[pi].prims) for (let i = 0; i < pr.mesh.pos.length; i += 3) { const v = apply(P, [pr.mesh.pos[i], pr.mesh.pos[i + 1], pr.mesh.pos[i + 2]]), sd = side(v[0]), a = axis[sd]; if (!a) continue; const e = ext[sd] || (ext[sd] = { r: 0, z0: Infinity, z1: -Infinity }); e.r = Math.max(e.r, Math.hypot(v[0] - a[0], v[1] - a[1])); e.z0 = Math.min(e.z0, v[2]); e.z1 = Math.max(e.z1, v[2]); } }
      nearFix = { axis, ext, dxOf, dz: EF.dz, re: EF.near };
      let nv = 0; parts.forEach(part => { if (EF.near.test(part.node.name || '')) for (const pr of part.prims) for (let i = 0; i < pr.mesh.pos.length; i += 3) { const v = apply(P, [pr.mesh.pos[i], pr.mesh.pos[i + 1], pr.mesh.pos[i + 2]]); if (nearOf(v)) nv++; } });
      log(`  and ${nv} vertices of ${EF.near} round the engines`);
    }
    log(`  engines moved ${EF.dz > 0 ? '+' : ''}${EF.dz} m along${EF.x !== undefined ? `, across to ${EF.x} m (left ${dxOf('L').toFixed(2)}, right ${dxOf('R').toFixed(2)})` : ''}: ${moved.size} parts, ${motionShift.size} motions`);
    // every part the reversers move goes with its engine: one left behind stands apart from the nacelle at rest (the NG
    // 737s' reverser halves until 15 Nov: a gap like reversers out, on an aircraft holding at 0 kt)
    const left = parts.filter((part, pi) => !moved.has(pi) && part.mi.some(i => motions[i].control === 'reversers')).map(part => part.node.name || '?');
    if (left.length) throw new Error(`${af}: ENGINE_FIX leaves parts the reversers move behind: ${[...new Set(left)].join(', ')} (config.mjs ${af}'s parts)`);
  }
  // the main gear moved to the published station (config.mjs GEAR_FIX), the motions turning only it with it
  const GF = GEAR_FIX[af];
  if (GF) {
    const movedG = new Set();
    parts.forEach((part, pi) => { if (!GF.parts.test(part.node.name || '')) return; const t = shiftOf.get(pi) || [0, 0, 0]; shiftOf.set(pi, [t[0], t[1], t[2] + GF.dz]); movedG.add(pi); });
    let nm = 0; motions.forEach((m, i) => { const on = parts.map((p, pi) => (p.mi.includes(i) ? pi : -1)).filter(pi => pi >= 0); if (on.length && on.every(pi => movedG.has(pi))) { motionShift.set(i, shiftOf.get(on[0])); nm++; } });
    log(`  main gear moved ${GF.dz > 0 ? '+' : ''}${GF.dz} m along: ${movedG.size} parts, ${nm} motions`);
  }
  // the fin moved to the published station (config.mjs FIN_FIX), the motions turning only it (the rudder's hinge) with it
  const FF = FIN_FIX[af];
  if (FF) {
    const movedF = new Set();
    parts.forEach((part, pi) => { if (!FF.parts.test(part.node.name || '')) return; const t = shiftOf.get(pi) || [0, 0, 0]; shiftOf.set(pi, [t[0], t[1], t[2] + FF.dz]); movedF.add(pi); });
    if (!movedF.size) throw new Error(`${af}: FIN_FIX matches no part (config.mjs)`);
    let nm = 0; motions.forEach((m, i) => { const on = parts.map((p, pi) => (p.mi.includes(i) ? pi : -1)).filter(pi => pi >= 0); if (on.length && on.every(pi => movedF.has(pi))) { motionShift.set(i, shiftOf.get(on[0])); nm++; } });
    log(`  fin moved ${FF.dz > 0 ? '+' : ''}${FF.dz} m along: ${movedF.size} parts (${[...new Set([...movedF].map(pi => parts[pi].node.name))].join(', ')}), ${nm} motions`);
  }
  // a vertex (kit frame) of a `near` part within an engine's radius (+10 %) and length (1 m ahead, 0.3 m behind): its move
  function nearOf(v) {
    if (!nearFix) return null; const sd = v[0] < 0 ? 'L' : 'R', a = nearFix.axis[sd], e = nearFix.ext[sd];
    if (!a || !e || v[2] < e.z0 - 1.0 || v[2] > e.z1 + 0.3 || Math.hypot(v[0] - a[0], v[1] - a[1]) > e.r * 1.1) return null;   // (an inlet lip reaches up to a metre ahead of the nacelle's parts)
    return [nearFix.dxOf(sd), 0, nearFix.dz];
  }
  const shiftNear = (mesh, name) => { if (!nearFix || !nearFix.re.test(name || '')) return mesh; for (let i = 0; i < mesh.pos.length; i += 3) { const t = nearOf([mesh.pos[i], mesh.pos[i + 1], mesh.pos[i + 2]]); if (t) { mesh.pos[i] += t[0]; mesh.pos[i + 1] += t[1]; mesh.pos[i + 2] += t[2]; } } return mesh; };
  const shifted = (mesh, t) => { if (!t) return mesh; for (let i = 0; i < mesh.pos.length; i += 3) { mesh.pos[i] += t[0]; mesh.pos[i + 1] += t[1]; mesh.pos[i + 2] += t[2]; } return mesh; };
  // parts stretched aft to a published station (config.mjs STRETCH_FIX): each part's own front and aft end, kit frame
  const SF = STRETCH_FIX[af], spanOf = new Map();
  if (SF) {
    parts.forEach((part, pi) => { if (!SF.parts.test(part.node.name || '')) return; let z0 = Infinity, z1 = -Infinity; for (const pr of part.prims) for (let i = 0; i < pr.mesh.pos.length; i += 3) { const v = apply(P, [pr.mesh.pos[i], pr.mesh.pos[i + 1], pr.mesh.pos[i + 2]]); z0 = Math.min(z0, v[2]); z1 = Math.max(z1, v[2]); } if (z1 > z0) spanOf.set(pi, [z0, z1]); });
    log(`  stretched to ${SF.aftTo} m: ${[...spanOf].map(([pi, [z0, z1]]) => `${parts[pi].node.name} ${z0.toFixed(2)}–${z1.toFixed(2)}`).join(', ')}`);
  }
  const stretched = (mesh, pi) => { const sp = spanOf.get(pi); if (!sp) return mesh; const [z0, z1] = sp, k = (SF.aftTo - z0) / (z1 - z0); for (let i = 2; i < mesh.pos.length; i += 3) if (mesh.pos[i] > z0) mesh.pos[i] = z0 + (mesh.pos[i] - z0) * k; return mesh; };
  const groupFor = (mi, internal, slot) => {
    const g = mi.join(',') + (internal ? '|i' : ''), key = g + '#' + slot;
    let e = groups.get(key); if (!e) groups.set(key, (e = { g, mi, internal, slot, meshes: [], names: new Set() }));
    return e;
  };
  let panesAdded = 0;
  parts.forEach((part, pi) => {
    part.prims.forEach((pr, qi) => {
      const slot = liveries.map((L, li) => keyOf(li, L.json.meshes[part.node.mesh].primitives[pr.j].material)).join('.');
      let tm = stretched(shiftNear(shifted(transformMesh(pr.mesh, P), shiftOf.get(pi)), part.node.name), pi);
      const leg = legOf.get(entryOf.get(`${pi}:${qi}`));
      // cockpit glass drawn as a frame with holes (config.mjs COCKPIT_PANES): each hole gets its pane (geometry.mjs capHoles)
      const gm = liveries[0].json.materials[liveries[0].json.meshes[part.node.mesh].primitives[pr.j].material];
      if (COCKPIT_PANES.has(af) && gm && gm.extras && gm.extras.cockpitGlazing) { const c = capHoles(tm); if (c.panes) { tm = c.mesh; panesAdded += c.panes; } }
      if (leg && wowOf.has(leg)) {
        const [lo, hi] = splitBelow(tm, leg.cut);
        if (hi) { const e = groupFor(part.mi, part.internal, slot); e.meshes.push(hi); e.names.add(part.node.name); }
        if (lo) { const e = groupFor([...part.mi, wowOf.get(leg)], part.internal, slot); e.meshes.push(lo); e.names.add(part.node.name); }
        return;
      }
      if (leg) compressLeg(tm, leg);
      const e = groupFor(part.mi, part.internal, slot); e.meshes.push(tm); e.names.add(part.node.name);
    });
  });
  if (panesAdded) log(`  ${panesAdded} cockpit window${panesAdded > 1 ? 's' : ''} left open in the library's glazing given panes`);
  // the materials each merged mesh draws with, per livery
  const slotMats = liveries.map((L, li) => { const byId = new Map(); for (const v of matIds[li].values()) byId.set(v.id, v); return byId; });
  let uvWrapped = 0;
  let merged = [...groups.values()].map(e => {
    const mats = e.slot.split('.').map((id, li) => slotMats[li].get(+id));
    const textured = mats.some((m, li) => !!(liveries[li].json.materials[m.k].pbrMetallicRoughness || {}).baseColorTexture);
    let mesh = weld(concat(e.meshes));
    if (!textured) mesh = weld({ ...mesh, uv: null });
    else uvWrapped += wrapStrayUVs(mesh);
    return { ...e, mats, mesh, ...surfaceOf(mesh) };
  });
  if (uvWrapped) log(`  ${uvWrapped} stray UV coordinates wrapped back (the library's ±hundreds; a slot's range is quantized to ${GEO.uvBits} bits)`);
  const tris0 = merged.reduce((s, m) => s + m.mesh.idx.length / 3, 0);
  // ---- the desktop hero's own detail: over budget (the 777 family, the 787s), simplified within 5 mm
  if (tris0 > GEO.heroTris) merged = merged.map(m => ({ ...m, mesh: simplify(MO.MeshoptSimplifier, m.mesh, GEO.heroError) }));
  const tris = merged.reduce((s, m) => s + m.mesh.idx.length / 3, 0);
  const lods = {};
  for (const [name, err] of Object.entries(GEO.lodErrors)) lods[name] = merged.map(m => simplify(MO.MeshoptSimplifier, m.mesh, err));

  // ---- dimensions and the review points, in the kit frame
  const all = merged.map(m => m.mesh.pos), bb = bounds(all);
  // the contacts were found on kit-axis positions (x lateral, y up, z aft) before levelling: back to the library's
  // frame, then through P
  const lv = v => apply(P, [v[2], v[1], -v[0]]);
  const nose = lv([0, contacts.nose.y, contacts.nose.z]), main = lv([0, contacts.main.y, contacts.main.z]);
  const rp = rig.reviewPoints || {};
  const dims = { noseZ: r4(nose[2]), mainZ: r4(main[2] + (GF ? GF.dz : 0)), L: r4(bb.max[2]), span: r4(bb.max[0] - bb.min[0]), H: r4(bb.max[1]), track: r4(contacts.main.track),
    eye: rp.cockpit ? apply(P, rp.cockpit).map(r4) : null, door: rp.door ? apply(P, rp.door).map(r4) : null, pitchFixDeg: r4(pitchDeg), floatM: r4(floatM), twin: fit ? twinKey : null };

  // ---- quantize and pack (one grid for every mesh and LOD of the variant)
  const grid = { off: bb.min.map(v => Math.floor(v * 100) / 100), step: GEO.posStep };
  // UV ranges per material slot (each livery's material there gets the same transform: the geometry is shared)
  const uvq = new Map();
  for (const m of merged) {
    if (!m.mesh.uv) continue;
    const key = m.slot; let q = uvq.get(key);
    const U = m.mesh.uv; let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
    for (let i = 0; i < U.length; i += 2) { if (U[i] < u0) u0 = U[i]; if (U[i] > u1) u1 = U[i]; if (U[i + 1] < v0) v0 = U[i + 1]; if (U[i + 1] > v1) v1 = U[i + 1]; }
    if (q) { u0 = Math.min(u0, q.off[0]); v0 = Math.min(v0, q.off[1]); u1 = Math.max(u1, q.off[0] + q.range[0]); v1 = Math.max(v1, q.off[1] + q.range[1]); }
    uvq.set(key, { off: [u0, v0], range: [Math.max(1e-6, u1 - u0), Math.max(1e-6, v1 - v0)] });
  }
  for (const q of uvq.values()) { const top = (1 << GEO.uvBits) - 1; q.bits = GEO.uvBits; q.scale = [q.range[0] / top, q.range[1] / top]; }

  // Apply the same filter as the cached-model loader after simplification, so the shared wing mesh retains its tessellation.
  const doorShells = merged.map(mesh => liveries.every((L, i) => {
    const m = L.json.materials[mesh.mats[i].k], image = texOf(L.json, m.pbrMetallicRoughness?.baseColorTexture);
    return isCargoDoorShell(`${af}-${L.livery}`, { name: m.name, alpha: m.alphaMode || 'OPAQUE' }, L.json.images?.[image]?.name);
  }));
  const packOne = meshes => {
    const pk = new MeshoptPacker(MO.MeshoptEncoder), accessors = [], prims = [];
    meshes.forEach((mesh0, i) => {
      const m = merged[i];
      const idx = doorShells[i] ? withoutCargoDoorShells({ pos: mesh0.pos, posStride: 3, index: mesh0.idx }, [0, 0, 0, 1]) : mesh0.idx;
      const mesh = reorder(MO.MeshoptEncoder, idx === mesh0.idx ? mesh0 : { ...mesh0, idx });
      if (!mesh.idx.length) { prims.push(null); return; }
      const uq = m.mesh.uv ? uvq.get(m.slot) : null;
      const q = quantize(MO.MeshoptEncoder, mesh, grid, uq, GEO.normalBits);
      const posV = pk.view(new Uint8Array(q.pos.buffer), q.n, 8, 'ATTRIBUTES', 'NONE', 34962);
      const nrmV = pk.view(q.nrm, q.n, q.normalStride, 'ATTRIBUTES', 'OCTAHEDRAL', 34962);
      const a = { POSITION: accessors.push({ bufferView: posV, componentType: 5122, count: q.n, type: 'VEC3', min: q.qmin, max: q.qmax }) - 1,
        NORMAL: accessors.push({ bufferView: nrmV, componentType: q.normalStride === 4 ? 5120 : 5122, normalized: true, count: q.n, type: 'VEC3' }) - 1 };
      if (q.uv) a.TEXCOORD_0 = accessors.push({ bufferView: pk.view(new Uint8Array(q.uv.buffer), q.n, 4, 'ATTRIBUTES', 'NONE', 34962), componentType: 5123, count: q.n, type: 'VEC2' }) - 1;
      const big = q.n > 65535, ib = big ? mesh.idx : Uint16Array.from(mesh.idx);
      const idxA = accessors.push({ bufferView: pk.view(new Uint8Array(ib.buffer, ib.byteOffset, ib.byteLength), mesh.idx.length, big ? 4 : 2, 'TRIANGLES', 'NONE', 34963), componentType: big ? 5125 : 5123, count: mesh.idx.length, type: 'SCALAR' }) - 1;
      prims.push({ attributes: a, indices: idxA, n: q.n, tris: mesh.idx.length / 3, gpu: q.n * (8 + q.normalStride + (q.uv ? 4 : 0)) + ib.byteLength });
    });
    const binBuf = pk.bin();
    return { bin: put('g', '.bin', binBuf), views: pk.views, accessors, prims, raw: pk.raw };
  };
  const packs = { lod0: packOne(merged.map(m => m.mesh)) };
  for (const [name, meshes] of Object.entries(lods)) packs[name] = packOne(meshes);

  // ---- per livery: textures, materials, the glTF
  const packedTris = packs.lod0.prims.reduce((s, p) => s + (p?.tris ?? 0), 0);
  const variantOut = { af, geometry: packs.lod0.bin, tris: packedTris, srcTris: tris0 + droppedTris, droppedTris, meshes: merged.length, dims, lods: {},
    fit: fit ? { twin: twinKey, pitchDeg: r4(fit.pitchDeg), dyM: r4(fit.dyM), depthM: fit.depthM === null ? null : r4(fit.depthM), spreadM: r4(fit.spreadM), legs: fit.legs.map(l => ({ name: l.name, d: r4(l.d), cut: r4(l.cut) })) } : null };
  for (const [name, pk] of Object.entries(packs)) variantOut.lods[name] = { bin: pk.bin.rel, wire: pk.bin.wire, tris: pk.prims.reduce((s, p) => s + (p ? p.tris : 0), 0) };
  const motionList = [], motionIdx = new Map();
  const motionRef = i => {
    if (!motionIdx.has(i)) {
      const o = motionOut(motionsX[i], P), t = motionShift.get(i);
      if (t && o.p) o.p = o.p.map((v, k) => +(v + t[k]).toFixed(4));   // (a translation's axis doesn't move)
      motionIdx.set(i, motionList.length); motionList.push(o);
    }
    return motionIdx.get(i);
  };
  const lightsFile = path.join(LIB, af, 'lights.json');
  const lights = fs.existsSync(lightsFile) ? lightsOut(JSON.parse(fs.readFileSync(lightsFile, 'utf8')), P) : [];
  // which images are paint: those that differ between this airframe's liveries (or, with one livery, the materials tagged as paint)
  const useCount = new Map(); for (const L of liveries) for (const h of new Set(L.imgHash)) useCount.set(h, (useCount.get(h) || 0) + 1);

  for (let li = 0; li < liveries.length; li++) {
    if (EMIT && !EMIT.has(liveries[li].livery)) continue;
    const L = liveries[li], lj = L.json, key = `${af}-${L.livery}`;
    const backing = new Set();
    for (const [i, mesh] of merged.entries()) {
      const material = lj.materials[mesh.mats[li].k], pbr = material.pbrMetallicRoughness || {};
      if (isCargoDoorBacking(key, {
        name: material.name, alpha: material.alphaMode || 'OPAQUE',
        map: pbr.baseColorTexture?.index ?? -1, color: pbr.baseColorFactor || [1, 1, 1, 1]
      })) backing.add(i);
    }
    // the images this livery's kept materials use
    const used = new Map();   // image index → { paint, area (m² of surface), uv (share of the image those surfaces use) }
    for (const m of merged) {
      const mm = lj.materials[m.mats[li].k], pbr = mm.pbrMetallicRoughness || {};
      // a cabin-window mask (the 737 MAX's painted windows): kept, for the cabin lights at night (D-144)
      const ei = mm.extras && mm.extras.cabinWindow ? texOf(lj, mm.emissiveTexture) : -1;
      if (ei >= 0) { const r = used.get(ei) || { paint: false, area: 0, uv: 0, mask: true }; r.area += m.area; r.uv += m.uvArea; used.set(ei, r); }
      const i = texOf(lj, pbr.baseColorTexture); if (i < 0) continue;
      const r = used.get(i) || { paint: false, area: 0, uv: 0 };
      r.paint ||= liveries.length > 1 ? useCount.get(L.imgHash[i]) < liveries.length : !!(mm.extras && (mm.extras.operatorPaintFinish || mm.extras.cabinWindow));
      r.area += m.area; r.uv += m.uvArea;
      used.set(i, r);
    }
    // decode, find flat colours, size within the budget, encode
    const tex = new Map();   // image index → { flat: [r,g,b,a] } | { w, h, codec, alpha, img }
    for (const [i, r] of used) {
      const s = imageStats(lj, L.bin, i, L.imgHash[i]);
      if (s.flat) { tex.set(i, { flat: s.color, name: lj.images[i].name }); continue; }
      const codec = r.mask || (!r.paint && s.busy >= TEX.busyEtc1s) ? 'etc1s' : 'auto';   // (auto: budgeted as UASTC, decided when encoded)
      const cap = (i === L.wingPaintImage && WING_ATLAS_FIX[L.asset.selector]?.maxSize) ||
        (r.mask ? TEX.maskCap : r.paint ? TEX.paintCap : TEX.otherCap);
      let w = Math.min(cap, pot(s.w)), h = Math.min(cap, pot(s.h));
      if (s.w / s.h !== w / h) { const ar = s.w / s.h; if (ar > 1) h = Math.max(4, pot(w / ar)); else w = Math.max(4, pot(h * ar)); }
      tex.set(i, { src: [lj, L.bin, i], w, h, codec, alpha: s.alpha, paint: r.paint, mask: !!r.mask, busy: s.busy, name: lj.images[i].name, hash: L.imgHash[i], area: r.area, uv: Math.min(1, r.uv) });
    }
    // the budget, by texel density: the map with the most texels per square metre of the surface it covers is the most
    // over-resolved, and is halved first (a 4096² winglet atlas before the fuselage's paint); maps finer than 5 mm a
    // texel are halved even within budget. Floors: paint 1024, the rest 512 (or less where already finer than 5 mm)
    // (a cabin-window mask, 0.7 MB at most, comes on top: counted in, it tipped the 737-9 over and halved its paint)
    const total = () => [...tex.values()].reduce((s, t) => s + (t.flat || t.mask ? 0 : gpuBytes(t.w, t.h, t.codec, t.alpha)), 0);
    const density = t => (t.w * t.h * Math.max(0.02, t.uv)) / Math.max(0.05, t.area);
    for (let guard = 0; guard < 60; guard++) {
      const over = total() > TEX.gpuBudget;
      const cand = [...tex.values()].filter(t => !t.flat && !t.mask && Math.max(t.w, t.h) > 16 && (density(t) > TEX.maxDensity || (over && Math.max(t.w, t.h) > (t.paint ? TEX.minPaint : TEX.minOther))));
      if (!cand.length) break;
      cand.sort((a, b) => density(b) - density(a));
      cand[0].w = Math.max(4, cand[0].w >> 1); cand[0].h = Math.max(4, cand[0].h >> 1);
    }
    if (FORCE_CODEC) for (const t of tex.values()) if (!t.flat) t.codec = FORCE_CODEC;   // after sizing: same sizes as today
    const encs = await pool([...tex.entries()].filter(([, t]) => !t.flat), JOBS, async ([i, t]) => {
      if (TEXMODE === 'none') return [i, null, null];
      const minPsnr = t.paint ? TEX.etc1sPsnrPaint : TEX.etc1sPsnrOther;
      const key = sha(Buffer.concat([Buffer.from(t.hash), Buffer.from(JSON.stringify([t.w, t.h, t.codec, t.alpha, TEXMODE, TEX.uastc, TEX.etc1s, minPsnr]))])).slice(0, 24);
      const img = () => resize(decodePNG(imageBytes(t.src[0], t.src[1], t.src[2])), t.w, t.h, true);   // only when not cached
      if (TEXMODE === 'png') { const f = path.join(CACHE, 'ktx', key + '.png'); if (!fs.existsSync(f)) fs.writeFileSync(f, encodePNG(img(), t.alpha)); return [i, put('t', '.png', fs.readFileSync(f), false), 'image/png']; }
      const k = await ktx2(img, t.codec, t.alpha, true, key, minPsnr);
      t.codec = k.codec; t.psnr = k.psnr;
      return [i, put('t', '.ktx2', k.buf, false), 'image/ktx2'];
    });
    for (const [i, file, mime] of encs) { const t = tex.get(i); t.file = file; t.mime = mime; delete t.src; }

    // ---- the glTF: materials by merged mesh, images by file
    const images = [], textures = [], materials = [], matIndex = new Map(), imgIndex = new Map();
    const exts = new Set(['EXT_meshopt_compression', 'KHR_mesh_quantization']);
    const textureFor = (i, slotKey) => {
      const t = tex.get(i); if (!t || t.flat || !t.file) return null;
      if (!imgIndex.has(i)) { imgIndex.set(i, images.length); images.push({ uri: `../${t.file.rel}`, mimeType: t.mime, name: t.name }); }
      const ti = textures.length;
      textures.push(t.mime === 'image/ktx2' ? { extensions: { KHR_texture_basisu: { source: imgIndex.get(i) } }, sampler: 0 } : { source: imgIndex.get(i), sampler: 0 });
      if (t.mime === 'image/ktx2') exts.add('KHR_texture_basisu');
      const q = uvq.get(slotKey), info = { index: ti };
      if (q) { info.extensions = { KHR_texture_transform: { offset: q.off.map(v => +v.toFixed(6)), scale: q.scale.map(v => +v.toPrecision(8)) } }; exts.add('KHR_texture_transform'); }
      return info;
    };
    const materialFor = m => {
      const k = m.mats[li].k, key = m.slot + '@' + k;
      if (matIndex.has(key)) return matIndex.get(key);
      const src = lj.materials[k], pbr = src.pbrMetallicRoughness || {}, cc = (src.extensions || {}).KHR_materials_clearcoat;
      let rough = pbr.roughnessFactor ?? 1;
      if (cc && cc.clearcoatFactor) rough = rough + ((cc.clearcoatRoughnessFactor ?? rough) - rough) * Math.min(1, cc.clearcoatFactor);   // the coat's gloss, folded in
      const out = { name: src.name, pbrMetallicRoughness: { baseColorFactor: (pbr.baseColorFactor || [1, 1, 1, 1]).map(r4), metallicFactor: r4(pbr.metallicFactor ?? 1), roughnessFactor: r4(rough) } };
      const bi = texOf(lj, pbr.baseColorTexture), t = bi >= 0 ? tex.get(bi) : null;
      if (t && t.flat) { const c = t.flat; out.pbrMetallicRoughness.baseColorFactor = out.pbrMetallicRoughness.baseColorFactor.map((f, j) => r4(f * (j < 3 ? srgbToLin(c[j]) : c[3] / 255))); }
      else if (t) { const info = textureFor(bi, m.slot); if (info) out.pbrMetallicRoughness.baseColorTexture = info; }
      if (src.emissiveFactor && src.emissiveFactor.some(v => v > 0)) out.emissiveFactor = src.emissiveFactor.map(r4);
      if (src.alphaMode && src.alphaMode !== 'OPAQUE') { out.alphaMode = src.alphaMode; if (src.alphaCutoff !== undefined) out.alphaCutoff = src.alphaCutoff; }
      if (src.doubleSided) out.doubleSided = true;
      const x = src.extras || {}, ex = {};
      if (x.cockpitGlazing) ex.glaze = 1;
      if (x.cabinWindow && !pbr.baseColorTexture) ex.cabin = 1;
      // the cabin-window mask: the emissive texture, its factor left 0 (the page lights it at night, D-144)
      const ei = x.cabinWindow ? texOf(lj, src.emissiveTexture) : -1, et = ei >= 0 ? tex.get(ei) : null;
      if (et && !et.flat) { const info = textureFor(ei, m.slot); if (info) { out.emissiveTexture = info; ex.cabinMask = 1; } }
      if (x.operatorPaintFinish || (t && t.paint)) ex.paint = 1;
      if (Object.keys(ex).length) out.extras = ex;
      matIndex.set(key, materials.length); materials.push(out);
      return materials.length - 1;
    };
    const buildGltf = (lodName) => {
      const pk = packs[lodName], nodes = [], meshes = [];
      merged.forEach((m, i) => {
        const pr = pk.prims[i]; if (!pr || backing.has(i)) return;
        const mesh = { primitives: [{ attributes: pr.attributes, indices: pr.indices, material: materialFor(m) }] };
        const node = { mesh: meshes.push(mesh) - 1, translation: grid.off, scale: [grid.step, grid.step, grid.step] };
        const ex = {}; if (m.mi.length) ex.m = m.mi.map(motionRef); if (m.internal) ex.internal = 1;
        if (Object.keys(ex).length) node.extras = ex;
        nodes.push(node);
      });
      const credits = creditsFor(L.asset);
      const g = {
        asset: { version: '2.0', generator: 'livesfo tools/fleet-convert.mjs', copyright: credits.copyright },
        extensionsUsed: [...exts], extensionsRequired: [...exts],
        scene: 0, scenes: [{ nodes: nodes.map((_, i) => i + 1) }],
        nodes: [{ name: `${af}/${L.livery}`, children: nodes.map((_, i) => i + 1) }, ...nodes],
        meshes, materials, textures, images, samplers: [{ magFilter: 9729, minFilter: 9987 }],
        accessors: pk.accessors, bufferViews: pk.views,
        buffers: [{ uri: `../${pk.bin.rel}`, byteLength: pk.bin.bytes }, { byteLength: pk.raw, extensions: { EXT_meshopt_compression: { fallback: true } } }],
        extras: { livesfo: { v: 1, airframe: af, livery: L.livery, selector: L.asset.selector, label: rig.label, dims, grid: [...grid.off, grid.step], motions: motionList, lights, detents: DETENTS[af] || DETENTS.default, credits } }
      };
      g.nodes[0].children = nodes.map((_, i) => i + 1);
      g.scenes = [{ nodes: [0] }];
      if (!textures.length) { delete g.textures; delete g.images; delete g.samplers; }
      return g;
    };
    const gl0 = buildGltf('lod0');
    const file = put('a', '.gltf', Buffer.from(JSON.stringify(gl0)));
    const lite = put('a', '.gltf', Buffer.from(JSON.stringify(buildGltf('lod1'))));
    const texWire = [...tex.values()].reduce((s, t) => s + (t.file ? t.file.bytes : 0), 0);
    const texGpu = [...tex.values()].reduce((s, t) => s + (t.flat || !t.file ? 0 : gpuBytes(t.w, t.h, t.codec, t.alpha)), 0);
    const drawn = packs.lod0.prims.filter((p, i) => p && !backing.has(i));
    const geoGpu = drawn.reduce((s, p) => s + p.gpu, 0);
    const drawnTris = drawn.reduce((s, p) => s + p.tris, 0);
    report.assets[key] = {
      gltf: file.rel, lite: lite.rel, selector: L.asset.selector, airframe: af, livery: L.livery, label: rig.label,
      wire: file.wire + packs.lod0.bin.wire + texWire, gpu: geoGpu + texGpu, geoGpu, texGpu, tris: drawnTris, draws: drawn.length, dims,
      textures: [...tex.values()].map(t => (t.flat ? { name: t.name, flat: t.flat } : { name: t.name, w: t.w, h: t.h, codec: t.codec, psnr: t.psnr, alpha: t.alpha, paint: !!t.paint, busy: r4(t.busy), bytes: t.file ? t.file.bytes : 0 })),
      special: SPECIAL.has(L.asset.selector), credits: creditsFor(L.asset).id
    };
    log(`  ${key}: ${(report.assets[key].wire / 1e6).toFixed(2)} MB wire, ${(report.assets[key].gpu / 1e6).toFixed(1)} MB GPU (${(geoGpu / 1e6).toFixed(1)} geometry), ${drawnTris} tris, ${drawn.length} draws`);
  }
  report.variants.push(variantOut);
  log(`  variant ${liveries.map(l => l.livery).join(', ')}: ${tris0 + droppedTris} → ${packedTris} tris (${droppedTris + tris - packedTris} dropped), ${merged.length} meshes, geometry ${(packs.lod0.bin.wire / 1e3).toFixed(0)} KB br, levelled ${pitchDeg.toFixed(2)}° (${(floatM * 100).toFixed(0)} cm)`);
}

/* ---------------- credits ---------------- */
const credits = new Map();
function creditsFor(asset) {
  const id = (asset.sourcePackages || []).join('+') || (asset.authoredGeometry ? 'authored' : 'unknown');
  if (credits.has(id)) return credits.get(id);
  const pk = (asset.sourcePackages || []).map(p => ({ id: p, ...handoff.sourcePackages[p] }));
  const lic = [...new Set(pk.map(p => licenceOf(p.licenseEvidence)))];
  const c = {
    id, licences: lic, authored: !!asset.authoredGeometry,
    sources: pk.map(p => ({ id: p.id, repo: p.repository && p.repository.full_name, url: p.repository && p.repository.html_url, rev: p.repository && p.repository.revision, ...PACKAGE_INFO[p.id], licence: licenceOf(p.licenseEvidence), evidence: p.licenseEvidence, notices: p.notices, source: p.correspondingSource })),
    copyright: pk.length ? `Adapted from ${pk.map(p => (PACKAGE_INFO[p.id] && PACKAGE_INFO[p.id].repo) || (p.repository ? p.repository.full_name : p.id)).join(', ')} (${lic.join(', ')}); converted by livesfo` : 'the SFO aircraft library'
  };
  credits.set(id, c);
  return c;
}

/* ---------------- main ---------------- */
const t0 = Date.now();
const MO = FITS_ONLY ? null : await meshopt();
if (FITS_ONLY) log(`fleet-convert: recording fits from ${LIB}`);
else {
  for (const d of ['g', 't', 'a']) fs.mkdirSync(path.join(OUT, d), { recursive: true });
  fs.mkdirSync(path.join(CACHE, 'ktx'), { recursive: true });
  log(`fleet-convert: ${LIB}\n  meshoptimizer ${MO.version}, textures: ${TEXMODE}${TEXMODE === 'ktx2' ? ` (${basisu() || 'basisu missing'})` : ''}`);
}
const report = FITS_ONLY ? null : { v: 1, generated: new Date().toISOString(), base: '/m/', library: { zip: libPkg.zip || null, sha256: libPkg.sha256 || null, updated: handoff.updatedAtUTC }, tools: { meshoptimizer: MO.version }, types: {}, regs: {}, assets: {}, variants: [], credits: {} };
const prevPath = path.join(ROOT, 'shared/fleet.json'), prevReport = path.join(OUT, 'report.json');
const prev = !FITS_ONLY && fs.existsSync(prevReport) ? JSON.parse(fs.readFileSync(prevReport, 'utf8')) : null;
for (const af of ONLY) {
  if (EXCLUDE_AIRFRAMES.has(af)) { log(`${af}: excluded (licence)`); continue; }
  const assets = handoff.assets.filter(a => a.selector.split('/')[0] === af && convertibleSelector(a.selector) && (!ONLY_LIVERY || ONLY_LIVERY.has(a.selector.split('/')[1])));
  if (!assets.length) { log(`${af}: nothing to convert`); continue; }
  log(`${af}: ${assets.length} liveries`);
  const loaded = assets.map(loadLivery);
  const byGeo = new Map(); for (const L of loaded) { const s = geoSignature(L); if (!byGeo.has(s)) byGeo.set(s, []); byGeo.get(s).push(L); }
  for (const group of byGeo.values()) await convertVariant(af, group, MO, report);
}
if (writtenFits) {
  fs.mkdirSync(path.dirname(WRITE_FITS), { recursive: true });
  fs.writeFileSync(WRITE_FITS, fitTableJSON(writtenFits));
  log(`fit table: ${WRITE_FITS} (${Object.keys(writtenFits.airframes).length} airframes)`);
}
if (FITS_ONLY) process.exit(0);
// keep what an earlier run converted for airframes not in this run (an --only run adds to the index)
if (prev) for (const [k, v] of Object.entries(prev.assets || {})) if (!report.assets[k] && !ONLY.includes(v.airframe)) report.assets[k] = v;
if (prev) for (const v of prev.variants || []) if (!ONLY.includes(v.af)) report.variants.push(v);
// the index: ICAO type → airline (ICAO) → asset, from the library's SFO coverage (special liveries never a default)
for (const c of coverage.combinations) {
  const a = c.asset; if (!a) continue;
  const key = `${a.aircraft}-${a.livery}`, iata = String(c.id).split('/')[0];
  if (!report.assets[key] || report.assets[key].special || c.specialLivery) continue;
  const al = IATA_ICAO[iata]; if (!al) continue;
  (report.types[c.canonicalType] ||= {})[al] = key;
}
// our crowd's liveries on the library's airframes (tools/fleet/reverse.mjs, `reverse`): kept while their template's model
// is the same file, else dropped (run reverse.mjs again); the library's own livery of the pair, once it has one, wins
if (prev) for (const [k, v] of Object.entries(prev.assets || {})) {
  if (!v.reverse) continue;
  const t = report.assets[v.reverse.template], mine = report.types[v.reverse.type] && report.types[v.reverse.type][v.reverse.al];
  if (!t || t.gltf !== v.reverse.templateGltf || (mine && mine !== k)) { delete report.assets[k]; log(`${k}: ${mine && mine !== k ? `the library has ${v.reverse.type}|${v.reverse.al} now` : `its template ${v.reverse.template} changed`}: run tools/fleet/reverse.mjs again`); continue; }
  report.assets[k] = v; (report.types[v.reverse.type] ||= {})[v.reverse.al] = k;
}
for (const c of credits.values()) report.credits[c.id] = { ...c, copyright: undefined };
if (prev) for (const [k, v] of Object.entries(prev.credits || {})) if (!report.credits[k]) report.credits[k] = v;
if (NO_INDEX) {
  const trial = { generated: report.generated, codec: FORCE_CODEC || 'rule', assets: {} };
  for (const [k, a] of Object.entries(report.assets)) if (ONLY.includes(a.airframe) && (!EMIT || EMIT.has(a.livery))) { trial.assets[k] = a; log(`  ${k}: ${a.gltf}`); }
  fs.writeFileSync(TRIAL, JSON.stringify(trial, null, 1) + '\n');
  log(`trial: ${TRIAL}`);
  process.exit(0);
}
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1) + '\n');
// the page's index: what it needs to pick and load a model, and to credit it (textures and variants stay in the report)
const lean = { ...report, variants: undefined, assets: Object.fromEntries(Object.entries(report.assets).map(([k, a]) => [k, { gltf: a.gltf, lite: a.lite, label: a.label, wire: a.wire, gpu: a.gpu, tris: a.tris, draws: a.draws, special: a.special || undefined, credits: a.credits,
  livery: a.reverse ? a.livery : undefined, reverse: a.reverse ? { template: a.reverse.template, from: a.reverse.from, licence: a.reverse.licence } : undefined }])),
  credits: Object.fromEntries(Object.entries(report.credits).map(([k, c]) => [k, { licences: c.licences, sources: c.sources.map(s => ({ id: s.id, repo: s.repo, url: s.url, rev: s.rev, licence: s.licence })) }])) };
fs.writeFileSync(prevPath, JSON.stringify(lean) + '\n');
const A = Object.values(report.assets), med = arr => { const s = [...arr].sort((p, q) => p - q); return s[Math.floor(s.length / 2)] || 0; };
log(`\n${A.length} assets, ${report.variants.length} variants in ${((Date.now() - t0) / 1000).toFixed(0)} s. Median wire ${(med(A.map(a => a.wire)) / 1e6).toFixed(2)} MB, GPU ${(med(A.map(a => a.gpu)) / 1e6).toFixed(1)} MB; max wire ${(Math.max(...A.map(a => a.wire)) / 1e6).toFixed(2)} MB, GPU ${(Math.max(...A.map(a => a.gpu)) / 1e6).toFixed(1)} MB`);
log(`index: shared/fleet.json (${Object.keys(report.types).length} types); files: ${OUT}`);

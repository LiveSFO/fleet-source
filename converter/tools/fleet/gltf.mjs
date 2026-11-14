// @ts-check
/**
 * glTF in and out for the fleet converter: the GLB subset the fleet library writes (one root node, every part a direct
 * child with no transform of its own, float attributes, indexed triangles, PNG images), and the subset the converter
 * writes (EXT_meshopt_compression, KHR_mesh_quantization, KHR_texture_basisu), which client/js/libmodel.js reads.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const CT = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/** @param {Buffer} buf @returns {{json: any, bin: Buffer}} */
export function readGLB(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
  let p = 12, json = null, bin = null;
  while (p < buf.length) {
    const len = buf.readUInt32LE(p), type = buf.readUInt32LE(p + 4), d = buf.subarray(p + 8, p + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(d.toString('utf8'));
    else if (type === 0x004e4942) bin = d;
    p += 8 + len;
  }
  return { json, bin: /** @type {Buffer} */ (bin) };
}

/** an accessor's data as a fresh, tightly packed typed array (ints stay ints) */
export function accessor(json, bin, i) {
  const a = json.accessors[i], T = CT[a.componentType], n = NC[a.type], bv = json.bufferViews[a.bufferView];
  const es = T.BYTES_PER_ELEMENT, stride = bv.byteStride || n * es, base = bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0);
  const out = new T(a.count * n);
  if (stride === n * es && base % es === 0) out.set(new T(bin.buffer, base, a.count * n));
  else {
    const dv = new DataView(bin.buffer);
    const get = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[a.componentType];
    for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = dv[get](base + k * stride + c * es, true);
  }
  return out;
}

/** an embedded image's bytes */
export function imageBytes(json, bin, i) {
  const im = json.images[i], bv = json.bufferViews[im.bufferView];
  return bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
}

/**
 * meshoptimizer (MIT): the npm package if installed (`npm i -D meshoptimizer`), else the copy MESHOPT_DIR points at
 * (any meshoptimizer ≥ 0.21 package folder).
 */
export async function meshopt() {
  let dir = null;
  try { dir = path.dirname(createRequire(import.meta.url).resolve('meshoptimizer')); } catch { /* not installed */ }
  if (dir) return load(dir);
  {
    const dir = process.env.MESHOPT_DIR;
    if (!dir || !fs.existsSync(path.join(dir, 'meshopt_encoder.js'))) throw new Error('meshoptimizer not found: npm i -D meshoptimizer, or set MESHOPT_DIR to a meshoptimizer package folder');
    return load(dir);
  }
  async function load(dir) {
    const url = f => 'file://' + path.join(dir, f);
    const [{ MeshoptEncoder }, { MeshoptSimplifier }, { MeshoptDecoder }] = await Promise.all([import(url('meshopt_encoder.js')), import(url('meshopt_simplifier.js')), import(url('meshopt_decoder.mjs'))]);
    await Promise.all([MeshoptEncoder.ready, MeshoptSimplifier.ready, MeshoptDecoder.ready]);
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    return { MeshoptEncoder, MeshoptSimplifier, MeshoptDecoder, version: pkg.version, dir };
  }
}

/**
 * Builds one meshopt-compressed buffer (the geometry .bin) and the bufferViews that point into it, following
 * EXT_meshopt_compression: each view has its compressed bytes in buffer 0 and declares its decoded size in buffer 1
 * (a fallback buffer with no data: the extension is required).
 */
export class MeshoptPacker {
  constructor(enc) { this.enc = enc; this.parts = []; this.size = 0; this.views = []; this.raw = 0; }
  /**
   * @param {Uint8Array} data decoded bytes (count × stride), already filtered (encodeFilterOct…) when a filter is named
   * @param {number} count @param {number} stride
   * @param {'ATTRIBUTES'|'TRIANGLES'|'INDICES'} mode @param {'NONE'|'OCTAHEDRAL'|'QUATERNION'|'EXPONENTIAL'} [filter]
   * @param {number} [target] 34962 vertex data, 34963 indices @returns {number} the bufferView index
   */
  view(data, count, stride, mode, filter = 'NONE', target) {
    const enc = this.enc.encodeGltfBuffer(data, count, stride, mode);   // bitstream version 0: EXT_meshopt_compression
    while (this.size % 4) { this.parts.push(Buffer.alloc(1)); this.size++; }
    const off = this.size;
    this.parts.push(Buffer.from(enc.buffer, enc.byteOffset, enc.byteLength)); this.size += enc.byteLength;
    const rawOff = this.raw; this.raw += Math.ceil(data.byteLength / 4) * 4;
    const v = { buffer: 1, byteOffset: rawOff, byteLength: data.byteLength, extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: off, byteLength: enc.byteLength, byteStride: stride, count, mode, ...(filter !== 'NONE' ? { filter } : {}) } } };
    if (mode === 'ATTRIBUTES') v.byteStride = stride;
    if (target) v.target = target;
    this.views.push(v);
    return this.views.length - 1;
  }
  bin() { return Buffer.concat(this.parts); }
}

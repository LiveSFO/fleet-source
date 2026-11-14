// @ts-check
/**
 * Images for the fleet converter, with no dependencies: PNG in (8-bit grey, RGB, palette, grey-alpha and RGBA; bit
 * depths 1–8; not interlaced, which is all the fleet library writes) and out, an area-weighted resize, and the
 * statistics the codec choice reads (alpha used, one flat colour, how noisy).
 */
import zlib from 'node:zlib';

/** @typedef {{w: number, h: number, data: Uint8Array}} RGBA  8 bits per channel, rows top to bottom */

/** @param {Uint8Array} buf a PNG file @returns {RGBA} */
export function decodePNG(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (dv.getUint32(0) !== 0x89504e47) throw new Error('not a PNG');
  let p = 8, w = 0, h = 0, depth = 8, ct = 6, il = 0, plte = null, trns = null;
  const idat = [];
  while (p < u8.length) {
    const len = dv.getUint32(p), type = String.fromCharCode(u8[p + 4], u8[p + 5], u8[p + 6], u8[p + 7]), d = u8.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = dv.getUint32(p + 8); h = dv.getUint32(p + 12); depth = d[8]; ct = d[9]; il = d[12]; }
    else if (type === 'PLTE') plte = d;
    else if (type === 'tRNS') trns = d;
    else if (type === 'IDAT') idat.push(d);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (il) throw new Error('interlaced PNG not supported');
  if (depth === 16) throw new Error('16-bit PNG not supported');
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct];
  if (!ch) throw new Error(`PNG colour type ${ct}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = Math.max(1, (ch * depth) >> 3), stride = (w * ch * depth + 7) >> 3;
  const cur = new Uint8Array(stride), prev = new Uint8Array(stride);
  const out = new Uint8Array(w * h * 4);
  let q = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[q++];
    for (let i = 0; i < stride; i++) {
      const x = raw[q++], a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v;
      if (f === 0) v = x;
      else if (f === 1) v = x + a;
      else if (f === 2) v = x + b;
      else if (f === 3) v = x + ((a + b) >> 1);
      else { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      cur[i] = v & 255;
    }
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      let r, g, b, al = 255;
      if (depth < 8) {
        const bit = x * depth, byte = cur[bit >> 3], shift = 8 - depth - (bit & 7), v = (byte >> shift) & ((1 << depth) - 1);
        if (ct === 3) { r = plte[v * 3]; g = plte[v * 3 + 1]; b = plte[v * 3 + 2]; if (trns && v < trns.length) al = trns[v]; }
        else { r = g = b = Math.round(v * 255 / ((1 << depth) - 1)); }
      } else if (ct === 0) { r = g = b = cur[x]; if (trns && trns.length >= 2 && cur[x] === trns[1]) al = 0; }
      else if (ct === 2) { r = cur[x * 3]; g = cur[x * 3 + 1]; b = cur[x * 3 + 2]; if (trns && trns.length >= 6 && r === trns[1] && g === trns[3] && b === trns[5]) al = 0; }
      else if (ct === 3) { const v = cur[x]; r = plte[v * 3]; g = plte[v * 3 + 1]; b = plte[v * 3 + 2]; if (trns && v < trns.length) al = trns[v]; }
      else if (ct === 4) { r = g = b = cur[x * 2]; al = cur[x * 2 + 1]; }
      else { r = cur[x * 4]; g = cur[x * 4 + 1]; b = cur[x * 4 + 2]; al = cur[x * 4 + 3]; }
      out[row + x * 4] = r; out[row + x * 4 + 1] = g; out[row + x * 4 + 2] = b; out[row + x * 4 + 3] = al;
    }
    prev.set(cur);
  }
  return { w, h, data: out };
}

const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const b = Buffer.alloc(12 + data.length);
  b.writeUInt32BE(data.length, 0); b.write(type, 4, 'latin1'); Buffer.from(data.buffer, data.byteOffset, data.length).copy(b, 8);
  b.writeUInt32BE(crc32(b.subarray(4, 8 + data.length)), 8 + data.length);
  return b;
}
/** @param {RGBA} img @param {boolean} [alpha] keep the alpha channel (else RGB) @returns {Buffer} */
export function encodePNG(img, alpha = true) {
  const { w, h, data } = img, ch = alpha ? 4 : 3, stride = w * ch;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < w; x++) for (let c = 0; c < ch; c++) raw[y * (stride + 1) + 1 + x * ch + c] = data[(y * w + x) * 4 + c];
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = alpha ? 6 : 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', new Uint8Array(0))]);
}

/**
 * Area-weighted resize (each output pixel averages the input it covers, in linear light for colour and premultiplied
 * by alpha, so dark fringes don't creep in): the right filter for shrinking paint atlases by any factor.
 * @param {RGBA} img @param {number} W @param {number} H @param {boolean} srgb colour data (not a mask) @returns {RGBA}
 */
export function resize(img, W, H, srgb = true) {
  const { w, h, data } = img;
  if (W === w && H === h) return img;
  const toLin = new Float32Array(256); for (let i = 0; i < 256; i++) { const c = i / 255; toLin[i] = srgb ? (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)) : c; }
  const fromLin = v => { v = Math.min(1, Math.max(0, v)); const c = srgb ? (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) : v; return Math.round(c * 255); };
  // separable: weights of each source column (row) for each target column (row)
  const spans = (n, N) => { const s = n / N, r = []; for (let i = 0; i < N; i++) { const a = i * s, b = a + s, ws = []; for (let k = Math.floor(a); k < Math.min(n, Math.ceil(b)); k++) { const wt = Math.min(b, k + 1) - Math.max(a, k); if (wt > 1e-6) ws.push(k, wt / s); } r.push(ws); } return r; };
  const sx = spans(w, W), sy = spans(h, H);
  const tmp = new Float32Array(W * h * 4);   // horizontal pass, premultiplied linear
  for (let y = 0; y < h; y++) for (let X = 0; X < W; X++) {
    let r = 0, g = 0, b = 0, a = 0; const ws = sx[X];
    for (let k = 0; k < ws.length; k += 2) { const i = (y * w + ws[k]) * 4, wt = ws[k + 1], al = data[i + 3] / 255; r += toLin[data[i]] * al * wt; g += toLin[data[i + 1]] * al * wt; b += toLin[data[i + 2]] * al * wt; a += al * wt; }
    const o = (y * W + X) * 4; tmp[o] = r; tmp[o + 1] = g; tmp[o + 2] = b; tmp[o + 3] = a;
  }
  const out = new Uint8Array(W * H * 4);
  for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
    let r = 0, g = 0, b = 0, a = 0; const ws = sy[Y];
    for (let k = 0; k < ws.length; k += 2) { const i = (ws[k] * W + X) * 4, wt = ws[k + 1]; r += tmp[i] * wt; g += tmp[i + 1] * wt; b += tmp[i + 2] * wt; a += tmp[i + 3] * wt; }
    const o = (Y * W + X) * 4, inv = a > 1e-6 ? 1 / a : 0;
    out[o] = fromLin(r * inv); out[o + 1] = fromLin(g * inv); out[o + 2] = fromLin(b * inv); out[o + 3] = Math.round(Math.min(1, a) * 255);
  }
  return { w: W, h: H, data: out };
}

/**
 * What the codec choice needs to know about an image:
 *  - alpha: any pixel not fully opaque (a used alpha channel);
 *  - flat: one colour everywhere (within ±2): replaced by a colour factor, no texture at all;
 *  - color: the mean colour (sRGB bytes), for that factor;
 *  - busy: the share of 4×4 blocks with more than a little texture (local contrast), the "noisy maps" ETC1S suits;
 *    flat paint with sharp lettering has few busy blocks (most are one colour) and goes UASTC.
 * @param {RGBA} img
 */
export function stats(img) {
  const { w, h, data } = img;
  let alpha = false, mn = [255, 255, 255, 255], mx = [0, 0, 0, 0];
  const sum = [0, 0, 0, 0];
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 4; c++) { const v = data[i + c]; if (v < mn[c]) mn[c] = v; if (v > mx[c]) mx[c] = v; sum[c] += v; }
    if (data[i + 3] < 250) alpha = true;
  }
  const n = w * h, flat = mx.every((v, c) => v - mn[c] <= 4);
  let busy = 0, blocks = 0;
  const step = Math.max(1, Math.floor(Math.sqrt((w / 4) * (h / 4) / 65536)));   // sample at most ~65k blocks
  for (let by = 0; by + 4 <= h; by += 4 * step) for (let bx = 0; bx + 4 <= w; bx += 4 * step) {
    blocks++;
    const L = new Float32Array(16); let lo = 1e9, hi = -1;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const i = ((by + y) * w + bx + x) * 4, l = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      L[y * 4 + x] = l; if (l < lo) lo = l; if (l > hi) hi = l;
    }
    if (hi - lo < 4) continue;
    // noisy: many grey levels in the block (grime, a photo), not two flat colours with an edge between them (paint and
    // lettering). Two clusters fitted to the block's levels: what's left over is the noise
    let c0 = lo, c1 = hi;
    for (let it = 0; it < 2; it++) {
      let s0 = 0, n0 = 0, s1 = 0, n1 = 0;
      for (const l of L) { if (Math.abs(l - c0) <= Math.abs(l - c1)) { s0 += l; n0++; } else { s1 += l; n1++; } }
      if (n0) c0 = s0 / n0; if (n1) c1 = s1 / n1;
    }
    let res = 0; for (const l of L) res += Math.min(Math.abs(l - c0), Math.abs(l - c1));
    if (res / 16 > 2.5) busy++;
  }
  return { alpha, flat, color: sum.map(v => Math.round(v / n)), busy: blocks ? busy / blocks : 0 };
}

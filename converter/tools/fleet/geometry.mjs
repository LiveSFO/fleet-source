// @ts-check
/**
 * Geometry for the fleet converter: the library's frame to the kit's, the rest pose levelled on the gear, parts merged,
 * welded, simplified, quantized and reordered for the GPU.
 *
 * Frames. The library: metres, X aft, Y up, Z port, origin near mid-fuselage, the raw unloaded gear-down pose (the
 * nose tyre floats 5–46 cm above the mains' contact plane). The kit (livesfo's traffic.js place()): metres, +Z aft
 * (forward is −Z), Y up, +X starboard, the nose tip at z = 0 and the tyres on y = 0, level on its gear. A rotation of
 * −90° about Y takes one to the other (lib (x, y, z) → kit (−z, y, x): no mirroring), then the model is pitched about
 * the main gear's contact until the nose tyre touches too, and moved so the nose is at z = 0 and the tyres at y = 0.
 */

/** @typedef {{pos: Float32Array, nrm: Float32Array, uv: Float32Array|null, idx: Uint32Array}} Mesh  float xyz / uv, triangle list */
/** @typedef {{R: number[], t: number[]}} Rigid  v' = R·v + t (R row-major 3×3) */

export const LIB_TO_KIT = [0, 0, -1, 0, 1, 0, 1, 0, 0];   // (x, y, z) → (−z, y, x)

export const apply = (P, v) => [P.R[0] * v[0] + P.R[1] * v[1] + P.R[2] * v[2] + P.t[0], P.R[3] * v[0] + P.R[4] * v[1] + P.R[5] * v[2] + P.t[1], P.R[6] * v[0] + P.R[7] * v[1] + P.R[8] * v[2] + P.t[2]];
export const rotate = (R, v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
const mul3 = (A, B) => { const C = new Array(9).fill(0); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) C[i * 3 + j] += A[i * 3 + k] * B[k * 3 + j]; return C; };
/** B after A */
export const compose = (B, A) => ({ R: mul3(B.R, A.R), t: apply(B, A.t) });

/**
 * Where the gear touches the ground in the rotated (kit-axes) rest pose: the main gear's contact (the lowest points,
 * both sides) and the nose gear's (the lowest point near the centreline well ahead of the mains).
 * @param {Float32Array[]} positions kit axes, not yet levelled
 */
export function contacts(positions) {
  let yMin = Infinity;
  for (const P of positions) for (let i = 1; i < P.length; i += 3) if (P[i] < yMin) yMin = P[i];
  let n = 0, z = 0, xl = 0, xr = 0, nl = 0, nr = 0;
  for (const P of positions) for (let i = 0; i < P.length; i += 3) if (P[i + 1] < yMin + 0.03) { n++; z += P[i + 2]; if (P[i] < 0) { xl += P[i]; nl++; } else { xr += P[i]; nr++; } }
  const main = { y: yMin, z: z / n, track: (nr ? xr / nr : 0) - (nl ? xl / nl : 0) };
  let yN = Infinity;
  for (const P of positions) for (let i = 0; i < P.length; i += 3) if (Math.abs(P[i]) < 0.6 && P[i + 2] < main.z - 3 && P[i + 1] < yN) yN = P[i + 1];
  let m = 0, zn = 0;
  for (const P of positions) for (let i = 0; i < P.length; i += 3) if (Math.abs(P[i]) < 0.6 && P[i + 2] < main.z - 3 && P[i + 1] < yN + 0.03) { m++; zn += P[i + 2]; }
  return { main, nose: { y: yN, z: zn / m } };
}

/**
 * The rigid transform from the library's frame to the kit's, levelled: rotated to kit axes, pitched nose-down about
 * the main gear contact until the nose tyre touches, the tyres on y = 0 and the nose tip at z = 0.
 * @param {Float32Array[]} libPositions every visible part's positions in the library frame (gear down)
 */
export function kitTransform(libPositions) {
  const R0 = { R: LIB_TO_KIT, t: [0, 0, 0] };
  const rot = libPositions.map(P => { const o = new Float32Array(P.length); for (let i = 0; i < P.length; i += 3) { o[i] = -P[i + 2]; o[i + 1] = P[i + 1]; o[i + 2] = P[i]; } return o; });
  const c = contacts(rot);
  const h = c.nose.y - c.main.y, D = c.main.z - c.nose.z, a = -Math.atan2(h, D);   // about +x: the nose comes down
  const ca = Math.cos(a), sa = Math.sin(a);
  // rotate about the main contact point: v' = Rx·(v − m) + m
  const Rx = [1, 0, 0, 0, ca, -sa, 0, sa, ca], m = [0, c.main.y, c.main.z], Rm = rotate(Rx, m);
  let P = compose({ R: Rx, t: [m[0] - Rm[0], m[1] - Rm[1], m[2] - Rm[2]] }, R0);
  // then the tyres onto y = 0 and the nose tip onto z = 0
  let zMin = Infinity;
  for (const L of libPositions) for (let i = 0; i < L.length; i += 3) { const v = apply(P, [L[i], L[i + 1], L[i + 2]]); if (v[2] < zMin) zMin = v[2]; }
  P = compose({ R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, -c.main.y, -zMin] }, P);
  return { P, pitchDeg: -a * 180 / Math.PI, floatM: h, contacts: c };
}

/** a mesh moved by P (positions) and its rotation (normals) */
export function transformMesh(mesh, P) {
  const pos = new Float32Array(mesh.pos.length), nrm = new Float32Array(mesh.nrm.length);
  for (let i = 0; i < pos.length; i += 3) {
    const v = apply(P, [mesh.pos[i], mesh.pos[i + 1], mesh.pos[i + 2]]); pos[i] = v[0]; pos[i + 1] = v[1]; pos[i + 2] = v[2];
    const n = rotate(P.R, [mesh.nrm[i], mesh.nrm[i + 1], mesh.nrm[i + 2]]); nrm[i] = n[0]; nrm[i + 1] = n[1]; nrm[i + 2] = n[2];
  }
  return { pos, nrm, uv: mesh.uv, idx: mesh.idx };
}

/** several meshes as one (all with UVs or none: a missing set is zero-filled) */
export function concat(meshes) {
  let nv = 0, ni = 0; const withUV = meshes.some(m => m.uv);
  for (const m of meshes) { nv += m.pos.length / 3; ni += m.idx.length; }
  const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), uv = withUV ? new Float32Array(nv * 2) : null, idx = new Uint32Array(ni);
  let ov = 0, oi = 0;
  for (const m of meshes) {
    pos.set(m.pos, ov * 3); nrm.set(m.nrm, ov * 3); if (uv && m.uv) uv.set(m.uv, ov * 2);
    for (let i = 0; i < m.idx.length; i++) idx[oi + i] = m.idx[i] + ov;
    ov += m.pos.length / 3; oi += m.idx.length;
  }
  return { pos, nrm, uv, idx };
}

/**
 * Merge vertices that are identical in every attribute (the X-Plane meshes come unwelded, three vertices a triangle),
 * drop degenerate triangles and vertices nothing uses.
 */
export function weld(mesh) {
  const nv = mesh.pos.length / 3, map = new Map(), remap = new Uint32Array(nv), f = new Float32Array(8), u = new Uint32Array(f.buffer);
  let k = 0;
  const pos = [], nrm = [], uv = [];
  for (let i = 0; i < nv; i++) {
    f[0] = mesh.pos[i * 3]; f[1] = mesh.pos[i * 3 + 1]; f[2] = mesh.pos[i * 3 + 2]; f[3] = mesh.nrm[i * 3]; f[4] = mesh.nrm[i * 3 + 1]; f[5] = mesh.nrm[i * 3 + 2];
    f[6] = mesh.uv ? mesh.uv[i * 2] : 0; f[7] = mesh.uv ? mesh.uv[i * 2 + 1] : 0;
    const key = u.join(',');
    let j = map.get(key);
    if (j === undefined) { j = k++; map.set(key, j); pos.push(f[0], f[1], f[2]); nrm.push(f[3], f[4], f[5]); if (mesh.uv) uv.push(f[6], f[7]); }
    remap[i] = j;
  }
  const idx = [];
  for (let t = 0; t < mesh.idx.length; t += 3) {
    const a = remap[mesh.idx[t]], b = remap[mesh.idx[t + 1]], c = remap[mesh.idx[t + 2]];
    if (a === b || b === c || a === c) continue;
    // zero area (coincident positions with different normals or UVs)
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    const ux = pos[b * 3] - ax, uy = pos[b * 3 + 1] - ay, uz = pos[b * 3 + 2] - az, vx = pos[c * 3] - ax, vy = pos[c * 3 + 1] - ay, vz = pos[c * 3 + 2] - az;
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (cx * cx + cy * cy + cz * cz < 1e-18) continue;
    idx.push(a, b, c);
  }
  return compact({ pos: new Float32Array(pos), nrm: new Float32Array(nrm), uv: mesh.uv ? new Float32Array(uv) : null, idx: new Uint32Array(idx) });
}

/** drop the vertices no triangle uses */
export function compact(mesh) {
  const nv = mesh.pos.length / 3, map = new Int32Array(nv).fill(-1);
  let k = 0; for (const i of mesh.idx) if (map[i] < 0) map[i] = k++;
  if (k === nv) return mesh;
  const pos = new Float32Array(k * 3), nrm = new Float32Array(k * 3), uv = mesh.uv ? new Float32Array(k * 2) : null;
  for (let i = 0; i < nv; i++) { const j = map[i]; if (j < 0) continue; pos.set(mesh.pos.subarray(i * 3, i * 3 + 3), j * 3); nrm.set(mesh.nrm.subarray(i * 3, i * 3 + 3), j * 3); if (uv) uv.set(mesh.uv.subarray(i * 2, i * 2 + 2), j * 2); }
  return { pos, nrm, uv, idx: Uint32Array.from(mesh.idx, i => map[i]) };
}

/**
 * Fewer triangles within an error in metres (meshoptimizer's simplifier: attribute seams and the mesh's open borders
 * are kept, so parts don't crack apart). Returns the mesh unchanged when it barely shrinks.
 */
export function simplify(S, mesh, error) {
  const [idx] = S.simplify(mesh.idx, mesh.pos, 3, 0, error, ['ErrorAbsolute', 'LockBorder']);
  if (idx.length > mesh.idx.length * 0.95) return mesh;
  return compact({ pos: mesh.pos, nrm: mesh.nrm, uv: mesh.uv, idx });
}

/** vertex cache and fetch order (meshoptimizer), so the GPU and the compressor both do better */
export function reorder(E, mesh) {
  const idx = Uint32Array.from(mesh.idx), [remap, unique] = E.reorderMesh(idx, true, false);
  const nv = mesh.pos.length / 3, pos = new Float32Array(unique * 3), nrm = new Float32Array(unique * 3), uv = mesh.uv ? new Float32Array(unique * 2) : null;
  for (let i = 0; i < nv; i++) { const j = remap[i]; if (j === 0xffffffff || j >= unique) continue; pos.set(mesh.pos.subarray(i * 3, i * 3 + 3), j * 3); nrm.set(mesh.nrm.subarray(i * 3, i * 3 + 3), j * 3); if (uv) uv.set(mesh.uv.subarray(i * 2, i * 2 + 2), j * 2); }
  return { pos, nrm, uv, idx };
}

/** the bounding box of several float position arrays */
export function bounds(arrays) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const P of arrays) for (let i = 0; i < P.length; i += 3) for (let c = 0; c < 3; c++) { if (P[i + c] < mn[c]) mn[c] = P[i + c]; if (P[i + c] > mx[c]) mx[c] = P[i + c]; }
  return { min: mn, max: mx };
}

/**
 * Quantized vertex streams (KHR_mesh_quantization), meshopt-ready:
 *  - positions: int16 on one grid for the whole aircraft (offset and step: the node's translation and scale), 8-byte stride;
 *  - normals: int8 octahedral (meshopt's OCTAHEDRAL filter), 4-byte stride;
 *  - UVs: uint16, unnormalized, mapped from the material's UV range (KHR_texture_transform undoes it), 4-byte stride.
 * @param {any} E MeshoptEncoder @param {Mesh} mesh @param {{off: number[], step: number}} grid @param {{off: number[], scale: number[], bits: number}|null} uvq
 */
export function quantize(E, mesh, grid, uvq, normalBits = 8) {
  const n = mesh.pos.length / 3;
  const pos = new Int16Array(n * 4), qmin = [32767, 32767, 32767], qmax = [-32768, -32768, -32768];
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) {
    const q = Math.round((mesh.pos[i * 3 + c] - grid.off[c]) / grid.step);
    if (q < -32768 || q > 32767) throw new Error(`position out of the int16 grid (${q})`);
    pos[i * 4 + c] = q; if (q < qmin[c]) qmin[c] = q; if (q > qmax[c]) qmax[c] = q;
  }
  const n4 = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { let x = mesh.nrm[i * 3], y = mesh.nrm[i * 3 + 1], z = mesh.nrm[i * 3 + 2]; const l = Math.hypot(x, y, z) || 1; if (!(l > 1e-6)) { x = 0; y = 1; z = 0; } n4[i * 4] = x / l; n4[i * 4 + 1] = y / l; n4[i * 4 + 2] = z / l; n4[i * 4 + 3] = 0; }
  const nrm = E.encodeFilterOct(n4, n, normalBits <= 8 ? 4 : 8, normalBits);
  let uv = null;
  if (uvq && mesh.uv) {
    uv = new Uint16Array(n * 2); const top = (1 << uvq.bits) - 1;
    for (let i = 0; i < n; i++) for (let c = 0; c < 2; c++) uv[i * 2 + c] = Math.max(0, Math.min(top, Math.round((mesh.uv[i * 2 + c] - uvq.off[c]) / uvq.scale[c])));
  }
  return { n, pos, qmin, qmax, nrm, normalStride: normalBits <= 8 ? 4 : 8, uv };
}

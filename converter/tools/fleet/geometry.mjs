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

/** a kit profile's height at station z (fus.top or fus.bot: [[z, y from yc], …]) */
const profileAt = (pts, z) => {
  if (z <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (pts[i][0] >= z) { const [z0, y0] = pts[i - 1], [z1, y1] = pts[i]; return y0 + (y1 - y0) * (z - z0) / Math.max(1e-9, z1 - z0); }
  return pts[pts.length - 1][1];
};
const median = a => { const s = a.filter(Number.isFinite).sort((p, q) => p - q); return s.length ? s[s.length >> 1] : NaN; };

function fitPositions(meshes) {
  return meshes.map(({ pos }) => {
    const rotated = new Float32Array(pos.length);
    for (let i = 0; i < pos.length; i += 3) {
      rotated[i] = -pos[i + 2]; rotated[i + 1] = pos[i + 1]; rotated[i + 2] = pos[i];
    }
    return rotated;
  });
}

function noseVertices(rot, zMin) {
  const nose = [];
  for (const P of rot) for (let i = 0; i < P.length; i += 3) {
    if (P[i + 2] < zMin + 2.5) nose.push(P[i + 1], P[i + 2]);
  }
  return nose;
}

function noseStation(vertices, rotateZ) {
  let zN = Infinity;
  for (let i = 0; i < vertices.length; i += 2) {
    const z = rotateZ(vertices[i], vertices[i + 1]);
    if (z < zN) zN = z;
  }
  return zN;
}

/** @typedef {{pitchRad: number, dyM: number, gearBoundaryM: number, depthM: number|null, spreadM: number}} FitRecord */

/**
 * The library model fitted to its kit twin (the crowd model a selection swaps it for; D-149: "the current model and the
 * hifi models are not of the same dimension … the switch over is not smooth"). The library's models stand on unloaded
 * gear (their struts fully extended, as in flight), so levelling them on their own tyres (kitTransform) left the body
 * about 0.4 m above the kit's and pitched it nose down by up to 1.3°, lifting the fin tip a metre. Here, instead:
 *   - the body is levelled by its crown over the cabin (15–62 % of the length), as the kit stands;
 *   - and raised or lowered so its crown (cabin) and belly (forward of the wing box) meet the kit's: the centrelines
 *     coincide;
 *   - then each gear leg is compressed (or extended) by what its tyres sank (or floated): the vertices below a cut just
 *     above its tyres move up with them, so the oleo slides into its strut, as a loaded gear's does;
 *   - the nose tip at z = 0, as before.
 * Parts that move with the gear and stand clear of the cut (doors, bay hardware) move with the body. The rig's motions
 * are re-expressed through P as before; a compressed leg retracts about the same pivots.
 * @param {{pos: Float32Array, idx: Uint32Array}[]} meshes each part's mesh in the library frame (gear down)
 * @param {boolean[]} isGear the parts the gear moves (or bay hardware)
 * @param {any} twin the kit type (AL_TYPES): fus.yc, fus.top, fus.bot, gear.nose.z, gear.main.z
 */
export function kitFit(meshes, isGear, twin) {
  const rot = fitPositions(meshes);
  const c = contacts(rot), S = bodySlices(rot, meshes, isGear), { L, zMin } = S;
  const crown = [], belly = [];
  for (let s = 0; s < S.nb; s++) {
    const f = (S.zs(s) - zMin) / L;
    if (f >= 0.1 && f <= 0.72 && Number.isFinite(S.top[s])) crown.push([S.top[s], S.zs(s)]);
    if (f >= 0.1 && f <= 0.3 && Number.isFinite(S.bot[s])) belly.push([S.bot[s], S.zs(s)]);
  }
  if (crown.length < 20) return null;
  const noseV = noseVertices(rot, zMin);
  // pitch and height together: the body turned about its main gear contact until its crown and belly follow the kit's
  // (yc + fus.top, yc + fus.bot) best, by the median distance (robust to fairings, antennas, a 747's hump)
  const my = c.main.y, mz = c.main.z, yc = twin.fus.yc;
  const evalA = a => {
    const ca = Math.cos(a), sa = Math.sin(a), ry = (y, z) => my + ca * (y - my) - sa * (z - mz), rz = (y, z) => mz + sa * (y - my) + ca * (z - mz);
    const zN = noseStation(noseV, rz);
    const rc = crown.map(([y, z]) => yc + profileAt(twin.fus.top, rz(y, z) - zN) - ry(y, z));
    const rb = belly.map(([y, z]) => yc + profileAt(twin.fus.bot, rz(y, z) - zN) - ry(y, z));
    const mc = median(rc), mb = rb.length >= 8 ? median(rb) : NaN;
    const cost = median(rc.map(r => Math.abs(r - mc))) + (Number.isFinite(mb) ? median(rb.map(r => Math.abs(r - mb))) : 0);
    return { a, zN, mc, mb, cost };
  };
  let best = null;
  for (let d = -5; d <= 5.001; d += 0.1) { const r = evalA(d * Math.PI / 180); if (!best || r.cost < best.cost) best = r; }
  for (let d = -0.1; d <= 0.1001; d += 0.01) { const r = evalA(best.a + d * Math.PI / 180); if (r.cost < best.cost) best = r; }
  const { a, zN, mc, mb } = best;
  // The centrelines meet: the crown and belly each off by half of any difference in the body's depth.
  const record = {
    pitchRad: a, dyM: Number.isFinite(mb) ? (mc + mb) / 2 : mc,
    gearBoundaryM: (twin.gear.nose.z + twin.gear.main.z) / 2,
    depthM: Number.isFinite(mb) ? mb - mc : null, spreadM: best.cost
  };
  const fit = finishKitFit(meshes, isGear, c, record, zN), { P } = fit;
  // The reference profiles are for local FIT_DEBUG only.
  const fitted = ([y, z], prof) => { const v = apply(P, [z, y, -0]); return [+v[2].toFixed(2), +v[1].toFixed(3), +(yc + profileAt(prof, v[2])).toFixed(3)]; };
  const sec = f => { const s = Math.round((f * L) / S.BIN); return { f, depth: Number.isFinite(S.top[s]) && Number.isFinite(S.bot[s]) ? +(S.top[s] - S.bot[s]).toFixed(3) : null, halfW: +S.half[s].toFixed(3) }; };
  return { ...fit, debug: { L, crown: crown.map(p => fitted(p, twin.fus.top)), belly: belly.map(p => fitted(p, twin.fus.bot)), sections: [0.25, 0.4, 0.55].map(sec) } };
}

/** Apply the saved values to the source mesh, without a twin's profiles or stations. */
export function applyKitFit(meshes, isGear, record) {
  const rot = fitPositions(meshes), c = contacts(rot);
  let zMin = Infinity;
  for (const P of rot) for (let i = 2; i < P.length; i += 3) if (P[i] < zMin) zMin = P[i];
  const { y: my, z: mz } = c.main;
  const ca = Math.cos(record.pitchRad), sa = Math.sin(record.pitchRad);
  const zN = noseStation(noseVertices(rot, zMin), (y, z) => mz + sa * (y - my) + ca * (z - mz));
  return finishKitFit(meshes, isGear, c, record, zN);
}

function finishKitFit(meshes, isGear, c, record, zN) {
  const { pitchRad: a, dyM, gearBoundaryM, depthM, spreadM } = record;
  const { y: my, z: mz } = c.main, ca = Math.cos(a), sa = Math.sin(a);
  const R0 = { R: LIB_TO_KIT, t: [0, 0, 0] };
  const Rx = [1, 0, 0, 0, ca, -sa, 0, sa, ca], Rm = rotate(Rx, [0, my, mz]);
  const P = compose({ R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, dyM, -zN] }, compose({ R: Rx, t: [0, my - Rm[1], mz - Rm[2]] }, R0));
  // The nose leg is ahead of mid-wheelbase. Group the others by side and gaps over 1.2 m.
  const info = [];
  meshes.forEach((M, k) => {
    if (!isGear[k] || !M.pos.length) return;
    let y0 = Infinity, y1 = -Infinity, sx = 0, sz = 0, n = 0;
    for (let i = 0; i < M.pos.length; i += 3) { const v = apply(P, [M.pos[i], M.pos[i + 1], M.pos[i + 2]]); if (v[1] < y0) y0 = v[1]; if (v[1] > y1) y1 = v[1]; sx += v[0]; sz += v[2]; n++; }
    info.push({ k, y0, y1, x: sx / n, z: sz / n });
  });
  const groups = [];
  const nose = info.filter(p => p.z < gearBoundaryM), rest = info.filter(p => p.z >= gearBoundaryM);
  if (nose.length) groups.push({ name: 'nose', parts: nose });
  for (const side of [-1, 1]) {
    const sp = rest.filter(p => (p.x < 0 ? -1 : 1) === side).sort((p, q) => Math.abs(p.x) - Math.abs(q.x));
    let cur = null;
    for (const p of sp) { if (!cur || Math.abs(p.x) - cur.last > 1.2) { cur = { name: `${side < 0 ? 'left' : 'right'} ${groups.length}`, parts: [], last: 0 }; groups.push(cur); } cur.parts.push(p); cur.last = Math.abs(p.x); }
  }
  const legs = [];
  for (const g of groups) {
    const low = g.parts.reduce((b, p) => (p.y0 < b.y0 ? p : b), g.parts[0]);
    if (!(Math.abs(low.y0) < 1.2)) continue;   // no tyre near the ground: doors or bay parts only
    const R = Math.max(0.3, Math.min(0.8, (low.y1 - low.y0) / 2));
    // the axles: the bottom of the leg along its length (10 cm bins), each local low within a tyre's radius one tyre
    const bins = new Map();
    for (const p of g.parts) { const M = meshes[p.k]; for (let i = 0; i < M.pos.length; i += 3) { const v = apply(P, [M.pos[i], M.pos[i + 1], M.pos[i + 2]]); if (v[1] > low.y0 + 2.5) continue; const b = Math.round(v[2] / 0.1); if (!bins.has(b) || v[1] < bins.get(b)) bins.set(b, v[1]); } }
    const keys = [...bins.keys()].sort((p, q) => p - q), axles = [];
    for (const b of keys) {
      const y = bins.get(b); if (y > low.y0 + 1.2) continue;
      let lowest = true; for (let o = -4; o <= 4 && lowest; o++) if (o && bins.has(b + o) && bins.get(b + o) < y) lowest = false;
      if (lowest && !axles.some(a => Math.abs(a[0] - b * 0.1) < 0.6)) axles.push([+(b * 0.1).toFixed(2), +y.toFixed(3)]);
    }
    const tiltDeg = axles.length > 1 ? Math.atan2(axles[axles.length - 1][1] - axles[0][1], axles[axles.length - 1][0] - axles[0][0]) * 180 / Math.PI : 0;
    // the leg's moving parts: those reaching down into the wheels' half (tyres, axles, bogie, the oleo's piston); doors
    // and bay hardware that stop short of it stay as they are
    legs.push({ name: g.name, parts: new Set(g.parts.filter(p => p.y0 < low.y0 + R + 0.15).map(p => p.k)), cut: low.y0 + 2 * R + 0.08, d: -low.y0, y0: low.y0, R, axles, tiltDeg });
  }
  return { P, pitchDeg: -a * 180 / Math.PI, dyM, depthM, spreadM, legs, contacts: c, record };
}

/**
 * The body's sections, in kit axes about the library's origin: the fuselage-sized parts (not the gear; longer than a
 * quarter of the aircraft, narrower than 8 m) sliced across every BIN metres. Where a slice of a triangle crosses the
 * centre plane, its height there is a crown (highest) or belly (lowest) candidate; every slice point is a half-width
 * candidate. (The library's fuselages are long quads: their vertices miss most stations, so the triangles are sliced.)
 */
export function bodySlices(rot, meshes, isGear, BIN = 0.25) {
  let zMin = Infinity, zMax = -Infinity;
  for (const P of rot) for (let i = 2; i < P.length; i += 3) { if (P[i] < zMin) zMin = P[i]; if (P[i] > zMax) zMax = P[i]; }
  const L = zMax - zMin, nb = Math.ceil(L / BIN) + 2, zs = b => zMin + b * BIN;
  const body = rot.map((P, k) => {
    if (isGear[k] || !P.length) return false;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < P.length; i += 3) { if (P[i] < x0) x0 = P[i]; if (P[i] > x1) x1 = P[i]; if (P[i + 2] < z0) z0 = P[i + 2]; if (P[i + 2] > z1) z1 = P[i + 2]; }
    return z1 - z0 > 0.25 * L && x1 - x0 < 8;
  });
  const top = new Float64Array(nb).fill(-Infinity), bot = new Float64Array(nb).fill(Infinity), half = new Float64Array(nb);
  rot.forEach((P, k) => {
    if (!body[k]) return;
    const I = meshes[k].idx;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, d = I[t + 2] * 3, vs = [[P[a], P[a + 1], P[a + 2]], [P[b], P[b + 1], P[b + 2]], [P[d], P[d + 1], P[d + 2]]];
      const lo = Math.min(vs[0][2], vs[1][2], vs[2][2]), hi = Math.max(vs[0][2], vs[1][2], vs[2][2]);
      for (let s = Math.ceil((lo - zMin) / BIN); s <= Math.floor((hi - zMin) / BIN); s++) {
        const z = zs(s), pts = [];
        for (let e = 0; e < 3; e++) { const p = vs[e], q = vs[(e + 1) % 3]; if ((p[2] - z) * (q[2] - z) > 0 || p[2] === q[2]) continue; const f = (z - p[2]) / (q[2] - p[2]); pts.push([p[0] + f * (q[0] - p[0]), p[1] + f * (q[1] - p[1])]); }
        if (pts.length < 2) continue;
        const [u, v] = pts;
        for (const w of pts) if (Math.abs(w[0]) > half[s]) half[s] = Math.abs(w[0]);
        if (u[0] * v[0] > 0 && Math.min(Math.abs(u[0]), Math.abs(v[0])) > 0.05) continue;   // not across the centre plane
        const g = Math.abs(v[0] - u[0]) < 1e-9 ? 0.5 : Math.max(0, Math.min(1, -u[0] / (v[0] - u[0]))), y = u[1] + g * (v[1] - u[1]);
        if (y > top[s]) top[s] = y; if (y < bot[s]) bot[s] = y;
      }
    }
  });
  return { zMin, L, BIN, nb, zs, top, bot, half };
}

/** a leg's compression, in place (kit frame): the vertices below its cut move by its d (up: the strut shortens) */
export function compressLeg(mesh, leg) {
  for (let i = 1; i < mesh.pos.length; i += 3) if (mesh.pos[i] < leg.cut) mesh.pos[i] += leg.d;
  return mesh;
}

/** a mesh split at a height (kit frame): the triangles with a corner below it, and the rest (either may be null) */
export function splitBelow(mesh, cut) {
  const lo = [], hi = [], I = mesh.idx, P = mesh.pos;
  for (let t = 0; t < I.length; t += 3) (P[I[t] * 3 + 1] < cut || P[I[t + 1] * 3 + 1] < cut || P[I[t + 2] * 3 + 1] < cut ? lo : hi).push(I[t], I[t + 1], I[t + 2]);
  const part = list => (list.length ? compact({ ...mesh, idx: Uint32Array.from(list) }) : null);
  return [part(lo), part(hi)];
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

/**
 * Windows left open in a cockpit's glass (15 Nov, the user: "the windshield is transparent and leaking the details
 * through from the other side"): where the library drew the glazing as a frame with holes (the 737-700's: one piece,
 * its outline and six holes, the very panes the 737-800 draws), each hole gets a pane. Per connected piece of the mesh
 * (welded at 1 mm), its closed boundary loops: a piece with one loop is a pane already; in a piece with more, the
 * largest loop is its outline, every other one a hole, filled by a fan from its centre. Kit frame (x across, y up, z
 * aft): a pane faces away from a point a metre below and two behind its centre, inside the nose.
 * Returns the mesh with the panes added (the input as it is when nothing is open) and the number of panes.
 */
export function capHoles(mesh) {
  const nv = mesh.pos.length / 3, key = i => `${Math.round(mesh.pos[3 * i] * 1000)},${Math.round(mesh.pos[3 * i + 1] * 1000)},${Math.round(mesh.pos[3 * i + 2] * 1000)}`;
  const ids = new Map(), W = new Int32Array(nv); for (let i = 0; i < nv; i++) { const k = key(i); if (!ids.has(k)) ids.set(k, i); W[i] = ids.get(k); }
  const tris = []; for (let i = 0; i < mesh.idx.length; i += 3) { const a = W[mesh.idx[i]], b = W[mesh.idx[i + 1]], c = W[mesh.idx[i + 2]]; if (a !== b && b !== c && a !== c) tris.push(a, b, c); }
  const ek = (a, b) => (a < b ? a * nv + b : b * nv + a), cnt = new Map();
  for (let t = 0; t < tris.length; t += 3) for (let e = 0; e < 3; e++) { const k = ek(tris[t + e], tris[t + (e + 1) % 3]); cnt.set(k, (cnt.get(k) || 0) + 1); }
  const par = new Int32Array(nv).map((_, i) => i), find = x => { while (par[x] !== x) x = par[x] = par[par[x]]; return x; };
  for (let t = 0; t < tris.length; t += 3) { par[find(tris[t + 1])] = find(tris[t]); par[find(tris[t + 2])] = find(tris[t]); }
  const adj = new Map(); for (const [k, c] of cnt) if (c === 1) { const a = Math.floor(k / nv), b = k % nv; (adj.get(a) || adj.set(a, []).get(a)).push(b); (adj.get(b) || adj.set(b, []).get(b)).push(a); }
  // every run of open edges: a hole's is a closed loop through vertices with two open edges each; an outline may run
  // through vertices where open edges branch (the 737 MAX's), so it's traced too, to be known as the outline
  const used = new Set(), loops = [];
  for (const [a, nb0] of adj) for (const b0 of nb0) {
    if (used.has(ek(a, b0))) continue;
    const loop = [a]; let prev = a, cur = b0, closed = false; used.add(ek(a, b0));
    for (;;) {
      if (cur === a) { closed = true; break; }
      loop.push(cur); const nb = adj.get(cur).filter(v => !used.has(ek(cur, v)));
      if (!nb.length) break;
      const nx = nb[0]; used.add(ek(cur, nx)); prev = cur; cur = nx;
    }
    loops.push({ l: loop, closed: closed && loop.length >= 3 && loop.every(v => adj.get(v).length === 2) });
  }
  const P = i => [mesh.pos[3 * i], mesh.pos[3 * i + 1], mesh.pos[3 * i + 2]];
  const size = l => { const bb = [0, 1, 2].map(k => { let lo = Infinity, hi = -Infinity; for (const i of l) { lo = Math.min(lo, mesh.pos[3 * i + k]); hi = Math.max(hi, mesh.pos[3 * i + k]); } return hi - lo; }); return Math.hypot(...bb); };
  // per piece: its largest run is its outline; every other closed loop a hole, if it's a window's size (not a sliver)
  const byPiece = new Map(); for (const o of loops) { const r = find(o.l[0]); (byPiece.get(r) || byPiece.set(r, []).get(r)).push(o); }
  const holes = []; for (const ls of byPiece.values()) { if (ls.length < 2) continue; ls.sort((a, b) => size(b.l) - size(a.l)); for (const o of ls.slice(1)) if (o.closed && size(o.l) > 0.15) holes.push(o.l); }
  if (!holes.length) return { mesh, panes: 0 };
  const pos = [...mesh.pos], nrm = [...mesh.nrm], uv = mesh.uv ? [...mesh.uv] : null, idx = [...mesh.idx];
  for (const l of holes) {
    const c = [0, 1, 2].map(k => l.reduce((s, i) => s + mesh.pos[3 * i + k], 0) / l.length);
    // the pane's normal: the fan's, summed, turned to face out of the nose
    let n = [0, 0, 0]; for (let i = 0; i < l.length; i++) { const a = P(l[i]), b = P(l[(i + 1) % l.length]); const u = [a[0] - c[0], a[1] - c[1], a[2] - c[2]], v = [b[0] - c[0], b[1] - c[1], b[2] - c[2]]; n = [n[0] + u[1] * v[2] - u[2] * v[1], n[1] + u[2] * v[0] - u[0] * v[2], n[2] + u[0] * v[1] - u[1] * v[0]]; }
    const out = [c[0], 1.0, -2.0], flip = n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0, nl = Math.hypot(...n) || 1; if (flip) n = n.map(x => -x); n = n.map(x => x / nl);
    const base = pos.length / 3; pos.push(...c); nrm.push(...n); if (uv) uv.push(0, 0);
    for (const i of l) { pos.push(...P(i)); nrm.push(...n); if (uv) uv.push(0, 0); }
    for (let i = 0; i < l.length; i++) { const a = base + 1 + i, b = base + 1 + (i + 1) % l.length; if (flip) idx.push(base, b, a); else idx.push(base, a, b); }
  }
  return { mesh: { pos: new Float32Array(pos), nrm: new Float32Array(nrm), uv: uv ? new Float32Array(uv) : null, idx: new Uint32Array(idx) }, panes: holes.length };
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

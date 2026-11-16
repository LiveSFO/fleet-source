// @ts-check
/**
 * The fleet library's rig and lights in the kit frame (fleet-convert.mjs): each motion re-expressed for the moved
 * model (a rigid move P of the whole aircraft turns a motion M into P·M·P⁻¹: its axis turns with P, its centre moves
 * with P), and the light fixtures as livesfo's glows read them.
 */
import { apply, rotate } from './geometry.mjs';

const r4 = v => Math.round(v * 1e4) / 1e4;
export const matches = (m, x) => (m.targetPartIds ? m.targetPartIds.includes(x.sourcePartId) : m.model === x.sourceModel && (m.targets || []).includes(x.sourceName));

const defOf = m => JSON.stringify([m.control, m.type, m.property, m.axis, m.center, m.factor, m.offset, m.interpolation, m.min, m.max, m.inputScale, m.spinDirection]);
const partsOf = m => (m.targetPartIds ? [...m.targetPartIds].sort() : (m.targets || []).slice().sort());
/**
 * A part's motions (`mi`, indices into the rig, in its order) as they compose, outermost first: the runtime multiplies
 * them in this order, so the last applies first. FlightGear nests each <animation> as a transform above what it names,
 * and the library's flat list (its own runtime composes it in file order) loses that:
 * - a motion that reaches the part through a group sits above every motion inside that group. The groups nest (on
 *   every airframe, two motions on one part move either the same parts or one a superset of the other's), so the one
 *   moving more parts is outer. At equal parts, a motion on a group's name is outer to one on the part's own name: the
 *   A320 family's flaps rotate about their own hinge inside a group ("Left inner flap nested") that rotates about a
 *   second, which gives the Fowler motion (applied the other way round, the flap's leading edge rose into the wing);
 *   the same holds for its gear's drag struts, the 777's reverser doors and gear, the 787's and E175's gear;
 * - two motions on the same name keep the file's order, the first outermost (FlightGear inserts the later one closer
 *   to the part);
 * - the same animation listed twice for the same parts counts once: the library's 737 MAX rigs list every motion of
 *   animation-common.xml twice (737-9.xml includes it once), which doubled the flaps' travel (61° at flaps 30), the
 *   spoilers', the reversers' and the gear's. A repeat over different parts stays (the 777's aft flap turns 35° on
 *   top of the 35° it shares with the fore flap).
 * @param {any[]} motions the rig's motions @param {number[]} mi this part's @param {{sourceName?: string}} x the part
 */
export function chainFor(motions, mi, x) {
  const seen = new Set(), keep = [];
  for (const i of mi) { const k = defOf(motions[i]) + '|' + partsOf(motions[i]).join(','); if (!seen.has(k)) { seen.add(k); keep.push(i); } }
  const own = i => ((motions[i].targets || []).includes(x.sourceName) ? 1 : 0);
  return keep.map((i, k) => ({ i, k, n: partsOf(motions[i]).length, own: own(i) }))
    .sort((p, q) => q.n - p.n || p.own - q.own || p.k - q.k).map(o => o.i);
}
/** a motion's value (degrees or metres) for a control's input, as the runtime has it (libmodel.js motion) */
export function valueAt(m, input) {
  let v = input * (m.inputScale || 1);
  const ip = m.interpolation && m.interpolation.length ? m.interpolation : null;
  if (ip) { v = ip[ip.length - 1][1]; for (let i = 1; i < ip.length; i++) if (input * (m.inputScale || 1) <= ip[i][0]) { const [x0, y0] = ip[i - 1], [x1, y1] = ip[i], t = x1 === x0 ? 1 : (input * (m.inputScale || 1) - x0) / (x1 - x0); v = y0 + Math.max(0, Math.min(1, t)) * (y1 - y0); break; } if (input * (m.inputScale || 1) <= ip[0][0]) v = ip[0][1]; }
  v = v * (m.factor ?? 1) + (m.offset ?? 0);
  if (m.min !== null && m.min !== undefined) v = Math.max(+m.min, v); if (m.max !== null && m.max !== undefined) v = Math.min(+m.max, v);
  return v;
}

/** a rig motion in the kit frame, compactly: control, type, axis, centre, the value curve */
export function motionOut(m, P) {
  const o = { c: m.control, t: m.type === 'translate' ? 't' : m.type === 'spin' ? 's' : 'r', a: rotate(P.R, m.axis).map(r4) };
  if (o.t !== 't') o.p = apply(P, m.center || [0, 0, 0]).map(r4);
  if (m.type === 'spin') o.d = m.spinDirection || 1;
  else {
    o.f = m.factor; o.o = m.offset; if (m.inputScale && m.inputScale !== 1) o.s = m.inputScale;
    if (m.interpolation && m.interpolation.length) o.ip = m.interpolation.flat().map(r4);
    if (m.min !== null && m.min !== undefined) o.mn = +m.min; if (m.max !== null && m.max !== undefined) o.mx = +m.max;
  }
  if (m.control === 'gear' && /hydraulic\/gear\/door-/.test(m.property || '')) o.door = 1;
  if (m.wowZero) o.wz = 1;   // turned only in the air: on the ground (wow 1) it lies as drawn (a bogie's tilt)
  if (m.control === 'spoilers' && /final-deg/.test(m.property || '')) o.deg = 1;
  return o;
}
const KIND = { nav: 'nav', strobe: 'strobe', beacon: 'beacon', landing: 'landing', taxi: 'taxi', turnoff: 'turnoff', logo: 'logo', winglight: 'wing', 'wing-inspection': 'wing', wing: 'wing' };
/** the library's light fixtures (lights.json) as livesfo's glows read them: {k, side, col, p, d} in the kit frame */
export function lightsOut(list, P) {
  const out = [];
  for (const l of list || []) {
    const k = KIND[l.kind]; if (!k || !l.position) continue;
    if (Math.hypot(...l.position) < 0.01) continue;   // a fixture "at the origin": a placement the library never made
    const p = apply(P, l.position).map(r4), side = p[0] < -0.3 ? 'L' : p[0] > 0.3 ? 'R' : 'C';
    if (out.some(q => q.k === k && Math.hypot(q.p[0] - p[0], q.p[1] - p[1], q.p[2] - p[2]) < 0.05)) continue;   // listed twice
    const col = k === 'nav' ? (l.color === 'red' ? [1.0, 0.06, 0.03] : l.color === 'green' ? [0.05, 1.0, 0.42] : [1, 1, 1]) : k === 'beacon' ? [1.0, 0.05, 0.02] : k === 'strobe' ? [0.92, 0.95, 1.0] : [1.0, 0.96, 0.88];
    // beams: landing and taxi lights forward and ~6° down; turn-off lights splayed 12° outward
    const d = k === 'landing' || k === 'taxi' ? [0, -0.105, -1] : k === 'turnoff' ? [side === 'L' ? -0.21 : 0.21, -0.105, -1] : null;
    out.push({ k, side, col, p, ...(d ? { d } : {}) });
  }
  return out;
}


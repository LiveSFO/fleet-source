// @ts-check
/**
 * The fleet library's rig and lights in the kit frame (fleet-convert.mjs): each motion re-expressed for the moved
 * model (a rigid move P of the whole aircraft turns a motion M into P·M·P⁻¹: its axis turns with P, its centre moves
 * with P), and the light fixtures as livesfo's glows read them.
 */
import { apply, rotate } from './geometry.mjs';

const r4 = v => Math.round(v * 1e4) / 1e4;
export const matches = (m, x) => (m.targetPartIds ? m.targetPartIds.includes(x.sourcePartId) : m.model === x.sourceModel && (m.targets || []).includes(x.sourceName));
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


// The kit model a fleet library airframe stands for, for the fleet tools: the bakes' keys ("kit model|airline",
// tools/fleet/bake.mjs), each hi-fi model's twin (fleet-convert.mjs) and the coverage report. Resolved as the server
// resolves a type for the client (server/src/core/registry.js modelFor), so a bake is found under the key the client
// asks for and a hi-fi model is fitted to the model it swaps with (D-149):
//   - a code two kit types list goes to the first one registered (E135: the ERJ-135, not the ERJ-140, which the kit
//     lists under E135 too), as the registry and the kit's AL_TYPES.forIcao do;
//   - a stand-in (a type the kit doesn't build, drawn as its nearest type, scaled: approx) is no airframe's twin and
//     gets no bake;
//   - a freighter (the library's airframes b77f, b744f, b748f, b762f, b763f: an id or label ending in F) goes to the kit's
//     freighter model of its type where the kit has one, as the registry draws a cargo operator's aircraft (main, 15 Nov:
//     "bake the cargo pairs onto the freighter keys (b777f now, the 747F, 767-200F and A300-600F when they land), not the
//     passenger airframes"). ADS-B's designators don't tell a freighter (B77L is the 777-200LR and the 777F), so the
//     server decides by the operator (registry.js freighterKit: an all-cargo operator, a passenger airline's cargo
//     flight number, or the owner's brand); the library's airframe says it here. Where the kit has no freighter of the
//     type (the 767-300F), its passenger model.
import fs from 'node:fs';
import * as registry from '../../server/src/core/registry.js';

const KT = JSON.parse(fs.readFileSync(new URL('../../shared/aircraft-types.json', import.meta.url), 'utf8')).types;
export const KIT_KEYS = new Set(KT.map(t => t.key));
/** type → the kit's freighter model of it: the registry's table (registry.js FREIGHTER_KIT, main's freighter rule, 15 Nov;
 * the kit's batch 2 adds its 747-400F, 747-8F and 767-200F there) */
export const FREIGHTER_KIT = registry.FREIGHTER_KIT;

/** is this library airframe a freighter: its id ("b77f", "b763f" or an asset "b748f-korean-air-cargo") or its label
 * ("Boeing 777F", "Boeing 767-300F / converted freighter", "Boeing 767-200SF") */
export function isFreighter(id, label = '') {
  return /^[a-z]\d[\da-z]*f$/i.test(String(id || '').split('-')[0]) || /\d(F|SF|BCF|BDSF)\b|freighter/i.test(String(label || ''));
}

/** the kit model a library airframe of this ICAO type stands for, or null (a stand-in, or a type the kit doesn't know) */
export function kitFor(type, freighter = false) {
  if (!type) return null;
  if (freighter) { const k = FREIGHTER_KIT[type]; if (k && KIT_KEYS.has(k)) return k; }
  const m = registry.modelFor(type, null, null);
  return m && !m.approx && KIT_KEYS.has(m.model) ? m.model : null;
}

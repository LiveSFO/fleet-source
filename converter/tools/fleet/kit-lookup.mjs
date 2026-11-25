// The converter's exact kit-type matches. The registry parity test covers this copy of the
// aliases and freighter lookup without bringing the website's registry into the converter.
const SAME = new Set(['B773', 'B76W', 'E75S', 'CRJ1', 'C72R', 'S22T', 'SR20', 'P28B', 'P28R', 'P28T', 'PA28', 'BE30', 'AT72', 'AT75', 'CL30', 'CL64', 'AS55', 'AS35', 'S70', 'UH60',
  'MD82', 'MD83', 'MD81', 'LJ36', 'TBM7', 'AT44', 'C206']);
export const FREIGHTER_KIT = { B77L: 'b777f', B77F: 'b777f', MD11: 'md11', B744: 'b747-400f', B748: 'b747-8f', B762: 'b767-200f', B741: 'b747-400f', B742: 'b747-400f', B743: 'b747-400f' };

/** is this library airframe a freighter: its id ("b77f", "b763f" or an asset "b748f-korean-air-cargo") or its label
 * ("Boeing 777F", "Boeing 767-300F / converted freighter", "Boeing 767-200SF") */
export function isFreighter(id, label = '') {
  return /^[a-z]\d[\da-z]*f$/i.test(String(id || '').split('-')[0]) || /\d(F|SF|BCF|BDSF)\b|freighter/i.test(String(label || ''));
}

/** Match the registry's own type first, then a same-airframe alias. Stand-ins have no fit reference. */
export function kitLookup(types) {
  const keys = new Set(types.map(t => t.key));
  const byCode = new Map();
  for (const own of [true, false]) for (const t of types) t.icao.forEach((code, i) => {
    if ((i === 0) === own && (own || SAME.has(code)) && !byCode.has(code)) byCode.set(code, t.key);
  });
  // Registry's only exact fallback absent from the kit's ICAO lists.
  if (!byCode.has('MD81') && keys.has('md88')) byCode.set('MD81', 'md88');
  return (type, freighter = false) => {
    const cargo = freighter && FREIGHTER_KIT[type];
    return (cargo && keys.has(cargo) ? cargo : byCode.get(type)) ?? null;
  };
}

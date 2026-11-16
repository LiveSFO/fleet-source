// A registration told by its form (LS-106: tools/fleet/marks.mjs picks it out of what macOS's Vision reads on a model's
// side), with no side effects so the tests can import it.

/** nationality marks (ICAO Annex 7 and the ITU's allocations): those an airliner here can carry, and their neighbours */
const NAT = new Set(('C CC CP CS CU CX D EC EI EK EP ER ES ET EW EX EY EZ F G HA HB HC HH HI HK HL HP HR HS HZ I JA JY LN LV LX LY LZ '
  + 'OB OD OE OH OK OM OO OY P PH PK PP PR PS PT PU PZ RA RP S2 S5 SE SP ST SU SX T7 TC TF TG TI TJ TS TU UK UN UR VH VN VP VQ VT '
  + 'XA XB XC XU XY YA YI YK YL YR YS YU YV Z ZA ZK ZP ZS 3B 4K 4L 4R 4X 5A 5B 5H 5N 5R 5Y 6Y 7O 7T 8Q 9A 9G 9H 9J 9K 9M 9N 9V 9Y '
  + 'A2 A3 A5 A6 A7 A9C A4O AP B C5 C9 D2 D4 E3 E5 E7 H4 J2 J5 P4 S7 T9 V5 V8').split(' '));

/**
 * A registration by its form, or null: an N-number (14 CFR 47.15: one to five characters, a digit 1–9 first, at most
 * two letters last, never I or O), a nationality mark, a hyphen and the rest (C-FIUA, VT-JRI, 4X-EDH, B-2001, A7-ANB,
 * HP-9902CMP), or the marks written without one (Japan's JA, Korea's HL). The reader's I and O among an N-number's
 * figures read as 1 and 0; a mark it doesn't know (a type's "7-8F", a reader's "IC-") is none.
 * @param {string} s
 */
export function asReg(s) {
  const t = String(s).toUpperCase().replace(/[\s.·•,'"`]/g, '').replace(/[–—_]/g, '-');
  const n = /^N[0-9IO][0-9IO]{0,4}[A-Z]{0,2}$/.test(t) ? 'N' + t.slice(1).replace(/^([0-9IO]+)/, m => m.replace(/I/g, '1').replace(/O/g, '0')) : t;
  if (/^N[1-9]\d{0,4}$|^N[1-9]\d{0,3}[A-HJ-NP-Z]$|^N[1-9]\d{0,2}[A-HJ-NP-Z]{2}$/.test(n)) return n;
  const m = /^([A-Z0-9]{1,3})-([A-Z0-9]{2,7})$/.exec(t);   // (Panama's run longer: HP-9902CMP)
  if (m && NAT.has(m[1]) && /[A-Z0-9]{2,}/.test(m[2])) return t;
  if (/^JA\d{3,4}[A-Z]?$|^JA\d{2}[A-Z]{2}$|^HL\d{4}$/.test(t)) return t;
  return null;
}

// F-29. The library's Delta 757-200 paint (b752/delta, its 4096² atlas "DAL4") carries a 2010 promotional decal under
// the cockpit on both sides: Dalí's moustache in black with a grey shadow, "HIGH", "HIGH MUSEUM OF ART ATLANTA PRESENTS",
// "DALÍ" in red and "AUG 7 - JAN 9" (the High Museum's "Dalí: The Late Work", 7 Aug 2010 to 9 Jan 2011, on one Delta
// 757 that summer). Every Delta 757 wore it: the detailed model, the crowd's 757-200 baked from it, and LS-226's
// 757-300 sibling. Repaired on the converter's copy of the paint (config.mjs TEX_FIX; the library stays as it is): within
// a polygon round each side's decal, kept clear of the SkyTeam logo, the forward door and the navy belly, every texel
// that isn't the fuselage's white or its pale panel lines (243 against the white's 255; the decal's shadow is 188, its
// stroke and lettering darker or red), and two texels round it (their soft edges), filled from the white round them:
// a membrane, so a panel line under the lettering runs on through it.

// [x, y] in the atlas's 4096² pixels; the port side's fuselage strip runs nose left, the starboard's nose right
const DECAL = [
  [[84, 680], [318, 680], [318, 706], [400, 706], [400, 900], [84, 900]],
  [[3716, 3526], [3768, 3526], [3768, 3505], [4010, 3505], [4010, 3740], [3716, 3740]]
];

const inside = (poly, x, y) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};

/**
 * @param {{ w: number, h: number, data: Uint8Array }} png RGB or RGBA, changed in place
 * @returns {number} the texels repainted
 */
export function repairDelta757Decal({ w, h, data }) {
  const ch = data.length / (w * h), s = w / 4096, mask = new Uint8Array(w * h);
  for (const p of DECAL) {
    const poly = p.map(([x, y]) => [x * s, y * s]);
    const x0 = Math.floor(Math.min(...poly.map(q => q[0]))), x1 = Math.ceil(Math.max(...poly.map(q => q[0])));
    const y0 = Math.floor(Math.min(...poly.map(q => q[1]))), y1 = Math.ceil(Math.max(...poly.map(q => q[1])));
    const mark = new Uint8Array(w * h);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (!inside(poly, x + 0.5, y + 0.5)) continue;
      const k = ch * (y * w + x), r = data[k], g = data[k + 1], b = data[k + 2];
      if (Math.min(r, g, b) < 230 || Math.max(r, g, b) - Math.min(r, g, b) > 30) mark[y * w + x] = 1;
    }
    // two texels round each (the strokes' soft edges), within the polygon
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (!inside(poly, x + 0.5, y + 0.5)) continue;
      let on = false;
      for (let dy = -2; dy <= 2 && !on; dy++) for (let dx = -2; dx <= 2; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && xx < w && yy >= 0 && yy < h && mark[yy * w + xx]) { on = true; break; } }
      if (on) mask[y * w + x] = 1;
    }
  }
  const cells = []; for (let q = 0; q < w * h; q++) if (mask[q]) cells.push(q);
  // the membrane: from white, each texel the mean of its four neighbours, the unmasked ones fixed
  for (const q of cells) for (let c = 0; c < 3; c++) data[ch * q + c] = 255;
  const F = new Float32Array(cells.length * 3);
  for (let it = 0; it < 80; it++) {
    cells.forEach((q, i) => {
      const x = q % w, n = [x > 0 ? q - 1 : q + 1, x < w - 1 ? q + 1 : q - 1, q >= w ? q - w : q + w, q < w * (h - 1) ? q + w : q - w];
      for (let c = 0; c < 3; c++) F[3 * i + c] = (data[ch * n[0] + c] + data[ch * n[1] + c] + data[ch * n[2] + c] + data[ch * n[3] + c]) / 4;
    });
    cells.forEach((q, i) => { for (let c = 0; c < 3; c++) data[ch * q + c] = Math.round(F[3 * i + c]); });
  }
  return cells.length;
}

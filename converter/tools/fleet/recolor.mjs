// LS-252 (F-35): a livery's palette swapped for another as it is baked (tools/fleet/bake-recolor.json): Southwest's
// 737-700 in the library (`b737-southwest`, GPL) is painted in pure RGB, the Heart livery's blue, red and yellow at
// #0000ff, #ff0000 and #ffff00, where its 737-800 and 737-8 carry Bold Blue, Warm Red and Sunrise Yellow. Each pixel is
// read as a blend of two of the palette's colours (white and black always among them: titles, outlines, greys), and
// drawn as the same blend of their replacements; one that's no such blend (a door's handle, a registration's ink) stays.
// So antialiased edges (blue into a white title, red into the grey border) swap with their colours, and whites and greys
// stay as they were.

const hex = s => { const v = parseInt(String(s).replace('#', ''), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
const toHex = c => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

/**
 * A palette swap
 * @param {string[]} from the source colours (#rrggbb) @param {string[]} to their replacements, in order
 * @param {number} [tol] how far (RGB) a pixel may lie from a blend of two of them and still be swapped
 * @returns {{ px: (r: number, g: number, b: number) => number[] | null, color: (h: string) => string }}
 */
export function paletteSwap(from, to, tol = 24) {
  if (!Array.isArray(from) || !Array.isArray(to) || from.length !== to.length || !from.length) throw new Error('recolor: from and to must pair up');
  const S = [...from.map(hex), [255, 255, 255], [0, 0, 0]], T = [...to.map(hex), [255, 255, 255], [0, 0, 0]], n = S.length, tol2 = tol * tol;
  const px = (r, g, b) => {
    let best = Infinity, out = null;
    for (let i = 0; i < n; i++) for (let j = i; j < n; j++) {
      const a = S[i], d = [S[j][0] - a[0], S[j][1] - a[1], S[j][2] - a[2]], L = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
      const t = L ? Math.max(0, Math.min(1, ((r - a[0]) * d[0] + (g - a[1]) * d[1] + (b - a[2]) * d[2]) / L)) : 0;
      const e0 = r - a[0] - t * d[0], e1 = g - a[1] - t * d[1], e2 = b - a[2] - t * d[2], e = e0 * e0 + e1 * e1 + e2 * e2;
      if (e < best) { best = e; out = [i, j, t, e0, e1, e2]; }
    }
    if (best > tol2) return null;
    const [i, j, t, e0, e1, e2] = /** @type {number[]} */ (out);
    // the same blend of the replacements, and what the pixel had off the blend (a shade, noise) kept
    return [T[i][0] + t * (T[j][0] - T[i][0]) + e0, T[i][1] + t * (T[j][1] - T[i][1]) + e1, T[i][2] + t * (T[j][2] - T[i][2]) + e2];
  };
  const color = h => { const c = hex(h), m = px(c[0], c[1], c[2]); return m ? toHex(m) : h; };
  return { px, color };
}

/**
 * An image's pixels swapped in place (RGBA or RGB, 8 bits)
 * @param {{ data: Uint8Array | Buffer, w: number, h: number }} img @param {ReturnType<typeof paletteSwap>} swap
 * @returns {number} the pixels swapped
 */
export function recolorImage(img, swap) {
  const n = img.w * img.h, ch = img.data.length / n, D = img.data, memo = new Map(); let k = 0;
  for (let p = 0; p < n; p++) {
    const o = p * ch, key = (D[o] << 16) | (D[o + 1] << 8) | D[o + 2];
    let m = memo.get(key); if (m === undefined) { m = swap.px(D[o], D[o + 1], D[o + 2]); memo.set(key, m); }
    if (!m) continue;
    D[o] = Math.max(0, Math.min(255, Math.round(m[0]))); D[o + 1] = Math.max(0, Math.min(255, Math.round(m[1]))); D[o + 2] = Math.max(0, Math.min(255, Math.round(m[2]))); k++;
  }
  return k;
}

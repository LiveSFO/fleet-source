// F-25. In the 4096² CSeries atlas the left wing patch tapers from x=847 to x=1810,
// against the straight root at x=1965. The other wing is mirrored. The bounds
// include padding for the converter's smaller texture and its mipmaps.
export function repairA220WingPaint({ w, h, data }) {
  const atlas = 4096, top = 2396, bottom = 2955, root = 1965, pad = 32;
  const sample = 4 * (Math.floor(2370 * h / atlas) * w + Math.floor(1131 * w / atlas));
  const paint = data.slice(sample, sample + 3);
  for (let y = Math.ceil((top - pad) * h / atlas); y < Math.floor((bottom + pad) * h / atlas); y++) {
    const fraction = Math.max(0, Math.min(1, (y * atlas / h - top) / (bottom - top)));
    const edge = Math.floor((847 + (1810 - 847) * fraction - pad) * w / atlas);
    for (let x = edge; x < Math.ceil((root + pad) * w / atlas); x++) {
      data.set(paint, 4 * (y * w + x));
      data.set(paint, 4 * (y * w + w - 1 - x));
    }
  }
}

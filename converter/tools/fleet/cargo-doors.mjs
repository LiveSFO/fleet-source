// The native 767 freighters and the derived UPS model share the same cargo-door assembly.
const CARGO_DOOR_MODELS = new Set(['b762f-abx-air', 'b763f-abx-air', 'b763f-amazon-air', 'b763f-fedex', 'b763f-ups-rb']);

/** The solid occluder covers painted doors and lower access panels. */
export function isCargoDoorBacking(key, material) {
  return CARGO_DOOR_MODELS.has(key) &&
    material.name === 'ac3dmat0_surface' && material.alpha === 'OPAQUE' && material.map < 0 &&
    material.color[0] === 0 && material.color[1] === 0 && material.color[2] === 0 && material.color[3] === 1;
}

export function isCargoDoorShell(key, material, imageName) {
  return CARGO_DOOR_MODELS.has(key) && material.name === 'TFL_surface.004' &&
    material.alpha === 'OPAQUE' && imageName === 'TFL';
}

/** The shared TFL mesh includes real engine and wing parts. Drop only the two open door shells in kit space. */
export function withoutCargoDoorShells({ pos, posStride, index }, [x0, y0, z0, step]) {
  const inShell = vertex => {
    const p = vertex * posStride;
    const x = Math.abs(pos[p] * step + x0), y = pos[p + 1] * step + y0, z = pos[p + 2] * step + z0;
    return x >= 2.20 && x <= 4.60 && y >= 4.10 && y <= 4.55 && z >= 9.60 && z <= 13.30;
  };
  const keep = [];
  for (let i = 0; i < index.length; i += 3) {
    const a = index[i], b = index[i + 1], c = index[i + 2];
    if (!(inShell(a) && inShell(b) && inShell(c))) keep.push(a, b, c);
  }
  return keep.length === index.length ? index : new index.constructor(keep);
}

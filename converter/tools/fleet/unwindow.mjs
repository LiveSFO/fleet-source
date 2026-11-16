// A crowd body image without its painted cabin windows (reverse.mjs: where the hi-fi template's panes are the windows;
// 16 Nov, the user: "a lot of livery issues like this - the windows"). Pure (an RGBA array in, changed in place), so it
// runs in node for tuning (tools/research/fleet/unwindow-check.mjs) and in reverse.mjs's page, its source injected.
//
// The image is the painter's layout: a column a station along the body, rows round the section, each flank a quarter
// of the height from its edge. For each flank:
//   - its row of windows: within an eighth of the height of the flank, the rows where much of the cabin's length (its
//     middle three quarters) is darker than the row's median in window-sized pieces (runs of 3 to 60 pixels, eight or
//     more: a stripe's or a belly's long run doesn't count); the core, the rows round the darkest one at least 60 % as
//     dark;
//   - the band: the core and one and a half times its height round it (at least 8 rows, 2.5 % of the image), and a
//     margin outside that where a blob running on out of the band shows;
//   - the dark blobs in that (darker than the paint: the upper quartile of the row round it), their holes filled (a
//     photo's window is a dark rim round its reflection); the window-like ones: wholly inside the band (a title's
//     strokes run on into the margin), filled (over 55 % of their box: a letter's ring or stroke isn't), at most three
//     times as wide as tall;
//   - the windows: the window-like blobs on one line (fitted through those roughly like the median such blob; a
//     title's letters above or below it aren't), like the median one on it (0.6 to 1.5 times its height, half to 1.6
//     times its width, 0.45 to 2.2 times its area), with no other small blob beside it within a third of a window's
//     width (a word's letters on the line aren't; a logo or a big title may be), six or more of them;
//   - a window painted over a title's letter or a stripe (not darker than the paint round it by much, or one blob with
//     the letter): found by the windows' own colour, window-like, on the line and spaced like windows as above;
//   - each window, three pixels round it (its soft rim; not into another blob), filled smoothly from the paint round it
//     (a membrane: each pixel the mean of its neighbours; a letter's or a logo's edge beside it doesn't bleed in); one
//     over a letter, from the letter and the paint round it, along its column or its row where the two sides are the
//     same of the two (the letter's edge crossing it runs on).
// @param {Uint8ClampedArray|Uint8Array} D RGBA @param {number} W @param {number} H
// @param {{dbg?: boolean}} [o] dbg: also return the bands and the blobs (kept and removed) for a picture
// @returns {{removed: number, bands?: any[], blobs?: any[]}}
export function unwindow(D, W, H, o = {}) {
  const lum = k => 0.3 * D[k] + 0.59 * D[k + 1] + 0.11 * D[k + 2], x0 = Math.round(0.12 * W), x1 = Math.round(0.88 * W);
  const median = a => { if (!a.length) return 0; const s = Float64Array.from(a).sort(); return s[s.length >> 1]; };
  const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  let removed = 0; const bands = [], blobs = [];
  for (const fc of [0.25, 0.75]) {
    // each row's darkness in window-sized pieces: the share of the cabin's length in dark runs of 3 to 60 pixels (a
    // stripe's or a belly's long run doesn't count), with at least eight such runs
    const ra = Math.round((fc - 0.125) * H), rb = Math.round((fc + 0.125) * H), frac = [];
    for (let r = ra; r <= rb; r++) {
      const ls = []; for (let x = x0; x < x1; x++) ls.push(lum(4 * (r * W + x)));
      const med = median(ls);
      let n = 0, runs = 0, run = 0;
      for (let i = 0; i <= ls.length; i++) { if (i < ls.length && ls[i] < med - 35) { run++; continue; } if (run >= 3 && run <= 60) { n += run; runs++; } run = 0; }
      frac.push(runs >= 8 ? n / ls.length : 0);
    }
    const peak = Math.max(...frac); if (peak < 0.08) continue;
    const pi = frac.indexOf(peak), lim = 0.6 * peak; let r0 = pi, r1 = pi;
    while (r0 > 0 && frac[r0 - 1] > lim) r0--; while (r1 < frac.length - 1 && frac[r1 + 1] > lim) r1++;
    // the band, and a margin outside it where a blob that runs on out of it shows (a title's stroke, not a window)
    const core = r1 - r0 + 1, pad = Math.max(8, Math.round(1.5 * core), Math.round(0.025 * H)), mg = Math.max(4, Math.round(0.5 * pad));
    const top = ra + r0 - pad - mg, bot = ra + r1 + pad + mg, bh = bot - top + 1, N = W * bh;
    if (top < 7 || bot >= H - 7) continue;
    const band = { fc, top: top + mg, bot: bot - mg, core: [ra + r0, ra + r1], peak: +peak.toFixed(2) };
    bands.push(band);
    // dark: darker than the paint, the upper quartile of its row round it (4 % of the width each way: the body's shading
    // along it and round the section is the paint; windows, under half of a row's length, aren't)
    const R = Math.max(16, Math.round(0.04 * W)), step = 8, nb = Math.ceil(W / step) + 1, dark = new Uint8Array(N), L = new Float32Array(W), bgB = new Float32Array(nb);
    for (let r = top; r <= bot; r++) {
      for (let x = 0; x < W; x++) L[x] = lum(4 * (r * W + x));
      for (let b = 0; b < nb; b++) { const xc = Math.min(W - 1, b * step), q = L.slice(Math.max(0, xc - R), Math.min(W, xc + R + 1)).sort(); bgB[b] = q[Math.floor(0.75 * (q.length - 1))]; }
      for (let x = 0; x < W; x++) { const b0 = Math.floor(x / step), t = x / step - b0, bg = bgB[b0] * (1 - t) + bgB[Math.min(nb - 1, b0 + 1)] * t; if (L[x] < bg - 32) dark[(r - top) * W + x] = 1; }
    }
    // a blob's shape from its pixels (indices into the band): its box, its holes (cells of the box not reached from the
    // box's edge but through it), centre
    const shape = px => {
      let bx0 = W, bx1 = -1, by0 = bh, by1 = -1;
      for (const j of px) { const x = j % W, y = (j - x) / W; if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
      const w = bx1 - bx0 + 1, h = by1 - by0 + 1, g = new Uint8Array(w * h), q = [];
      for (const j of px) { const x = j % W, y = (j - x) / W; g[(y - by0) * w + x - bx0] = 1; }
      for (let x = 0; x < w; x++) for (const y of [0, h - 1]) if (!g[y * w + x]) { g[y * w + x] = 2; q.push(y * w + x); }
      for (let y = 0; y < h; y++) for (const x of [0, w - 1]) if (!g[y * w + x]) { g[y * w + x] = 2; q.push(y * w + x); }
      while (q.length) { const c = q.pop(), x = c % w, y = (c - x) / w; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h || g[yy * w + xx]) continue; g[yy * w + xx] = 2; q.push(yy * w + xx); } }
      const holes = []; for (let c = 0; c < g.length; c++) if (!g[c]) holes.push((by0 + (c / w | 0)) * W + bx0 + c % w);
      return { px, holes, bx0, bx1, by0, by1, w, h, area: px.length + holes.length, cx: (bx0 + bx1) / 2, cy: (by0 + by1) / 2 };
    };
    const windowLike = c => c.by0 >= mg && c.by1 <= bh - 1 - mg && c.h >= 3 && c.w >= 2 && c.w <= 3 * c.h + 2 && c.area >= 0.55 * c.w * c.h;
    // the dark blobs (4-connected)
    const seen = new Uint8Array(N), cands = [];
    for (let i = 0; i < N; i++) {
      if (!dark[i] || seen[i]) continue;
      const px = [], st = [i]; seen[i] = 1;
      while (st.length) { const j = st.pop(), x = j % W; px.push(j); for (const k of [x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1, j - W, j + W]) { if (k < 0 || k >= N || seen[k] || !dark[k]) continue; seen[k] = 1; st.push(k); } }
      if (px.length >= 4) cands.push(shape(px));
    }
    // window-like, and roughly like the median such blob (a title's letters may be most of them)
    const like = cands.filter(windowLike);
    let mh = median(like.map(c => c.h)), mw = median(like.map(c => c.w)), ma = 0, tol = Math.max(2, 0.4 * mh);
    const loose = c => windowLike(c) && c.h >= 0.5 * mh && c.h <= 1.8 * mh && c.w <= 2.5 * mw + 2;
    const sized = c => windowLike(c) && c.h >= 0.6 * mh && c.h <= 1.5 * mh + 1 && c.w >= 0.5 * mw && c.w <= 1.6 * mw + 2 && c.area >= 0.45 * ma && c.area <= 2.2 * ma;
    // their line: the one through two of them (nearly level) with the most within 40 % of the median height of it,
    // then fitted to those by least squares
    const lsq = on => {
      const n = on.length, mx = on.reduce((p, c) => p + c.cx, 0) / n, my = on.reduce((p, c) => p + c.cy, 0) / n;
      let sxy = 0, sxx = 0; for (const c of on) { sxy += (c.cx - mx) * (c.cy - my); sxx += (c.cx - mx) ** 2; }
      return { x: mx, y: my, s: sxx > 0 ? Math.max(-0.03, Math.min(0.03, sxy / sxx)) : 0 };
    };
    const pool = cands.filter(loose);
    let line = null, best = 0;
    for (let a = 0; a < pool.length; a++) for (let b = a; b < pool.length; b += Math.max(1, pool.length >> 5)) {
      const A = pool[a], B = pool[b], s = A === B || Math.abs(B.cx - A.cx) < 1 ? 0 : (B.cy - A.cy) / (B.cx - A.cx);
      if (Math.abs(s) > 0.03) continue;
      let n = 0; for (const c of pool) if (Math.abs(c.cy - (A.cy + s * (c.cx - A.cx))) <= tol) n++;
      if (n > best) { best = n; line = { x: A.cx, y: A.cy, s }; }
    }
    if (!line || best < 6) { for (const c of cands) if (o.dbg && (c.h > 2 || c.w > 2)) blobs.push({ x0: c.bx0, x1: c.bx1, y0: top + c.by0, y1: top + c.by1, win: false }); continue; }
    const lineY = x => line.y + line.s * (x - line.x), onLine = c => Math.abs(c.cy - lineY(c.cx)) <= tol;
    line = lsq(pool.filter(onLine));
    // the windows' own size: the median of those on the line (height, width and area)
    { const on = pool.filter(onLine); mh = median(on.map(c => c.h)); mw = median(on.map(c => c.w)); ma = median(on.map(c => c.area)); tol = Math.max(2, 0.4 * mh); }
    // the windows: on the line, and spaced like windows (no other small blob beside it, at its height, within a third of
    // a window's width: a word's letters aren't); then the size taken from them, the line fitted to them, once more
    const comp = new Int32Array(N).fill(-1); cands.forEach((c, i) => { for (const j of c.px) comp[j] = i; });
    // (beside it: another small blob's pixels, a letter's or a window's, not a logo's or a big title's; windows stand
    // further apart than a word's letters)
    const crowded = (c, ci, g) => {
      let n = 0;
      for (let y = c.by0; y <= c.by1; y++) for (let x = Math.max(0, c.bx0 - g); x <= Math.min(W - 1, c.bx1 + g); x++) {
        if (x >= c.bx0 && x <= c.bx1) continue; const k = comp[y * W + x];
        if (k >= 0 && k !== ci && cands[k].px.length >= 6 && cands[k].area <= 3 * ma) n++;
      }
      return n >= 4;
    };
    const pick = () => { const g = Math.max(2, Math.round(0.35 * mw)); return cands.filter((c, i) => sized(c) && onLine(c) && !crowded(c, i, g)); };
    let wins = pick();
    if (wins.length >= 6) {
      mh = median(wins.map(c => c.h)); mw = median(wins.map(c => c.w)); ma = median(wins.map(c => c.area)); tol = Math.max(2, 0.4 * mh);
      line = lsq(wins); wins = pick();
    }
    if (wins.length < 6) wins = [];
    const isWin = new Set(wins);
    // the windows' colour (the median of their pixels, before they're filled)
    const wp = []; for (const c of wins) for (let i = 0; i < c.px.length; i += 2) { const g = 4 * (top * W + c.px[i]); wp.push([D[g], D[g + 1], D[g + 2]]); }
    const wcol = [0, 1, 2].map(ch => median(wp.map(p => p[ch])));
    if (o.dbg) {
      for (const c of cands) if (!isWin.has(c) && (c.h > 2 || c.w > 2)) blobs.push({ x0: c.bx0, x1: c.bx1, y0: top + c.by0, y1: top + c.by1, win: false });
      for (const c of wins) blobs.push({ x0: c.bx0, x1: c.bx1, y0: top + c.by0, y1: top + c.by1, win: true });
      band.line = [lineY(0) + top, lineY(W - 1) + top]; band.mh = mh; band.mw = mw;
    }
    // the cells to fill: each window, its holes and three pixels round it, but not into another blob (a letter, a logo,
    // the stripe it ran into)
    const fill = new Uint8Array(N);
    for (const c of wins) {
      const own = new Set(c.px), ci = cands.indexOf(c);
      for (const j of [...c.px, ...c.holes]) {
        const x = j % W, y = (j - x) / W;
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
          const xx = x + dx, yy = y + dy; if (xx < 0 || xx >= W || yy < 1 || yy >= bh - 1) continue;
          const k = yy * W + xx; if (comp[k] >= 0 && comp[k] !== ci && !own.has(k)) continue;
          fill[k] = 1;
        }
      }
      removed++;
    }
    // a mask's patches (4-connected) and their rings (the cells round them)
    const at = j => { const g = 4 * (top * W + j); return [D[g], D[g + 1], D[g + 2]]; };
    const patches = mask => {
      const seenP = new Uint8Array(N), out = [];
      for (let k0 = 0; k0 < N; k0++) {
        if (!mask[k0] || seenP[k0]) continue;
        const cells = [], st = [k0], ring = new Set(); seenP[k0] = 1;
        while (st.length) { const k = st.pop(), x = k % W; cells.push(k); for (const n of [x > 0 ? k - 1 : -1, x < W - 1 ? k + 1 : -1, k - W, k + W]) { if (n < 0 || n >= N) continue; if (!mask[n]) { ring.add(n); continue; } if (!seenP[n]) { seenP[n] = 1; st.push(n); } } }
        out.push({ cells, ring: [...ring] });
      }
      return out;
    };
    // a ring's two colours (two means from its darkest and lightest cells): a letter's or a stripe's and the paint's, if
    // they differ by 40 or more and the lesser is a tenth of the ring or more
    const twoOf = ring => {
      const rcol = ring.map(at), lums = rcol.map(p => 0.3 * p[0] + 0.59 * p[1] + 0.11 * p[2]);
      let A = rcol[lums.indexOf(Math.min(...lums))], B = rcol[lums.indexOf(Math.max(...lums))], na = 0;
      for (let it = 0; it < 6; it++) {
        const ga = [], gb = []; for (const p of rcol) (dist(p, A) < dist(p, B) ? ga : gb).push(p); na = ga.length;
        if (ga.length) A = [0, 1, 2].map(ch => ga.reduce((q, p) => q + p[ch], 0) / ga.length); if (gb.length) B = [0, 1, 2].map(ch => gb.reduce((q, p) => q + p[ch], 0) / gb.length);
      }
      return { A, B, two: dist(A, B) >= 40 && Math.min(na, rcol.length - na) >= 0.1 * rcol.length };
    };
    // a patch between two colours: each cell from what's round it, down its column where above and below are the same
    // of the two, else along its row where left and right are, else from the nearest; then softened (a letter's edge
    // crossing it runs on)
    const across = (mask, ps) => {
      const out = new Map();
      for (const { cells, t } of ps) {
        const cls = k => (dist(at(k), t.A) < dist(at(k), t.B) ? 0 : 1);
        const look = (k, step) => { let n = k, d = 0; for (;;) { const x = n % W; if ((step === -1 && x === 0) || (step === 1 && x === W - 1)) return null; n += step; d++; if (n < 0 || n >= N) return null; if (!mask[n]) return { n, d, c: cls(n) }; } };
        const lerp = (p, q) => { const f = p.d / (p.d + q.d), a = at(p.n), b = at(q.n); return [0, 1, 2].map(ch => a[ch] + (b[ch] - a[ch]) * f); };
        for (const k of cells) {
          const u = look(k, -W), d = look(k, W), l = look(k, -1), r = look(k, 1);
          let v;
          if (u && d && u.c === d.c) v = lerp(u, d);
          else if (l && r && l.c === r.c) v = lerp(l, r);
          else { const n = [u, d, l, r].filter(Boolean).sort((p, q) => p.d - q.d)[0]; v = n ? at(n.n) : at(k); }
          out.set(k, v);
        }
      }
      for (const [k, v] of out) { const g = 4 * (top * W + k); for (let ch = 0; ch < 3; ch++) D[g + ch] = Math.round(v[ch]); }
      const soft = new Map();
      for (const k of out.keys()) { const x = k % W, c = [0, 0, 0]; let n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (x + dx < 0 || x + dx >= W) continue; const v = at(k + dy * W + dx); for (let ch = 0; ch < 3; ch++) c[ch] += v[ch]; n++; } soft.set(k, c.map(v => v / n)); }
      for (const [k, v] of soft) { const g = 4 * (top * W + k); for (let ch = 0; ch < 3; ch++) D[g + ch] = Math.round(v[ch]); }
    };
    // in paint (one colour round it): a membrane, the ring's odd cells (a letter's or a logo's edge just beside it) as
    // its median so they don't bleed in; between a letter or a stripe and the paint: across (above)
    const F = new Float32Array(N * 3);
    for (let k = 0; k < N; k++) { const g = 4 * (top * W + k); F[3 * k] = D[g]; F[3 * k + 1] = D[g + 1]; F[3 * k + 2] = D[g + 2]; }
    const col = k => [F[3 * k], F[3 * k + 1], F[3 * k + 2]], set = (k, c) => { F[3 * k] = c[0]; F[3 * k + 1] = c[1]; F[3 * k + 2] = c[2]; };
    const free = [], two = [];
    for (const { cells, ring } of patches(fill)) {
      const t = twoOf(ring);
      if (t.two) { two.push({ cells, t }); continue; }
      const m = [0, 1, 2].map(ch => median(ring.map(k => F[3 * k + ch])));
      for (const k of ring) if (dist(col(k), m) > 40) set(k, m);
      free.push(...cells);
    }
    // (the membrane: a start from the paint above and below in each column, then each cell the mean of its four neighbours)
    for (const k of free) {
      const x = k % W; let ya = (k - x) / W, yb = ya; while (ya > 0 && fill[ya * W + x]) ya--; while (yb < bh - 1 && fill[yb * W + x]) yb++;
      const y = (k - x) / W, t = yb > ya ? (y - ya) / (yb - ya) : 0.5;
      for (let ch = 0; ch < 3; ch++) F[3 * k + ch] = F[3 * (ya * W + x) + ch] * (1 - t) + F[3 * (yb * W + x) + ch] * t;
    }
    for (let it = 0; it < 120; it++) for (const k of free) {
      const x = k % W, l = x > 0 ? k - 1 : k + 1, r = x < W - 1 ? k + 1 : k - 1;
      for (let ch = 0; ch < 3; ch++) F[3 * k + ch] = 0.25 * (F[3 * l + ch] + F[3 * r + ch] + F[3 * (k - W) + ch] + F[3 * (k + W) + ch]);
    }
    for (const k of free) { const g = 4 * (top * W + k); for (let ch = 0; ch < 3; ch++) D[g + ch] = Math.round(F[3 * k + ch]); }
    across(fill, two);
    // windows painted over a title's letter or a stripe (inside a letter a window isn't darker than the paint round it
    // by much, or it's one blob with the letter): found by the windows' own colour (within 45 of the median of their
    // pixels), window-like, on the line and spaced like windows as above
    if (!wins.length) continue;
    const cm = new Uint8Array(N);
    for (let y = Math.max(mg, Math.floor(lineY(0) - 1.5 * mh)); y <= Math.min(bh - 1 - mg, Math.ceil(lineY(0) + 1.5 * mh)); y++) for (let x = 0; x < W; x++) { const k = y * W + x; if (!fill[k] && dist(at(k), wcol) < 45) cm[k] = 1; }
    const cc = [], lab = new Int32Array(N).fill(-1);
    for (let i = 0; i < N; i++) {
      if (!cm[i] || lab[i] >= 0) continue;
      const px = [], st = [i]; lab[i] = cc.length;
      while (st.length) { const j = st.pop(), x = j % W; px.push(j); for (const k of [x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1, j - W, j + W]) { if (k < 0 || k >= N || !cm[k] || lab[k] >= 0) continue; lab[k] = cc.length; st.push(k); } }
      cc.push(px.length >= 4 ? shape(px) : null);
    }
    const g2 = Math.max(2, Math.round(0.35 * mw));
    const cut = cc.filter((c, i) => {
      if (!c || !sized(c) || !onLine(c)) return false;
      let n = 0;   // (spaced like windows: no other small blob of the colour beside it, a word's letters)
      for (let y = c.by0; y <= c.by1; y++) for (let x = Math.max(0, c.bx0 - g2); x <= Math.min(W - 1, c.bx1 + g2); x++) { if (x >= c.bx0 && x <= c.bx1) continue; const k = lab[y * W + x]; if (k >= 0 && k !== i && cc[k] && cc[k].area <= 3 * ma) n++; }
      return n < 4;
    });
    if (o.dbg) for (const c of cut) blobs.push({ x0: c.bx0, x1: c.bx1, y0: top + c.by0, y1: top + c.by1, win: true, cut: true });
    if (!cut.length) continue;
    // each, two pixels round it, refilled across from what's round it
    const cf = new Uint8Array(N);
    for (const c of cut) {
      for (const j of [...c.px, ...c.holes]) {
        const x = j % W, y = (j - x) / W;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && xx < W && yy >= 1 && yy < bh - 1) cf[yy * W + xx] = 1; }
      }
      removed++;
    }
    across(cf, patches(cf).map(({ cells, ring }) => ({ cells, t: twoOf(ring) })));
  }
  return o.dbg ? { removed, bands, blobs } : { removed };
}

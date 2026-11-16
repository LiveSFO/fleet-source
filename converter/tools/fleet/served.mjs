#!/usr/bin/env node
// @ts-check
/**
 * Every file the hi-fi aircraft's /m/ serves, from the indexes the page loads, for the upload that goes with a deploy
 * (the main session's: /opt/livesfo/fleet on the VPS, docs/ops/production.md): the models (shared/fleet.json via the
 * converter's report: each asset's glTF and lite glTF, their geometry and textures, with the .br/.gz twins), our
 * liveries on the library's airframes among them (reverse.mjs), and the crowd's liveries (shared/fleet-bakes.json: the
 * bakes in bake/, the traced liveries in trace/). It checks each file is in data/fleet/out and, against an earlier
 * upload (a folder laid out as /m/, or a list), says what's new. Nothing is uploaded.
 *   node tools/fleet/served.mjs [--since <folder or list>] [--out data/fleet/served]
 * Writes files.txt (every file, relative to data/fleet/out: rsync --files-from) and new.txt (those the earlier upload
 * lacks), and prints the counts and sizes by kind.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2), opt = (k, d) => (argv.includes('--' + k) ? argv[argv.indexOf('--' + k) + 1] : d);
const OUT = path.join(ROOT, 'data/fleet/out'), DEST = path.resolve(opt('out', path.join(ROOT, 'data/fleet/served')));
const report = JSON.parse(fs.readFileSync(path.join(OUT, 'report.json'), 'utf8')), ix = JSON.parse(fs.readFileSync(path.join(ROOT, 'shared/fleet.json'), 'utf8'));
const bakes = JSON.parse(fs.readFileSync(path.join(ROOT, 'shared/fleet-bakes.json'), 'utf8'));

/** @type {Map<string, string>} file → kind */
const files = new Map();
const add = (rel, kind) => { if (!files.has(rel)) files.set(rel, kind); for (const t of ['.br', '.gz']) if (fs.existsSync(path.join(OUT, rel + t)) && !files.has(rel + t)) files.set(rel + t, kind); };
const missing = [];
for (const [k, a] of Object.entries(ix.assets)) {
  const r = report.assets[k]; if (!r) { missing.push(`${k}: in shared/fleet.json, not in report.json`); continue; }
  const kind = a.reverse ? 'models, ours (reverse.mjs)' : 'models';
  for (const rel of [a.gltf, a.lite]) {
    if (!rel) continue;
    if (!fs.existsSync(path.join(OUT, rel))) { missing.push(rel); continue; }
    add(rel, kind);
    const g = JSON.parse(fs.readFileSync(path.join(OUT, rel), 'utf8'));
    for (const x of [...(g.buffers || []), ...(g.images || [])]) if (x.uri) { const f = path.posix.normalize(path.posix.join(path.posix.dirname(rel), x.uri)); if (fs.existsSync(path.join(OUT, f))) add(f, kind); else missing.push(f); }
  }
}
for (const [k, e] of Object.entries(bakes.liveries)) for (const s of Object.keys(bakes.sizes)) for (const part of ['body', 'fin']) {
  const rel = e[s] && e[s][part]; if (!rel) continue;
  if (!fs.existsSync(path.join(OUT, rel))) { missing.push(`${k} ${s} ${part}: ${rel}`); continue; }
  add(rel, e.traced ? 'liveries traced (trace/)' : 'liveries baked (bake/)');
}
if (missing.length) { console.error(`missing from data/fleet/out (${missing.length}):\n  ${missing.slice(0, 20).join('\n  ')}`); process.exit(1); }

// an earlier upload: a folder laid out as /m/ (data/fleet-source/served-index-2026-11-13), or a list of paths
const since = opt('since');
let before = null;
if (since) {
  before = new Set();
  if (fs.statSync(since).isDirectory()) { const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else before.add(path.relative(since, p)); } }; walk(since); }
  else for (const l of fs.readFileSync(since, 'utf8').split('\n')) if (l.trim()) before.add(l.trim());
}
fs.mkdirSync(DEST, { recursive: true });
const all = [...files.keys()].sort(), fresh = before ? all.filter(f => !before.has(f)) : all;
fs.writeFileSync(path.join(DEST, 'files.txt'), all.join('\n') + '\n');
fs.writeFileSync(path.join(DEST, 'new.txt'), fresh.join('\n') + '\n');
const size = f => fs.statSync(path.join(OUT, f)).size, mb = n => (n / 1e6).toFixed(1) + ' MB';
const by = (list) => { const o = {}; for (const f of list) { const k = files.get(f) || '?', x = o[k] || (o[k] = { n: 0, b: 0 }); x.n++; x.b += size(f); } return o; };
const show = (title, list) => { const o = by(list); console.log(`${title}: ${list.length} files, ${mb(list.reduce((s, f) => s + size(f), 0))}`); for (const [k, x] of Object.entries(o).sort()) console.log(`  ${k.padEnd(28)} ${String(x.n).padStart(5)}  ${mb(x.b).padStart(9)}`); };
show('served by /m/', all);
if (before) { show(`new since ${path.relative(ROOT, since) || since}`, fresh); console.log(`  (the earlier upload's ${before.size} files: ${[...before].filter(f => !files.has(f)).length} of them no index names now; they stay, harmless)`); }
console.log(`lists: ${path.relative(ROOT, path.join(DEST, 'files.txt'))}, ${path.relative(ROOT, path.join(DEST, 'new.txt'))}`);
console.log(`upload (the main session, with the deploy): rsync -a --ignore-existing --files-from=${path.relative(ROOT, path.join(DEST, 'new.txt'))} data/fleet/out/ root@<vps>:/opt/livesfo/fleet/`);

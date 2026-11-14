#!/usr/bin/env node
// @ts-check
/**
 * Removes converter outputs no current asset uses (stale content-hashed files from earlier runs), so data/fleet/out is
 * exactly what /m/ serves: node tools/fleet/gc.mjs [--out data/fleet/out] [--dry]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2), opt = (k, d) => (argv.includes('--' + k) ? argv[argv.indexOf('--' + k) + 1] : d);
const OUT = path.resolve(opt('out', path.join(ROOT, 'data/fleet/out'))), dry = argv.includes('--dry');
const report = JSON.parse(fs.readFileSync(path.join(OUT, 'report.json'), 'utf8'));
const keep = new Set(['report.json']);
for (const a of Object.values(report.assets)) for (const rel of [a.gltf, a.lite]) {
  if (!rel) continue;
  keep.add(rel);
  const g = JSON.parse(fs.readFileSync(path.join(OUT, rel), 'utf8'));
  for (const x of [...(g.buffers || []), ...(g.images || [])]) if (x.uri) keep.add(path.posix.normalize(path.posix.join(path.posix.dirname(rel), x.uri)));
}
for (const v of report.variants || []) for (const l of Object.values(v.lods || {})) keep.add(l.bin);
let n = 0, bytes = 0, kept = 0, keptBytes = 0;
for (const d of ['a', 'g', 't']) for (const f of fs.readdirSync(path.join(OUT, d))) {
  const rel = `${d}/${f}`, base = rel.replace(/\.(br|gz)$/, ''), p = path.join(OUT, rel), sz = fs.statSync(p).size;
  if (keep.has(base)) { kept++; keptBytes += sz; continue; }
  n++; bytes += sz; if (!dry) fs.rmSync(p);
}
console.log(`${dry ? 'would remove' : 'removed'} ${n} files (${(bytes / 1e6).toFixed(1)} MB); kept ${kept} (${(keptBytes / 1e6).toFixed(1)} MB with the .br/.gz twins)`);

// The twin contributes only these values to a geometry fit. The key binds them to the source parts the fit reads.
import crypto from 'node:crypto';
import fs from 'node:fs';

const name = /^[a-z0-9][a-z0-9-]*$/;
const signature = /^[0-9a-f]{40}$/;
const fitKeys = ['pitchRad', 'dyM', 'gearBoundaryM', 'depthM', 'spreadM'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keysAre = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
const isFit = record => keysAre(record, fitKeys) && fitKeys.every(k => (k === 'depthM' && record[k] === null) || Number.isFinite(record[k]));

export function fitInputKey(entries) {
  const hash = crypto.createHash('sha256'), header = Buffer.alloc(9);
  const bytes = array => Buffer.from(array.buffer, array.byteOffset, array.byteLength);
  for (const { pos, idx, gear } of entries) {
    header.writeUInt32LE(pos.length, 0);
    header.writeUInt32LE(idx.length, 4);
    header[8] = gear ? 1 : 0;
    hash.update(header).update(bytes(pos)).update(bytes(idx));
  }
  return hash.digest('hex').slice(0, 40);
}

export function readFitTable(file) {
  const table = JSON.parse(fs.readFileSync(file, 'utf8'));
  const invalid = part => { throw new Error(`${file}: invalid fleet fit table (${part})`); };
  if (!keysAre(table, ['v', 'airframes']) || table.v !== 1 || !object(table.airframes)) invalid('schema');
  for (const [af, airframe] of Object.entries(table.airframes)) {
    if (!name.test(af) || !keysAre(airframe, ['twin', 'variants', 'liveries']) ||
        !(airframe.twin === null || typeof airframe.twin === 'string' && name.test(airframe.twin)) ||
        !object(airframe.variants) || !object(airframe.liveries)) invalid(af);
    for (const [key, record] of Object.entries(airframe.variants)) {
      if (!signature.test(key) || (record !== null && (!airframe.twin || !isFit(record)))) invalid(`${af}/${key}`);
    }
    for (const [livery, key] of Object.entries(airframe.liveries)) {
      if (!name.test(livery) || typeof key !== 'string' || !Object.hasOwn(airframe.variants, key)) invalid(`${af}/${livery}`);
    }
  }
  return table;
}

/** Copy only the airframes and geometry fits a bundle covers. A partial table cannot silently ship. */
export function selectFitTable(table, selectors) {
  const airframes = {};
  for (const selector of selectors) {
    const [af, livery] = selector.split('/'), source = table.airframes[af];
    if (!source?.liveries || !Object.hasOwn(source.liveries, livery)) {
      throw new Error(`Fit table is missing ${selector}; regenerate it with --fits-only --write-fits`);
    }
    const key = source.liveries[livery];
    const target = airframes[af] ??= { twin: source.twin, variants: {}, liveries: {} };
    target.variants[key] = source.variants[key];
    target.liveries[livery] = key;
  }
  return { v: 1, airframes };
}

export const fitTableJSON = table => JSON.stringify(table, null, 1) + '\n';

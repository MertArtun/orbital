#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const url = 'https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=tle';
const target = path.resolve('public/data/fallback-tle.json');

const response = await fetch(url, { signal: AbortSignal.timeout(12_000), headers: { 'User-Agent': 'ORBITAL fallback updater' } });
if (!response.ok) throw new Error(`CelesTrak returned ${response.status}.`);
const lines = (await response.text()).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
const name = lines[0]?.replace(/^0\s+/, '');
const line1 = lines.find((line) => line.startsWith('1 '));
const line2 = lines.find((line) => line.startsWith('2 '));
if (!name || !line1 || !line2 || line1.slice(2, 7) !== line2.slice(2, 7)) throw new Error('Invalid ISS TLE response.');
const payload = {
  updatedAt: new Date().toISOString(),
  source: 'CelesTrak GP data, NORAD 25544',
  records: [{ name, line1, line2, noradId: line1.slice(2, 7) }],
};
fs.writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`Updated ${target} with epoch ${line1.slice(18, 32).trim()}.`);

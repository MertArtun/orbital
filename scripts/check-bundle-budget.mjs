#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

import { ROOT } from './lib/goal-store.mjs';

// Gzipped JS + CSS a modern browser downloads for the first paint of `/`, read
// from the prerendered HTML rather than from a chunk list we maintain by hand:
// Turbopack rehashes every chunk name on every build.
const PRERENDERED_HTML = path.join(ROOT, '.next/server/app/index.html');

// Before the telemetry chart moved off the first load this measured 279,502
// bytes, of which the recharts chunk was 112,393. It now measures 179,241;
// docs/perf/production-baseline.json carries the current figure.
//
// The headroom is deliberate. This gate exists to stop a chunk of consequence
// re-entering the first load -- anything on the order of the 112 KB recharts
// chunk trips it immediately -- not to police a few kilobytes of ordinary
// dependency drift. A budget that goes red for a reason unrelated to what it
// guards gets raised rather than obeyed, and then it guards nothing.
//
// One thing that headroom does not cover: the 39.5 KB polyfill bundle is
// excluded below because it ships `noModule` and no browser that runs this app
// executes it. That exclusion is larger than the headroom, so if Next ever
// stops marking it, this gate goes red for exactly the unrelated reason the
// paragraph above warns about. Read the failure output before raising the
// number.
export const INITIAL_PAYLOAD_BUDGET_BYTES = 190 * 1024;

// Today's build references 12 assets and 179 KB. These are not targets, they
// are the point below which the measurement has clearly stopped working.
const MIN_INITIAL_ASSETS = 4;
const MIN_INITIAL_BYTES = 50 * 1024;

// The globe is a dynamic(..., { ssr: false }) import, so three.js must not be
// reachable from the prerendered HTML. This string is emitted by three's
// renderer and survives minification, so it identifies the chunk even though
// the chunk name changes every build.
const THREE_MARKER = 'THREE.WebGLRenderer';

function assetPath(url) {
  return path.join(ROOT, '.next', url.split('?')[0].replace('/_next/', ''));
}

// Scripts marked noModule are the legacy polyfill bundle. A browser that runs
// this app never executes it, so it is excluded from the initial payload --
// but it is still scanned for three.js, because a reference from any tag in
// the prerendered HTML would mean the globe is no longer lazy.
function referencedAssets(html) {
  const byUrl = new Map();
  for (const tag of html.match(/<(?:script|link)\b[^>]*>/g) ?? []) {
    const url = tag.match(/(?:src|href)="(\/_next\/static\/[^"]+)"/)?.[1];
    if (!url) continue;
    const extension = path.extname(url.split('?')[0]);
    if (extension !== '.js' && extension !== '.css') continue;
    const legacy = /\bnoModule\b/.test(tag);
    const existing = byUrl.get(url);
    byUrl.set(url, { url, legacy: existing ? existing.legacy && legacy : legacy });
  }
  return [...byUrl.values()];
}

/**
 * Whether `THREE_MARKER` appears anywhere in the built client chunks.
 *
 * The three.js assertion below is a string search, so a `three` release that
 * renames that string would disarm it in silence -- the check would keep
 * passing while measuring nothing, which is the failure this repository keeps
 * finding the expensive way. This is its positive control: if the marker is
 * absent from the whole build, the assertion cannot be trusted and the run
 * fails rather than reporting a clean bill.
 */
function markerExistsSomewhere() {
  const root = path.join(ROOT, '.next/static/chunks');
  if (!fs.existsSync(root)) return false;
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.endsWith('.js') && fs.readFileSync(full).includes(THREE_MARKER)) return true;
    }
  }
  return false;
}

export function measureInitialPayload() {
  if (!fs.existsSync(PRERENDERED_HTML)) {
    throw new Error(
      `No prerendered HTML at ${path.relative(ROOT, PRERENDERED_HTML)}.\n` +
        'Run `npm run build` first. If the build ran and the file is still missing, `/` is no ' +
        'longer statically prerendered and this budget needs to be rewritten rather than skipped.',
    );
  }

  const html = fs.readFileSync(PRERENDERED_HTML, 'utf8');
  const assets = referencedAssets(html);
  if (assets.length === 0) {
    throw new Error(
      `${path.relative(ROOT, PRERENDERED_HTML)} references no JS or CSS under /_next/static. ` +
        'The markup shape changed, so this check would pass without measuring anything.',
    );
  }

  const missing = assets.filter((asset) => !fs.existsSync(assetPath(asset.url)));
  if (missing.length > 0) {
    throw new Error(
      `The prerendered HTML references files that are not in .next:\n${missing
        .map((asset) => `  ${asset.url}`)
        .join('\n')}\nThe build output is stale or partial. Re-run \`npm run build\`.`,
    );
  }

  const measured = assets.map((asset) => {
    const source = fs.readFileSync(assetPath(asset.url));
    return {
      ...asset,
      rawBytes: source.length,
      gzipBytes: zlib.gzipSync(source, { level: 9 }).length,
      containsThree: source.includes(THREE_MARKER),
    };
  });

  return {
    htmlBytes: Buffer.byteLength(html),
    budgetBytes: INITIAL_PAYLOAD_BUDGET_BYTES,
    initialGzipBytes: measured
      .filter((asset) => !asset.legacy)
      .reduce((total, asset) => total + asset.gzipBytes, 0),
    assets: measured,
    threeAssets: measured.filter((asset) => asset.containsThree),
    markerFound: markerExistsSomewhere(),
  };
}

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function report(payload) {
  const rows = [...payload.assets].sort((a, b) => b.gzipBytes - a.gzipBytes);
  console.log('\nInitial payload for / (gzip level 9, from .next/server/app/index.html)\n');
  for (const row of rows) {
    const name = path.basename(row.url);
    console.log(
      `${row.legacy ? '-' : ' '} ${name.padEnd(30)} ${kb(row.gzipBytes).padStart(9)}  ` +
        `raw ${kb(row.rawBytes).padStart(9)}${row.legacy ? '  (noModule, not counted)' : ''}`,
    );
  }
  console.log(
    `\n  ${'initial JS + CSS'.padEnd(30)} ${kb(payload.initialGzipBytes).padStart(9)}  ` +
      `budget ${kb(payload.budgetBytes)}`,
  );
}

function main() {
  const payload = measureInitialPayload();
  report(payload);

  const failures = [];

  // A floor, in the same spirit as expectMeaningfulSweep in
  // e2e/contrast.spec.ts: a budget is a ceiling, and a ceiling is satisfied by
  // measuring nothing. Zero bytes passes. Twenty-four bytes passes. Neither is
  // this app, so both mean the measurement broke rather than the payload
  // shrank. Review the numbers when this trips; do not lower it to make it go.
  const counted = payload.assets.filter((asset) => !asset.legacy);
  if (counted.length < MIN_INITIAL_ASSETS || payload.initialGzipBytes < MIN_INITIAL_BYTES) {
    failures.push(
      `Only ${counted.length} non-legacy assets totalling ${payload.initialGzipBytes} bytes were ` +
        `measured, below the floor of ${MIN_INITIAL_ASSETS} assets and ${MIN_INITIAL_BYTES} bytes.\n` +
        '  A budget is a ceiling and passes trivially when nothing is measured, so this is the ' +
        'floor that says the measurement itself still works. If the payload really did shrink ' +
        'this far, lower the floor deliberately and say why.',
    );
  }

  if (payload.initialGzipBytes > payload.budgetBytes) {
    const over = payload.initialGzipBytes - payload.budgetBytes;
    const largest = [...payload.assets]
      .filter((asset) => !asset.legacy)
      .sort((a, b) => b.gzipBytes - a.gzipBytes)[0];
    failures.push(
      `Initial JS + CSS is ${payload.initialGzipBytes} bytes gzipped, ` +
        `${over} bytes (${kb(over)}) over the ${payload.budgetBytes} byte budget.\n` +
        `  Largest initial chunk: ${path.basename(largest.url)} at ${kb(largest.gzipBytes)}.\n` +
        '  Move work off the first load with a dynamic import, or justify a new budget in ' +
        'scripts/check-bundle-budget.mjs.',
    );
  }

  // Positive control before the assertion that depends on it: a `three` release
  // that renames THREE.WebGLRenderer would leave the check below passing while
  // testing nothing, and a guard that cannot fail is worse than no guard,
  // because it is trusted.
  if (!payload.markerFound) {
    failures.push(
      `The string ${JSON.stringify(THREE_MARKER)} appears in no built chunk, so the ` +
        'three.js assertion below is not testing anything.\n' +
        '  Either the globe stopped shipping three.js, or three renamed the marker. Find the ' +
        'string three emits now and update THREE_MARKER; do not delete this check.',
    );
  }

  if (payload.threeAssets.length > 0) {
    failures.push(
      `three.js is reachable from the prerendered HTML via:\n${payload.threeAssets
        .map((asset) => `  ${asset.url} (${kb(asset.gzipBytes)} gzipped)`)
        .join('\n')}\n` +
        '  The globe must stay behind dynamic(..., { ssr: false }) so the first load does not ' +
        'pay for the 3D renderer.',
    );
  }

  if (failures.length > 0) {
    console.error(`\n✗ Bundle budget failed\n\n${failures.join('\n\n')}\n`);
    process.exit(1);
  }

  console.log(
    `\n✓ Initial payload is within budget and three.js is not in it ` +
      `(${payload.assets.length} referenced assets checked).`,
  );
}

if (import.meta.filename === process.argv[1]) {
  try {
    main();
  } catch (error) {
    // The guards above raise operator-facing messages; a stack trace only
    // buries them.
    console.error(`\n✗ Bundle budget could not run\n\n${error.message}\n`);
    process.exit(1);
  }
}

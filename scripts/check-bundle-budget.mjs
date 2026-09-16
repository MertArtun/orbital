#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

import { ROOT } from './lib/goal-store.mjs';

// Gzipped JS and CSS a modern browser downloads for the first paint of `/`,
// whether it arrives as a chunk or inline in the document, read from the
// prerendered HTML rather than from a chunk list we maintain by hand:
// Turbopack rehashes every chunk name on every build.
const PRERENDERED_HTML = path.join(ROOT, '.next/server/app/index.html');

// The telemetry chart moving off the first load is what this budget exists to
// hold. No current figure is restated here: docs/perf/production-baseline.json
// carries the measured payload and the per-asset breakdown, and a number
// copied into a comment goes stale the first time anything moves. The chunk
// that had to leave was recharts, and the report still names it.
//
// The headroom is deliberate. This gate exists to stop a chunk of consequence
// re-entering the first load -- anything on the order of the 112 KB recharts
// chunk trips it immediately -- not to police a few kilobytes of ordinary
// dependency drift. A budget that goes red for a reason unrelated to what it
// guards gets raised rather than obeyed, and then it guards nothing.
//
// One thing that headroom does not cover: the polyfill bundle is excluded
// below because it ships `noModule` and no browser that runs this app executes
// it. That exclusion is larger than the headroom, so if Next ever stops
// marking it, this gate goes red for exactly the unrelated reason the
// paragraph above warns about. The failure output names the exclusion and its
// size for that reason -- read it before raising the number.
export const INITIAL_PAYLOAD_BUDGET_BYTES = 190 * 1024;

// Not targets: the point below which the measurement has clearly stopped
// working. The real build is an order of magnitude above both.
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

// Everything the document carries inline. Without this, the measurement is not
// a measurement of the payload but of one way of packaging it: inlining the
// stylesheet, or replacing a chunk tag with an inline loader, removes bytes
// from the count while the browser downloads MORE, and the verdict goes green
// as the page gets heavier. Counting inline bytes in the same total makes the
// figure invariant to packaging -- bytes moved from a chunk into the HTML land
// in this column instead of that one, and nothing changes. A threshold on HTML
// size would only have moved the goalposts; this removes them.
function inlineSource(html) {
  const parts = [];
  // `\s` and not `\b` before src: `\b` matches at the hyphen in `data-src`, so
  // the lookahead read a data attribute as a real one and excluded that script
  // from the total -- bytes leaving the measurement through the very hole this
  // function was written to close.
  for (const [, body] of html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    parts.push(body);
  }
  for (const [, body] of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) parts.push(body);
  return Buffer.from(parts.join(''), 'utf8');
}

// The gate measures what the prerendered HTML points at under /_next/static.
// A tag pointing anywhere else -- public/, a CDN, an inline-configured
// next/script -- is a first-load download that the measurement cannot see at
// all: it does not shrink the count, so no floor can ever notice it. The same
// bytes are caught or invisible depending only on which directory they are
// served from, so the reference itself has to be the failure.
function externalReferences(html) {
  const external = [];
  for (const tag of html.match(/<(?:script|link)\b[^>]*>/g) ?? []) {
    const isScript = /^<script/.test(tag);
    const rel = tag.match(/\srel="([^"]*)"/)?.[1] ?? '';
    const as = tag.match(/\sas="([^"]*)"/)?.[1] ?? '';
    // A preload is only this gate's business when the thing preloaded is the
    // JS or CSS it measures. A texture preloaded as an image is a different
    // trade -- ADR 0009 weighs it explicitly -- and failing it here would be
    // the gate going red for a reason unrelated to what it guards, which is
    // how a gate gets raised instead of obeyed.
    const relevant = isScript
      ? /\ssrc="/.test(tag)
      : /\bstylesheet\b/.test(rel) ||
        /\bmodulepreload\b/.test(rel) ||
        (/\bpreload\b/.test(rel) && (as === 'script' || as === 'style'));
    if (!relevant) continue;
    const url = tag.match(/\s(?:src|href)="([^"]+)"/)?.[1];
    if (!url || url.startsWith('/_next/static/')) continue;
    if (url.startsWith('data:')) continue;
    external.push(url);
  }
  return [...new Set(external)];
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

/**
 * Whether `three` itself still emits `THREE_MARKER`.
 *
 * `markerExistsSomewhere` asks a directory, and a directory answers with
 * whatever files happen to be lying in it: a leftover chunk from an earlier
 * build satisfies it even after a `three` release renames the marker, and that
 * compound -- renamed marker plus stale chunk -- disarms the laziness
 * assertion in total silence. This asks the package that owns the string,
 * whose content is pinned by the lockfile and changes exactly when `three`
 * does. The two controls fail for two distinct reasons and the failure text
 * says which. Suggested and verified in both directions by the QA pass.
 */
function threeEntryMarker() {
  const dir = path.join(ROOT, 'node_modules/three');
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    // Read the entry from three's own manifest rather than hardcoding a
    // filename this repo would then have to track across releases.
    const entry = pkg.exports?.['.']?.import ?? pkg.module ?? pkg.main;
    if (!entry) return { entry: null, found: false };
    return { entry, found: fs.readFileSync(path.join(dir, entry)).includes(THREE_MARKER) };
  } catch {
    return { entry: null, found: false };
  }
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

  const inline = inlineSource(html);
  const inlineGzipBytes = inline.length > 0 ? zlib.gzipSync(inline, { level: 9 }).length : 0;

  return {
    htmlBytes: Buffer.byteLength(html),
    budgetBytes: INITIAL_PAYLOAD_BUDGET_BYTES,
    inlineRawBytes: inline.length,
    inlineGzipBytes,
    inlineContainsThree: inline.includes(THREE_MARKER),
    externalReferences: externalReferences(html),
    initialGzipBytes:
      inlineGzipBytes +
      measured
        .filter((asset) => !asset.legacy)
        .reduce((total, asset) => total + asset.gzipBytes, 0),
    assets: measured,
    threeAssets: measured.filter((asset) => asset.containsThree),
    markerFound: markerExistsSomewhere(),
    threeEntry: threeEntryMarker(),
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
    `  ${'inline <script>/<style>'.padEnd(30)} ${kb(payload.inlineGzipBytes).padStart(9)}  ` +
      `raw ${kb(payload.inlineRawBytes).padStart(9)}`,
  );
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
    const legacy = payload.assets.filter((asset) => asset.legacy);
    const legacyBytes = legacy.reduce((total, asset) => total + asset.gzipBytes, 0);
    failures.push(
      `Initial JS + CSS is ${payload.initialGzipBytes} bytes gzipped, ` +
        `${over} bytes (${kb(over)}) over the ${payload.budgetBytes} byte budget.\n` +
        `  Largest initial chunk: ${path.basename(largest.url)} at ${kb(largest.gzipBytes)}.\n` +
        `  Excluded as noModule and not counted: ${legacy.length} asset(s), ${kb(legacyBytes)}.\n` +
        '  Chunk names are turbopack hashes and change every build, so diff the table above ' +
        'against bundle.assets in docs/perf/production-baseline.json to see which one grew.\n' +
        '  Move work off the first load with a dynamic import, or justify a new budget in ' +
        'scripts/check-bundle-budget.mjs.',
    );
  }

  // Positive control before the assertion that depends on it: a `three` release
  // that renames THREE.WebGLRenderer would leave the check below passing while
  // testing nothing, and a guard that cannot fail is worse than no guard,
  // because it is trusted.
  if (!payload.threeEntry.found) {
    failures.push(
      `The string ${JSON.stringify(THREE_MARKER)} does not appear in three's own entry point ` +
        `(${payload.threeEntry.entry ?? 'entry could not be resolved from node_modules/three'}), ` +
        'so the assertion below is probing for a string the dependency no longer emits.\n' +
        '  A leftover chunk from an earlier build can still satisfy the build-output control, so ' +
        'this is the one that catches a renamed marker. Find the string three emits now and ' +
        'update THREE_MARKER; do not delete this check.',
    );
  } else if (!payload.markerFound) {
    failures.push(
      `The string ${JSON.stringify(THREE_MARKER)} is present in three's entry point but appears ` +
        'in no built chunk, so the assertion below is not testing anything.\n' +
        '  Either the globe stopped shipping three.js at all, or the minifier is now mangling the ' +
        'marker. Establish which before trusting a green run.',
    );
  }

  if (payload.externalReferences.length > 0) {
    failures.push(
      `The prerendered HTML loads first-paint resources from outside /_next/static:\n${payload.externalReferences
        .map((url) => `  ${url}`)
        .join('\n')}\n` +
        '  These are downloaded on the first load and this gate cannot weigh them, so they would ' +
        'pass at any size while the measured figure stayed flat. Serve them through the bundle, ' +
        'load them after first paint, or widen this check deliberately and say why.',
    );
  }

  if (payload.inlineContainsThree) {
    failures.push(
      `The string ${JSON.stringify(THREE_MARKER)} appears inline in the prerendered HTML, so ` +
        'three.js ships on the first load without a chunk to attribute it to.',
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

// `process.argv[1]` is the path as typed while Node realpaths the ESM module
// specifier, so a symlinked invocation made these two disagree and the script
// exited 0 having run nothing at all -- a silent pass that verify.mjs would
// have recorded as success.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === import.meta.filename) {
  try {
    main();
  } catch (error) {
    // The guards above raise operator-facing messages; a stack trace only
    // buries them.
    console.error(`\n✗ Bundle budget could not run\n\n${error.message}\n`);
    process.exit(1);
  }
}

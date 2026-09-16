#!/usr/bin/env node
/**
 * Measures the production build of `/` in the Playwright chromium that is
 * already installed for the e2e suite, over the Chrome DevTools Protocol.
 *
 * There is no Lighthouse run behind these numbers and no single score is
 * produced. Byte counts come from build output and are exact; paint and
 * blocking timings come from one machine in one session and are comparable
 * only against another run of this script on that machine. The written report
 * says so in its own text, because a number that does not carry its own
 * provenance is indistinguishable from an invented one.
 */
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import { chromium, devices } from '@playwright/test';

import { ROOT, nowIso } from './lib/goal-store.mjs';
import { measureInitialPayload } from './check-bundle-budget.mjs';

const require = createRequire(import.meta.url);

const DEFAULT_OUT = 'docs/perf/production-baseline.json';
const DEFAULT_PORT = 3100;
// Long enough for the globe chunk to arrive and paint on the throttled profile,
// where the chunk alone is seconds of transfer at 1.6 Mbps. Its size is in
// bundle.assets in the written report rather than restated here.
const SETTLE_MS = 10_000;
// Every profile is measured this many times and the report publishes the
// spread, not a run. ADR 0009 argues at length that a single timing on this
// hardware cannot be trusted; publishing a single timing anyway, and then
// choosing which single timing, is the same claim made twice in opposite
// directions. With n>1 there is no run to select.
const REPEATS = 3;

// Lighthouse's mobile throttling preset, applied directly rather than
// simulated: 4x CPU, 1.6 Mbps down, 750 Kbps up, 150 ms RTT.
const PROFILES = [
  {
    name: 'desktop',
    context: { viewport: { width: 1440, height: 900 } },
    cpuThrottlingRate: 1,
    network: null,
  },
  {
    name: 'mobile-375-throttled',
    context: { ...devices['iPhone 13'], viewport: { width: 375, height: 812 } },
    cpuThrottlingRate: 4,
    network: {
      offline: false,
      latency: 150,
      downloadThroughput: Math.round((1.6 * 1024 * 1024) / 8),
      uploadThroughput: Math.round((750 * 1024) / 8),
    },
  },
];

const INTERPRETATION = {
  exact: [
    'bundle.initialGzipBytes and every bundle.assets entry are read from build output. They are byte-exact and reproduce on any machine at the same commit.',
    'bundle.withinBudget is the only value here that gates a merge; scripts/check-bundle-budget.mjs enforces it.',
    'profiles[].resources counts and encoded sizes are reported by the browser and are stable apart from upstream API payload size.',
  ],
  reportOnly: [
    'firstContentfulPaintMs, largestContentfulPaintMs, documentResponseEndMs, totalBlockingTimeMs, globeCanvasMs and every cdpMetrics duration move with CPU load, thermal state and headless mode. Compare them only against another run of this script on the machine named in environment.',
    'cumulativeLayoutShift and largestContentfulPaint are both measured against live upstream data, so both vary with internet latency and not only with the host. The gated CLS budget lives in e2e/resilience.spec.ts against stubbed responses.',
    'Every timing is published as min, median, max and the individual runs across ' + REPEATS + ' repeats of the profile. Read the spread, not the median: the gap between min and max is the honest precision of the measurement on this machine, and a metric whose max is several times its min is not a number to quote anywhere.',
    'environment.loadAverage and environment.loadAverageAfter bracket the run rather than describe it: the first is sampled before any profile, the second after the last one. Read them together. A wide gap means the machine was contended while the timings above were taken, and those timings should be compared only against a run with a similar bracket.',
  ],
  notes: [
    'No Lighthouse score is computed. Producing a single absolute performance number would need a controlled lab this project does not have, so the report gives measurements and their provenance instead.',
    'The page fetches live upstream data through its own /api routes during this run, so paint and blocking figures include real internet latency.',
    'Existing Playwright gates run against `next dev`. Only the numbers in this file come from a production build.',
    'Chrome charges the emulated round trip to the body transfer, not to responseStart, so serverResponseStartMs stays near zero on the throttled profile. It measures local server think-time, not a network time to first byte; documentResponseEndMs is when the HTML finished arriving.',
  ],
};

// Reports normally land inside the repo; a scratch --out outside it should
// print as an absolute path rather than a ladder of `..` segments.
function displayPath(target) {
  const relative = path.relative(ROOT, target);
  return relative.startsWith('..') ? target : relative;
}

function flagValue(name, fallback) {
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (inline) return inline.split('=').slice(1).join('=');
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function git(args, fallback = null, trim = true) {
  try {
    const out = execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    // `trim` is right for rev-parse and branch and wrong for porcelain status:
    // an unstaged modification's record begins with a space (` M path`), and
    // trimming ate it, shifting the fixed-offset path slice by one character so
    // no path ever matched its exclusion. See treeDirtyExcludingReport.
    return trim ? out.trim() : out;
  } catch {
    return fallback;
  }
}

/**
 * Whether anything except the report itself differs from the named commit.
 *
 * The report is written into the tree it is describing, so a naive
 * `git status --porcelain` is non-empty on every run that is about to be
 * committed — which would make the flag always true and therefore carry no
 * information at all. Excluding only the output path keeps it meaningful: true
 * here means the measured bundle really was built from something other than
 * the commit named above.
 */
function treeDirtyExcludingReport(outPath) {
  // Git quotes any path containing a space or a non-ASCII byte, so a matched
  // comparison against the raw status line would silently stop excluding the
  // report and leave the flag permanently true -- the same defect as before,
  // wearing a different hat. `-z` gives NUL-separated, never-quoted paths.
  const report = path.relative(ROOT, outPath);
  // `-uall` lists untracked files individually. Without it git collapses a new
  // directory to `?? docs/perf/`, which never matches the report's own path, so
  // the first run that creates the directory reports dirty however carefully
  // the exclusion is written.
  return git(['status', '--porcelain', '-uall', '-z'], '', false)
    .split('\0')
    .filter(Boolean)
    // Each record is `XY <path>`: two status columns and a space, so the path
    // starts at a fixed offset -- which is only true of untrimmed output. A
    // rename's second record is a bare old path and is mangled by this slice,
    // forcing the flag true; that residual is left, because true is the safe
    // direction. Safe is not the same as correct, and this flag has now been
    // wrong in the safe direction three separate times.
    .map((record) => record.slice(3))
    .some((file) => file !== report);
}

function environmentStamp(chromiumVersion, outPath) {
  const cpus = os.cpus();
  return {
    commit: git(['rev-parse', 'HEAD']),
    branch: git(['branch', '--show-current']),
    // A dirty tree means the measured bundle does not match the named commit.
    treeDirty: treeDirtyExcludingReport(outPath),
    node: process.version,
    // Machine class, not machine identity: reports are committed, and
    // .claude/rules/security.md forbids user-specific identifiers in the repo.
    platform: `${os.platform()} ${os.release()}`,
    arch: os.arch(),
    cpuModel: cpus[0]?.model ?? 'unknown',
    cpuCount: cpus.length,
    memoryGb: Math.round(os.totalmem() / 1024 ** 3),
    // Load entering the run. See `loadAverageAfter` for the other end:
    // contention that starts mid-measurement is exactly the case this field
    // exists for, and a single sample taken before the profiles cannot see it.
    // No figures are quoted here -- a comment that names the run it sits
    // beside is false the next time the run is regenerated, which this one was
    // four times over.
    loadAverage: os.loadavg().map((value) => Math.round(value * 100) / 100),
    // Filled in after the profiles run. Declared here so the pair serialises
    // adjacently: they only mean anything together, and this is a document
    // somebody reads.
    loadAverageAfter: null,
    playwright: require('@playwright/test/package.json').version,
    chromium: chromiumVersion,
    next: require('next/package.json').version,
  };
}

/**
 * Collapses repeated runs of one profile into a spread.
 *
 * Every numeric metric becomes `{ min, median, max, runs }`. Nothing is
 * averaged: an average of three timings on a contended host is a number that
 * describes no run that happened, and the point of measuring three times is to
 * show how far apart they were. Non-numeric and structural fields are taken
 * from the first run, since they do not vary between repeats of one profile.
 */
function summariseRuns(profile, runs) {
  const spread = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return {
      min: sorted[0],
      median: sorted[(sorted.length - 1) >> 1],
      max: sorted[sorted.length - 1],
      runs: values,
    };
  };
  const keys = Object.keys(runs[0].metrics);
  const metrics = Object.fromEntries(
    keys.map((key) => {
      const values = runs.map((run) => run.metrics[key]);
      return [key, values.every((value) => typeof value === 'number') ? spread(values) : values[0]];
    }),
  );
  return {
    name: profile.name,
    viewport: profile.context.viewport,
    cpuThrottlingRate: profile.cpuThrottlingRate,
    network: profile.network,
    settleMs: SETTLE_MS,
    repeats: runs.length,
    metrics,
    resources: runs[0].resources,
    cdpMetrics: runs[0].cdpMetrics,
  };
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`The production server did not answer ${url} within ${timeoutMs} ms.`);
}

/**
 * `next build` rewrites this generated file, so a report taken after a build
 * stamped `treeDirty: true` every time — the flag claiming "the measured
 * bundle is not this commit" when the only difference is a file the build tool
 * regenerates. A flag that is wrong in the alarming direction gets ignored,
 * which ends the same way as one that is always true. `scripts/verify.mjs`
 * restores it for the same reason.
 */
function restoreGeneratedNextEnv() {
  const file = 'next-env.d.ts';
  try {
    const dirty =
      spawnSync('git', ['diff', '--quiet', '--', file], { cwd: ROOT, stdio: 'ignore' }).status !== 0;
    if (!dirty) return;
    const committed = execFileSync('git', ['show', `HEAD:${file}`], { cwd: ROOT, encoding: 'utf8' });
    fs.writeFileSync(path.join(ROOT, file), committed);
    console.log(`\nRestored the generated ${file} after the build rewrote it.`);
  } catch {
    // Not a git checkout, or the file is untracked: nothing to restore.
  }
}

async function assertPortFree(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1_000) });
  } catch {
    return;
  }
  throw new Error(
    `Something is already serving ${url}. Stop it, or pass --port with a free port: this script ` +
      'must measure the build it just produced, not whatever else is listening.',
  );
}

function startServer(port) {
  const child = spawn(path.join(ROOT, 'node_modules/.bin/next'), ['start', '--port', String(port)], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  return child;
}

function stopServer(child) {
  if (!child || child.killed) return;
  try {
    // The detached child leads its own process group; kill the group so the
    // Next.js worker goes with it and the port is released.
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}

// Runs before any page script, so the observers see the entries that a
// listener attached after navigation would already have missed.
function instrument() {
  const state = {
    firstContentfulPaintMs: null,
    largestContentfulPaintMs: null,
    cumulativeLayoutShift: 0,
    longTasks: [],
    globeCanvasMs: null,
  };
  window.__orbitalPerf = state;

  const observe = (type, handler) => {
    try {
      new PerformanceObserver((list) => list.getEntries().forEach(handler)).observe({
        type,
        buffered: true,
      });
    } catch {
      // Entry type unsupported in this browser; the report records null.
    }
  };

  observe('paint', (entry) => {
    if (entry.name === 'first-contentful-paint') state.firstContentfulPaintMs = entry.startTime;
  });
  observe('largest-contentful-paint', (entry) => {
    state.largestContentfulPaintMs = entry.startTime;
  });
  observe('layout-shift', (entry) => {
    if (!entry.hadRecentInput) state.cumulativeLayoutShift += entry.value;
  });
  observe('longtask', (entry) => {
    state.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
  });

  const canvasWatcher = new MutationObserver(() => {
    if (state.globeCanvasMs === null && document.querySelector('canvas')) {
      state.globeCanvasMs = performance.now();
      canvasWatcher.disconnect();
    }
  });
  canvasWatcher.observe(document, { childList: true, subtree: true });
}

function collect() {
  const state = window.__orbitalPerf;
  const navigation = performance.getEntriesByType('navigation')[0];
  const fcp = state.firstContentfulPaintMs ?? 0;
  // Total blocking time: the part of every long task past 50 ms, counted from
  // first contentful paint, which is the window a user is actually waiting in.
  const totalBlockingTimeMs = state.longTasks
    .filter((task) => task.startTime + task.duration > fcp)
    .reduce((total, task) => total + Math.max(0, task.duration - 50), 0);

  const resources = performance.getEntriesByType('resource');
  const byType = {};
  for (const resource of resources) {
    const key = resource.initiatorType || 'other';
    const bucket = (byType[key] ??= { count: 0, transferBytes: 0 });
    bucket.count += 1;
    bucket.transferBytes += resource.transferSize || 0;
  }

  return {
    metrics: {
      serverResponseStartMs: navigation?.responseStart ?? null,
      documentResponseEndMs: navigation?.responseEnd ?? null,
      firstContentfulPaintMs: state.firstContentfulPaintMs,
      largestContentfulPaintMs: state.largestContentfulPaintMs,
      domContentLoadedMs: navigation?.domContentLoadedEventEnd ?? null,
      loadEventMs: navigation?.loadEventEnd ?? null,
      cumulativeLayoutShift: Number(state.cumulativeLayoutShift.toFixed(4)),
      totalBlockingTimeMs: Math.round(totalBlockingTimeMs),
      longTaskCount: state.longTasks.length,
      longestTaskMs: Math.round(Math.max(0, ...state.longTasks.map((task) => task.duration))),
      globeCanvasMs: state.globeCanvasMs === null ? null : Math.round(state.globeCanvasMs),
    },
    resources: {
      requestCount: resources.length,
      transferBytes: resources.reduce((total, resource) => total + (resource.transferSize || 0), 0),
      byInitiator: byType,
    },
  };
}

async function measureProfile(browser, profile, url) {
  const context = await browser.newContext(profile.context);
  const page = await context.newPage();
  await page.addInitScript(instrument);

  const client = await context.newCDPSession(page);
  await client.send('Performance.enable');
  await client.send('Emulation.setCPUThrottlingRate', { rate: profile.cpuThrottlingRate });
  if (profile.network) {
    await client.send('Network.enable');
    await client.send('Network.emulateNetworkConditions', profile.network);
  }

  await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
  await page.waitForTimeout(SETTLE_MS);

  const { metrics: cdpMetrics } = await client.send('Performance.getMetrics');
  const observed = await page.evaluate(collect);
  await context.close();

  return {
    name: profile.name,
    viewport: profile.context.viewport,
    cpuThrottlingRate: profile.cpuThrottlingRate,
    network: profile.network,
    settleMs: SETTLE_MS,
    ...observed,
    cdpMetrics: Object.fromEntries(cdpMetrics.map((metric) => [metric.name, metric.value])),
  };
}

function printSummary(report) {
  const { bundle } = report;
  console.log('\nProduction measurement\n');
  console.log(`  commit            ${report.environment.commit ?? 'unknown'}`);
  console.log(`  machine           ${report.environment.cpuModel} (${report.environment.arch})`);
  console.log(`  chromium          ${report.environment.chromium}`);
  console.log(
    `\n  initial JS + CSS  ${bundle.initialGzipBytes} B gzip / ${bundle.budgetBytes} B budget` +
      `  ${bundle.withinBudget ? 'within' : 'OVER'}`,
  );
  // min-median-max, never a single figure: the spread is the measurement.
  // `digits` exists because rounding is not neutral. CLS lives below 0.1, so
  // whole-millisecond rounding printed a real 0.0314 shift as a flat `0` while
  // the JSON beside it held the true value -- a summary wrong in the reassuring
  // direction, which is the one nobody checks.
  const band = (value, unit = 'ms', digits = 0) => {
    const show = (n) => n.toFixed(digits);
    return value && typeof value === 'object'
      ? `${show(value.min)}-${show(value.max)} ${unit} (median ${show(value.median)})`
      : `${value ?? 'not seen'}`;
  };
  for (const profile of report.profiles) {
    const m = profile.metrics;
    console.log(`\n  ${profile.name} (CPU x${profile.cpuThrottlingRate}, ${profile.repeats} runs)`);
    console.log(`    document          ${band(m.documentResponseEndMs)} to responseEnd`);
    console.log(`    FCP               ${band(m.firstContentfulPaintMs)}`);
    console.log(`    LCP               ${band(m.largestContentfulPaintMs)}`);
    console.log(`    TBT               ${band(m.totalBlockingTimeMs)}`);
    console.log(`    long tasks        ${band(m.longTaskCount, '')}`);
    console.log(`    CLS               ${band(m.cumulativeLayoutShift, '', 4)}`);
    console.log(`    globe canvas      ${band(m.globeCanvasMs)}`);
    console.log(`    requests          ${profile.resources.requestCount} / ${profile.resources.transferBytes} B`);
  }
  console.log('\n  Timings above are report-only, and are ranges because a single one is not');
  console.log('  a measurement. See "interpretation" in the report.');
}

async function main() {
  const outPath = path.resolve(ROOT, flagValue('out', DEFAULT_OUT));
  const port = Number(flagValue('port', DEFAULT_PORT));
  const url = `http://127.0.0.1:${port}/`;

  await assertPortFree(url);

  if (!process.argv.includes('--no-build')) {
    console.log('▶ npm run build\n');
    const build = spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' });
    if (build.status !== 0) {
      console.error('\nThe production build failed, so there is nothing to measure.');
      process.exit(build.status ?? 1);
    }
    restoreGeneratedNextEnv();
  }

  const bundle = measureInitialPayload();
  const server = startServer(port);
  const cleanup = () => stopServer(server);
  process.once('exit', cleanup);
  process.once('SIGINT', () => {
    cleanup();
    process.exit(130);
  });

  let browser;
  try {
    await waitForServer(url, 60_000);
    browser = await chromium.launch();
    const report = {
      schemaVersion: 1,
      generatedAt: nowIso(),
      command: `node scripts/measure-perf.mjs --out ${displayPath(outPath)} --port ${port}`,
      interpretation: INTERPRETATION,
      environment: environmentStamp(browser.version(), outPath),
      bundle: {
        budgetBytes: bundle.budgetBytes,
        initialGzipBytes: bundle.initialGzipBytes,
        withinBudget: bundle.initialGzipBytes <= bundle.budgetBytes,
        prerenderedHtmlBytes: bundle.htmlBytes,
        assets: bundle.assets.map((asset) => ({
          url: asset.url,
          rawBytes: asset.rawBytes,
          gzipBytes: asset.gzipBytes,
          countedInInitial: !asset.legacy,
        })),
      },
      profiles: [],
    };

    for (const profile of PROFILES) {
      const runs = [];
      for (let attempt = 1; attempt <= REPEATS; attempt += 1) {
        console.log(`\n▶ measuring ${profile.name} (${attempt} of ${REPEATS})\n`);
        runs.push(await measureProfile(browser, profile, url));
      }
      report.profiles.push(summariseRuns(profile, runs));
    }

    // Bounds the run rather than its start: a stamp taken only before the
    // profiles reports a quiet machine even when contention arrived halfway
    // through, which is the one reading it exists to catch.
    report.environment.loadAverageAfter = os
      .loadavg()
      .map((value) => Math.round(value * 100) / 100);

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
    printSummary(report);
    console.log(`\n✓ Report written to ${displayPath(outPath)}`);
  } finally {
    if (browser) await browser.close();
    cleanup();
  }
}

await main();

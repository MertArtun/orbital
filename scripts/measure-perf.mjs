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
// Long enough for the globe chunk to arrive and paint on the throttled
// profile, where 486 KB gzipped over slow 4G is about 2.4 s of transfer alone.
const SETTLE_MS = 10_000;

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
    'cumulativeLayoutShift is measured without stubbed feeds here, so it varies with upstream latency. The gated CLS budget lives in e2e/resilience.spec.ts against stubbed responses.',
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

function git(args, fallback = null) {
  try {
    return execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
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
  return git(['status', '--porcelain', '-uall', '-z'])
    .split('\0')
    .filter(Boolean)
    // Each record is `XY <path>`; the status letters are always two columns
    // and a space.
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
    // The one fact a reader needs to judge a timing, and the one the report
    // did not carry. The first run of this report measured desktop blocking
    // time at 9326 ms while three builds were running; the committed run
    // measured 1090 ms. Without the load figure those are one number and an
    // anecdote. With it they are two comparable points.
    loadAverage: os.loadavg().map((value) => Math.round(value * 100) / 100),
    playwright: require('@playwright/test/package.json').version,
    chromium: chromiumVersion,
    next: require('next/package.json').version,
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
  for (const profile of report.profiles) {
    const m = profile.metrics;
    console.log(`\n  ${profile.name} (CPU x${profile.cpuThrottlingRate})`);
    console.log(`    document          ${Math.round(m.documentResponseEndMs ?? 0)} ms to responseEnd`);
    console.log(`    FCP               ${Math.round(m.firstContentfulPaintMs ?? 0)} ms`);
    console.log(`    LCP               ${Math.round(m.largestContentfulPaintMs ?? 0)} ms`);
    console.log(`    TBT               ${m.totalBlockingTimeMs} ms over ${m.longTaskCount} long tasks`);
    console.log(`    CLS               ${m.cumulativeLayoutShift}`);
    console.log(`    globe canvas      ${m.globeCanvasMs ?? 'not seen'} ms`);
    console.log(`    requests          ${profile.resources.requestCount} / ${profile.resources.transferBytes} B`);
  }
  console.log('\n  Timings above are report-only. See "interpretation" in the report.');
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
      console.log(`\n▶ measuring ${profile.name}\n`);
      report.profiles.push(await measureProfile(browser, profile, url));
    }

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

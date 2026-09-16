#!/usr/bin/env node
/**
 * Measures the contrast of text painted over the globe canvas, which
 * `e2e/contrast.spec.ts` structurally cannot: that gate composites background
 * *colours*, and a WebGL canvas is pixels.
 *
 * Two instrument errors make this measurement easy to get wrong, and both
 * produced convincing false findings before this script existed.
 *
 * The first is the bounding box. Worst pixel inside a text rectangle measures
 * the background *between* letters, and the box for "DRAG TO ROTATE · SCROLL TO
 * ZOOM" is mostly gaps — a star has far more gap to cross than glyph. So the
 * backdrop is sampled only where ink actually lands: screenshot twice, once
 * normally and once with the glyph fill made transparent, and keep the pixels
 * that moved most of the way toward the text colour.
 *
 * The second is the element rect. `.orbit-legend span` contains an
 * `<i class="legend-line">` swatch before its label, so `getBoundingClientRect`
 * on the element scores a decorative graphic as if it were text. Rects come
 * from text nodes only.
 *
 * Nothing here gates a merge. It exists so the numbers in ADR 0009 and in
 * `e2e/contrast.spec.ts` are regenerable rather than typed — the same standard
 * that ADR applies to `scripts/measure-perf.mjs`.
 */
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import { chromium } from '@playwright/test';

import { ROOT, nowIso } from './lib/goal-store.mjs';

const require = createRequire(import.meta.url);

const DEFAULT_OUT = 'docs/a11y/ink-contrast.json';
const DEFAULT_PORT = 3101;
/** WCAG 2.2 SC 1.4.3 for normal text. Every run below is normal text. */
const THRESHOLD = 4.5;
/** A pixel counts as ink once it has moved this far from bare backdrop to text colour. */
const INK_COVERAGE = 0.85;

/** Text painted directly over the WebGL canvas. Nothing else needs this script. */
const SELECTORS = ['.globe-hud--bottom p', '.orbit-legend span', '.globe-hud--top p'];

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

function displayPath(target) {
  const relative = path.relative(ROOT, target);
  return relative.startsWith('..') ? target : relative;
}

async function assertPortFree(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1_000) });
  } catch {
    return;
  }
  throw new Error(
    `Something is already serving ${url}. Stop it, or pass --port with a free port: this ` +
      'script must measure the build it just produced, not whatever else is listening.',
  );
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {
      // Still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`The production server did not answer ${url} within ${timeoutMs} ms.`);
}

/**
 * Text-node client rects, never the element rect.
 *
 * An element box swallows whatever decorative children the element contains,
 * which is how a legend colour swatch once got scored as if it were a letter.
 */
function textRects(selectors) {
  const out = [];
  const range = document.createRange();
  for (const selector of selectors) {
    for (const element of Array.from(document.querySelectorAll(selector))) {
      const style = getComputedStyle(element);
      let box = null;
      for (const node of Array.from(element.childNodes)) {
        if (node.nodeType !== Node.TEXT_NODE || !(node.textContent ?? '').trim()) continue;
        range.selectNodeContents(node);
        for (const rect of Array.from(range.getClientRects())) {
          if (rect.width <= 0 || rect.height <= 0) continue;
          box = box
            ? {
                left: Math.min(box.left, rect.left),
                top: Math.min(box.top, rect.top),
                right: Math.max(box.right, rect.right),
                bottom: Math.max(box.bottom, rect.bottom),
              }
            : { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
        }
      }
      if (!box) continue;
      out.push({
        selector,
        text: (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40),
        colour: style.color,
        fontSize: Number.parseFloat(style.fontSize),
        fontWeight: Number(style.fontWeight) || 400,
        box,
      });
    }
  }
  return out;
}

/** Compares the two captures in-page, so no image decoder is needed. */
async function analyse({ plain, hidden, runs, coverage, THRESHOLD_IN_PAGE }) {
  const decode = async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext('2d').drawImage(image, 0, 0);
    return { ctx: canvas.getContext('2d'), width: image.width };
  };
  const withText = await decode(plain);
  const withoutText = await decode(hidden);
  const dpr = withText.width / window.innerWidth;

  const channel = (value) => {
    const scaled = value / 255;
    return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  const ratio = (a, b) => {
    const [high, low] = luminance(a) >= luminance(b) ? [luminance(a), luminance(b)] : [luminance(b), luminance(a)];
    return (high + 0.05) / (low + 0.05);
  };
  return runs.map((run) => {
    const left = Math.floor(run.box.left * dpr);
    const top = Math.floor(run.box.top * dpr);
    const width = Math.max(1, Math.round((run.box.right - run.box.left) * dpr));
    const height = Math.max(1, Math.round((run.box.bottom - run.box.top) * dpr));
    const lit = withText.ctx.getImageData(left, top, width, height).data;
    const bare = withoutText.ctx.getImageData(left, top, width, height).data;

    // The foreground is the pixel that was actually painted, never the declared
    // colour. Parsing `getComputedStyle().color` looks simpler and is a trap:
    // Tailwind v4 serves this palette as `lab()`, which a naive number-grab
    // reads as three unrelated RGB channels, and a translucent colour like the
    // eyebrow's `rgba(..., 0.68)` is not what lands on screen anyway. Reading
    // the painted pixel needs no parser and handles both for free.
    //
    // Ink is found the same way: the largest painted-versus-bare difference in
    // the box is a fully covered glyph centre, and anything within
    // INK_COVERAGE of it is ink. Antialiased edges and the gaps between letters
    // fall well short.
    const delta = [];
    for (let i = 0; i < lit.length; i += 4) {
      delta.push(
        Math.hypot(lit[i] - bare[i], lit[i + 1] - bare[i + 1], lit[i + 2] - bare[i + 2]),
      );
    }
    const fullCoverage = Math.max(...delta);

    let inkPixels = 0;
    let worstInk = Infinity;
    let worstInkBackdrop = null;
    let worstInkPainted = null;
    let belowThreshold = 0;
    let worstInBox = Infinity;

    for (let i = 0, pixel = 0; i < lit.length; i += 4, pixel += 1) {
      const backdrop = [bare[i], bare[i + 1], bare[i + 2]];
      const painted = [lit[i], lit[i + 1], lit[i + 2]];

      if (fullCoverage < 8 || delta[pixel] < fullCoverage * coverage) continue;

      inkPixels += 1;
      const inkRatio = ratio(painted, backdrop);
      if (inkRatio < worstInk) {
        worstInk = inkRatio;
        worstInkBackdrop = backdrop;
        worstInkPainted = painted;
      }
      if (inkRatio < THRESHOLD_IN_PAGE) belowThreshold += 1;
    }

    // What a bounding-box measurement would have reported, using the glyph
    // colour actually painted. Recorded only to show the size of that error:
    // it scores the background between letters, which nobody reads.
    if (worstInkPainted) {
      for (let i = 0; i < bare.length; i += 4) {
        worstInBox = Math.min(worstInBox, ratio(worstInkPainted, [bare[i], bare[i + 1], bare[i + 2]]));
      }
    }

    return {
      selector: run.selector,
      text: run.text,
      colour: run.colour,
      fontSize: run.fontSize,
      fontWeight: run.fontWeight,
      inkPixels,
      worstInkRatio: inkPixels > 0 ? Number(worstInk.toFixed(2)) : null,
      worstInkBackdrop,
      worstInkPainted,
      inkBelowThresholdPercent:
        inkPixels > 0 ? Number(((belowThreshold / inkPixels) * 100).toFixed(2)) : null,
      // Kept only to show how far wrong the naive metric is. Never a finding.
      worstInBoxRatio: Number.isFinite(worstInBox) ? Number(worstInBox.toFixed(2)) : null,
    };
  });
}

async function measureState(page, label, coverage) {
  const runs = await page.evaluate(textRects, SELECTORS);
  if (runs.length === 0) {
    throw new Error(
      `No text was located over the canvas in state "${label}". The selectors in ` +
        'scripts/measure-ink-contrast.mjs no longer match the markup, so this run would ' +
        'report a clean result while measuring nothing.',
    );
  }
  const plain = (await page.screenshot({ type: 'png' })).toString('base64');
  await page.addStyleTag({ content: '*, *::before, *::after { -webkit-text-fill-color: transparent !important; }' });
  const hidden = (await page.screenshot({ type: 'png' })).toString('base64');
  const measured = await page.evaluate(analyse, {
    plain,
    hidden,
    runs,
    coverage,
    THRESHOLD_IN_PAGE: THRESHOLD,
  });
  return { state: label, runs: measured };
}

async function main() {
  const outPath = path.resolve(ROOT, flagValue('out', DEFAULT_OUT));
  const port = Number(flagValue('port', DEFAULT_PORT));
  const url = `http://127.0.0.1:${port}/`;

  await assertPortFree(url);

  if (!process.argv.includes('--no-build')) {
    const build = spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: true });
    if (build.status !== 0) process.exit(build.status ?? 1);
  }

  const server = spawn(path.join(ROOT, 'node_modules/.bin/next'), ['start', '--port', String(port)], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  const cleanup = () => {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      server.kill('SIGTERM');
    }
  };
  process.once('exit', cleanup);
  // Default SIGINT termination does not run `exit` listeners, so Ctrl-C during the
  // run would leave the detached `next start` holding the port and the browser
  // running. The next run then dies in its port check, so it is self-detecting --
  // but self-detecting later is not the same as cleaning up now.
  process.once('SIGINT', () => {
    cleanup();
    process.exit(130);
  });

  let browser;
  try {
    await waitForServer(url, 60_000);
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('.iss-marker', { state: 'attached', timeout: 30_000 });
    await page.waitForTimeout(4_000);

    const states = [];
    states.push(await measureState(page, 'at rest', INK_COVERAGE));

    // Zoomed in until lit Earth fills the frame, which is what the hint the
    // script is measuring invites the visitor to do.
    const reload = async () => {
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('.iss-marker', { state: 'attached', timeout: 30_000 });
      await page.waitForTimeout(3_000);
    };
    await reload();
    const frame = await page.locator('.globe-frame canvas').first().boundingBox();
    for (let notch = 0; notch < 14; notch += 1) {
      await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2);
      await page.mouse.wheel(0, -240);
      await page.waitForTimeout(120);
    }
    await page.waitForTimeout(2_500);
    states.push(await measureState(page, 'zoomed in', INK_COVERAGE));

    for (const [index, drag] of [
      [-320, 0],
      [320, 0],
      [0, -200],
      [0, 200],
    ].entries()) {
      await reload();
      await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2);
      await page.mouse.down();
      await page.mouse.move(frame.x + frame.width / 2 + drag[0], frame.y + frame.height / 2 + drag[1], {
        steps: 12,
      });
      await page.mouse.up();
      await page.waitForTimeout(2_000);
      states.push(await measureState(page, `rotated ${index + 1}`, INK_COVERAGE));
    }

    const everyRun = states.flatMap((state) => state.runs).filter((run) => run.inkPixels > 0);
    // Without this, a run where the glyph-difference pass found no ink anywhere
    // reaches an empty reduce with no initial value and dies on a TypeError
    // about an empty array -- the one failure in this file that would reach the
    // operator as a stack trace instead of as the thing that actually went
    // wrong. No ink means the instrument stopped seeing text, not that the text
    // passed.
    if (everyRun.length === 0) {
      throw new Error(
        'No measured run found any inked pixels, so there is nothing to report a contrast ratio ' +
          'for. The glyph-difference pass relies on -webkit-text-fill-color: transparent changing ' +
          'the painted pixels; if that stopped working, this harness is measuring nothing rather ' +
          'than measuring a page that passes.',
      );
    }
    const worst = everyRun.reduce((low, run) => (run.worstInkRatio < low.worstInkRatio ? run : low));
    const cpus = os.cpus();

    const report = {
      schemaVersion: 1,
      generatedAt: nowIso(),
      command: `node scripts/measure-ink-contrast.mjs --out ${displayPath(outPath)} --port ${port}`,
      threshold: THRESHOLD,
      inkCoverage: INK_COVERAGE,
      interpretation: [
        'worstInkRatio is the contrast of the text colour against the painted pixel beneath an actual glyph stroke. It is the only figure here that is a finding.',
        'worstInBoxRatio is the same measurement over the whole text rectangle, including the background between letters. It is recorded only to show how far wrong that metric is; a thin bright line crossing a box touches far more gap than ink.',
        'Rects come from text nodes, never from element boxes: an element box includes decorative children, which is how a legend colour swatch was once scored as if it were a letter.',
        'inkCoverage is a tuning constant and it is load-bearing, so it is published beside the numbers it produced. Independent review swept it on one screenshot pair: the reported ratio moves roughly 0.45 for every 0.05 of coverage, and there is no plateau, because at this font size antialiasing leaves no fully-covered glyph interior. The constant slices a continuous ramp rather than separating two populations.',
        'The direction of that bias is conservative, which review established from outside this instrument: a fully-covered glyph pixel must equal the declared text colour composited over the measured backdrop, a value computable from CSS tokens with no screenshot involved, and the measured curve converges to it as coverage approaches 1 (predicted 6.57, 7.66, 7.84 against 6.49, 7.87, 7.77). Admitting pixels down to 85% coverage admits antialiased blends sitting nearer the backdrop, so the figures published here run below the WCAG answer rather than above it. This harness can manufacture a failure; it cannot manufacture a pass.',
        'This measurement gates nothing. e2e/contrast.spec.ts composites background colours and cannot read a canvas, so a palette change or a denser starfield can move these numbers without any gate noticing. Re-run this script when either changes.',
      ],
      environment: {
        commit: git(['rev-parse', 'HEAD']),
        branch: git(['branch', '--show-current']),
        node: process.version,
        platform: `${os.platform()} ${os.release()}`,
        arch: os.arch(),
        cpuModel: cpus[0]?.model ?? 'unknown',
        playwright: require('@playwright/test/package.json').version,
        chromium: browser.version(),
      },
      summary: {
        statesMeasured: states.length,
        runsMeasured: everyRun.length,
        worstInkRatio: worst.worstInkRatio,
        worstInkRun: { selector: worst.selector, text: worst.text, state: states.find((s) => s.runs.includes(worst))?.state ?? null },
        anyInkBelowThreshold: everyRun.some((run) => run.inkBelowThresholdPercent > 0),
      },
      states,
    };

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

    console.log('\nInk contrast over the globe canvas\n');
    for (const state of states) {
      for (const run of state.runs) {
        console.log(
          `  ${state.state.padEnd(11)} ${run.selector.padEnd(22)} ink ${String(run.inkPixels).padStart(5)}px  ` +
            `worst ${String(run.worstInkRatio ?? 'n/a').padStart(5)}:1  below4.5 ${run.inkBelowThresholdPercent ?? 'n/a'}%  ` +
            `(box worst ${run.worstInBoxRatio}:1)`,
        );
      }
    }
    console.log(
      `\n  worst inked pixel anywhere: ${report.summary.worstInkRatio}:1 against a ${THRESHOLD}:1 threshold`,
    );
    // This script gates nothing by design -- ADR 0009 explains why -- but a
    // tick beside a failing ratio is still a lie told to whoever runs it. A
    // known-bad run reported 1.6:1 and signed off with a checkmark.
    if (report.summary.anyInkBelowThreshold) {
      console.log(
        `\n✗ Text over the canvas is below ${THRESHOLD}:1. This script does not fail the build; ` +
          'the finding is real regardless.',
      );
    }
    console.log(`\n✓ Report written to ${displayPath(outPath)}`);
  } finally {
    if (browser) await browser.close();
    cleanup();
  }
}

try {
  await main();
} catch (error) {
  // The guards above raise operator-facing messages; a stack trace buries them.
  console.error(`\n✗ Ink contrast measurement could not run\n\n${error.message}\n`);
  process.exit(1);
}

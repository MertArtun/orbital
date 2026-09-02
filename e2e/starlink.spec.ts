import { expect, test, type Page, type Route } from '@playwright/test';

import { MAX_STARLINK_POINTS } from '../lib/starlink';

/** The recent-epoch element set the other globe specs stub with. */
const ISS_TLE = {
  name: 'ISS (ZARYA)',
  line1: '1 25544U 98067A   26221.47238266  .00004421  00000+0  87174-4 0  9992',
  line2: '2 25544  51.6322  36.3838 0007357  29.0181 331.1215 15.49394423580019',
  noradId: '25544',
};

const LAUNCH = {
  id: 'stub-launch-1',
  name: 'Falcon 9 · Starlink',
  mission: 'Starlink group',
  provider: 'SpaceX',
  rocket: 'Falcon 9',
  padName: 'LC-39A',
  locationName: 'Kennedy Space Center',
  net: new Date(Date.now() + 86_400_000).toISOString(),
  status: 'Go',
  webcastUrl: null,
  imageUrl: null,
  latitude: 28.6084,
  longitude: -80.6043,
};

const ASTROS = { count: 7, people: [{ name: 'Stub Crew', craft: 'ISS' }] };

/** TLE fields are fixed-width columns; splice in place instead of reformatting. */
function splice(line: string, start: number, value: string) {
  return line.slice(0, start) + value + line.slice(start + value.length);
}

/**
 * satellite.js parses column ranges and never reads the trailing checksum, so
 * the fleet below would propagate with a stale digit. It is recomputed anyway:
 * a fixture that is only valid because nothing checks it is a trap for whoever
 * next feeds it through something that does.
 */
function withChecksum(line: string) {
  const body = line.slice(0, 68);
  const sum = [...body].reduce((total, char) => {
    if (char >= '0' && char <= '9') return total + Number(char);
    return char === '-' ? total + 1 : total;
  }, 0);
  return `${body}${sum % 10}`;
}

/** TLE angle format: eight columns, four decimals, space padded. */
const angle = (degrees: number) => degrees.toFixed(4).padStart(8, ' ');

/**
 * A synthetic constellation on the order of the real upstream set. Only the
 * NORAD id, right ascension and mean anomaly move, which spreads the satellites
 * around the shell without inventing an element set SGP4 rejects.
 */
function starlinkFleet(size: number) {
  return Array.from({ length: size }, (_, index) => {
    const noradId = String(44000 + index);
    const raan = angle((index * 360) / size);
    // The golden angle keeps neighbouring ids from sharing a phase.
    const meanAnomaly = angle((index * 137.508) % 360);
    return {
      name: `STARLINK-${1000 + index}`,
      line1: withChecksum(splice(ISS_TLE.line1, 2, noradId)),
      line2: withChecksum(splice(splice(splice(ISS_TLE.line2, 2, noradId), 17, raan), 43, meanAnomaly)),
      noradId,
    };
  });
}

/**
 * Sized so a correct sampler lands exactly on the render budget: 4000 records
 * step by ceil(4000 / 800) = 5 and yield 800. A smaller fleet would pass the
 * cap assertion below without ever reaching it, and would leave the main-thread
 * budget measuring a fraction of the satellites production renders.
 */
const FLEET = starlinkFleet(4_000);

const envelope = (data: unknown) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ ok: true, data, source: 'live', fetchedAt: new Date().toISOString() }),
});

async function stubSpaceData(page: Page) {
  await page.route('**/api/tle/**', (route) => route.fulfill(envelope([ISS_TLE])));
  await page.route('**/api/launches**', (route) => route.fulfill(envelope([LAUNCH])));
  await page.route('**/api/astros**', (route) => route.fulfill(envelope(ASTROS)));
}

/**
 * Registered after the general TLE stub on purpose: Playwright matches the most
 * recently registered route first, so this one wins for the Starlink group.
 */
async function stubStarlink(page: Page, response: Parameters<Route['fulfill']>[0]) {
  await page.route('**/api/tle/starlink**', (route) => route.fulfill(response));
}

/** The launch list also contains "Starlink", so anchor on the control's name. */
const starlinkToggle = (page: Page) => page.getByRole('button', { name: /^Starlink ·/ });

/** The globe only mounts a marker once propagation has produced a position. */
async function waitForIssMarker(page: Page) {
  await page.waitForSelector('.iss-marker', { state: 'attached', timeout: 20_000 });
}

async function enableStarlink(page: Page) {
  const toggle = starlinkToggle(page);
  await toggle.click();
  await expect(toggle).toHaveAccessibleName(/\d+ satellites/, { timeout: 25_000 });
  return toggle;
}

/** Total main-thread blocking observed over `windowMs`, in milliseconds. */
async function longTaskMs(page: Page, windowMs: number) {
  return page.evaluate(async (ms) => {
    let blocked = 0;
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) blocked += entry.duration;
    });
    observer.observe({ entryTypes: ['longtask'] });
    await new Promise((resolve) => setTimeout(resolve, ms));
    observer.disconnect();
    return blocked;
  }, windowMs);
}

test.describe('Starlink layer', () => {
  test.beforeEach(async ({ page }) => {
    await stubSpaceData(page);
    await stubStarlink(page, envelope(FLEET));
  });

  test('stays off, and unfetched, until the visitor asks for it', async ({ page }) => {
    const fetched: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/tle/starlink')) fetched.push(request.url());
    });

    await page.goto('/');
    await waitForIssMarker(page);

    const toggle = starlinkToggle(page);
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(toggle).toHaveAccessibleName(/off/i);

    // A full element set is hundreds of kilobytes. Downloading it for a layer
    // nobody opened is the cost this assertion exists to prevent.
    await page.waitForTimeout(1_500);
    expect(fetched).toEqual([]);
  });

  test('samples the fleet down to the render budget when enabled', async ({ page }) => {
    await page.goto('/');
    await waitForIssMarker(page);

    const toggle = await enableStarlink(page);
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');

    // The control's visible label is its accessible name, so this reads the
    // number a visitor is actually shown.
    const rendered = Number(/(\d+) satellites/.exec((await toggle.textContent()) ?? '')?.[1]);
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThanOrEqual(MAX_STARLINK_POINTS);
    expect(rendered).toBeLessThan(FLEET.length);
  });

  test('adds no horizontal overflow at the enabled state', async ({ page }) => {
    await page.goto('/');
    await waitForIssMarker(page);
    await enableStarlink(page);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('keeps the main thread responsive while the layer runs', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'longtask entries are not observable in WebKit.');
    test.setTimeout(90_000);

    await page.goto('/');
    await waitForIssMarker(page);
    // The cinematic intro tween and the first WebGL frames are main-thread work
    // that belongs to neither window; let them finish before baselining.
    await page.waitForTimeout(3_000);

    const baseline = await longTaskMs(page, 4_000);
    await enableStarlink(page);
    // Measure the steady state: the fetch, the JSON parse and the worker's
    // one-off fleet build are all behind the first rendered batch.
    const enabled = await longTaskMs(page, 4_000);

    // Self-baselining: the machine's own idle globe sets the reference, so this
    // states "propagating 800 satellites costs the main thread almost nothing",
    // not "this CI runner is fast". Four 1Hz ticks land inside the window; each
    // may only rewrite one buffer attribute.
    expect(enabled, `baseline ${baseline.toFixed(0)}ms, enabled ${enabled.toFixed(0)}ms`)
      .toBeLessThan(baseline + 400);
  });

  test('survives a Starlink feed failure without taking the globe down', async ({ page }) => {
    await stubStarlink(page, {
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: 'starlink upstream unavailable' }),
    });

    await page.goto('/');
    await waitForIssMarker(page);

    const toggle = starlinkToggle(page);
    await toggle.click();
    await expect(toggle).toHaveAccessibleName(/unavailable/i, { timeout: 25_000 });

    // The ISS keeps its own feed...
    await expect(page.locator('.iss-marker')).toBeAttached();
    // ...and the control stays operable rather than stuck in a failed state.
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(toggle).toHaveAccessibleName(/off/i);
  });
});

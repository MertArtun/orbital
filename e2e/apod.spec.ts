import { expect, test, type Page } from '@playwright/test';

const ISS_TLE = {
  name: 'ISS (ZARYA)',
  line1: '1 25544U 98067A   26221.47238266  .00004421  00000+0  87174-4 0  9992',
  line2: '2 25544  51.6322  36.3838 0007357  29.0181 331.1215 15.49394423580019',
  noradId: '25544',
};

const ASTROS = { count: 7, people: [{ name: 'Stub Crew', craft: 'ISS' }] };

const LAUNCH = {
  id: 'stub-launch-1',
  name: 'Falcon 9 · Starlink',
  mission: 'Starlink',
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

const IMAGE_URL = 'https://apod.nasa.gov/apod/image/pillars.jpg';
const VIDEO_URL = 'https://www.youtube.com/embed/example';

/** Shape must track lib/types.ts `Apod`. */
const APOD = {
  date: '2026-09-08',
  title: 'Pillars of Creation',
  explanation:
    'The Pillars of Creation stand about five light-years tall inside the Eagle Nebula, columns of cold hydrogen and dust that are slowly being sculpted away by the ultraviolet light of the young stars nearby. Infrared surveys see straight through the opaque towers and reveal the protostars still forming inside them, which is why the region has been imaged repeatedly across four decades of increasingly capable instruments. The pillars are almost certainly gone already: a supernova recorded in the same field would have swept them clear roughly six thousand years ago, and we are simply waiting on the light to arrive.',
  mediaType: 'image',
  url: IMAGE_URL,
  hdUrl: null,
  copyright: 'NASA, ESA',
};

/** A 1x1 PNG, so the card's image request never leaves the machine. */
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGPg4tMAAABmAEGtTrFeAAAAAElFTkSuQmCC',
  'base64',
);

function ok(data: unknown, extra: Record<string, unknown> = {}) {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      data,
      source: 'live',
      fetchedAt: new Date().toISOString(),
      ...extra,
    }),
  };
}

/** Everything the dashboard needs except APOD, which each test stubs itself. */
async function stubDashboard(page: Page) {
  await page.route('**/api/tle/**', (route) => route.fulfill(ok([ISS_TLE])));
  await page.route('**/api/astros**', (route) => route.fulfill(ok(ASTROS)));
  await page.route('**/api/launches**', (route) => route.fulfill(ok([LAUNCH])));
  await page.route('**/apod.nasa.gov/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG }),
  );
}

/** Copied from resilience.spec.ts: our own 503s are the result the test asked for. */
function collectFailures(page: Page) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    if ((message.location()?.url ?? '').includes('/api/')) return;
    consoleErrors.push(message.text());
  });
  return { pageErrors, consoleErrors };
}

function apodPanel(page: Page) {
  return page.locator('.glass-panel', { has: page.locator('#apod-title') });
}

/**
 * The card is mounted below the dashboard grid, so it starts off-screen in both
 * projects. Bringing it into view is what is supposed to start the request.
 */
async function revealCard(page: Page) {
  await page.locator('#apod-title').scrollIntoViewIfNeeded();
}

test.describe('astronomy picture of the day', () => {
  test('defers the request until the card is near the viewport', async ({ page }) => {
    let apodRequests = 0;
    await stubDashboard(page);
    await page.route('**/api/apod**', (route) => {
      apodRequests += 1;
      return route.fulfill(ok(APOD));
    });

    await page.goto('/');
    // The globe is the expensive part of the first viewport. Waiting for the
    // marker means TLE, propagation and the first frame have all happened —
    // if APOD were eager it would have fired long before this point.
    await page.waitForSelector('.iss-marker', { state: 'attached', timeout: 20_000 });
    await page.waitForTimeout(1_500);
    expect(apodRequests).toBe(0);

    await revealCard(page);
    await expect.poll(() => apodRequests, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);

    await expect(page.locator('#apod-title')).toHaveText(APOD.title);
    await expect(apodPanel(page).locator('.status-chip')).toHaveText('LIVE');
  });

  test('keeps the dashboard intact when APOD fails', async ({ page }) => {
    const failures = collectFailures(page);
    await stubDashboard(page);
    await page.route('**/api/apod**', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'apod upstream unavailable' }),
      }),
    );

    await page.goto('/');
    await revealCard(page);

    await expect(page.getByText('Picture of the day unavailable')).toBeVisible();
    // An optional decorative feed failing must cost the mission surfaces nothing.
    await expect(page.locator('.globe-frame')).toBeVisible();
    await expect(page.locator('canvas').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Upcoming missions' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Can you see the ISS?' })).toBeVisible();
    expect(failures.pageErrors).toEqual([]);
    expect(failures.consoleErrors).toEqual([]);
  });

  test('renders a video day as a link, never an embed', async ({ page }) => {
    await stubDashboard(page);
    await page.route('**/api/apod**', (route) =>
      route.fulfill(ok({ ...APOD, mediaType: 'video', url: VIDEO_URL })),
    );

    await page.goto('/');
    await revealCard(page);

    const link = page.getByRole('link', { name: /video/i });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', VIDEO_URL);
    await expect(link).toHaveAttribute('target', '_blank');
    // The point of the test: an upstream URL never becomes a frame in our page.
    await expect(page.locator('iframe')).toHaveCount(0);
  });

  test('stays compact at 375 px with the text expanded', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-375', 'Mobile viewport gate.');
    await stubDashboard(page);
    await page.route('**/api/apod**', (route) => route.fulfill(ok(APOD)));

    await page.goto('/');
    await revealCard(page);

    const toggle = page.getByRole('button', { name: 'Read more' });
    await expect(toggle).toBeVisible();
    await toggle.click();
    // The same control, relabelled — not a second button appearing beside it.
    const expanded = page.getByRole('button', { name: 'Show less' });
    await expect(expanded).toHaveAttribute('aria-expanded', 'true');

    // Six hundred characters of unclamped prose is the widest this card ever
    // gets. If anything is going to push past 375 px, it is this.
    const size = await page.evaluate(() => ({
      body: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    expect(size.body).toBeLessThanOrEqual(size.viewport + 1);

    await expanded.click();
    await expect(page.getByRole('button', { name: 'Read more' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  test('marks a cached day', async ({ page }) => {
    await stubDashboard(page);
    await page.route('**/api/apod**', (route) =>
      route.fulfill(ok(APOD, { source: 'stale-memory', stale: true })),
    );

    await page.goto('/');
    await revealCard(page);

    await expect(page.locator('#apod-title')).toHaveText(APOD.title);
    await expect(apodPanel(page).locator('.status-chip')).toHaveText('CACHED');
  });
});

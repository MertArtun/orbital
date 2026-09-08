import { expect, test, type Page } from '@playwright/test';

/**
 * The recent-epoch element set the other globe specs stub with. Stubbing the
 * upstream keeps these assertions deterministic: the real route waits out a
 * 10s CelesTrak timeout before falling back.
 */
const ISS_TLE = {
  name: 'ISS (ZARYA)',
  line1: '1 25544U 98067A   26221.47238266  .00004421  00000+0  87174-4 0  9992',
  line2: '2 25544  51.6322  36.3838 0007357  29.0181 331.1215 15.49394423580019',
  noradId: '25544',
};

/** Shape must track lib/types.ts `Launch`; a drifted stub renders "undefined". */
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

/** lib/types.ts `AstrosPayload` is an object, not an array. */
const ASTROS = { count: 7, people: [{ name: 'Stub Crew', craft: 'ISS' }] };

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

/** The marker only exists once propagation has produced a position. */
async function waitForIssMarker(page: Page) {
  await page.waitForSelector('.iss-marker', { state: 'attached', timeout: 20_000 });
}

const slider = (page: Page) => page.getByRole('slider', { name: 'Simulated time offset' });

/** The subsolar readout carries the longitude the globe drew the cap around. */
const subsolar = (page: Page) => page.locator('.telemetry-panel [data-subsolar-lng]');

/** The one sentence that explains the sun state; the model caption is its own node. */
const explanation = (page: Page) => page.locator('.telemetry-panel p.max-w-prose');

function readSubsolarLng(page: Page) {
  return subsolar(page).evaluate((element) =>
    Number(element.getAttribute('data-subsolar-lng')),
  );
}

/**
 * Degrees of longitude the subsolar point has travelled west, which is the
 * only direction it travels. Taken modulo 360 so a crossing of the
 * antimeridian — the readout is normalised to [-180, 180) — reads as 22°
 * rather than 338°.
 */
function westward(from: number, to: number) {
  return (((from - to) % 360) + 360) % 360;
}

test.describe('day/night terminator', () => {
  test.beforeEach(async ({ page }) => {
    await stubSpaceData(page);
  });

  test("explains the station's sun state in words", async ({ page }) => {
    await page.goto('/');
    await waitForIssMarker(page);

    // The three shapes describeSunState can take: Earth's shadow, sunlit over
    // night ground (the geometry a visible pass needs), or plain daylight.
    await expect(explanation(page)).toHaveText(/shadow|daylight|visible pass/);
    await expect(subsolar(page)).toHaveText(/SUBSOLAR \d+\.\d+° [NS] · \d+\.\d+° [EW]/);
  });

  test('moves the terminator with the simulated clock', async ({ page }) => {
    await page.goto('/');
    await waitForIssMarker(page);
    await expect(subsolar(page)).toBeVisible();

    const before = await readSubsolarLng(page);
    await slider(page).fill('90');

    // 90 simulated minutes of the Sun's 0.25°/min westward sweep is 22.5° of
    // longitude. The recompute sits behind a 60 s recentre and a 200 ms
    // trailing debounce; a 90-minute jump clears both at once.
    await expect
      .poll(async () => westward(before, await readSubsolarLng(page)), { timeout: 8_000 })
      .toBeGreaterThan(20);
    // And it stops there: a cap drawn for a doubled or unclamped offset would
    // sail past the slider's own bound.
    expect(westward(before, await readSubsolarLng(page))).toBeLessThan(25);
  });

  test('keeps the globe clean with the night cap on', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/');
    await waitForIssMarker(page);
    await expect(subsolar(page)).toBeVisible();

    // Three polygon rebuilds: the cap is re-digested at each end of the range
    // and again on the way back to live.
    const range = slider(page);
    await range.focus();
    await page.keyboard.press('End');
    await expect(range).toHaveValue('90');
    await page.keyboard.press('Home');
    await expect(range).toHaveValue('-90');
    await page.getByRole('button', { name: 'Return to now' }).click();
    await expect(range).toHaveValue('0');
    // The debounce has to run out inside the test, or the rebuild it defers
    // would land after the assertion.
    await page.waitForTimeout(1_000);

    expect(errors).toEqual([]);
  });

  test('adds no horizontal overflow at 375 px', async ({ page }) => {
    await page.goto('/');
    await waitForIssMarker(page);
    await expect(subsolar(page)).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

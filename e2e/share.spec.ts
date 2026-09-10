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
  // The picture of the day is below the fold and lazy, but a scroll or a slow
  // machine can still bring it into its load margin. Refused outright so no
  // test in this file can reach NASA; the panel degrades to its own copy.
  await page.route('**/api/apod**', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: 'apod upstream unavailable' }),
    }),
  );
}

/** The marker only exists once propagation has produced a position. */
async function waitForIssMarker(page: Page) {
  await page.waitForSelector('.iss-marker', { state: 'attached', timeout: 20_000 });
}

const passPanel = (page: Page) =>
  page.locator('.glass-panel', { has: page.locator('#passes-title') });

/**
 * The one node that carries the observer's decimal degrees. The globe HUD
 * prints coordinates too, at two decimals, so this is anchored on the panel.
 */
const coordinates = (page: Page) => passPanel(page).locator('.location-coordinates');

const locationChip = (page: Page) => passPanel(page).locator('.status-chip');

const searchBox = (page: Page) => passPanel(page).getByRole('combobox');

/** Stable across the button's COPY LINK / COPIED states, unlike its name. */
const copyButton = (page: Page) => passPanel(page).locator('button[data-share-url]');

const SYDNEY_LINK = '/?lat=-33.8688&lng=151.2093&place=Sydney';

test.describe('shared observer links', () => {
  test.beforeEach(async ({ page }) => {
    await stubSpaceData(page);
  });

  test('restores the observer a link asks for', async ({ page }) => {
    await page.goto(SYDNEY_LINK);
    await waitForIssMarker(page);

    // The panel's own rendering is toFixed(3), so the link's four decimals are
    // matched as the three the interface actually shows.
    await expect(coordinates(page)).toHaveText(/-33\.869°,\s*151\.209°/);
    await expect(searchBox(page)).toHaveValue('Sydney');
    await expect(locationChip(page)).toHaveText('LINK');
  });

  test('ignores a malformed link and stays on the default', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      // Stubbed upstreams answer 503 on purpose; their fetch failures are the
      // product's degraded path, not a defect in link handling.
      if (message.type() === 'error' && !message.text().includes('/api/')) {
        errors.push(message.text());
      }
    });
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/?lat=91&lng=abc');
    await waitForIssMarker(page);

    await expect(coordinates(page)).toHaveText(/41\.005°,\s*28\.977°/);
    await expect(locationChip(page)).not.toHaveText('LINK');
    expect(errors).toEqual([]);
  });

  test('hands back a link that restores the same observer', async ({ page }) => {
    await page.goto(SYDNEY_LINK);
    await waitForIssMarker(page);
    await expect(locationChip(page)).toHaveText('LINK');

    const shareUrl = await copyButton(page).getAttribute('data-share-url');
    expect(shareUrl).toMatch(/[?&]lat=-33\.8688(&|$)/);
    expect(shareUrl).toContain('place=Sydney');

    // The round trip is the whole promise of the control: what it hands over
    // has to land on the same observer, not merely look like a link.
    await page.goto(shareUrl!);
    await waitForIssMarker(page);
    await expect(coordinates(page)).toHaveText(/-33\.869°,\s*151\.209°/);
    await expect(locationChip(page)).toHaveText('LINK');
  });

  test('keeps the copy control usable and named', async ({ page }) => {
    test.skip(test.info().project.name !== 'mobile-375', 'small-viewport ergonomics');

    await page.goto(SYDNEY_LINK);
    await waitForIssMarker(page);

    const button = copyButton(page);
    const label = (await button.innerText()).trim();
    // WCAG 2.5.3: speech input works only if the spoken visible words are a
    // prefix of the name assistive technology reports.
    await expect(button).toHaveAccessibleName(new RegExp(`^${label}`));

    const box = await button.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('lets the link outrank a browser position', async ({ page, context }) => {
    // The headline decision in ADR 0008: somebody who followed a link to a
    // place must not be moved home by a permission they granted once. Both
    // are available here — the link and a real fix — and the link wins.
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 41.0053, longitude: 28.977 });

    await page.goto(SYDNEY_LINK);
    await waitForIssMarker(page);

    await expect(coordinates(page)).toHaveText(/-33\.869°, 151\.209°/);
    await expect(locationChip(page)).toHaveText('LINK');
    // Long enough that a geolocation callback would have landed and moved it.
    await page.waitForTimeout(1_500);
    await expect(coordinates(page)).toHaveText(/-33\.869°, 151\.209°/);
    await expect(locationChip(page)).toHaveText('LINK');
  });

  test('reveals the link when the clipboard refuses it', async ({ page }) => {
    // An insecure context, a denied permission, or a browser without the API.
    // The link is still the answer, so it has to end up on screen.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: () => Promise.reject(new Error('Write permission denied.')),
        },
      });
    });

    await page.goto(SYDNEY_LINK);
    await waitForIssMarker(page);

    const button = copyButton(page);
    const url = await button.getAttribute('data-share-url');
    await button.click();

    const manual = page.getByLabel(/Share link/i);
    await expect(manual).toBeVisible();
    await expect(manual).toHaveValue(url!);
    // The failure is not dressed up as success.
    await expect(button).toHaveText('COPY LINK');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('copies the link to the clipboard', async ({ page, context }) => {
    test.skip(
      test.info().project.name !== 'desktop-chromium',
      'clipboard permissions are Chromium-only',
    );
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await page.goto(SYDNEY_LINK);
    await waitForIssMarker(page);

    const button = copyButton(page);
    const shareUrl = await button.getAttribute('data-share-url');
    await button.click();

    await expect(button).toHaveText('COPIED');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(shareUrl);
  });

  test('reveals a link to where the visitor is now, not where they were', async ({ page }) => {
    // The refusal path is the only one that puts a link on screen, so it is
    // the only one that can put a stale link on screen. An earlier version
    // stored the URL at the moment of refusal; choosing a city afterwards then
    // left the visitor copying a link back to the place they had just left.
    // Handing over the wrong coordinates is worse than handing over nothing.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: () => Promise.reject(new Error('Write permission denied.')),
        },
      });
    });

    await page.goto(SYDNEY_LINK);
    await waitForIssMarker(page);

    await copyButton(page).click();
    const manual = page.getByLabel(/Share link/i);
    await expect(manual).toHaveValue(/lat=-33\.8688/);

    await searchBox(page).fill('Ankara, Türkiye');
    await expect(coordinates(page)).toHaveText(/39\.921°,\s*32\.854°/);

    // Still revealed, and pointing at the new observer rather than Sydney.
    await expect(manual).toHaveValue(/lat=39\.9208/);
    await expect(manual).not.toHaveValue(/-33\.8688/);
  });

  test('re-arms the COPIED badge when the link is copied again', async ({ page, context }) => {
    test.skip(
      test.info().project.name !== 'desktop-chromium',
      'clipboard permissions are Chromium-only',
    );
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await page.goto(SYDNEY_LINK);
    await waitForIssMarker(page);

    const button = copyButton(page);
    const firstPress = Date.now();
    await button.click();
    await expect(button).toHaveText('COPIED');

    // Press again while the badge is still up. The state behind it counts
    // presses rather than recording a boolean for exactly this reason: setting
    // a boolean that is already true is not a state change, so React re-runs
    // no effect, and the badge would drop 2.5 s after the *first* press with
    // the second press acknowledged by nothing at all.
    await page.waitForTimeout(Math.max(0, firstPress + 1_500 - Date.now()));
    await button.click();

    // Read at a fixed instant rather than through a polling matcher, which
    // would retry until the assertion it is meant to catch came true: 3.2 s
    // after the first press is 700 ms past where a boolean drops the badge and
    // 800 ms short of where the counter does. A loaded machine only fires the
    // timer later, so the failure mode of this margin is a missed regression
    // rather than a flake.
    await page.waitForTimeout(Math.max(0, firstPress + 3_200 - Date.now()));
    expect(
      (await button.innerText()).trim(),
      'The COPIED badge expired on the first press instead of restarting on the second',
    ).toBe('COPIED');

    // ...and it is still a badge that expires, not one that sticks.
    await expect(button).toHaveText('COPY LINK', { timeout: 4_000 });
  });
});

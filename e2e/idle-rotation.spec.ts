import { expect, test, type Page } from '@playwright/test';

/**
 * The recent-epoch element set the other globe specs stub with. Here the TLE
 * response is held back on purpose: the behaviour under test is what the globe
 * does before the first orbital fix exists.
 */
const ISS_TLE = {
  name: 'ISS (ZARYA)',
  line1: '1 25544U 98067A   26221.47238266  .00004421  00000+0  87174-4 0  9992',
  line2: '2 25544  51.6322  36.3838 0007357  29.0181 331.1215 15.49394423580019',
  noradId: '25544',
};

const ASTROS = { count: 7, people: [{ name: 'Stub Crew', craft: 'ISS' }] };

const envelope = (data: unknown) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ ok: true, data, source: 'live', fetchedAt: new Date().toISOString() }),
});

/**
 * Every feed answers at once except the TLE, which waits for `release()`. An
 * empty launch list keeps the globe free of labels, so the only thing that can
 * change between two frames of the idle scene is the camera.
 */
async function stubWithHeldTle(page: Page) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/launches**', (route) => route.fulfill(envelope([])));
  await page.route('**/api/astros**', (route) => route.fulfill(envelope(ASTROS)));
  await page.route('**/api/apod**', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false}' }),
  );
  await page.route('**/api/tle/**', async (route) => {
    await released;
    await route.fulfill(envelope([ISS_TLE]));
  });
  return release;
}

/** The scene container reports what the effect decided, not what we hope it did. */
const scene = (page: Page) => page.locator('[data-auto-rotate]');

/**
 * Resolves once both globe textures have finished downloading. Sampling the
 * canvas earlier compares a half-textured frame with a textured one and reads
 * as motion whether the camera moved or not; register it before goto.
 */
function texturesLoaded(page: Page) {
  return Promise.all(
    ['earth-night.jpg', 'earth-topology.png'].map((file) =>
      page.waitForResponse((response) => response.url().includes(file)).then((r) => r.finished()),
    ),
  );
}

/**
 * Two captures of the WebGL canvas a second apart, once the idle scene has
 * settled. Measured against a still globe, frames keep changing for about six
 * seconds after the textures land — GPU upload, the terminator's arrival and
 * the paths layer's one-second transition — and are identical from then on.
 * After that, a rotating globe cannot produce identical frames and a still
 * one cannot produce different ones: the marker, its rings and the dashed
 * track only exist once a position does, and the terminator — drawn without
 * a position — is next rebuilt a full minute of simulated time after the
 * first one, well outside the ten seconds these tests run for. (Freezing the
 * page clock to rule it out was tried and broke the page's data flow.)
 */
async function canvasMoved(page: Page, textures: Promise<unknown>) {
  await textures;
  await page.waitForTimeout(6_500);
  const canvas = page.locator('canvas').first();
  // An element screenshot is a slice of the composited page, so the HUD that
  // sits over the canvas is in it too — and its LIVE chip pulses. Masking the
  // HUD leaves the WebGL frame as the only thing that can differ.
  const options = { mask: [page.locator('.globe-hud')], animations: 'disabled' as const };
  const before = await canvas.screenshot(options);
  await page.waitForTimeout(1_200);
  const after = await canvas.screenshot(options);
  return Buffer.compare(before, after) !== 0;
}

test.describe('idle globe rotation', () => {
  test('turns the globe while no ISS position is available', async ({ page }) => {
    await stubWithHeldTle(page);
    const textures = texturesLoaded(page);
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible();

    // Behaviour first, bookkeeping second: a globe that does not move fails
    // here whether or not the effect ever reported anything.
    expect(await canvasMoved(page, textures)).toBe(true);
    await expect(scene(page)).toHaveAttribute('data-auto-rotate', 'true');
  });

  test('stops turning once the first position arrives', async ({ page }) => {
    const release = await stubWithHeldTle(page);
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible();
    await expect(scene(page)).toHaveAttribute('data-auto-rotate', 'true');

    release();
    await page.waitForSelector('.iss-marker', { state: 'attached', timeout: 20_000 });
    await expect(scene(page)).toHaveAttribute('data-auto-rotate', 'false');
  });

  test('never turns under reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await stubWithHeldTle(page);
    const textures = texturesLoaded(page);
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible();

    await expect(scene(page)).toHaveAttribute('data-auto-rotate', 'false');
    expect(await canvasMoved(page, textures)).toBe(false);
  });
});

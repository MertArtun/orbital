import { expect, test, type Page } from '@playwright/test';

/**
 * A TLE with a recent epoch so SGP4 returns a plausible LEO state for "now".
 * Stubbing the upstream keeps these assertions deterministic: the real route
 * waits out a 10s CelesTrak timeout before falling back, which would otherwise
 * make every globe assertion a race against that timer.
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
const ASTROS = {
  count: 7,
  people: [{ name: 'Stub Crew', craft: 'ISS' }],
};

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

test.describe('cinematic ISS globe', () => {
  test.beforeEach(async ({ page }) => {
    await stubSpaceData(page);
  });

  test('globe is the dominant element in the first viewport', async ({ page }) => {
    await page.goto('/');
    const frame = page.locator('.globe-frame');
    await expect(frame).toBeVisible();

    const metrics = await page.evaluate(() => {
      const rect = document.querySelector('.globe-frame')!.getBoundingClientRect();
      const visibleHeight = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
      return {
        share: (rect.width * visibleHeight) / (innerWidth * innerHeight),
        top: rect.top,
        viewportHeight: innerHeight,
      };
    });

    // It must be above the fold and own most of the first screen.
    expect(metrics.top).toBeLessThan(metrics.viewportHeight * 0.25);
    expect(metrics.share).toBeGreaterThan(0.4);
  });

  test('react-globe.gl never server-renders a WebGL canvas', async ({ page }) => {
    const response = await page.goto('/');
    const html = await response!.text();

    // ssr:false means the scene must not appear in the server payload at all.
    expect(html).not.toContain('<canvas');
    // ...but the client must still hydrate one.
    await expect(page.locator('canvas').first()).toBeVisible();
  });

  test('renders an accessible ISS marker once telemetry arrives', async ({ page }) => {
    await page.goto('/');
    await waitForIssMarker(page);

    const marker = page.locator('.iss-marker');
    await expect(marker).toHaveAttribute('aria-label', /ISS/i);
    expect(await marker.evaluate((el) => el.tagName)).toBe('BUTTON');
  });

  test('ISS marker interpolates between 1Hz propagation updates', async ({ page }) => {
    await page.goto('/');
    await waitForIssMarker(page);

    // The cinematic intro flies the camera for ~2s after the first fix, and a
    // moving camera re-projects the marker every frame. Sampling through it
    // measures camera motion, not marker interpolation, and passes even against
    // the snap-per-tick bug this test exists to catch. Wait it out first.
    await page.waitForTimeout(2_600);

    // three-globe writes the screen position onto the marker element itself, so
    // that is the node to measure — its wrapper stays at transform:none.
    const samples = await page.evaluate(async () => {
      const readTransform = () => {
        const el = document.querySelector('.iss-marker') as HTMLElement | null;
        return el ? getComputedStyle(el).transform : '';
      };
      const seen: string[] = [];
      for (let i = 0; i < 20; i += 1) {
        seen.push(readTransform());
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      return seen;
    });

    // The criterion is "moves more often than telemetry arrives". The window
    // spans ~3 propagation ticks, so snapping can produce at most ~4 distinct
    // positions no matter how fast the renderer is, while a tween produces one
    // per rendered frame. Asserting well above the tick count states that
    // directly instead of encoding one machine's frame rate: the marker's
    // on-screen travel here is sub-pixel, so the raw sample count is
    // renderer-dependent (12 on macOS Chromium, 5 on headless Linux WebKit over
    // a 1.2s window) and a threshold tuned to either one is a CI flake.
    const distinct = new Set(samples.filter(Boolean));
    expect(distinct.size).toBeGreaterThan(6);
  });

  test('clicking the ISS marker brings telemetry into view', async ({ page }) => {
    await page.goto('/');
    await waitForIssMarker(page);

    // Hit-test the marker's centre rather than using locator.click(). The marker
    // now moves continuously, which Playwright's "stable" heuristic never
    // accepts, but a slowly drifting target is perfectly clickable for a real
    // user. elementFromPoint still proves the click lands on the marker and not
    // on the WebGL canvas stacked over it.
    const hit = await page.evaluate(() => {
      const marker = document.querySelector('.iss-marker') as HTMLElement | null;
      if (!marker) return null;
      const rect = marker.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const topMost = document.elementFromPoint(x, y);
      return { x, y, reaches: marker.contains(topMost) || topMost === marker };
    });

    expect(hit).not.toBeNull();
    expect(hit!.reaches).toBe(true);

    await page.mouse.click(hit!.x, hit!.y);
    // The telemetry panel's own labelled heading, not a text guess.
    const telemetry = page.locator('#iss-telemetry-title');
    await expect(telemetry).toBeInViewport({ timeout: 5_000 });
  });

  test('selecting a launch focuses the globe on its pad', async ({ page }) => {
    await page.goto('/');
    await waitForIssMarker(page);

    const focusEvents = await page.evaluate(() => {
      (window as unknown as { __focus: unknown[] }).__focus = [];
      window.addEventListener('orbital:focus-launch', (event) => {
        (window as unknown as { __focus: unknown[] }).__focus.push(
          (event as CustomEvent).detail,
        );
      });
      return true;
    });
    expect(focusEvents).toBe(true);

    await page.getByRole('button', { name: /Falcon 9/i }).first().click();

    await expect
      .poll(async () =>
        page.evaluate(() => (window as unknown as { __focus: unknown[] }).__focus.length),
      )
      .toBeGreaterThan(0);
  });

  test('honours reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await waitForIssMarker(page);

    // The global reduced-motion rule must actually reach the marker's halo,
    // which is the one continuously animating element on the globe.
    const duration = await page.evaluate(() => {
      const halo = document.querySelector('.iss-marker__halo');
      return halo ? getComputedStyle(halo).animationDuration : null;
    });
    expect(duration).not.toBeNull();
    expect(Number.parseFloat(duration!)).toBeLessThan(0.05);
  });

  test('attaches the marker when the TLE lands during the globe build-in', async ({ page }) => {
    // The marker is a CSS2DObject, and CSS2DRenderer only appends its element
    // to the DOM while the object is visible. three-globe hides HTML elements
    // it judges to be behind the globe with a checker that, on first use,
    // memoises the camera position transformed into the globe group's local
    // frame, and that is rebuilt only when the camera moves. Its default
    // build-in spins that group a full turn over 1.2 s, so a first use during
    // the spin captures the camera in a rotated frame: the marker is judged
    // against a camera that is up to 180 degrees of longitude away, classed as
    // behind the globe, and never attaches.
    //
    // Reduced motion is the exposed path: its camera stops after one
    // pointOfView call, so the stale checker is never replaced. The animated
    // intro re-tweens the camera for 1.8 s and rebuilds the checker every
    // frame, which is why only this path was flaky in CI.
    //
    // Two things make the reproduction deterministic. The page clock is
    // shifted so the ISS sits on the equator, where a rotated frame hides the
    // marker for roughly 45-360 ms of the spin; near the orbit's 51.6 degree
    // latitude limit the same geometry hides it for only ~100 ms, which is why
    // the bug came and went with the time of day. The TLE is then released
    // 60 ms after the globe texture finishes, which lands the marker's first
    // digest in the middle of that window.
    //
    // Only WebKit (mobile-375) reproduces the failure before the fix. On
    // headless Chromium a PerformanceObserver('longtask') shows the first WebGL
    // frame holding the main thread for ~400 ms right after the texture loads,
    // so the marker's digest cannot run until the spin has left the window;
    // that project passes this test with or without the fix.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript((target: number) => {
      const RealDate = Date;
      const offset = target - RealDate.now();
      class ShiftedDate extends RealDate {
        constructor(...args: []) {
          if (args.length === 0) super(RealDate.now() + offset);
          else super(...args);
        }
        static override now() {
          return RealDate.now() + offset;
        }
      }
      window.Date = ShiftedDate as DateConstructor;
    }, Date.UTC(2026, 7, 9, 12, 6, 35)); // ISS_TLE puts the ISS at lat 0.0, lng 76.5 here

    const textureLoaded = page
      .waitForResponse((response) => response.url().includes('earth-night.jpg'))
      .then((response) => response.finished());
    await page.route('**/api/tle/**', async (route) => {
      await textureLoaded;
      await new Promise((resolve) => setTimeout(resolve, 60));
      await route.fulfill(envelope([ISS_TLE]));
    });

    await page.goto('/');
    await waitForIssMarker(page);
  });

  test('produces no hydration or console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/');
    await waitForIssMarker(page);

    const hydration = errors.filter((text) => /hydrat|did not match|mismatch/i.test(text));
    expect(hydration).toEqual([]);
    expect(errors).toEqual([]);
  });
});

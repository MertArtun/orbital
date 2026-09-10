import { expect, test, type Page } from '@playwright/test';

/**
 * The recent-epoch element set the other globe specs stub with. Copied from
 * e2e/time-control.spec.ts rather than imported: a fixture shared across specs
 * couples them, and stubbing the upstream is what keeps these assertions
 * deterministic -- the real route waits out a 10s CelesTrak timeout before it
 * falls back, which would put every camera measurement in a race with a timer.
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
  // The picture of the day is decorative, lazy and rate limited. Refusing it
  // keeps NASA out of a spec about the camera, and proves the intro is
  // indifferent to a failing optional feed.
  await page.route('**/api/apod**', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false}' }),
  );
}

/**
 * Holds the TLE back until `release()`. Adapted from e2e/idle-rotation.spec.ts,
 * for a different reason: this spec measures how long the camera moves for
 * after the first fix, and the first fix has to land on a renderer that is
 * already warm. Released cold, the marker's first digest queues behind the
 * texture upload and the first WebGL frame -- a main-thread block of roughly
 * 400 ms on Chromium, per the note in e2e/globe.spec.ts -- and can enter the
 * DOM anywhere up to a second and a half into an intro it is supposed to be
 * measuring. Registered after the general stub on purpose: Playwright matches
 * the most recently registered route first.
 */
async function holdTle(page: Page) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/tle/**', async (route) => {
    await released;
    await route.fulfill(envelope([ISS_TLE]));
  });
  return release;
}

/** Resolves once both globe textures have finished downloading. */
function texturesLoaded(page: Page) {
  return Promise.all(
    ['earth-night.jpg', 'earth-topology.png'].map((file) =>
      page.waitForResponse((response) => response.url().includes(file)).then((r) => r.finished()),
    ),
  );
}

/** The marker only exists once propagation has produced a position. */
async function waitForIssMarker(page: Page) {
  await page.waitForSelector('.iss-marker', { state: 'attached', timeout: 20_000 });
}

/** The scene container reports what the effects decided, not what we hope. */
const scene = (page: Page) => page.locator('[data-auto-rotate]');

type Sample = { t: number; x: number | null; y: number | null; rotating: string | null };

/**
 * The ISS marker's screen position, every `interval` ms.
 *
 * The marker is the probe because three-globe writes the projected position
 * onto that element, so it is the only thing in the DOM that says where the
 * camera is looking; the canvas moves for the rings and the dashed track
 * whether or not the camera does, so it cannot tell an approach from a still
 * scene. It is not a *pure* camera probe -- the station moves too, and
 * `htmlTransitionDuration` tweens it between 1 Hz fixes -- so the assertions
 * below are distances in pixels rather than string equality: the intro sweeps
 * the marker across tens to hundreds of pixels, while a settled camera leaves
 * only the station's own travel, which is well under a pixel per second at
 * this zoom. Its box is a fixed 36px and the pulsing halo is absolutely
 * positioned inside it, so the rect measures position and nothing else.
 *
 * A marker the camera has swung behind the globe is detached from the CSS2D
 * layer and reads as null; those samples are dropped rather than counted as a
 * position of zero.
 */
function sampleMarker(page: Page, duration: number): Promise<Sample[]> {
  return page.evaluate(
    ({ duration }) =>
      // One sample per rendered frame, resolved from inside the frame loop.
      // An earlier version awaited setTimeout between samples: when this
      // machine is busy enough for the page's timer queue to fall seconds
      // behind -- several Playwright projects at once will do it -- that loop
      // outlived the test timeout and failed a passing intro. requestAnimation
      // Frame cannot outrun the renderer it is measuring, and if frames stop
      // arriving the deadline below ends the sampling with what it has rather
      // than hanging.
      new Promise<Sample[]>((resolve) => {
        const samples: Sample[] = [];
        const started = performance.now();
        const step = () => {
          const marker = document.querySelector('.iss-marker');
          const rect = marker?.getBoundingClientRect();
          samples.push({
            t: performance.now() - started,
            x: rect ? rect.left + rect.width / 2 : null,
            y: rect ? rect.top + rect.height / 2 : null,
            rotating:
              document.querySelector('[data-auto-rotate]')?.getAttribute('data-auto-rotate') ?? null,
          });
          if (performance.now() - started >= duration) resolve(samples);
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
        // A tab that stops painting stops calling rAF; end on time regardless.
        setTimeout(() => resolve(samples), duration + 2_000);
      }),
    { duration },
  );
}

type Located = { t: number; x: number; y: number; rotating: string | null };

const located = (samples: Sample[]): Located[] =>
  samples.filter((sample): sample is Located => sample.x !== null && sample.y !== null);

const distance = (a: Located, b: Located) => Math.hypot(a.x - b.x, a.y - b.y);

/** An index read the compiler cannot know is safe, made safe. */
function required(sample: Located | undefined, what: string): Located {
  if (!sample) throw new Error(`No sample located the ISS marker ${what}`);
  return sample;
}

test.describe('cinematic intro', () => {
  // The camera windows here are measured in real seconds on a machine that may
  // be running several browser projects at once; the default 30 s leaves no
  // room for a slow first WebGL frame on top of them.
  test.setTimeout(90_000);

  test.beforeEach(async ({ page }) => {
    await stubSpaceData(page);
  });

  test('flies the camera in once and settles', async ({ page }) => {
    const release = await holdTle(page);
    const textures = texturesLoaded(page);
    await page.goto('/');
    await textures;
    await page.waitForTimeout(1_000);

    // On a warm renderer the marker enters the DOM within a frame or two of
    // the first fix, so sampling from here measures the same window that
    // e2e/globe.spec.ts and e2e/a11y.spec.ts wait 2.6 s to clear.
    release();
    await waitForIssMarker(page);
    const samples = located(await sampleMarker(page, 3_400));

    expect(samples.length).toBeGreaterThan(15);
    const settled = required(samples.at(-1), 'as the camera settled');

    // An approach happened rather than a nudge: the marker is carried about
    // 90px across both viewports, so 20 is far outside the station's own
    // travel and far inside the shot.
    const travelled = Math.max(...samples.map((sample) => distance(sample, settled)));
    expect(
      travelled,
      `The camera barely moved: furthest excursion from where it settled was ${travelled.toFixed(1)}px`,
    ).toBeGreaterThan(20);

    // Still flying a second in -- an approach, not a cut. Measured across a
    // 600ms window rather than between two adjacent samples so the assertion
    // does not encode one machine's sampling rate.
    const midFlight = samples.filter((sample) => sample.t >= 700 && sample.t <= 1_300);
    const first = required(midFlight.at(0), 'a second into the intro');
    const still = Math.max(...midFlight.map((sample) => distance(sample, first)));
    expect(still, 'The camera had already stopped a second in').toBeGreaterThan(8);

    // ...and it is over inside the ceiling the other specs depend on. Fixes
    // keep arriving at 1 Hz across this window, so a still tail also says the
    // intro is one-time: nothing restarts it.
    const tail = samples.filter((sample) => sample.t >= 2_600);
    expect(tail.length).toBeGreaterThan(3);
    const drift = Math.max(...tail.map((sample) => distance(sample, settled)));
    expect(drift, `The camera was still moving 2.6s in, by ${drift.toFixed(1)}px`).toBeLessThan(2);
  });

  test('settles on a linked observer when one is given', async ({ page }) => {
    // Sydney: far enough from the ISS ground track at any instant that the
    // wrong branch could never be mistaken for the right one.
    await page.goto('/?lat=-33.8688&lng=151.2093');
    await waitForIssMarker(page);

    // Asserted on the branch the scene reports rather than on pixels: where a
    // camera "is" is a projection, and a test that reads one is a test of the
    // renderer's arithmetic.
    await expect(scene(page)).toHaveAttribute('data-intro-focus', 'observer');
  });

  test('makes no camera transition under reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await waitForIssMarker(page);

    // Read without polling, the instant the marker exists: under reduced
    // motion the camera is placed synchronously with the first fix, so the
    // branch is already recorded here. This is the assertion that keeps the
    // P2-00 guard armed -- e2e/globe.spec.ts's build-in test only exposes the
    // marker-attachment defect because that single pointOfView lands inside
    // three-globe's 1.2 s build-in spin. Defer it behind a timer and this
    // fails, before the other test quietly stops guarding.
    expect(
      await scene(page).getAttribute('data-intro-focus'),
      'The reduced-motion camera was placed on a timer rather than with the first fix',
    ).toBe('iss');
    await expect(scene(page)).toHaveAttribute('data-intro-focus', 'iss');
    const samples = located(await sampleMarker(page, 1_200));

    expect(samples.length).toBeGreaterThan(8);
    const first = required(samples.at(0), 'under reduced motion');
    const moved = Math.max(...samples.map((sample) => distance(sample, first)));
    expect(moved, `The camera transitioned by ${moved.toFixed(1)}px under reduced motion`).toBeLessThan(2);

    // The P2-04 guard, across the whole window rather than at its ends: an
    // idle rotation under reduced motion is both the wrong behaviour and what
    // would mask the P2-00 marker defect.
    expect(samples.filter((sample) => sample.rotating !== 'false')).toEqual([]);
  });

  test('produces no console or page errors during the intro', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/');
    await waitForIssMarker(page);
    await page.waitForTimeout(2_600);

    expect(errors).toEqual([]);
  });
});

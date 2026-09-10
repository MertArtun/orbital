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
      // On a fixed interval, not once per rendered frame. An earlier version
      // sampled from inside requestAnimationFrame, on the reasoning that it
      // cannot outrun the renderer it is measuring -- true, and exactly the
      // problem: it cannot outrun a *slow* one either. CI's software renderer
      // draws this globe at about three frames a second against sixty here,
      // so every "did we sample enough" check became an assertion about the
      // machine rather than about the camera, and the suite failed there
      // while passing everywhere else. A 50 ms interval samples the same
      // painted positions at a density nothing in the renderer controls;
      // between two frames it simply reads the same rectangle twice, which no
      // assertion below is sensitive to. (The version before that awaited a
      // timeout between samples and could outlive the test timeout on a busy
      // machine, because each late sample delayed the next. A fixed interval
      // with the deadline below does not compound that way.)
      new Promise<Sample[]>((resolve) => {
        const samples: Sample[] = [];
        const started = performance.now();
        // The window is measured from the marker's first appearance, not from
        // the call. Sampling has to begin before the marker exists to catch
        // the fix that creates it, but a renderer slow enough to take a second
        // over that first frame would otherwise spend the window waiting
        // rather than measuring.
        let appeared: number | null = null;
        const take = () => {
          const marker = document.querySelector('.iss-marker');
          const rect = marker?.getBoundingClientRect();
          const now = performance.now();
          if (rect && appeared === null) appeared = now;
          samples.push({
            t: now - started,
            x: rect ? rect.left + rect.width / 2 : null,
            y: rect ? rect.top + rect.height / 2 : null,
            rotating:
              document.querySelector('[data-auto-rotate]')?.getAttribute('data-auto-rotate') ?? null,
          });
          if (appeared !== null && now - appeared >= duration) stop();
        };
        const interval = setInterval(take, 50);
        const deadline = setTimeout(() => stop(), duration + 6_000);
        function stop() {
          clearInterval(interval);
          clearTimeout(deadline);
          resolve(samples);
        }
        take();
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

/**
 * Asserts the sampler ran across the whole window, rather than asserting a
 * sample count. Count is a proxy for coverage that encodes a frame rate: this
 * machine renders the globe at 60 fps and CI's software renderer at about
 * three, so a count that reads "we measured properly" here reads "the browser
 * is broken" there. What the assertions below actually need is that the last
 * sample lands near the end of the window and that there are enough of them
 * to take a maximum over.
 */
function covered(samples: Located[], duration: number, least: number): Located[] {
  expect(
    samples.length,
    `The marker was located ${samples.length} times in ${duration} ms — too few to measure anything`,
  ).toBeGreaterThanOrEqual(least);
  const first = required(samples.at(0), 'at the start of the sampling window');
  const last = required(samples.at(-1), 'at the end of the sampling window');
  const span = last.t - first.t;
  expect(
    span,
    `Sampling covered ${Math.round(span)} ms of the ${duration} ms window`,
  ).toBeGreaterThan(duration - 500);
  return samples;
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

    // Sampling starts with the release rather than after the marker is found,
    // and every window below is measured from the marker's first appearance
    // rather than from the start of sampling. The intro's own clock starts at
    // the first fix, and the marker appears at that same fix; waiting for it
    // first and then measuring from there folds the marker's attach latency
    // into every window, which on a slow renderer is enough to push the
    // mid-flight window past the end of a flight that has already happened.
    // Samples taken before the marker exists carry no position and `located`
    // drops them, so the first surviving sample is the fix.
    release();
    const sampling = sampleMarker(page, 3_600);
    await waitForIssMarker(page);
    const samples = covered(located(await sampling), 3_600, 8);

    const fix = required(samples.at(0), 'when the marker first appeared').t;
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
    // window rather than between two adjacent samples so the assertion does
    // not encode a sampling rate, and the window sits inside the flight,
    // which runs from 200 ms to 2200 ms after the fix.
    const midFlight = samples.filter((sample) => sample.t >= fix + 400 && sample.t <= fix + 1_600);
    expect(midFlight.length, 'Nothing was sampled mid-flight').toBeGreaterThanOrEqual(2);
    const first = required(midFlight.at(0), 'a second into the intro');
    const still = Math.max(...midFlight.map((sample) => distance(sample, first)));
    expect(still, 'The camera had already stopped a second in').toBeGreaterThan(8);

    // ...and it is over inside the ceiling the other specs depend on. Fixes
    // keep arriving at 1 Hz across this window, so a still tail also says the
    // intro is one-time: nothing restarts it. Bounded at the far end as well,
    // because the station's own travel would eventually exceed the threshold.
    const tail = samples.filter((sample) => sample.t >= fix + 2_600 && sample.t <= fix + 3_400);
    expect(tail.length, 'Nothing was sampled after the intro should have ended').toBeGreaterThanOrEqual(2);
    const rest = required(tail.at(-1), 'at the end of the settled tail');
    const drift = Math.max(...tail.map((sample) => distance(sample, rest)));
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

    // The branch, and only the branch. An earlier version of this line read
    // the attribute without polling and claimed that made it a timing guard
    // too -- that the P2-00 build-in test could not quietly stop guarding
    // while this passed. Measured, it is not: reintroduce the deferral and
    // this still passes 10 times out of 10, because the marker can take
    // longer to attach than the 200 ms hold being detected. What the camera
    // is pointed at is assertable from here; when it was pointed is not, and
    // lib/globeIntro.test.ts holds that line instead.
    await expect(scene(page)).toHaveAttribute('data-intro-focus', 'iss');
    const samples = covered(located(await sampleMarker(page, 1_200)), 1_200, 3);
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

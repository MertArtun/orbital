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

/** TLE fields are fixed-width columns; splice in place instead of reformatting. */
function splice(line: string, start: number, value: string) {
  return line.slice(0, start) + value + line.slice(start + value.length);
}

/** satellite.js never reads the checksum, but a fixture nothing checks is a trap. */
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
 * Copied from starlink.spec.ts rather than imported: a fixture shared across
 * specs couples them, and the sizing rationale differs. That spec needs 4000
 * records to reach the render budget; this one only needs the worker to be
 * running and ticking, so it uses a fleet small enough to build in well under
 * a second and leave the timing assertions room.
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
      line2: withChecksum(
        splice(splice(splice(ISS_TLE.line2, 2, noradId), 17, raan), 43, meanAnomaly),
      ),
      noradId,
    };
  });
}

const FLEET = starlinkFleet(240);

const envelope = (data: unknown) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ ok: true, data, source: 'live', fetchedAt: new Date().toISOString() }),
});

async function stubSpaceData(page: Page) {
  await page.route('**/api/tle/**', (route) => route.fulfill(envelope([ISS_TLE])));
  await page.route('**/api/launches**', (route) => route.fulfill(envelope([LAUNCH])));
  await page.route('**/api/astros**', (route) => route.fulfill(envelope(ASTROS)));
  // Registered after the general TLE stub on purpose: Playwright matches the
  // most recently registered route first, so this one wins for the group.
  await page.route('**/api/tle/starlink**', (route) => route.fulfill(envelope(FLEET)));
}

/** The marker only exists once propagation has produced a position. */
async function waitForIssMarker(page: Page) {
  await page.waitForSelector('.iss-marker', { state: 'attached', timeout: 20_000 });
}

const group = (page: Page) => page.getByRole('group', { name: 'Simulated time' });
const slider = (page: Page) => page.getByRole('slider', { name: 'Simulated time offset' });

/**
 * The offset readout is the control's <output>, which carries the status role.
 * The globe legend also renders "+45 MIN" and the step buttons render
 * "−10 MIN", so a bare text lookup would match the wrong node.
 */
const offsetReadout = (page: Page) => group(page).getByRole('status');

/** The HUD chip, not the control's own — they carry different words for live. */
const hudChip = (page: Page) => page.locator('.globe-hud--top .status-chip');

/** The launch list also contains "Starlink", so anchor on the control's name. */
const starlinkToggle = (page: Page) => page.getByRole('button', { name: /^Starlink ·/ });

async function enableStarlink(page: Page) {
  const toggle = starlinkToggle(page);
  await toggle.click();
  await expect(toggle).toHaveAccessibleName(/\d+ satellites/, { timeout: 25_000 });
}

/** The instant the globe frame is currently rendering, and its drift from now. */
function readSimulatedAt(page: Page) {
  return page.evaluate(() => {
    const frame = document.querySelector('.globe-frame')!;
    const value = Number(frame.getAttribute('data-simulated-at'));
    return { value, drift: value - Date.now() };
  });
}

test.describe('simulated time control', () => {
  test.beforeEach(async ({ page }) => {
    await stubSpaceData(page);
  });

  test('exposes accessible ±90 minute controls', async ({ page }) => {
    await page.goto('/');
    await waitForIssMarker(page);

    const range = slider(page);
    await expect(range).toHaveAttribute('min', '-90');
    await expect(range).toHaveAttribute('max', '90');

    await expect(page.getByRole('button', { name: 'Rewind 10 minutes' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Advance 10 minutes' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Return to now' })).toBeVisible();

    // The keyboard path is the whole point of using a native range input.
    await range.focus();
    await page.keyboard.press('End');
    await expect(range).toHaveValue('90');
    await expect(offsetReadout(page)).toHaveText('+90 MIN');
    await expect(range).toHaveAttribute('aria-valuetext', '90 minutes ahead');

    // At the bound the step button is announced as disabled but stays in the
    // tab order and does nothing: a natively disabled button would throw a
    // keyboard user who had just pressed it back to the top of the document.
    // Pressed from the keyboard: Playwright's click() honours aria-disabled
    // and would wait for the button to become enabled, which is the point.
    const advance = page.getByRole('button', { name: 'Advance 10 minutes' });
    await expect(advance).toHaveAttribute('aria-disabled', 'true');
    await advance.focus();
    await expect(advance).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(range).toHaveValue('90');
    await expect(advance).toBeFocused();

    await range.focus();
    await page.keyboard.press('Home');
    await expect(range).toHaveValue('-90');
    await expect(range).toHaveAttribute('aria-valuetext', '90 minutes behind');

    // A control that only fits by pushing the page sideways is not responsive.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('scrubs the ISS and the chip to the simulated instant', async ({ page }) => {
    await page.goto('/');
    await waitForIssMarker(page);

    // three-globe writes the screen position onto the marker element itself.
    // A marker the scrub has swung behind the globe is detached from the CSS2D
    // layer, which reads as null here — also a change of position, so the
    // assertion below stays honest either way.
    const markerTransform = () =>
      page.evaluate(() => {
        const marker = document.querySelector('.iss-marker');
        return marker ? getComputedStyle(marker).transform : null;
      });
    const live = await markerTransform();
    expect(live).not.toBeNull();

    await slider(page).fill('90');
    await expect(slider(page)).toHaveValue('90');

    const simulated = await page.evaluate(() => {
      const value = Number(document.querySelector('.globe-frame')!.getAttribute('data-simulated-at'));
      return value - (Date.now() + 90 * 60_000);
    });
    expect(Math.abs(simulated)).toBeLessThan(5_000);

    await expect(hudChip(page)).toHaveText('SIMULATED');

    // The attribute and the marker's propagation land in consecutive renders,
    // so this is the state they settle in rather than a single sample.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const frame = document.querySelector('.globe-frame')!;
            const propagated = frame
              .querySelector('[data-propagated-at]')
              ?.getAttribute('data-propagated-at');
            return propagated
              ? Date.parse(propagated) === Number(frame.getAttribute('data-simulated-at'))
              : false;
          }),
        { timeout: 8_000 },
      )
      .toBe(true);

    await expect.poll(markerTransform, { timeout: 8_000 }).not.toBe(live);
  });

  test('returns to now and keeps the live clock ticking', async ({ page }) => {
    await page.goto('/');
    await waitForIssMarker(page);

    await slider(page).fill('90');
    await expect(hudChip(page)).toHaveText('SIMULATED');

    // Activated from the keyboard on purpose: the button becomes inert the
    // instant it succeeds, and focus has to survive that.
    const reset = page.getByRole('button', { name: 'Return to now' });
    await reset.focus();
    await page.keyboard.press('Enter');

    await expect(hudChip(page)).toHaveText('1 HZ LIVE');
    await expect(offsetReadout(page)).toHaveText('LIVE');
    await expect(reset).toHaveAttribute('aria-disabled', 'true');
    await expect(reset).toBeFocused();

    // Returning to now must restart the clock, not freeze it at the instant of
    // the press: the simulated timestamp has to keep advancing with real time.
    const first = await readSimulatedAt(page);
    await page.waitForTimeout(1_500);
    const second = await readSimulatedAt(page);

    expect(second.value).toBeGreaterThan(first.value);
    expect(Math.abs(first.drift)).toBeLessThan(3_000);
    expect(Math.abs(second.drift)).toBeLessThan(3_000);
  });

  test('propagates the worker and the ISS from the same instant', async ({ page }) => {
    test.setTimeout(90_000);

    // Every propagate request the Starlink worker receives, recorded before the
    // page's own code can reach the worker.
    await page.addInitScript(() => {
      const captured: number[] = [];
      (window as unknown as { __propagateAt: number[] }).__propagateAt = captured;

      const original = Worker.prototype.postMessage;
      function patched(this: Worker, ...args: unknown[]) {
        const message = args[0] as { type?: string; at?: number } | null;
        if (message?.type === 'propagate' && typeof message.at === 'number') {
          captured.push(message.at);
        }
        (original as (...rest: unknown[]) => void).apply(this, args);
      }
      Worker.prototype.postMessage = patched as typeof Worker.prototype.postMessage;
    });

    await page.goto('/');
    await waitForIssMarker(page);

    // Every instant the globe frame has rendered, so the worker's requests can
    // be checked against the set of instants the ISS was actually drawn at.
    await page.evaluate(() => {
      const frame = document.querySelector('.globe-frame')!;
      const seen: string[] = [];
      const seed = frame.getAttribute('data-simulated-at');
      if (seed) seen.push(seed);
      (window as unknown as { __simulatedAt: string[] }).__simulatedAt = seen;

      // Records are delivered at the microtask checkpoint, so two writes in
      // one task would collapse to the later value if only the target were
      // read; the old value of each record recovers the intermediate one.
      new MutationObserver((records) => {
        for (const record of records) {
          if (record.oldValue) seen.push(record.oldValue);
          const value = (record.target as Element).getAttribute('data-simulated-at');
          if (value) seen.push(value);
        }
      }).observe(frame, {
        attributes: true,
        attributeOldValue: true,
        attributeFilter: ['data-simulated-at'],
      });
    });

    await enableStarlink(page);
    await slider(page).fill('45');
    await page.waitForTimeout(2_500);

    const result = await page.evaluate(() => {
      const scope = window as unknown as { __propagateAt: number[]; __simulatedAt: string[] };
      const observed = new Set(scope.__simulatedAt.map(Number));
      const frame = document.querySelector('.globe-frame')!;
      const propagated =
        frame.querySelector('[data-propagated-at]')?.getAttribute('data-propagated-at') ?? '';
      return {
        propagated: scope.__propagateAt.length,
        strays: scope.__propagateAt.filter((at) => !observed.has(at)),
        issAgrees: observed.has(Date.parse(propagated)),
      };
    });

    expect(result.propagated).toBeGreaterThanOrEqual(2);
    // A worker reading a clock of its own would drift off the rendered set
    // within a tick, and Starlink would trail the ISS across the globe.
    expect(result.strays).toEqual([]);
    expect(result.issAgrees).toBe(true);
  });

  test('produces no console or page errors while scrubbing', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/');
    await waitForIssMarker(page);

    const range = slider(page);
    await range.focus();
    await page.keyboard.press('End');
    await page.keyboard.press('Home');
    await page.getByRole('button', { name: 'Return to now' }).click();
    await expect(offsetReadout(page)).toHaveText('LIVE');

    expect(errors).toEqual([]);
  });
});

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

type Feed = 'tle' | 'launches' | 'astros';

const GLOB: Record<Feed, string> = {
  tle: '**/api/tle/**',
  launches: '**/api/launches**',
  astros: '**/api/astros**',
};

function ok(data: unknown) {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, data, source: 'live', fetchedAt: new Date().toISOString() }),
  };
}

/** Serve every feed, then break exactly one of them. */
async function stubWithFailure(page: Page, broken: Feed | null, mode: 'error' | 'empty' = 'error') {
  const payload: Record<Feed, unknown> = { tle: [ISS_TLE], launches: [LAUNCH], astros: ASTROS };

  for (const feed of ['tle', 'launches', 'astros'] as Feed[]) {
    if (feed === broken) {
      await page.route(GLOB[feed], (route) =>
        mode === 'error'
          ? route.fulfill({
              status: 503,
              contentType: 'application/json',
              body: JSON.stringify({ ok: false, error: `${feed} upstream unavailable` }),
            })
          : route.fulfill(ok(feed === 'astros' ? { count: 0, people: [] } : [])),
      );
    } else {
      await page.route(GLOB[feed], (route) => route.fulfill(ok(payload[feed])));
    }
  }
}

/**
 * What each feed's owning surface must say. Without these the `survives` tests
 * only assert the static shell — globe frame, canvas, two headings — all of
 * which render whatever the feeds do, so an app that silently reported
 * "0 HUMANS IN SPACE" for a failed crew feed, or lost its propagation error UI
 * entirely, still passed. An outage has to name itself, and an empty response
 * has to read as empty rather than as an outage.
 */
const OWNING_COPY: Record<Feed, { error: RegExp; empty: RegExp }> = {
  tle: { error: /Orbital propagation unavailable/i, empty: /Acquiring ISS ephemeris/i },
  launches: { error: /Launch feed unavailable/i, empty: /No scheduled launches/i },
  astros: { error: /CREW DATA OFFLINE/i, empty: /0 HUMANS IN SPACE/i },
};

/** Anything the page throws, plus console errors, so a crash cannot pass silently. */
function collectFailures(page: Page) {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`console: ${message.text()}`);
  });
  return failures;
}

/** The dashboard is still standing: globe mounted, both panel headings present. */
async function expectDashboardIntact(page: Page) {
  await expect(page.locator('.globe-frame')).toBeVisible();
  await expect(page.locator('canvas').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Upcoming missions' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Can you see the ISS?' })).toBeVisible();
}

test.describe('upstream resilience', () => {
  for (const broken of ['tle', 'launches', 'astros'] as Feed[]) {
    test(`survives ${broken} failing on its own`, async ({ page }) => {
      const failures = collectFailures(page);
      await stubWithFailure(page, broken, 'error');
      await page.goto('/');

      await expectDashboardIntact(page);
      // Wait for the owning surface to actually say it failed. This is both the
      // real assertion and the synchronisation the pageerror check needs: read
      // immediately after the shell renders, the error path may not have run
      // yet, and an async throw in it goes unobserved most of the time.
      await expect(page.locator('body')).toContainText(OWNING_COPY[broken].error);
      expect(failures.filter((f) => f.startsWith('pageerror:'))).toEqual([]);
    });

    test(`survives ${broken} returning empty`, async ({ page }) => {
      const failures = collectFailures(page);
      await stubWithFailure(page, broken, 'empty');
      await page.goto('/');

      await expectDashboardIntact(page);
      // Empty is its own state: it must not borrow the outage copy, and the
      // outage must not borrow this. Asserting the empty wording specifically
      // is what stops the two collapsing into each other.
      await expect(page.locator('body')).toContainText(OWNING_COPY[broken].empty);
      await expect(page.locator('body')).not.toContainText(OWNING_COPY[broken].error);
      expect(failures.filter((f) => f.startsWith('pageerror:'))).toEqual([]);
    });
  }

  test('survives all three feeds failing at once', async ({ page }) => {
    const failures = collectFailures(page);
    for (const feed of ['tle', 'launches', 'astros'] as Feed[]) {
      await page.route(GLOB[feed], (route) =>
        route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ ok: false, error: 'upstream unavailable' }),
        }),
      );
    }
    await page.goto('/');

    await expectDashboardIntact(page);
    for (const feed of ['tle', 'launches', 'astros'] as Feed[]) {
      await expect(page.locator('body')).toContainText(OWNING_COPY[feed].error);
    }
    expect(failures.filter((f) => f.startsWith('pageerror:'))).toEqual([]);
  });

  test('names the failure instead of pretending the sky is empty', async ({ page }) => {
    await stubWithFailure(page, 'launches', 'error');
    await page.goto('/');

    // An outage and a genuinely empty manifest are different states; the panel
    // must not report "no launches" when the feed never answered.
    const panel = page.locator('.glass-panel', { hasText: 'Upcoming missions' });
    await expect(panel).toContainText(/unavailable/i);
  });
});

test.describe('layout stability', () => {
  test('a failing feed keeps the panel in its grid column', async ({ page }) => {
    // Deliberately x and width only. Height is covered by the CLS budget below;
    // the grid's minmax() tracks already pin the column, so calling this a
    // height guarantee would overstate it.
    await stubWithFailure(page, null);
    await page.goto('/');
    await expect(page.locator('.next-launch-card')).toBeVisible();
    const healthy = await page.locator('.glass-panel', { hasText: 'Upcoming missions' }).boundingBox();

    await page.context().clearCookies();
    await stubWithFailure(page, 'launches', 'error');
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Upcoming missions' })).toBeVisible();
    const broken = await page.locator('.glass-panel', { hasText: 'Upcoming missions' }).boundingBox();

    expect(healthy).not.toBeNull();
    expect(broken).not.toBeNull();
    // Same left edge and width: the panel keeps its column, whatever its state.
    expect(Math.abs(broken!.x - healthy!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(broken!.width - healthy!.width)).toBeLessThanOrEqual(1);
  });

  test('stays within a cumulative layout shift budget while feeds arrive', async ({ page }) => {
    // Panels legitimately grow as data lands, so raw height deltas are not the
    // right measure — a side column can grow without moving anything a reader
    // is looking at. CLS is, and it is the metric the objective's "stable
    // dimensions" criterion is really about. Measured 0.033 at the time of
    // writing; the budget is the Core Web Vitals "good" threshold.
    await page.addInitScript(() => {
      (window as unknown as { __cls: number }).__cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEntry & {
          value: number;
          hadRecentInput: boolean;
        })[]) {
          if (!entry.hadRecentInput) {
            (window as unknown as { __cls: number }).__cls += entry.value;
          }
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });

    // Stagger the feeds so each one lands separately and any shift it causes is
    // counted, rather than all arriving in one paint.
    await page.route(GLOB.astros, (route) => route.fulfill(ok(ASTROS)));
    await page.route(GLOB.tle, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 700));
      await route.fulfill(ok([ISS_TLE]));
    });
    await page.route(GLOB.launches, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_400));
      await route.fulfill(ok([LAUNCH, { ...LAUNCH, id: 'l2', name: 'Atlas V' }, { ...LAUNCH, id: 'l3', name: 'Vulcan' }]));
    });

    await page.goto('/');
    await expect(page.locator('.next-launch-card')).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1_500);

    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(cls).toBeLessThan(0.1);
  });

  test('does not overflow horizontally at 375px with every feed broken', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    for (const feed of ['tle', 'launches', 'astros'] as Feed[]) {
      await page.route(GLOB[feed], (route) =>
        route.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false}' }),
      );
    }
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Upcoming missions' })).toBeVisible();

    const size = await page.evaluate(() => ({
      body: document.body.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    expect(size.body).toBeLessThanOrEqual(size.viewport + 1);
  });
});

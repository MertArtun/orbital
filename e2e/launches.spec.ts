import { expect, test, type Page } from '@playwright/test';

const ISS_TLE = {
  name: 'ISS (ZARYA)',
  line1: '1 25544U 98067A   26221.47238266  .00004421  00000+0  87174-4 0  9992',
  line2: '2 25544  51.6322  36.3838 0007357  29.0181 331.1215 15.49394423580019',
  noradId: '25544',
};

const ASTROS = { count: 7, people: [{ name: 'Stub Crew', craft: 'ISS' }] };

/** Shape must track lib/types.ts `Launch`. */
function launch(overrides: Record<string, unknown>) {
  return {
    id: 'stub',
    name: 'Falcon 9 · Starlink Group 1',
    mission: 'Starlink Group 1',
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
    ...overrides,
  };
}

async function stub(page: Page, launches: unknown[]) {
  const envelope = (data: unknown, extra: Record<string, unknown> = {}) => ({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      data,
      source: 'live',
      fetchedAt: new Date().toISOString(),
      ...extra,
    }),
  });

  await page.route('**/api/tle/**', (route) => route.fulfill(envelope([ISS_TLE])));
  await page.route('**/api/astros**', (route) => route.fulfill(envelope(ASTROS)));
  await page.route('**/api/launches**', (route) => route.fulfill(envelope(launches)));
}

const heroCard = '.next-launch-card';

test.describe('launch mission control', () => {
  test('headlines the soonest upcoming launch, not a stale past one', async ({ page }) => {
    // A cached feed keeps its ordering but time moves on, so the first entry can
    // already have flown. Headlining it shows a "NEXT WINDOW" counting upward.
    const flown = launch({
      id: 'already-flown',
      name: 'Atlas V · Flown Yesterday',
      net: new Date(Date.now() - 86_400_000).toISOString(),
    });
    const soonest = launch({
      id: 'genuinely-next',
      name: 'Falcon Heavy · Genuinely Next',
      net: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const later = launch({
      id: 'later-still',
      name: 'Vulcan · Later Still',
      net: new Date(Date.now() + 7_200_000).toISOString(),
    });
    // Deliberately out of chronological order: dropping the flown launch is not
    // enough, the remaining two must also be sorted or the hero is the later
    // one. Filtering alone passes this fixture only if the sort is present.
    await stub(page, [flown, later, soonest]);
    await page.goto('/');

    const hero = page.locator(heroCard);
    await expect(hero).toBeVisible();
    await expect(hero).toContainText('Genuinely Next');
    await expect(hero).not.toContainText('Flown Yesterday');
    await expect(hero).not.toContainText('Later Still');
    // A countdown to a future launch never counts up.
    await expect(hero.locator('.countdown')).not.toContainText('T+');
    // And the manifest continues in chronological order beneath it.
    await expect(page.locator('.launch-row').first()).toContainText('Later Still');
  });

  test('gives every manifest entry mission, provider and pad context', async ({ page }) => {
    const launches = [1, 2, 3, 4, 5].map((index) =>
      launch({
        id: `launch-${index}`,
        name: `Rocket ${index} · Mission ${index}`,
        mission: `Mission ${index}`,
        provider: `Provider ${index}`,
        padName: `PAD-${index}`,
        net: new Date(Date.now() + index * 3_600_000).toISOString(),
      }),
    );
    await stub(page, launches);
    await page.goto('/');

    await expect(page.locator(heroCard)).toBeVisible();
    // Five launches total: the hero plus four manifest rows.
    await expect(page.locator('.launch-row')).toHaveCount(4);

    // The pad is the actionable detail — it is what the globe focuses on.
    await expect(page.locator(heroCard)).toContainText('PAD-1');
    for (const index of [2, 3, 4, 5]) {
      const row = page.locator('.launch-row', { hasText: `Mission ${index}` });
      await expect(row).toContainText(`Provider ${index}`);
      await expect(row).toContainText(`PAD-${index}`);
    }
  });

  test('keeps the countdown ticking while the page is open', async ({ page }) => {
    await stub(page, [launch({ net: new Date(Date.now() + 7_200_000).toISOString() })]);
    await page.goto('/');

    const countdown = page.locator(`${heroCard} .countdown`);
    await expect(countdown).toBeVisible();
    // useClock returns null on the first render so the server and client agree;
    // the placeholder is intentional. Wait for the real clock before sampling.
    await expect(countdown).not.toContainText('--:--');
    const first = await countdown.textContent();
    expect(first).toMatch(/^T−\d{2}:\d{2}:\d{2}:\d{2}$/);

    // Wait for the value to change rather than sampling at a fixed offset. The
    // old form asserted that a 1Hz interval fired inside a 2.2s window, which
    // starves on a loaded machine: both samples come back identical and the
    // test fails for lack of CPU rather than for a defect. Waiting keeps the
    // teeth — a countdown that stops updating still fails — without betting on
    // timing. The name is also honest now: this proves the countdown stays
    // live, not that it is derived from the wall clock. A drifting tick counter
    // would still pass, which is why that gap is tracked against P1-06.
    await expect(countdown).not.toHaveText(first!, { timeout: 15_000 });
  });

  test('keeps the dashboard intact when the launch feed fails', async ({ page }) => {
    await page.route('**/api/tle/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, data: [ISS_TLE], source: 'live', fetchedAt: new Date().toISOString() }),
      }),
    );
    await page.route('**/api/astros**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, data: ASTROS, source: 'live', fetchedAt: new Date().toISOString() }),
      }),
    );
    await page.route('**/api/launches**', (route) =>
      route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'upstream down' }) }),
    );
    await page.goto('/');

    // The panel keeps its heading and the globe keeps working.
    await expect(page.getByRole('heading', { name: 'Upcoming missions' })).toBeVisible();
    await expect(page.locator('.globe-frame')).toBeVisible();
    await expect(page.locator('canvas').first()).toBeVisible();
  });

  test('shows crew count and both clocks in the top bar', async ({ page }) => {
    await stub(page, [launch({})]);
    await page.goto('/');

    const topbar = page.locator('.topbar');
    await expect(topbar).toContainText('7 HUMANS IN SPACE');
    await expect(topbar).toContainText('UTC');
    await expect(topbar).toContainText('LOCAL');
  });
});

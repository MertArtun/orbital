import { expect, test, type Page } from '@playwright/test';

const ISS_TLE = {
  name: 'ISS (ZARYA)',
  line1: '1 25544U 98067A   26221.47238266  .00004421  00000+0  87174-4 0  9992',
  line2: '2 25544  51.6322  36.3838 0007357  29.0181 331.1215 15.49394423580019',
  noradId: '25544',
};

const LAUNCH = {
  id: 'l1',
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

function ok(data: unknown) {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, data, source: 'live', fetchedAt: new Date().toISOString() }),
  };
}

async function stub(page: Page) {
  await page.route('**/api/tle/**', (route) => route.fulfill(ok([ISS_TLE])));
  await page.route('**/api/astros**', (route) => route.fulfill(ok({ count: 7, people: [] })));
  await page.route('**/api/launches**', (route) =>
    route.fulfill(ok([LAUNCH, { ...LAUNCH, id: 'l2', name: 'Atlas V · Kuiper' }])),
  );
}

/**
 * next dev injects its own overlay into the document. It is not part of the
 * product and does not exist in a production build, so it is excluded by tag
 * rather than by a blanket relaxation of the assertions below.
 */
const DEV_OVERLAY = 'NEXTJS-PORTAL';

/** Walk the real tab order and describe each stop. */
async function tabStops(page: Page, limit = 20) {
  const stops: { tag: string; cls: string; name: string; role: string | null }[] = [];
  for (let i = 0; i < limit; i += 1) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const cls = typeof el.className === 'string' ? el.className.split(' ')[0] : '';
      // Let the browser resolve label association rather than reimplementing
      // accname: an input wrapped in a <label> has no aria-* attribute of its
      // own but is correctly named, and a hand-rolled check reports it as a
      // false positive.
      const labels = (el as HTMLInputElement).labels;
      const labelled = labels && labels.length > 0
        ? [...labels].map((label) => label.textContent ?? '').join(' ')
        : '';
      const describedBy = el.getAttribute('aria-labelledby');
      return {
        tag: el.tagName,
        cls: cls ?? '',
        name:
          el.getAttribute('aria-label') ||
          labelled ||
          (describedBy ? (document.getElementById(describedBy)?.textContent ?? '') : '') ||
          el.getAttribute('title') ||
          '',
        role: el.getAttribute('role'),
        text: (el.textContent ?? '').trim(),
      };
    });
    if (!stop) break;
    const resolved = { ...stop, name: stop.name || stop.text };
    if (stops.some((s) => s.tag === resolved.tag && s.cls === resolved.cls && s.name === resolved.name)) break;
    stops.push(resolved);
  }
  return stops.filter((s) => s.tag !== DEV_OVERLAY);
}

test.describe('keyboard accessibility', () => {
  test('every keyboard stop has an accessible name', async ({ page }) => {
    await stub(page);
    await page.goto('/');
    await page.waitForSelector('.iss-marker', { timeout: 20_000 });
    await page.waitForTimeout(2_600);

    const stops = await tabStops(page);
    expect(stops.length).toBeGreaterThan(0);

    const unnamed = stops.filter((stop) => stop.name.trim() === '');
    expect(
      unnamed,
      `Keyboard reaches ${unnamed.length} control(s) with no accessible name: ` +
        unnamed.map((s) => `${s.tag}.${s.cls}${s.role ? `[role=${s.role}]` : ''}`).join(', '),
    ).toEqual([]);
  });

  test('does not put a decorative chart in the tab order', async ({ page }) => {
    await stub(page);
    await page.goto('/');
    await page.waitForSelector('.iss-marker', { timeout: 20_000 });
    await page.waitForTimeout(2_600);

    // Recharts ships role="application" tabindex="0" on its surface by default.
    // role="application" tells a screen reader to hand keystrokes to the widget,
    // which is wrong for a sparkline whose values are already rendered as text.
    // Assert the intent — not a tab stop, not an application — rather than one
    // spelling of it: disabling the accessibility layer drops the attributes
    // entirely, while an explicit tabindex="-1" would be equally acceptable.
    const surface = page.locator('svg.recharts-surface');
    if ((await surface.count()) > 0) {
      const attrs = await surface.first().evaluate((el) => ({
        role: el.getAttribute('role'),
        tabindex: el.getAttribute('tabindex'),
      }));
      expect(attrs.role).not.toBe('application');
      expect(attrs.tabindex === null || attrs.tabindex === '-1').toBe(true);
    }

    // The chart still has to be announced as something, via a wrapper that can
    // actually carry a name — an aria-label on a bare div is ignored.
    await expect(page.locator('[role="img"][aria-label*="altitude" i]')).toHaveCount(1);

    const stops = await tabStops(page);
    const charts = stops.filter((stop) => stop.cls.includes('recharts') || stop.role === 'application');
    expect(
      charts,
      'A decorative chart surface is keyboard focusable',
    ).toEqual([]);
  });

  test('the ISS marker is reachable and shows a focus ring', async ({ page }) => {
    await stub(page);
    await page.goto('/');
    await page.waitForSelector('.iss-marker', { timeout: 20_000 });

    const ring = await page.evaluate(() => {
      const marker = document.querySelector('.iss-marker') as HTMLElement | null;
      if (!marker) return null;
      marker.focus();
      const style = getComputedStyle(marker);
      return {
        focused: document.activeElement === marker,
        outlineWidth: Number.parseFloat(style.outlineWidth),
        outlineStyle: style.outlineStyle,
      };
    });

    expect(ring).not.toBeNull();
    expect(ring!.focused).toBe(true);
    expect(ring!.outlineStyle).not.toBe('none');
    expect(ring!.outlineWidth).toBeGreaterThanOrEqual(2);
  });
});

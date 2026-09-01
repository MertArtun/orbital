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

/**
 * Walk the real tab order.
 *
 * Two things here are deliberate, both from review findings:
 *
 * 1. Cycle detection is by element IDENTITY, not by a descriptor collision. An
 *    earlier version stopped as soon as two stops shared tag+class+name, which
 *    a page can hit legitimately — two launch rows whose countdowns round to
 *    the same minute — and everything after that pair went unexamined, so an
 *    unnamed control later in the order could never be found.
 *
 * 2. The accessible name comes from Playwright's own accname computation via
 *    ariaSnapshot, not from a hand-rolled chain. A `textContent` fallback names
 *    a button whose only child is aria-hidden — this repo's own icon idiom —
 *    so a genuinely unnamed control would read as named.
 */
async function tabStops(page: Page, limit = 40) {
  await page.evaluate(() => {
    document.querySelectorAll('[data-a11y-stop]').forEach((el) => el.removeAttribute('data-a11y-stop'));
  });

  const stops: { tag: string; role: string | null; name: string; snapshot: string }[] = [];
  for (let index = 0; index < limit; index += 1) {
    await page.keyboard.press('Tab');
    const marked = await page.evaluate((i) => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return { kind: 'end' as const };
      if (el.hasAttribute('data-a11y-stop')) return { kind: 'cycle' as const };
      el.setAttribute('data-a11y-stop', String(i));
      return { kind: 'stop' as const, tag: el.tagName, role: el.getAttribute('role') };
    }, index);

    if (marked.kind !== 'stop') break;
    // The dev overlay is injected by `next dev` and absent from a production
    // build. Skip it by tag rather than relaxing the assertions.
    if (marked.tag === DEV_OVERLAY) continue;

    const snapshot = await page.locator(`[data-a11y-stop="${index}"]`).ariaSnapshot();
    // ariaSnapshot renders a named node as `- role "name"` and an unnamed one
    // as `- role`, so the absence of a quoted string IS the absence of a name.
    const name = /"([^"]*)"/.exec(snapshot)?.[1] ?? '';
    stops.push({ tag: marked.tag, role: marked.role, name, snapshot: snapshot.split('\n')[0] ?? '' });
  }
  return stops;
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
        unnamed.map((s) => `${s.tag}${s.role ? `[role=${s.role}]` : ''} ${s.snapshot}`).join(', '),
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
    // Not filtered on className: for an SVG element className is an
    // SVGAnimatedString, so a string test there silently never matches.
    const charts = stops.filter(
      (stop) => stop.role === 'application' || stop.snapshot.includes('application'),
    );
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

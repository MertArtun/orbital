import { expect, test, type Page } from '@playwright/test';

/**
 * Colour contrast, WCAG 2.2 SC 1.4.3 (level AA).
 *
 * Every ratio here is computed from what the browser resolved, never from the
 * values in the stylesheet. Three reasons, and each one has already produced a
 * wrong number by hand: the palette is authored in `lab()`, so a computed
 * colour is not a hex string; the panels are translucent over a translucent
 * shell, so a background is a stack rather than a value; and several rows sit
 * within 0.3 of the threshold, which is inside the margin that reading tokens
 * off a stylesheet gets wrong.
 *
 * The sweep walks the whole rendered document rather than a list of selectors,
 * so text added later is measured without anyone remembering to add it.
 */

const ISS_TLE = {
  name: 'ISS (ZARYA)',
  line1: '1 25544U 98067A   26221.47238266  .00004421  00000+0  87174-4 0  9992',
  line2: '2 25544  51.6322  36.3838 0007357  29.0181 331.1215 15.49394423580019',
  noradId: '25544',
};

const LAUNCH = {
  id: 'l1',
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

function ok(data: unknown) {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true, data, source: 'live', fetchedAt: new Date().toISOString() }),
  };
}

/** A 2×2 PNG so the stubbed picture never leaves the machine. */
const PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVQIW2NkYPj/n4GBgYGRgQEIAAAsIAMBMTg5PgAAAABJRU5ErkJggg==';

/**
 * Every upstream is answered locally: half the text this spec measures only
 * exists once a panel has data, so a network failure would quietly shrink the
 * sweep instead of failing it.
 */
async function stub(page: Page) {
  await page.route('**/api/tle/**', (route) => route.fulfill(ok([ISS_TLE])));
  await page.route('**/api/astros**', (route) => route.fulfill(ok({ count: 7, people: [] })));
  await page.route('**/api/launches**', (route) =>
    route.fulfill(ok([LAUNCH, { ...LAUNCH, id: 'l2', name: 'Atlas V · Kuiper' }])),
  );
  await page.route('**/api/apod**', (route) =>
    route.fulfill(
      ok({
        date: '2026-09-08',
        title: 'Pillars of Creation',
        explanation: 'Towers of cool gas and dust in the Eagle Nebula, lit from within by young stars.',
        mediaType: 'image',
        url: 'https://apod.nasa.gov/apod/image/pillars.jpg',
        hdUrl: null,
        copyright: 'NASA, ESA',
      }),
    ),
  );
  await page.route('**/apod.nasa.gov/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(PIXEL, 'base64') }),
  );
}

/** One run of text, measured where it is painted. */
type Finding = {
  ratio: number;
  required: number;
  foreground: string;
  background: string;
  fontSize: number;
  fontWeight: number;
  region: string;
  selector: string;
  pseudo: string;
  text: string;
  overMedia: boolean;
  overGradient: boolean;
};

type Audit = {
  findings: Finding[];
  skipped: { notRendered: number; visuallyHidden: number; noOpaqueBackdrop: number };
};

async function auditContrast(page: Page, rootSelector: string | null = null): Promise<Audit> {
  return page.evaluate((selector) => {
    type Rgba = { r: number; g: number; b: number; a: number };
    type Box = { left: number; top: number; right: number; bottom: number };

    const probe = document.createElement('canvas');
    probe.width = 1;
    probe.height = 1;
    const ctx = probe.getContext('2d', { willReadFrequently: true })!;
    const cache = new Map<string, Rgba>();

    /**
     * Legacy `rgb()`/`rgba()` is parsed exactly — it carries every alpha this
     * page composites. Anything else is painted once and read back, because
     * Tailwind v4 serves its palette as `lab()` and getComputedStyle hands
     * that back unchanged.
     */
    const toRgba = (value: string): Rgba => {
      const cached = cache.get(value);
      if (cached) return cached;
      const legacy = /^rgba?\(([^)]*)\)$/.exec(value);
      let out: Rgba;
      if (legacy) {
        const parts = (legacy[1] ?? '').split(/[\s,/]+/).filter(Boolean).map(Number);
        out = { r: parts[0] ?? 0, g: parts[1] ?? 0, b: parts[2] ?? 0, a: parts[3] ?? 1 };
      } else {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = value;
        ctx.fillRect(0, 0, 1, 1);
        const data = ctx.getImageData(0, 0, 1, 1).data;
        out = { r: data[0] ?? 0, g: data[1] ?? 0, b: data[2] ?? 0, a: (data[3] ?? 0) / 255 };
      }
      cache.set(value, out);
      return out;
    };

    const over = (top: Rgba, bottom: Rgba): Rgba => ({
      r: top.r * top.a + bottom.r * (1 - top.a),
      g: top.g * top.a + bottom.g * (1 - top.a),
      b: top.b * top.a + bottom.b * (1 - top.a),
      a: 1,
    });

    const luminance = (color: Rgba): number => {
      const channel = (value: number): number => {
        const s = value / 255;
        return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
    };

    const ratioOf = (a: Rgba, b: Rgba): number => {
      const first = luminance(a);
      const second = luminance(b);
      return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
    };

    const hex = (color: Rgba): string =>
      `#${[color.r, color.g, color.b]
        .map((value) => Math.round(value).toString(16).padStart(2, '0'))
        .join('')}`;

    /**
     * The painted backdrop: climb until a layer is opaque, then composite back
     * down. Opacity is folded in because it applies to a whole subtree, so a
     * faded ancestor dims both the text and everything it sits on.
     *
     * Background *images* are not composited — a gradient cannot be evaluated
     * from a computed style. Each finding records whether one was in the stack.
     *
     * That gap was measured rather than assumed, three times independently, at
     * the palette this file ships against. Sampling means making every glyph
     * transparent, screenshotting, and reading the real pixels inside each text
     * rectangle.
     *
     * For text on a panel the method holds: the painted ratio runs a little
     * under the modelled one and never over it by more than a rounding error,
     * so this function reads optimistic on a gradient and cannot invent a
     * failure. Re-measure if the panels ever gain a lighter wash.
     *
     * For text over the globe canvas it does not hold, and saying so is the
     * point. A gate that measured one camera orientation would report a number
     * it cannot defend. Sampled across eight page loads with the geometry
     * re-read every frame, five loads were clean and three were not: the
     * coordinate readout reached 1.21:1 and 1.62:1 painted, and the drag hint
     * 3.83:1, with about 2% of its box below threshold in every frame of those
     * loads. The starfield does not rotate with the earth, so a star that lands
     * behind a glyph stays there; the cyan orbit track does the same, measured
     * at a worst pixel of 1.56:1 behind the legend. What that means is that no
     * static ratio is true of text over a moving scene, and the honest reading
     * of the over-canvas rows here is the modelled 6.67:1 to 8.08:1 against the
     * frame, not a claim about every frame. The previous translucent palette
     * was worse in the same states -- 100% of every over-media box below 4.5,
     * against 0.5% now -- so the direction is right; the certainty was not.
     */
    const backdropOf = (el: Element) => {
      const chain: Element[] = [];
      for (let node: Element | null = el; node; node = node.parentElement) chain.push(node);
      const styles = chain.map((node) => getComputedStyle(node));

      const factors: number[] = new Array<number>(chain.length).fill(1);
      let factor = 1;
      for (let i = chain.length - 1; i >= 0; i -= 1) {
        factor *= Number(styles[i]?.opacity ?? 1);
        factors[i] = factor;
      }

      const layers: Rgba[] = [];
      let gradient = false;
      for (let i = 0; i < chain.length; i += 1) {
        const style = styles[i];
        if (!style) continue;
        if (style.backgroundImage !== 'none') gradient = true;
        const color = toRgba(style.backgroundColor);
        const alpha = color.a * (factors[i] ?? 1);
        if (alpha <= 0) continue;
        layers.push({ ...color, a: alpha });
        if (alpha >= 0.999) break;
      }

      const base = layers[layers.length - 1];
      if (!base || base.a < 0.999) return null;
      let composited: Rgba = base;
      for (let i = layers.length - 2; i >= 0; i -= 1) {
        const layer = layers[i];
        if (layer) composited = over(layer, composited);
      }
      return { color: composited, gradient, textFactor: factors[0] ?? 1 };
    };

    const range = document.createRange();

    /** Text the element paints itself, not the text of its descendants. */
    const ownText = (el: Element): string => {
      let text = '';
      for (const node of Array.from(el.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? '';
      }
      return text.replace(/\s+/g, ' ').trim();
    };

    /** The glyph rectangles, which is what `sr-only` and clipped text fail. */
    const textBox = (el: Element): Box | null => {
      let box: Box | null = null;
      for (const node of Array.from(el.childNodes)) {
        if (node.nodeType !== Node.TEXT_NODE || (node.textContent ?? '').trim() === '') continue;
        range.selectNodeContents(node);
        for (const rect of Array.from(range.getClientRects())) {
          if (rect.width <= 0 || rect.height <= 0) continue;
          box = box
            ? {
                left: Math.min(box.left, rect.left),
                top: Math.min(box.top, rect.top),
                right: Math.max(box.right, rect.right),
                bottom: Math.max(box.bottom, rect.bottom),
              }
            : { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
        }
      }
      return box;
    };

    const describe = (el: Element): string => {
      const classes = (el.getAttribute('class') ?? '').replace(/\s+/g, ' ').trim();
      // Elided in the middle rather than at the end: a Tailwind class list puts
      // layout first and the colour last, and the colour is the actionable half.
      const shown =
        classes.length > 108 ? `${classes.slice(0, 60)} … ${classes.slice(-45)}` : classes;
      return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${shown ? ` [${shown}]` : ''}`;
    };

    /** Nearest named ancestor, so a finding points at a panel and not just a div. */
    const regionOf = (el: Element): string => {
      for (let node: Element | null = el; node; node = node.parentElement) {
        const label = node.getAttribute('aria-label') ?? node.getAttribute('aria-labelledby') ?? node.id;
        if (label) return label;
      }
      return 'document';
    };

    const findings: Finding[] = [];
    const skipped = { notRendered: 0, visuallyHidden: 0, noOpaqueBackdrop: 0 };
    const root = selector ? document.querySelector(selector) : document.body;
    if (!root) return { findings, skipped };

    // Text over a canvas or an image has no backdrop a stylesheet can answer
    // for. It is still measured, against the frame behind the media, and the
    // finding says so rather than passing quietly.
    const media = Array.from(document.querySelectorAll('canvas, img, video'))
      .map((node) => node.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0);

    const NOT_TEXT = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TITLE']);

    for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
      // `next dev` injects an overlay that is not part of the product, and a
      // hydration payload is not text anybody reads. Both would otherwise land
      // in the skip counts and make them harder to read.
      if (NOT_TEXT.has(el.tagName) || el.closest('nextjs-portal')) continue;

      const own = ownText(el);
      const input = el instanceof HTMLInputElement ? el : null;
      const placeholder = input && input.value === '' ? input.placeholder.trim() : '';
      if (own === '' && placeholder === '') continue;

      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility !== 'visible') {
        skipped.notRendered += 1;
        continue;
      }
      // Glyph rectangles are reported at full size even when the box around
      // them is clipped to nothing, so the element's own box is what separates
      // text somebody can read from text only a screen reader gets. An empty
      // box means an ancestor is display:none, which getComputedStyle on this
      // element does not report; a 1×1 box is the `sr-only` idiom.
      const elBox = el.getBoundingClientRect();
      if (elBox.width < 0.5 || elBox.height < 0.5) {
        skipped.notRendered += 1;
        continue;
      }
      if (elBox.width < 2 || elBox.height < 2) {
        skipped.visuallyHidden += 1;
        continue;
      }
      const backdrop = backdropOf(el);
      if (!backdrop) {
        skipped.noOpaqueBackdrop += 1;
        continue;
      }
      if (backdrop.textFactor < 0.01) {
        skipped.notRendered += 1;
        continue;
      }

      const probes = [
        ...(own ? [{ pseudo: '', text: own, box: textBox(el) }] : []),
        ...(placeholder
          ? [
              {
                pseudo: '::placeholder',
                text: placeholder,
                box: { left: elBox.left, top: elBox.top, right: elBox.right, bottom: elBox.bottom },
              },
            ]
          : []),
      ];

      for (const { pseudo, text, box } of probes) {
        // No glyph rectangles at all means an ancestor is display:none, which
        // getComputedStyle on this element does not report.
        if (!box) {
          skipped.notRendered += 1;
          continue;
        }
        const source = pseudo ? getComputedStyle(el, pseudo) : style;
        const raw = toRgba(source.color);
        const foreground = over({ ...raw, a: raw.a * backdrop.textFactor }, backdrop.color);
        const fontSize = Number.parseFloat(source.fontSize);
        const fontWeight = Number(source.fontWeight) || 400;
        // SC 1.4.3 relaxes to 3:1 only for 24px, or 18.66px at 700 or heavier.
        // Both halves are read off the element rather than assumed.
        const large = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
        findings.push({
          ratio: ratioOf(foreground, backdrop.color),
          required: large ? 3 : 4.5,
          foreground: hex(foreground),
          background: hex(backdrop.color),
          fontSize,
          fontWeight,
          region: regionOf(el),
          selector: describe(el),
          pseudo,
          text: text.length > 64 ? `${text.slice(0, 63)}…` : text,
          overMedia: media.some(
            (rect) =>
              rect.left < box.right &&
              rect.right > box.left &&
              rect.top < box.bottom &&
              rect.bottom > box.top,
          ),
          overGradient: backdrop.gradient,
        });
      }
    }

    return { findings, skipped };
  }, rootSelector);
}

/**
 * Failures are grouped by call site: nine identical pass-card labels are one
 * fix, and printing them nine times buries the other eight problems.
 */
function contrastReport(audit: Audit, failures: Finding[]): string {
  const groups = new Map<string, { finding: Finding; count: number }>();
  for (const finding of failures) {
    const key = [
      finding.region,
      finding.selector,
      finding.pseudo,
      finding.foreground,
      finding.background,
    ].join('|');
    const group = groups.get(key);
    if (!group) {
      groups.set(key, { finding, count: 1 });
      continue;
    }
    group.count += 1;
    if (finding.ratio < group.finding.ratio) group.finding = finding;
  }

  const ordered = Array.from(groups.values()).sort((a, b) => a.finding.ratio - b.finding.ratio);
  const lines = ordered.slice(0, 30).map(({ finding, count }) => {
    const notes = [
      count > 1 ? `${count} elements` : '',
      finding.overMedia ? 'over a canvas or image, measured against the frame behind it' : '',
      finding.overGradient ? 'gradient in the stack, not composited' : '',
    ].filter(Boolean);
    return [
      `  ${finding.ratio.toFixed(2)}:1, needs ${finding.required}:1 — ${finding.foreground} on ${finding.background}, ${finding.fontSize}px/${finding.fontWeight}`,
      `      ${finding.region} › ${finding.selector}${finding.pseudo}`,
      `      "${finding.text}"${notes.length ? `  (${notes.join('; ')})` : ''}`,
    ].join('\n');
  });
  if (ordered.length > lines.length) {
    lines.push(`  …and ${ordered.length - lines.length} further call site(s).`);
  }

  return [
    `${failures.length} of ${audit.findings.length} measured text runs are below their WCAG 1.4.3 AA threshold.`,
    `Skipped: ${audit.skipped.notRendered} not rendered, ${audit.skipped.visuallyHidden} visually hidden, ${audit.skipped.noOpaqueBackdrop} with no opaque backdrop.`,
    'Background images are not composited, so a ratio measured over a gradient is the value on the flat colour beneath it.',
    ...lines,
  ].join('\n');
}

/** A sweep that measures almost nothing passes for the wrong reason. */
function expectMeaningfulSweep(audit: Audit, minimum: number) {
  expect(
    audit.findings.length,
    `Only ${audit.findings.length} text run(s) were measured, below the ${minimum} this page renders, ` +
      `so a pass would prove nothing. Skipped: ${JSON.stringify(audit.skipped)}`,
  ).toBeGreaterThanOrEqual(minimum);
}

function expectContrast(audit: Audit) {
  const failures = audit.findings.filter((finding) => finding.ratio < finding.required);
  expect(failures.length, contrastReport(audit, failures)).toBe(0);
}

/** Every panel filled, so the sweep sees the text that only exists with data. */
async function settle(page: Page) {
  await page.waitForSelector('.iss-marker', { state: 'attached', timeout: 20_000 });
  await expect(page.locator('.pass-card').first()).toBeVisible();
  await expect(page.locator('.launch-row').first()).toBeVisible();
  await expect(page.locator('[data-subsolar-lng]')).toBeVisible();
}

test.describe('colour contrast', () => {
  test('the dashboard has no text below its WCAG AA threshold', async ({ page }) => {
    await stub(page);
    await page.goto('/');
    await settle(page);

    // The picture of the day fetches nothing until it is scrolled near, so its
    // credit row does not exist to measure until it has been.
    await page.locator('section[aria-label="Astronomy picture of the day"]').scrollIntoViewIfNeeded();
    await expect(page.getByRole('img', { name: 'Pillars of Creation' })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));

    const audit = await auditContrast(page);
    expectMeaningfulSweep(audit, 60);
    expectContrast(audit);
  });

  test('the states only an interaction reaches meet it too', async ({ page }) => {
    // The placeholder is painted only while the field is empty, and the manual
    // share link only after the clipboard has refused. Neither state is on the
    // page a first sweep sees, and both carry their own colour.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error('Write permission denied.')) },
      });
    });
    await stub(page);
    await page.goto('/');
    await settle(page);

    await page.locator('button[data-share-url]').click();
    await expect(page.getByLabel(/Share link/i)).toBeVisible();

    const search = page
      .locator('.glass-panel', { has: page.locator('#passes-title') })
      .getByRole('combobox');
    await search.fill('');
    await expect(search).toHaveValue('');

    const audit = await auditContrast(page, '.glass-panel:has(#passes-title)');
    expectMeaningfulSweep(audit, 15);
    expectContrast(audit);
  });
});

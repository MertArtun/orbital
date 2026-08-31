import { expect, test } from '@playwright/test';

test.describe('ORBITAL dashboard', () => {
  test('renders the live dashboard shell', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'ORBITAL' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Can you see the ISS?' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Upcoming missions' })).toBeVisible();
  });

  test('never ellipsizes the product name at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');

    const brand = page.getByRole('heading', { name: 'ORBITAL', level: 1 });
    await expect(brand).toHaveText('ORBITAL');

    // The brand is a fixed 7-character string; clipping it to "ORBI…" is never
    // the right trade at any viewport. Secondary chrome yields instead.
    const clipped = await brand.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(clipped).toBe(false);
  });

  test('does not overflow at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    const dimensions = await page.evaluate(() => ({
      body: document.body.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport + 1);
  });
});

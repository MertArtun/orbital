import { expect, test } from '@playwright/test';

test.describe('ORBITAL dashboard', () => {
  test('renders the live dashboard shell', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'ORBITAL' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Can you see the ISS?' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Upcoming missions' })).toBeVisible();
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

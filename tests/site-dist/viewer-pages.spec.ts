import { expect, test } from '@playwright/test';

for (const format of ['docx', 'xlsx', 'pptx'] as const) {
  test(`${format.toUpperCase()} live and comment demos initialize`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto(`/${format}/?all`);

    await expect(page.locator('[data-built-in-comment-status]')).toBeHidden({ timeout: 60_000 });
    await expect(page.locator('canvas').first()).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/not a constructor|Failed:/i);
    expect(pageErrors).toEqual([]);
  });
}

test('PPTX single-comment margin has no trailing scroll range', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/pptx/?all');
  await expect(page.locator('[data-built-in-comment-status]')).toBeHidden({ timeout: 60_000 });

  const margin = page.locator('[data-ooxml-comment-ui="margin"]')
    .filter({ has: page.locator('.ooxml-comment-card') })
    .first();
  await expect(margin.locator('.ooxml-comment-card')).toHaveCount(1);

  const before = await margin.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    scrollTop: element.scrollTop,
  }));
  expect(before.scrollHeight).toBe(before.clientHeight);

  await margin.locator('.ooxml-comment-card').hover();
  await page.mouse.wheel(0, 100);
  await expect.poll(() => margin.evaluate((element) => element.scrollTop)).toBe(0);
});

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

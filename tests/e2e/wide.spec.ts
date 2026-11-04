import { expect, test } from '@playwright/test';
import { box, openApp } from './fixtures';

// Wide landscape screen: controls in a column on the left, the page on the right.
test.use({ viewport: { width: 1280, height: 720 } });
test.beforeEach(async ({ page }) => openApp(page));

test('on a wide screen the controls sit left of the page and stay open', async ({ page }) => {
  const sheet = page.getByTestId('sheet');
  await expect(sheet).not.toHaveClass(/collapsed/);
  await expect(page.locator('#sheet-body')).toBeVisible();
  await expect(page.getByTestId('sheet-handle')).toBeHidden();

  const tabs = await box(page.locator('.tabs'));
  const panel = await box(sheet);
  const work = await box(page.locator('#workspace'));
  const p = await box(page.getByTestId('page'));
  expect(tabs.x + tabs.width).toBeLessThanOrEqual(panel.x + 1);
  expect(panel.x + panel.width).toBeLessThanOrEqual(work.x + 1);
  expect(p.x).toBeGreaterThanOrEqual(work.x);
  // The workspace runs down to the bottom of the screen – nothing below it.
  expect(work.y + work.height).toBeCloseTo(720, 0);
  // Tabs are stacked vertically.
  const [a, b] = [await box(page.getByTestId('tab-layout')), await box(page.getByTestId('tab-photos'))];
  expect(b.y).toBeGreaterThan(a.y);
  expect(Math.abs(a.x - b.x)).toBeLessThan(1);
});

test('tabs switch panels without folding them; modes keep the panel open', async ({ page }) => {
  await page.getByTestId('tab-style').click();
  await expect(page.locator('#tab-style')).toBeVisible();
  await page.getByTestId('tab-style').click();
  await expect(page.locator('#tab-style')).toBeVisible();
  await page.getByTestId('mode-crop').click();
  await expect(page.locator('#sheet-body')).toBeVisible();
});

test('the page gets more height than with the bottom sheet', async ({ page }) => {
  const wide = await box(page.getByTestId('page'));
  await page.setViewportSize({ width: 700, height: 720 });
  await expect(page.getByTestId('sheet')).toHaveClass(/collapsed/);
  await expect(page.locator('.tabs')).toHaveCSS('flex-direction', 'row');
  await page.getByTestId('tab-layout').click();
  await expect.poll(async () => (await box(page.getByTestId('page'))).height).toBeLessThan(wide.height);
});

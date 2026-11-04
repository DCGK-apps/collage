import { expect, test, type Page } from '@playwright/test';
import { box, makePng, openApp } from './fixtures';

test.beforeEach(async ({ page }) => openApp(page));

const sheet = (page: Page) => page.getByTestId('sheet');
const body = (page: Page) => page.locator('#sheet-body');
const pageWidth = async (page: Page) => (await box(page.getByTestId('page'))).width;

test('settings sheet starts collapsed, giving the page more room', async ({ page }) => {
  await expect(sheet(page)).toHaveClass(/collapsed/);
  await expect(body(page)).toBeHidden();
  const collapsed = await box(page.getByTestId('page'));
  await page.getByTestId('tab-layout').click();
  await expect(body(page)).toBeVisible();
  const open = await box(page.getByTestId('page'));
  expect(collapsed.height).toBeGreaterThan(open.height);
});

test('a tab opens its panel; tapping the open tab again folds it', async ({ page }) => {
  await page.getByTestId('tab-style').click();
  await expect(page.locator('#tab-style')).toBeVisible();
  // Switching tabs keeps the sheet open.
  await page.getByTestId('tab-layout').click();
  await expect(page.locator('#tab-layout')).toBeVisible();
  await page.getByTestId('tab-layout').click();
  await expect(body(page)).toBeHidden();
});

test('the handle toggles the sheet', async ({ page }) => {
  await page.getByTestId('sheet-handle').click();
  await expect(body(page)).toBeVisible();
  await expect(page.getByTestId('sheet-handle')).toHaveAttribute('aria-expanded', 'true');
  await page.getByTestId('sheet-handle').click();
  await expect(body(page)).toBeHidden();
});

test('switching edges / crop / layers folds the sheet away', async ({ page }) => {
  for (const mode of ['mode-crop', 'mode-layers', 'mode-edges']) {
    await page.getByTestId('tab-layout').click();
    await expect(body(page)).toBeVisible();
    const w = await pageWidth(page);
    await page.getByTestId(mode).click();
    await expect(body(page)).toBeHidden();
    expect(await pageWidth(page)).toBeGreaterThanOrEqual(w);
  }
});

test('adding a layer from the sheet keeps it open (mode changes by itself)', async ({ page }) => {
  await page.getByTestId('tab-photos').click();
  await page.locator('#file-layer').setInputFiles({ name: 'l.png', mimeType: 'image/png', buffer: makePng(30, 20, [9, 9, 9]) });
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'layers');
  await expect(body(page)).toBeVisible();
});

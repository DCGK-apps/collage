import { expect, test } from '@playwright/test';
import { box, cells, getDoc, openApp } from './fixtures';

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await page.getByTestId('mode-crop').click();
});

const menu = (page: import('@playwright/test').Page) => page.getByTestId('cell-toolbar');

test('tapping a tile opens the menu, tapping it again closes it', async ({ page }) => {
  await cells(page).nth(0).click();
  await expect(menu(page)).toBeVisible();
  await cells(page).nth(0).click();
  await expect(menu(page)).toBeHidden();
});

test('tapping another tile closes the menu', async ({ page }) => {
  await cells(page).nth(0).click();
  await expect(menu(page)).toBeVisible();
  await cells(page).nth(3).click();
  await expect(menu(page)).toBeHidden();
  // The next tap opens it for that tile.
  await cells(page).nth(3).click();
  await expect(menu(page)).toBeVisible();
  await expect(cells(page).nth(3)).toHaveClass(/selected/);
});

test('tapping outside the page closes the menu', async ({ page }) => {
  await cells(page).nth(0).click();
  await expect(menu(page)).toBeVisible();
  const ws = await box(page.locator('#workspace'));
  const pg = await box(page.getByTestId('page'));
  // Empty workspace area below the page.
  await page.mouse.click(ws.x + 4, (pg.y + pg.height + ws.y + ws.height) / 2);
  await expect(menu(page)).toBeHidden();
});

test('tapping the gap between photos closes the menu', async ({ page }) => {
  await cells(page).nth(0).click();
  await expect(menu(page)).toBeVisible();
  const a = await box(cells(page).nth(0));
  const b = await box(cells(page).nth(1));
  await page.mouse.click((a.x + a.width + b.x) / 2, a.y + a.height / 2);
  await expect(menu(page)).toBeHidden();
});

test('menu buttons work and keep the menu open', async ({ page }) => {
  await cells(page).nth(0).click();
  await menu(page).locator('[data-act="zoom-in"]').click();
  await expect(menu(page)).toBeVisible();
  expect((await getDoc(page)).tree.first.first.crop.zoom).toBeGreaterThan(1);
});

test('swap still works: “Zamień”, then tap another tile', async ({ page }) => {
  const before = (await getDoc(page)).tree;
  await cells(page).nth(0).click();
  await menu(page).locator('[data-act="swap"]').click();
  await cells(page).nth(1).click();
  const after = (await getDoc(page)).tree;
  expect(after.first.first.photoId).toBe(before.first.second.photoId);
  expect(after.first.second.photoId).toBe(before.first.first.photoId);
});

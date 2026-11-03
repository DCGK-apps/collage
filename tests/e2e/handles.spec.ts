import { expect, test } from '@playwright/test';
import { box, center, dividers, drag, getDoc, openApp } from './fixtures';

test.beforeEach(async ({ page }) => openApp(page));

const pills = (page: import('@playwright/test').Page) => page.locator('[data-testid="divider"] .pill');

test('the eye button hides and shows the edge handles', async ({ page }) => {
  await expect(pills(page).first()).toBeVisible();
  await page.getByTestId('toggle-handles').click();
  for (const p of await pills(page).all()) await expect(p).toBeHidden();
  await page.getByTestId('toggle-handles').click();
  await expect(pills(page).first()).toBeVisible();
});

test('edges stay draggable while handles are hidden', async ({ page }) => {
  await page.getByTestId('toggle-handles').click();
  const r0 = (await getDoc(page)).tree.first.ratio;
  const s = center(await box(dividers(page, 'v').first()));
  await drag(page, s, { x: s.x + 40, y: s.y }, 6);
  expect((await getDoc(page)).tree.first.ratio).toBeGreaterThan(r0);
});

test('the choice survives a reload', async ({ page }) => {
  await page.getByTestId('toggle-handles').click();
  await page.reload();
  await expect(page.locator('body[data-ready="true"]')).toBeAttached();
  await expect(pills(page).first()).toBeHidden();
});

test('keyboard shortcut H toggles handles', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard shortcut');
  await page.keyboard.press('h');
  await expect(pills(page).first()).toBeHidden();
  await page.keyboard.press('h');
  await expect(pills(page).first()).toBeVisible();
});

test('the button is only shown in edges mode', async ({ page }) => {
  await expect(page.getByTestId('toggle-handles')).toBeVisible();
  await page.getByTestId('mode-crop').click();
  await expect(page.getByTestId('toggle-handles')).toBeHidden();
});

import { expect, test, type Page } from '@playwright/test';
import { openApp } from './fixtures';

const BUTTONS = ['mode-edges', 'mode-crop', 'mode-layers', 'undo', 'redo', 'smart', 'open-export'];

/** Every top-bar button is fully on screen and the bar does not overflow. */
async function allButtonsFit(page: Page) {
  const vw = page.viewportSize()!.width;
  for (const id of BUTTONS) {
    const b = (await page.getByTestId(id).boundingBox())!;
    expect(b, id).not.toBeNull();
    expect(b.x, id).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width, id).toBeLessThanOrEqual(vw + 0.5);
  }
  const overflow = await page.getByTestId('topbar').evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

const labelsVisible = (page: Page) => page.getByTestId('open-export').locator('.btn-label').isVisible();

for (const width of [1280, 820, 624, 480, 390, 320]) {
  test(`top bar fits at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await openApp(page);
    await allButtonsFit(page);
  });
}

test('wide screens show labels, narrow ones only icons', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openApp(page);
  expect(await labelsVisible(page)).toBe(true);
  await page.setViewportSize({ width: 460, height: 800 });
  await expect.poll(() => labelsVisible(page)).toBe(false);
  // Icon-only buttons keep an accessible name.
  await expect(page.getByRole('button', { name: 'Zapisz' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Kadr' })).toBeVisible();
  // Rotating back to a wide screen brings the labels back.
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect.poll(() => labelsVisible(page)).toBe(true);
});

test('larger system text (phone accessibility setting) switches to icons and still fits', async ({ page }) => {
  // The reported phone: ~624 CSS px wide with enlarged text; labels used to push buttons off screen.
  await page.setViewportSize({ width: 624, height: 900 });
  await openApp(page);
  await page.addStyleTag({ content: '.topbar .btn-label, .topbar .btn, .topbar .mode-btn { font-size: 17px !important; }' });
  await expect.poll(() => labelsVisible(page)).toBe(false);
  await allButtonsFit(page);
});

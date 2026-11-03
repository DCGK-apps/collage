import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { openApp, pngSize } from './fixtures';

test.beforeEach(async ({ page }) => openApp(page));

test('PNG export is A4 at 300 DPI', async ({ page }) => {
  await page.getByTestId('open-export').click();
  await expect(page.locator('#export-info')).toContainText('2480 × 3508');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-png').click()]);
  expect(dl.suggestedFilename()).toBe('kolaz.png');
  expect(pngSize(await readFile((await dl.path())!))).toEqual({ w: 2480, h: 3508 });
});

test('PDF export has an A4 page', async ({ page }) => {
  await page.getByTestId('open-export').click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-pdf').click()]);
  const buf = await readFile((await dl.path())!);
  const text = buf.toString('latin1');
  expect(text.startsWith('%PDF-')).toBe(true);
  expect(text).toContain('/MediaBox [0 0 595.28 841.89]');
});

test('exported pixels match the preview (margin is background, cells hold photos)', async ({ page }) => {
  await page.getByTestId('open-export').click();
  await page.locator('[data-dpi="150"]').click();
  await expect(page.locator('#export-info')).toContainText('1240 × 1754');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-png').click()]);
  const b64 = (await readFile((await dl.path())!)).toString('base64');
  const px = await page.evaluate(async (data) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + data;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const at = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
    // 4 mm gap at 150 DPI ≈ 23.6 px; sample the margin and the middle of the first quadrant.
    return { margin: at(10, 10), photo: at(Math.round(c.width / 4), Math.round(c.height / 4)) };
  }, b64);
  expect(px.margin).toEqual([255, 255, 255]);
  expect(px.photo).not.toEqual([255, 255, 255]);
});

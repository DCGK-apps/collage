import { expect, test, type Page } from '@playwright/test';
import { box, cells, center, dividers, getDoc, openApp } from './fixtures';

test.beforeEach(async ({ page }, info) => {
  test.skip(!info.project.use.hasTouch, 'touch-only');
  await openApp(page);
});

/** Real touch drag (touchstart/move/end → pointer events with pointerType "touch"). */
async function touchDrag(page: Page, points: { x: number; y: number }[]): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const [first, ...rest] = points;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first!] });
  for (const p of rest) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [p] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/** Two-finger pinch around a centre point. */
async function pinch(page: Page, c: { x: number; y: number }, from: number, to: number, steps = 8): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const pts = (d: number) => [
    { x: c.x - d, y: c.y, id: 0 },
    { x: c.x + d, y: c.y, id: 1 },
  ];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(from) });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(from + ((to - from) * i) / steps) });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test('touch-dragging an edge resizes cells', async ({ page }) => {
  const s = center(await box(dividers(page, 'v').first()));
  const w0 = (await box(cells(page).first())).width;
  await touchDrag(page, Array.from({ length: 10 }, (_, i) => ({ x: s.x + i * 4, y: s.y })));
  expect((await box(cells(page).first())).width - w0).toBeGreaterThan(25);
});

test('double-tap on an edge flips its orientation', async ({ page }) => {
  const s = center(await box(dividers(page, 'v').first()));
  await page.touchscreen.tap(s.x, s.y);
  await page.touchscreen.tap(s.x, s.y);
  await expect.poll(async () => (await getDoc(page)).tree.first.dir).toBe('h');
});

test('pinch zooms the photo in crop mode', async ({ page }) => {
  await page.getByTestId('mode-crop').click();
  const c = center(await box(cells(page).first()));
  await pinch(page, c, 20, 60);
  expect((await getDoc(page)).tree.first.first.crop.zoom).toBeGreaterThan(1.5);
});

import { expect, test } from '@playwright/test';
import { box, center, dividers, drag, getDoc, openApp } from './fixtures';

test.beforeEach(async ({ page }) => openApp(page));

/** Centre of the horizontal divider's pill – exactly where the vertical edges cross it. */
async function crossing(page: import('@playwright/test').Page) {
  return center(await box(dividers(page, 'h').first().locator('.pill')));
}

test('dragging the horizontal pill at a crossing moves the horizontal edge', async ({ page }) => {
  const before = await getDoc(page);
  const c = await crossing(page);
  await drag(page, c, { x: c.x, y: c.y + 50 }, 8);
  const after = await getDoc(page);
  expect(after.tree.ratio).toBeGreaterThan(before.tree.ratio);
  expect(after.tree.first.ratio).toBeCloseTo(before.tree.first.ratio);
});

test('dragging sideways at the crossing still moves the vertical edge', async ({ page }) => {
  const before = await getDoc(page);
  const c = await crossing(page);
  await drag(page, c, { x: c.x + 50, y: c.y }, 8);
  const after = await getDoc(page);
  expect(after.tree.first.ratio).toBeGreaterThan(before.tree.first.ratio);
  expect(after.tree.ratio).toBeCloseTo(before.tree.ratio);
});

test('double-click on the horizontal pill flips the horizontal edge', async ({ page }) => {
  const c = await crossing(page);
  await page.mouse.dblclick(c.x, c.y);
  await expect.poll(async () => (await getDoc(page)).tree.dir).toBe('v');
  expect((await getDoc(page)).tree.first.dir).toBe('v');
});

test('touch: drag down at the crossing moves the horizontal edge', async ({ page }, info) => {
  test.skip(!info.project.use.hasTouch, 'touch-only');
  const before = await getDoc(page);
  const c = await crossing(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [c] });
  for (let i = 1; i <= 10; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: c.x + i * 0.5, y: c.y + i * 5 }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect((await getDoc(page)).tree.ratio).toBeGreaterThan(before.tree.ratio);
});

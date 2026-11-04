import { expect, test, type Page } from '@playwright/test';
import { box, center, dividers, drag, getDoc, openApp } from './fixtures';

test.beforeEach(async ({ page }) => openApp(page));

const knob = (page: Page) => page.getByTestId('junction');
const ratios = async (page: Page) => {
  const t = (await getDoc(page)).tree;
  return { root: t.ratio, top: t.first.ratio, bottom: t.second.ratio };
};
/** Centre of a vertical segment's pill (the middle of that segment). */
const pill = async (page: Page, i: number) => center(await box(dividers(page, 'v').nth(i).locator('.pill')));

test('a knob marks where the top and bottom edges of the cross meet', async ({ page }) => {
  await expect(knob(page)).toHaveCount(1);
  const k = center(await box(knob(page)));
  const pg = await box(page.getByTestId('page'));
  expect(k.x).toBeCloseTo(pg.x + pg.width / 2, 0);
  expect(k.y).toBeCloseTo(pg.y + pg.height / 2, 0);
});

test('segments move independently: top to the right, bottom to the left', async ({ page }) => {
  const r0 = await ratios(page);
  const top = await pill(page, 0);
  await drag(page, top, { x: top.x + 40, y: top.y }, 6);
  const r1 = await ratios(page);
  expect(r1.top).toBeGreaterThan(r0.top);
  expect(r1.bottom).toBeCloseTo(r0.bottom);

  const bottom = await pill(page, 1);
  await drag(page, bottom, { x: bottom.x - 40, y: bottom.y }, 6);
  const r2 = await ratios(page);
  expect(r2.bottom).toBeLessThan(r0.bottom);
  expect(r2.top).toBeCloseTo(r1.top);
  // No longer aligned → no knob.
  await expect(knob(page)).toHaveCount(0);
});

test('dragging the knob sideways moves the whole vertical line', async ({ page }) => {
  const r0 = await ratios(page);
  const k = center(await box(knob(page)));
  await drag(page, k, { x: k.x + 40, y: k.y }, 6);
  const r1 = await ratios(page);
  expect(r1.top).toBeGreaterThan(r0.top);
  expect(r1.bottom).toBeCloseTo(r1.top);
  expect(r1.root).toBeCloseTo(r0.root);
  await expect(knob(page)).toHaveCount(1); // still aligned
});

test('dragging the knob up or down moves the horizontal line', async ({ page }) => {
  const r0 = await ratios(page);
  const k = center(await box(knob(page)));
  await drag(page, k, { x: k.x, y: k.y + 40 }, 6);
  const r1 = await ratios(page);
  expect(r1.root).toBeGreaterThan(r0.root);
  expect(r1.top).toBeCloseTo(r0.top);
});

test('snapping a segment back into line brings the knob back', async ({ page }) => {
  const top = await pill(page, 0);
  await drag(page, top, { x: top.x + 40, y: top.y }, 6);
  await expect(knob(page)).toHaveCount(0);
  const again = await pill(page, 0);
  await drag(page, again, { x: again.x - 39, y: again.y }, 6); // snaps to the bottom line
  await expect(knob(page)).toHaveCount(1);
});

test('Alt on a segment moves the whole line (desktop shortcut)', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard modifier');
  const top = await pill(page, 0);
  await page.keyboard.down('Alt');
  await drag(page, top, { x: top.x + 40, y: top.y }, 6);
  await page.keyboard.up('Alt');
  const r = await ratios(page);
  expect(r.bottom).toBeCloseTo(r.top);
  expect(r.top).toBeGreaterThan(0.55);
});

test('the knob hides together with the edge handles', async ({ page }) => {
  await page.getByTestId('toggle-handles').click();
  await expect(knob(page)).toBeHidden();
  await page.getByTestId('toggle-handles').click();
  await expect(knob(page)).toBeVisible();
});

test('touch: dragging the knob moves the whole line', async ({ page }, info) => {
  test.skip(!info.project.use.hasTouch, 'touch-only');
  const k = center(await box(knob(page)));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [k] });
  for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: k.x + i * 4, y: k.y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const r = await ratios(page);
  expect(r.top).toBeGreaterThan(0.55);
  expect(r.bottom).toBeCloseTo(r.top);
});

import { expect, test } from '@playwright/test';
import { box, cells, center, dividers, drag, getDoc, openApp } from './fixtures';

test.beforeEach(async ({ page }) => openApp(page));

test('starts with an A4 portrait page and a 2×2 grid', async ({ page }) => {
  const p = await box(page.getByTestId('page'));
  expect(p.width / p.height).toBeCloseTo(210 / 297, 2);
  await expect(cells(page)).toHaveCount(4);
  await expect(dividers(page)).toHaveCount(3);
  const doc = await getDoc(page);
  expect(doc.formatId).toBe('a4');
  expect(doc.orientation).toBe('portrait');
});

test('dragging an edge resizes neighbours smoothly and keeps DOM nodes', async ({ page }) => {
  const v = dividers(page, 'v').first();
  // Tag DOM nodes – re-created nodes would lose the tag (that was the old flicker bug).
  await page.evaluate(() => document.querySelectorAll('[data-testid="cell"], [data-testid="divider"]').forEach((n) => ((n as any).__tag = 1)));

  const start = center(await box(v));
  const firstCell = cells(page).first();
  const w0 = (await box(firstCell)).width;

  const widths = await drag(page, start, { x: start.x + 60, y: start.y }, 12, async () => (await box(firstCell)).width);

  // Monotonic growth, no jumps back, ends ~60px wider.
  for (let i = 1; i < widths.length; i++) expect(widths[i]!).toBeGreaterThanOrEqual(widths[i - 1]! - 0.5);
  expect(widths.at(-1)! - w0).toBeGreaterThan(50);
  expect(widths.at(-1)! - w0).toBeLessThan(70);

  const tagged = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="cell"], [data-testid="divider"]')].every((n) => (n as any).__tag === 1),
  );
  expect(tagged).toBe(true);
});

test('aligned edges move together (table-like), unlinked with Alt', async ({ page }) => {
  const [top, bottom] = [dividers(page, 'v').nth(0), dividers(page, 'v').nth(1)];
  const s = center(await box(top));
  await drag(page, s, { x: s.x + 40, y: s.y }, 8);
  expect(Math.abs((await box(top)).x - (await box(bottom)).x)).toBeLessThan(1);

  const s2 = center(await box(top));
  await page.keyboard.down('Alt');
  await drag(page, s2, { x: s2.x - 80, y: s2.y }, 8);
  await page.keyboard.up('Alt');
  expect((await box(bottom)).x - (await box(top)).x).toBeGreaterThan(60);
});

test('edges stop before a cell collapses', async ({ page }) => {
  const v = dividers(page, 'v').first();
  const s = center(await box(v));
  await drag(page, s, { x: 0, y: s.y }, 10);
  const pageBox = await box(page.getByTestId('page'));
  const scale = pageBox.width / 210;
  const first = await box(cells(page).first());
  expect(first.width / scale).toBeGreaterThanOrEqual(11.9);
});

test('double-click on an edge flips side-by-side ↔ stacked', async ({ page }) => {
  const v = dividers(page, 'v').first();
  const before = await getDoc(page);
  const id = before.tree.first.id;
  expect(before.tree.first.dir).toBe('v');
  await v.dblclick();
  await expect.poll(async () => (await getDoc(page)).tree.first.dir).toBe('h');
  // The two photos of the top row are now stacked.
  const [a, b] = [await box(cells(page).nth(0)), await box(cells(page).nth(1))];
  expect(b.y).toBeGreaterThan(a.y + a.height - 1);
  expect(Math.abs(a.x - b.x)).toBeLessThan(1);

  // Flip back with another double-click on the same (now horizontal) divider.
  await page.locator(`[data-testid="divider"][data-id="${id}"]`).dblclick();
  await expect.poll(async () => (await getDoc(page)).tree.first.dir).toBe('v');
});

test('single clicks on an edge do not flip it', async ({ page }) => {
  const v = dividers(page, 'v').first();
  await v.click();
  await page.waitForTimeout(500);
  await v.click();
  expect((await getDoc(page)).tree.first.dir).toBe('v');
});

test('undo / redo an edge drag as one step', async ({ page }) => {
  const v = dividers(page, 'v').first();
  const ratio0 = (await getDoc(page)).tree.first.ratio;
  const s = center(await box(v));
  await drag(page, s, { x: s.x + 50, y: s.y }, 10);
  const ratio1 = (await getDoc(page)).tree.first.ratio;
  expect(ratio1).toBeGreaterThan(ratio0);
  await page.getByTestId('undo').click();
  await expect.poll(async () => (await getDoc(page)).tree.first.ratio).toBeCloseTo(ratio0);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(async () => (await getDoc(page)).tree.first.ratio).toBeCloseTo(ratio1);
});

test('crop mode pans the photo inside its cell', async ({ page }) => {
  await page.getByTestId('mode-crop').click();
  // Cell 0 shows a landscape photo in a portrait cell → horizontal overflow.
  const c = center(await box(cells(page).first()));
  await drag(page, c, { x: c.x - 40, y: c.y }, 6);
  const doc = await getDoc(page);
  expect(doc.tree.first.first.crop.panX).toBeLessThan(0);
  expect(doc.tree.first.first.crop.panX).toBeGreaterThanOrEqual(-1);
});

test('changing format keeps the layout and resizes the page', async ({ page }) => {
  await page.getByTestId('tab-layout').click();
  await page.locator('[data-format="square"]').click();
  const p = await box(page.getByTestId('page'));
  expect(p.width / p.height).toBeCloseTo(1, 2);
  await expect(cells(page)).toHaveCount(4);
  await page.getByTestId('orientation').click();
  await page.locator('[data-format="a4"]').click();
  const p2 = await box(page.getByTestId('page'));
  expect(p2.width / p2.height).toBeCloseTo(297 / 210, 2);
});

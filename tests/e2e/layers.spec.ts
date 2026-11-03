import { expect, test } from '@playwright/test';
import { box, cells, center, dividers, drag, getDoc, makePng, openApp } from './fixtures';

test.beforeEach(async ({ page }) => openApp(page));

async function addLayer(page: import('@playwright/test').Page, color: [number, number, number] = [255, 0, 0]) {
  await page.getByTestId('tab-photos').click();
  await page.locator('#file-layer').setInputFiles({ name: 'layer.png', mimeType: 'image/png', buffer: makePng(60, 40, color) });
  await expect(page.getByTestId('float')).not.toHaveCount(0);
}

test('adds a free-floating photo above the grid and switches to layers mode', async ({ page }) => {
  await addLayer(page);
  await expect(page.getByTestId('float')).toHaveCount(1);
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'layers');
  await expect(page.getByTestId('float-toolbar')).toBeVisible();
  // Grid untouched.
  await expect(cells(page)).toHaveCount(4);
  // The float is what you hit at the page centre.
  const c = center(await box(page.getByTestId('page')));
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-testid]')?.getAttribute('data-testid'), c);
  expect(hit).toBe('float');
});

test('moves, resizes and rotates a layer', async ({ page }) => {
  await addLayer(page);
  const f = page.getByTestId('float');
  const d0 = (await getDoc(page)).floats[0];
  const c = center(await box(f));
  await drag(page, c, { x: c.x + 30, y: c.y + 20 }, 6);
  const d1 = (await getDoc(page)).floats[0];
  expect(d1.cx).toBeGreaterThan(d0.cx);
  expect(d1.cy).toBeGreaterThan(d0.cy);

  const rz = center(await box(f.locator('.h-resize')));
  await drag(page, rz, { x: rz.x + 40, y: rz.y + 30 }, 6);
  expect((await getDoc(page)).floats[0].size).toBeGreaterThan(d1.size);

  const rt = center(await box(f.locator('.h-rotate')));
  const fc = center(await box(f));
  await drag(page, rt, { x: fc.x + 120, y: fc.y }, 10);
  expect(Math.abs((await getDoc(page)).floats[0].rotation)).toBeGreaterThan(30);
});

test('layers stack in order and can be reordered', async ({ page }) => {
  await addLayer(page, [255, 0, 0]);
  await addLayer(page, [0, 0, 255]);
  const [a, b] = (await getDoc(page)).floats.map((f: any) => f.id);
  await page.getByTestId('float-toolbar').locator('[data-act="back"]').click();
  expect((await getDoc(page)).floats.map((f: any) => f.id)).toEqual([b, a]);
});

test('layers do not block edges in edges mode', async ({ page }) => {
  await addLayer(page);
  await page.getByTestId('mode-edges').click();
  const h = await box(dividers(page, 'h').first());
  // A point on the horizontal edge that lies under the float (float is centred, ~45% wide).
  const s = { x: h.x + h.width * 0.38, y: h.y + h.height / 2 };
  const under = await page.evaluate(({ x, y }) => {
    const f = document.querySelector('[data-testid="float"]')!.getBoundingClientRect();
    return x > f.left && x < f.right && y > f.top && y < f.bottom;
  }, s);
  expect(under).toBe(true);
  const r0 = (await getDoc(page)).tree.ratio;
  await drag(page, s, { x: s.x, y: s.y + 40 }, 6);
  expect((await getDoc(page)).tree.ratio).toBeGreaterThan(r0);
});

test('delete removes the selected layer and undo restores it', async ({ page }) => {
  await addLayer(page);
  await page.getByTestId('float-toolbar').locator('[data-act="remove"]').click();
  await expect(page.getByTestId('float')).toHaveCount(0);
  await page.getByTestId('undo').click();
  await expect(page.getByTestId('float')).toHaveCount(1);
});

test('adding a photo to the grid splits a cell and keeps edge tweaks', async ({ page }) => {
  const v = dividers(page, 'v').first();
  const s = center(await box(v));
  await drag(page, s, { x: s.x + 30, y: s.y }, 5);
  const ratio = (await getDoc(page)).tree.first.ratio;
  await page.getByTestId('tab-photos').click();
  await page.locator('#file-grid').setInputFiles({ name: 'g.png', mimeType: 'image/png', buffer: makePng(40, 40, [0, 200, 0]) });
  await expect(cells(page)).toHaveCount(5);
  expect((await getDoc(page)).tree.first.ratio).toBeCloseTo(ratio);
});

test('the gap slider also sets the frame width of every layer', async ({ page }) => {
  await addLayer(page, [255, 0, 0]);
  await addLayer(page, [0, 0, 255]);
  const frames = async () =>
    page.getByTestId('float').evaluateAll((els) => els.map((e) => parseFloat(getComputedStyle(e).paddingLeft)));
  const before = await frames();
  await page.locator('.tab[data-tab="tab-style"]').click();
  await page.locator('#rng-gap').fill('12');
  await expect.poll(async () => (await frames())[0]).toBeGreaterThan(before[0]!);
  const after = await frames();
  const scale = (await page.getByTestId('page').boundingBox())!.width / 210;
  for (const w of after) expect(w).toBeCloseTo(12 * scale, 0);
  expect(after[0]).toBeGreaterThan(before[0]!);
  // Turning the frame off on one layer removes it only there.
  await page.getByTestId('float-toolbar').locator('[data-act="frame"]').click();
  await expect.poll(async () => (await frames()).filter((w) => w === 0).length).toBe(1);
});

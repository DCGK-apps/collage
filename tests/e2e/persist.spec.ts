import { expect, test, type Page } from '@playwright/test';
import { box, cells, center, dividers, drag, getDoc, makePng, openApp } from './fixtures';

test.beforeEach(async ({ page }) => openApp(page));

async function saveAndReload(page: Page) {
  await page.evaluate(() => (window as any).__collage.flushSave());
  await page.reload();
  await expect(page.locator('body[data-ready="true"]')).toBeAttached();
}

/** All visible photos actually decoded (not broken images). */
const photosLoaded = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLImageElement>('[data-testid="cell"]:not(.empty) img, [data-testid="float"] img')].every(
      (i) => i.complete && i.naturalWidth > 0,
    ),
  );

test('the collage survives a reload: edges, style, photos and layers', async ({ page }) => {
  const s = center(await box(dividers(page, 'v').first()));
  await drag(page, s, { x: s.x + 40, y: s.y }, 6);
  await page.getByTestId('tab-photos').click();
  await page.locator('#file-grid').setInputFiles({ name: 'g.png', mimeType: 'image/png', buffer: makePng(80, 60, [0, 160, 0]) });
  await expect(cells(page)).toHaveCount(5);
  await page.locator('#file-layer').setInputFiles({ name: 'l.png', mimeType: 'image/png', buffer: makePng(60, 40, [200, 0, 0]) });
  await expect(page.getByTestId('float')).toHaveCount(1);
  await page.locator('.tab[data-tab="tab-style"]').click();
  await page.locator('#rng-gap').fill('9');
  const before = await getDoc(page);

  await saveAndReload(page);

  expect(await getDoc(page)).toEqual(before);
  await expect(cells(page)).toHaveCount(5);
  await expect(page.getByTestId('float')).toHaveCount(1);
  await expect.poll(() => photosLoaded(page)).toBe(true);
});

test('autosave happens on its own shortly after a change', async ({ page }) => {
  const s = center(await box(dividers(page, 'v').first()));
  await drag(page, s, { x: s.x + 40, y: s.y }, 6);
  const ratio = (await getDoc(page)).tree.first.ratio;
  await page.waitForTimeout(1000); // debounce is 400 ms
  await page.reload();
  await expect(page.locator('body[data-ready="true"]')).toBeAttached();
  expect((await getDoc(page)).tree.first.ratio).toBeCloseTo(ratio);
});

test('“Nowy kolaż” starts an empty layout, undo brings the old one back', async ({ page }) => {
  await page.locator('.tab[data-tab="tab-layout"]').click();
  await page.getByTestId('new-project').click();
  await expect(cells(page)).toHaveCount(4);
  await expect(page.locator('[data-testid="cell"].empty')).toHaveCount(4);
  await page.getByTestId('undo').click();
  await expect(page.locator('[data-testid="cell"].empty')).toHaveCount(0);
  // A new project is saved as well.
  await page.getByTestId('new-project').click();
  await saveAndReload(page);
  await expect(page.locator('[data-testid="cell"].empty')).toHaveCount(4);
  expect((await getDoc(page)).library).toEqual([]);
});

test('custom page size (mm or px) survives a reload and is offered again for a new collage', async ({ page }) => {
  await page.getByTestId('tab-layout').click();
  await page.getByTestId('format-custom').click();
  await page.getByTestId('unit-px').click();
  await page.getByTestId('custom-w').fill('1920');
  await page.getByTestId('custom-h').fill('1080');
  await page.getByTestId('custom-h').press('Enter');
  let doc = await getDoc(page);
  expect(doc.formatId).toBe('custom');
  expect(doc.orientation).toBe('landscape');
  const p = await box(page.getByTestId('page'));
  expect(p.width / p.height).toBeCloseTo(1920 / 1080, 2);

  await saveAndReload(page);
  await page.getByTestId('tab-layout').click();
  doc = await getDoc(page);
  expect(doc.formatId).toBe('custom');
  expect(doc.customMm).toEqual({ w: 91.44, h: 162.56 });
  await expect(page.getByTestId('custom-w')).toHaveValue('1920');
  await expect(page.getByTestId('custom-h')).toHaveValue('1080');

  // Switching away and back on a fresh document brings the last size back from preferences.
  await page.locator('#format-chips [data-format="a4"]').click();
  await page.evaluate(() => {
    const c = (window as any).__collage;
    c.store.doc.customMm = undefined;
  });
  await page.getByTestId('format-custom').click();
  doc = await getDoc(page);
  expect(doc.customMm).toEqual({ w: 91.44, h: 162.56 });
  expect(doc.orientation).toBe('landscape');
});

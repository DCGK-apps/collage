import { expect, test } from '@playwright/test';
import { cells, getDoc, makePng, openApp, settle } from './fixtures';

const photosIn = (t: any): string[] => (t.type === 'cell' ? [t.photoId] : [...photosIn(t.first), ...photosIn(t.second)]);

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await page.locator('.tab[data-tab="tab-layout"]').click();
});

test('“Losuj” builds a random layout with the same photos and keeps the style', async ({ page }) => {
  // A style chosen by the user must survive every draw.
  await page.locator('#rng-gap').evaluate((el: HTMLInputElement) => {
    el.value = '7';
    el.dispatchEvent(new Event('input'));
    el.dispatchEvent(new Event('change'));
  });
  const before = await getDoc(page);
  expect(before.style.gapMm).toBe(7);
  const seen = new Set<string>();
  for (let i = 0; i < 6; i++) {
    await page.getByTestId('random-layout').click();
    const doc = await getDoc(page);
    expect(photosIn(doc.tree).sort()).toEqual(photosIn(before.tree).sort());
    expect(doc.style).toEqual(before.style);
    seen.add(JSON.stringify(doc.tree, (k, v) => (k === 'id' ? undefined : v)));
  }
  await expect(cells(page)).toHaveCount(4);
  expect(seen.size).toBeGreaterThan(1);
  await expect(page.getByTestId('random-layout')).toHaveClass(/active/);
});

test('one “Cofnij” restores the layout', async ({ page }) => {
  const before = await getDoc(page);
  await page.getByTestId('random-layout').click();
  await page.getByTestId('undo').click();
  const after = await getDoc(page);
  expect(after.tree).toEqual(before.tree);
  expect(after.style.gapMm).toBe(before.style.gapMm);
});

/** Cells whose shape disagrees with their photo (portrait photo in a wide cell or vice versa). */
const misfits = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const { store } = (window as any).__collage;
    const byId = new Map<string, string | null>();
    const walk = (n: any): unknown => (n.type === 'cell' ? byId.set(n.id, n.photoId) : (walk(n.first), walk(n.second)));
    walk(store.doc.tree);
    let bad = 0;
    let seen = 0;
    for (const el of document.querySelectorAll<HTMLElement>('[data-testid="cell"]')) {
      const p = store.photos.get(byId.get(el.dataset.id!));
      const r = el.getBoundingClientRect();
      if (!p) continue;
      seen++;
      if (p.height > p.width !== r.height > r.width) bad++;
    }
    if (seen !== 5) throw new Error(`expected 5 photos in cells, saw ${seen}`);
    return bad;
  });

test('“Losuj” and “Wymieszaj” put portrait photos into tall cells and landscape into wide ones', async ({ page }) => {
  await page.getByTestId('new-project').click();
  await page.getByTestId('tab-photos').click();
  await page.locator('#file-grid').setInputFiles([
    { name: 'p1.png', mimeType: 'image/png', buffer: makePng(60, 80, [200, 0, 0]) },
    { name: 'p2.png', mimeType: 'image/png', buffer: makePng(60, 80, [0, 200, 0]) },
    { name: 'l1.png', mimeType: 'image/png', buffer: makePng(80, 60, [0, 0, 200]) },
    { name: 'l2.png', mimeType: 'image/png', buffer: makePng(80, 60, [200, 200, 0]) },
    { name: 'l3.png', mimeType: 'image/png', buffer: makePng(80, 60, [0, 200, 200]) },
  ]);
  await expect(cells(page)).toHaveCount(5);
  await page.locator('.tab[data-tab="tab-layout"]').click();

  let bad = 0;
  for (let i = 0; i < 6; i++) {
    await page.getByTestId('random-layout').click();
    await settle(page);
    bad += await misfits(page);
  }
  // A rare draw may leave one photo in a near-square cell of the "wrong" side.
  expect(bad).toBeLessThanOrEqual(3);

  // „Wymieszaj” keeps the layout; it must not do worse than the draw it starts from.
  const afterDraw = await misfits(page);
  const style = (await getDoc(page)).style;
  await page.getByTestId('tab-photos').click();
  bad = 0;
  for (let i = 0; i < 6; i++) {
    await page.locator('#btn-shuffle').click();
    await settle(page);
    bad += await misfits(page);
  }
  expect(bad).toBeLessThanOrEqual(6 * afterDraw + 2);
  expect((await getDoc(page)).style).toEqual(style);
});

import { expect, test } from '@playwright/test';
import { cells, getDoc, openApp } from './fixtures';

const GAPS = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12];
const photosIn = (t: any): string[] => (t.type === 'cell' ? [t.photoId] : [...photosIn(t.first), ...photosIn(t.second)]);

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await page.locator('.tab[data-tab="tab-layout"]').click();
});

test('“Losuj” builds a random layout with the same photos and a random separator width', async ({ page }) => {
  const before = await getDoc(page);
  const seen = new Set<string>();
  for (let i = 0; i < 6; i++) {
    await page.getByTestId('random-layout').click();
    const doc = await getDoc(page);
    expect(photosIn(doc.tree).sort()).toEqual(photosIn(before.tree).sort());
    expect(GAPS).toContain(doc.style.gapMm);
    seen.add(JSON.stringify(doc.tree, (k, v) => (k === 'id' ? undefined : v)));
  }
  await expect(cells(page)).toHaveCount(4);
  expect(seen.size).toBeGreaterThan(1);
  await expect(page.getByTestId('random-layout')).toHaveClass(/active/);
});

test('one “Cofnij” restores both the layout and the separator width', async ({ page }) => {
  const before = await getDoc(page);
  await page.getByTestId('random-layout').click();
  await page.getByTestId('undo').click();
  const after = await getDoc(page);
  expect(after.tree).toEqual(before.tree);
  expect(after.style.gapMm).toBe(before.style.gapMm);
});

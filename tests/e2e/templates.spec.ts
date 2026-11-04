import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { cells, getDoc, openApp } from './fixtures';

const openTab = (page: Page) => page.getByTestId('tab-templates').click();
const cards = (page: Page) => page.getByTestId('template');

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await openTab(page);
});

test('gallery shows built-in templates, matching the photo count first', async ({ page }) => {
  // The demo has 4 photos.
  await expect(page.getByTestId('template-filter-match')).toContainText('Dla 4 zdjęć');
  const n = await cards(page).count();
  expect(n).toBeGreaterThan(0);
  for (const meta of await page.locator('.tpl-meta').allTextContents()) expect(meta).toContain('4 zdjęcia');
  await page.getByTestId('template-filter-all').click();
  expect(await cards(page).count()).toBeGreaterThan(n);
});

test('applying a template uses the current photos; one undo restores the layout', async ({ page }) => {
  const before = await getDoc(page);
  await page.getByTestId('template-filter-all').click();
  await cards(page).filter({ hasText: 'Siatka 3×3' }).locator('.tpl-thumb').click();
  await expect(cells(page)).toHaveCount(9);
  await expect(page.locator('[data-testid="cell"].empty')).toHaveCount(5); // 4 photos, 9 slots
  await page.getByTestId('undo').click();
  expect((await getDoc(page)).tree).toEqual(before.tree);
});

test('a template with floating layers places photos as layers', async ({ page }) => {
  await cards(page).filter({ hasText: 'Tło + polaroidy' }).locator('.tpl-thumb').click();
  await expect(cells(page)).toHaveCount(1);
  await expect(page.getByTestId('float')).toHaveCount(3);
  expect((await getDoc(page)).style.gapMm).toBe(0);
});

async function saveCurrent(page: Page, name: string) {
  page.once('dialog', (d) => d.accept(name));
  await page.getByTestId('template-save').click();
  await expect(cards(page).filter({ hasText: name })).toHaveCount(1);
}

test('save the current layout as a template, export it and import it on another device', async ({ page, browser }) => {
  // Make the layout distinctive, then save.
  await page.evaluate(() => {
    const { store } = (window as any).__collage;
    store.edit((d: any) => {
      d.tree.ratio = 0.37;
    });
  });
  await saveCurrent(page, 'Mój test');
  const card = cards(page).filter({ hasText: 'Mój test' });
  await expect(card).toHaveAttribute('data-builtin', 'false');

  const [dl] = await Promise.all([page.waitForEvent('download'), card.getByTestId('template-export').click()]);
  expect(dl.suggestedFilename()).toBe('moj-test.collage-template.json');
  const file = await readFile((await dl.path())!);
  const json = JSON.parse(file.toString());
  expect(json).toMatchObject({ type: 'collage-template', version: 1, name: 'Mój test', slots: 4 });
  expect(JSON.stringify(json)).not.toContain('demo'); // no photos inside

  // "Another device": a fresh browser context with empty storage.
  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  await openApp(other);
  await openTab(other);
  await expect(cards(other).filter({ hasText: 'Mój test' })).toHaveCount(0);
  await other.locator('#file-templates').setInputFiles({ name: 'moj-test.collage-template.json', mimeType: 'application/json', buffer: file });
  const imported = cards(other).filter({ hasText: 'Mój test' });
  await expect(imported).toHaveCount(1);
  await imported.locator('.tpl-thumb').click();
  expect((await getDoc(other)).tree.ratio).toBeCloseTo(0.37);
  // Importing the same file again does not duplicate it.
  await other.locator('#file-templates').setInputFiles({ name: 'again.json', mimeType: 'application/json', buffer: file });
  await expect(other.locator('#toast')).toContainText('już były: 1');
  await expect(cards(other).filter({ hasText: 'Mój test' })).toHaveCount(1);
  await ctx.close();
});

test('user templates survive a reload and can be deleted', async ({ page }) => {
  await saveCurrent(page, 'Do usunięcia');
  await page.reload();
  await expect(page.locator('body[data-ready="true"]')).toBeAttached();
  await openTab(page);
  const card = cards(page).filter({ hasText: 'Do usunięcia' });
  await expect(card).toHaveCount(1);
  await card.getByTestId('template-delete').click();
  await expect(card).toHaveCount(0);
});

test('saving an identical layout twice is refused', async ({ page }) => {
  await saveCurrent(page, 'Pierwszy');
  page.once('dialog', (d) => d.accept('Drugi'));
  await page.getByTestId('template-save').click();
  await expect(page.locator('#toast')).toContainText('Taki szablon już jest');
  await expect(cards(page).filter({ hasText: 'Drugi' })).toHaveCount(0);
});

test('invalid files are reported and ignored', async ({ page }) => {
  const before = await cards(page).count();
  await page.locator('#file-templates').setInputFiles([
    { name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{ not json') },
    { name: 'other.json', mimeType: 'application/json', buffer: Buffer.from('{"type":"something-else"}') },
  ]);
  await expect(page.locator('#toast')).toContainText('nieprawidłowe: 2');
  await page.getByTestId('template-filter-match').click();
  expect(await cards(page).count()).toBe(before);
});

import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { box, cells, center, dividers, drag, getDoc, makePng, openApp } from './fixtures';

const photosLoaded = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLImageElement>('[data-testid="cell"]:not(.empty) img, [data-testid="float"] img')].every(
      (i) => i.complete && i.naturalWidth > 0,
    ),
  );

async function saveProject(page: Page): Promise<{ name: string; data: Buffer }> {
  await page.getByTestId('open-export').click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('project-save').click()]);
  return { name: dl.suggestedFilename(), data: await readFile((await dl.path())!) };
}

async function openProject(page: Page, name: string, data: Buffer) {
  await page.getByTestId('open-export').click();
  await page.locator('#file-project').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: data });
}

test('save the whole collage to a .collage file and open it on another device', async ({ page, browser }) => {
  await openApp(page);
  const s = center(await box(dividers(page, 'v').first()));
  await drag(page, s, { x: s.x + 40, y: s.y }, 6);
  await page.getByTestId('tab-photos').click();
  await page.locator('#file-grid').setInputFiles({ name: 'Wakacje.png', mimeType: 'image/png', buffer: makePng(80, 60, [0, 160, 0]) });
  await page.locator('#file-layer').setInputFiles({ name: 'Polaroid.png', mimeType: 'image/png', buffer: makePng(60, 40, [200, 0, 0]) });
  await expect(page.getByTestId('float')).toHaveCount(1);
  const before = await getDoc(page);

  const { name, data } = await saveProject(page);
  expect(name).toMatch(/^kolaz-\d{4}-\d{2}-\d{2}\.collage$/);
  expect(data.subarray(0, 2).toString()).toBe('PK');
  expect(data.includes(Buffer.from('project.json'))).toBe(true);

  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  await openApp(other);
  await openProject(other, name, data);
  await expect(other.locator('#toast')).toContainText('Otwarto projekt');
  await expect(other.getByTestId('export-modal')).not.toHaveClass(/open/);
  expect(await getDoc(other)).toEqual(before);
  await expect(cells(other)).toHaveCount(5);
  await expect(other.getByTestId('float')).toHaveCount(1);
  await expect.poll(() => photosLoaded(other)).toBe(true);

  // Opening is undoable.
  await other.getByTestId('undo').click();
  await expect(cells(other)).toHaveCount(4);
  await ctx.close();
});

test('a file that is not a project is refused with a message', async ({ page }) => {
  await openApp(page);
  const before = await getDoc(page);
  await openProject(page, 'notatki.collage', Buffer.from('to nie jest zip'));
  await expect(page.locator('#toast')).toContainText('To nie jest plik ZIP');
  expect(await getDoc(page)).toEqual(before);
});

test('“Otwórz kolaż…” in the Układ panel opens a saved project', async ({ page, browser }) => {
  await openApp(page);
  const s = center(await box(dividers(page, 'v').first()));
  await drag(page, s, { x: s.x + 40, y: s.y }, 6);
  const before = await getDoc(page);
  const { name, data } = await saveProject(page);

  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  await openApp(other);
  await other.getByTestId('tab-layout').click();
  const [chooser] = await Promise.all([other.waitForEvent('filechooser'), other.getByTestId('open-project-quick').click()]);
  await chooser.setFiles({ name, mimeType: 'application/octet-stream', buffer: data });
  await expect(other.locator('#toast')).toContainText('Otwarto projekt');
  expect(await getDoc(other)).toEqual(before);
  await ctx.close();
});

test('the save dialog scrolls on short screens with large text, so “Otwórz projekt” is reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 420 });
  await openApp(page);
  await page.addStyleTag({ content: '.modal-box .btn, .modal-box .label, .modal-box .muted { font-size: 17px !important; }' });
  await page.getByTestId('open-export').click();
  const open = page.getByTestId('project-open');
  await open.scrollIntoViewIfNeeded();
  const b = (await open.boundingBox())!;
  expect(b.y).toBeGreaterThanOrEqual(0);
  expect(b.y + b.height).toBeLessThanOrEqual(420 + 0.5);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), open.click()]);
  expect(chooser).toBeTruthy();
  // The top of the dialog (title, close button) must be reachable as well.
  const close = page.locator('#btn-close-export');
  await close.scrollIntoViewIfNeeded();
  const c = (await close.boundingBox())!;
  expect(c.y).toBeGreaterThanOrEqual(0);
  await close.click();
  await expect(page.getByTestId('export-modal')).not.toHaveClass(/open/);
});

import { expect, test, type Page } from '@playwright/test';
import { openApp } from './fixtures';

/**
 * Scripted stand-in for the browser's "Save as" dialog (File System Access API):
 * records what the app asked for and keeps the written bytes on window.__saved.
 * `answer` – 'save' writes to the chosen name, 'cancel' closes the dialog.
 */
async function installPicker(page: Page, answer: 'save' | 'cancel' = 'save', chosenName?: string) {
  await page.addInitScript(
    ({ answer, chosenName }) => {
      const w = window as any;
      w.__pickerCalls = [];
      w.__saved = [];
      w.showSaveFilePicker = async (opts: any) => {
        w.__pickerCalls.push({ id: opts.id, suggestedName: opts.suggestedName, accept: opts.types?.[0]?.accept });
        if (answer === 'cancel') throw new DOMException('closed', 'AbortError');
        const name = chosenName ?? opts.suggestedName;
        return {
          name,
          async createWritable() {
            const parts: Blob[] = [];
            return {
              async write(b: Blob) {
                parts.push(b);
              },
              async close() {
                const bytes = new Uint8Array(await new Blob(parts).arrayBuffer());
                w.__saved.push({ name, size: bytes.length, head: Array.from(bytes.slice(0, 4)) });
              },
            };
          },
        };
      };
    },
    { answer, chosenName },
  );
}

const calls = (page: Page) => page.evaluate(() => (window as any).__pickerCalls);
const saved = (page: Page) => page.evaluate(() => (window as any).__saved);

test('PNG export opens a "Save as" dialog that remembers the collage folder', async ({ page }) => {
  await installPicker(page, 'save', 'wakacje.png');
  await openApp(page, { savePicker: true });
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.getByTestId('open-export').click();
  await expect(page.getByTestId('save-where')).toBeVisible();
  await expect(page.getByTestId('ask-save')).toBeChecked();
  await expect(page.getByTestId('save-where-hint')).toBeHidden();

  await page.getByTestId('export-png').click();
  await expect(page.locator('#toast')).toContainText('Zapisano PNG wakacje.png');
  expect(await calls(page)).toEqual([{ id: 'collage-kolaze', suggestedName: 'kolaz.png', accept: { 'image/png': ['.png'] } }]);
  const [file] = await saved(page);
  expect(file.name).toBe('wakacje.png');
  expect(file.head).toEqual([0x89, 0x50, 0x4e, 0x47]);
  expect(downloads).toBe(0);
});

test('PDF, JPG and the project share one folder; templates have their own', async ({ page }) => {
  await installPicker(page);
  await openApp(page, { savePicker: true });
  await page.getByTestId('open-export').click();
  await page.getByTestId('export-pdf').click();
  await expect.poll(async () => (await saved(page)).length).toBe(1);
  await page.getByTestId('export-jpg').click();
  await expect.poll(async () => (await saved(page)).length).toBe(2);
  await page.getByTestId('project-save').click();
  await expect.poll(async () => (await saved(page)).length).toBe(3);
  await expect(page.locator('#toast')).toContainText(/Zapisano projekt kolaz-.*\.collage/);
  const c = await calls(page);
  expect(c.map((x: any) => x.id)).toEqual(['collage-kolaze', 'collage-kolaze', 'collage-kolaze']);
  expect(c.map((x: any) => x.suggestedName.split('.').pop())).toEqual(['pdf', 'jpg', 'collage']);
  const s = await saved(page);
  expect(String.fromCharCode(...s[0].head)).toBe('%PDF');
  expect(s[1].head.slice(0, 2)).toEqual([0xff, 0xd8]);
  expect(String.fromCharCode(...s[2].head.slice(0, 2))).toBe('PK');

  await page.locator('#btn-close-export').click();
  await page.getByTestId('tab-templates').click();
  await page.getByTestId('template-export').first().click();
  await expect.poll(async () => (await calls(page)).length).toBe(4);
  expect((await calls(page))[3].id).toBe('collage-szablony');
});

test('closing the dialog saves nothing and does not fall back to a download', async ({ page }) => {
  await installPicker(page, 'cancel');
  await openApp(page, { savePicker: true });
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.getByTestId('open-export').click();
  await page.getByTestId('export-png').click();
  await expect.poll(async () => (await calls(page)).length).toBe(1);
  await page.waitForTimeout(300);
  expect(downloads).toBe(0);
  await expect(page.locator('#toast')).not.toContainText(/Pobrano|Zapisano/);
});

test('“Pytaj, gdzie zapisać” can be turned off and the choice is remembered', async ({ page }) => {
  await installPicker(page);
  await openApp(page, { savePicker: true });
  await page.getByTestId('open-export').click();
  await page.getByTestId('ask-save').uncheck();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-png').click()]);
  expect(dl.suggestedFilename()).toBe('kolaz.png');
  expect(await calls(page)).toEqual([]);

  await page.reload();
  await expect(page.locator('body[data-ready="true"]')).toBeAttached();
  await page.getByTestId('open-export').click();
  await expect(page.getByTestId('ask-save')).not.toBeChecked();
});

test('browsers without the dialog download as before and explain where to change the folder', async ({ page }) => {
  await openApp(page);
  await page.getByTestId('open-export').click();
  await expect(page.getByTestId('save-where')).toBeHidden();
  await expect(page.getByTestId('save-where-hint')).toBeVisible();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-png').click()]);
  expect(dl.suggestedFilename()).toBe('kolaz.png');
});

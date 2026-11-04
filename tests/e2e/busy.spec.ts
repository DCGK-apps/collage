import { expect, test } from '@playwright/test';
import { openApp } from './fixtures';

test.beforeEach(async ({ page }) => openApp(page));

/** Record every label the busy indicator shows (it may be visible only for a moment). */
async function watchBusy(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as any).__busySeen = seen;
    new MutationObserver(() => {
      const el = document.getElementById('busy');
      if (el && !el.hidden) seen.push(el.textContent!.trim());
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] });
  });
}

test('exporting a PNG shows the busy indicator and blocks the interface until done', async ({ page }) => {
  await watchBusy(page);
  await page.getByTestId('open-export').click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-png').click()]);
  expect(dl.suggestedFilename()).toBe('kolaz.png');
  expect(await page.evaluate(() => (window as any).__busySeen)).toContain('Tworzę PNG…');
  await expect(page.getByTestId('busy')).toBeHidden();
  await expect(page.locator('body')).not.toHaveAttribute('aria-busy', 'true');
});

test('PDF export and project save show their own labels', async ({ page }) => {
  await watchBusy(page);
  await page.getByTestId('open-export').click();
  await Promise.all([page.waitForEvent('download'), page.getByTestId('export-pdf').click()]);
  await Promise.all([page.waitForEvent('download'), page.getByTestId('project-save').click()]);
  const seen: string[] = await page.evaluate(() => (window as any).__busySeen);
  expect(seen).toContain('Tworzę PDF…');
  expect(seen).toContain('Zapisuję projekt…');
});

test('the overlay covers the page and swallows clicks while busy', async ({ page }) => {
  const { clicked, covered } = await page.evaluate(async () => {
    const { withBusy } = (window as any).__collage;
    let clicked = false;
    let covered = false;
    const btn = document.querySelector<HTMLElement>('[data-testid="open-export"]')!;
    btn.addEventListener('click', () => (clicked = true), { once: true });
    await withBusy('Test…', async () => {
      const r = btn.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      covered = hit?.closest('#busy') !== null;
    });
    return { clicked, covered };
  });
  expect(covered).toBe(true);
  expect(clicked).toBe(false);
  await expect(page.getByTestId('busy')).toBeHidden();
});

import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { cells, getDoc, openApp, pngSize } from './fixtures';

/** Fire a fake `beforeinstallprompt` (what Chrome sends when the app is installable). */
async function offerInstall(page: Page) {
  await page.evaluate(() => {
    const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & Record<string, unknown>;
    (window as any).__prompted = 0;
    e.prompt = async () => {
      (window as any).__prompted++;
    };
    e.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(e);
  });
}

const swReady = (page: Page) =>
  page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return !!reg.active;
  });

const swVersion = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const ch = new MessageChannel();
        ch.port1.onmessage = (e) => resolve(e.data);
        navigator.serviceWorker.controller!.postMessage({ type: 'GET_VERSION' }, [ch.port2]);
      }),
  );

test('app is called Collage and has a valid manifest with the icons', async ({ page, request }) => {
  await openApp(page);
  await expect(page).toHaveTitle('Collage');
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest).toMatchObject({ name: 'Collage', short_name: 'Collage', display: 'standalone', start_url: './' });
  for (const icon of manifest.icons) {
    const res = await request.get('/' + icon.src);
    expect(res.headers()['content-type']).toContain('image/png');
    const { w, h } = pngSize(Buffer.from(await res.body()));
    expect(`${w}x${h}`).toBe(icon.sizes);
  }
  expect(manifest.icons.some((i: any) => i.purpose === 'maskable')).toBe(true);
  expect(pngSize(Buffer.from(await (await request.get('/icons/apple-touch-icon.png')).body()))).toEqual({ w: 180, h: 180 });
});

test('works offline after the first visit', async ({ page, context }) => {
  await openApp(page);
  expect(await swReady(page)).toBe(true);
  await page.reload(); // now controlled by the service worker
  await expect(page.locator('body[data-ready="true"]')).toBeAttached();
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('body[data-ready="true"]')).toBeAttached();
  await expect(cells(page)).toHaveCount(4);
  await context.setOffline(false);
});

test('install banner offers installation and hides afterwards', async ({ page }) => {
  await openApp(page, { installBanner: true });
  await expect(page.getByTestId('install-banner')).toBeHidden();
  await offerInstall(page);
  await expect(page.getByTestId('install-banner')).toBeVisible();
  await page.getByTestId('install').click();
  await expect.poll(() => page.evaluate(() => (window as any).__prompted)).toBe(1);
  await expect(page.getByTestId('install-banner')).toBeHidden();
});

test('dismissing the install banner is remembered', async ({ page }) => {
  await openApp(page, { installBanner: true });
  await offerInstall(page);
  await page.getByTestId('install-close').click();
  await expect(page.getByTestId('install-banner')).toBeHidden();
  await page.reload();
  await expect(page.locator('body[data-ready="true"]')).toBeAttached();
  await offerInstall(page);
  await expect(page.getByTestId('install-banner')).toBeHidden();
});

test.describe('iPhone Safari', () => {
  test.use({
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  });

  test('shows how to add the app to the home screen', async ({ page }) => {
    await openApp(page, { installBanner: true });
    const banner = page.getByTestId('install-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Do ekranu początkowego');
    await expect(page.getByTestId('install')).toBeHidden();
  });
});

/** Serve a private copy of the built app, so a test can "deploy" a new version into it. */
async function serveCopy(dir: string): Promise<{ url: string; close: () => Promise<void> }> {
  cpSync(join(process.cwd(), 'dist'), dir, { recursive: true });
  const types: Record<string, string> = {
    '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
  };
  const server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]!);
    const file = join(dir, path.endsWith('/') ? path + 'index.html' : path);
    try {
      const body = readFileSync(file);
      res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return { url: `http://localhost:${port}/`, close: () => new Promise((r) => server.close(() => r())) };
}

test('a new version shows “Odśwież” and is applied only after tapping it', async ({ page }) => {
  const dir = test.info().outputPath('site');
  const site = await serveCopy(dir);
  try {
    await page.goto(site.url);
    await expect(page.locator('body[data-ready="true"]')).toBeAttached();
    await swReady(page);
    await page.reload();
    await expect(page.locator('body[data-ready="true"]')).toBeAttached();
    const v1 = await swVersion(page);
    // Some work in progress that must survive the update.
    await page.evaluate(() => {
      const { store } = (window as any).__collage;
      store.edit((d: any) => {
        d.style.gapMm = 11;
      });
    });
    await page.evaluate(() => (window as any).__collage.flushSave());

    // "Deploy" a new version: the service worker on the server changes.
    const swPath = join(dir, 'sw.js');
    writeFileSync(swPath, readFileSync(swPath, 'utf8').replace(/const VERSION = '([^']+)'/, "const VERSION = '$1-next'"));
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update());

    const banner = page.getByTestId('update-banner');
    await expect(banner).toBeVisible();
    // Nothing changes until the user decides.
    expect(await swVersion(page)).toBe(v1);

    await Promise.all([page.waitForEvent('load'), page.getByTestId('update').click()]);
    await expect(page.locator('body[data-ready="true"]')).toBeAttached();
    await expect.poll(() => swVersion(page)).toBe(`${v1}-next`);
    await expect(banner).toBeHidden();
    expect((await getDoc(page)).style.gapMm).toBe(11);
  } finally {
    await site.close();
  }
});

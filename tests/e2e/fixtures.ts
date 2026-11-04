import { deflateSync } from 'node:zlib';
import { expect, type Locator, type Page } from '@playwright/test';

/* ------------------------------------------------------------ test images */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Solid-colour RGB PNG generated in memory (no fixtures on disk). */
export function makePng(w: number, h: number, rgb: [number, number, number]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) row.set(rgb, 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function pngSize(buf: Buffer): { w: number; h: number } {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/* ------------------------------------------------------------ app helpers */

export async function openApp(page: Page, opts: { installBanner?: boolean; savePicker?: boolean } = {}): Promise<void> {
  if (!opts.savePicker) {
    // Tests check plain downloads; the native "Save as" dialog can't be driven headless.
    // save-dialog.spec.ts installs a scripted dialog instead.
    await page.addInitScript(() => {
      delete (window as any).showSaveFilePicker;
    });
  }
  if (!opts.installBanner) {
    // Keep the install banner out of unrelated tests (Chrome may offer installation).
    await page.addInitScript(() => {
      try {
        const prefs = JSON.parse(localStorage.getItem('collage.prefs') ?? '{}');
        if (prefs.installDismissed === undefined) {
          prefs.installDismissed = true;
          localStorage.setItem('collage.prefs', JSON.stringify(prefs));
        }
      } catch {
        /* ignore */
      }
    });
  }
  if (process.env.SLOW_RAF) {
    // Stress mode: delay every animation frame so tests that measure the DOM
    // before the app re-rendered fail locally instead of only on fast CI runners.
    await page.addInitScript((ms) => {
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) => raf(() => setTimeout(() => cb(performance.now()), ms));
    }, Number(process.env.SLOW_RAF) > 1 ? Number(process.env.SLOW_RAF) : 60);
  }
  await page.goto('/');
  await expect(page.locator('body[data-ready="true"]')).toBeAttached();
}

export type Box = { x: number; y: number; width: number; height: number };

/**
 * Wait until the app has rendered pending changes. The app batches DOM updates
 * into the next animation frame, so measuring right after a click can see the
 * previous frame (this made CI flaky on fast runners).
 */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
}

export async function box(l: Locator): Promise<Box> {
  await settle(l.page());
  const b = await l.boundingBox();
  if (!b) throw new Error('element not visible');
  return b;
}

export function center(b: Box): { x: number; y: number } {
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Read the live document model (exposed for tests on window.__collage). */
export function getDoc(page: Page): Promise<any> {
  return page.evaluate(() => JSON.parse(JSON.stringify((window as any).__collage.store.doc)));
}

export function cells(page: Page): Locator {
  return page.getByTestId('cell');
}

export function dividers(page: Page, dir?: 'v' | 'h'): Locator {
  return dir ? page.locator(`[data-testid="divider"][data-dir="${dir}"]`) : page.getByTestId('divider');
}

/** Drag with many intermediate steps, returning a snapshot per step. */
export async function drag<T>(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps: number,
  sample?: () => Promise<T>,
): Promise<T[]> {
  const out: T[] = [];
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    if (sample) {
      await settle(page);
      out.push(await sample());
    }
  }
  await page.mouse.up();
  return out;
}

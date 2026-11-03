import { buildPdf } from '../core/pdf';
import { docPageSize, pageSizePx } from '../core/page';
import { drawDoc, type Ctx } from '../core/render';
import type { Store } from '../store';

/** Safe canvas area for mobile Safari and low-memory devices. */
export const MAX_CANVAS_PIXELS = 16_000_000;

export interface RenderResult {
  canvas: HTMLCanvasElement;
  dpi: number;
}

export function effectiveDpi(store: Store, dpi: number): number {
  const page = docPageSize(store.doc);
  const px = pageSizePx(page, dpi);
  if (px.w * px.h <= MAX_CANVAS_PIXELS) return dpi;
  return Math.floor(dpi * Math.sqrt(MAX_CANVAS_PIXELS / (px.w * px.h)));
}

export function renderToCanvas(store: Store, requestedDpi: number): RenderResult {
  const dpi = effectiveDpi(store, requestedDpi);
  const page = docPageSize(store.doc);
  const px = pageSizePx(page, dpi);
  const canvas = document.createElement('canvas');
  canvas.width = px.w;
  canvas.height = px.h;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  // Scale by exact px/page ratio so rounding never leaves an edge uncovered.
  drawDoc(ctx as unknown as Ctx, store.doc, store.photos, store.images, px.w / page.w);
  return { canvas, dpi };
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Nie udało się utworzyć pliku'))), type, quality),
  );
}

export async function exportPdf(store: Store, dpi: number): Promise<Blob> {
  const { canvas } = renderToCanvas(store, dpi);
  const jpeg = new Uint8Array(await (await canvasToBlob(canvas, 'image/jpeg', 0.93)).arrayBuffer());
  const page = docPageSize(store.doc);
  const pdf = buildPdf(jpeg, canvas.width, canvas.height, page.w, page.h);
  return new Blob([pdf as BlobPart], { type: 'application/pdf' });
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Print at the physical page size using a dedicated print stylesheet. */
export async function printDoc(store: Store, dpi: number): Promise<void> {
  const { canvas } = renderToCanvas(store, dpi);
  const blob = await canvasToBlob(canvas, 'image/jpeg', 0.95);
  const url = URL.createObjectURL(blob);
  const page = docPageSize(store.doc);
  const area = document.getElementById('print-area')!;
  area.innerHTML = '';
  const img = new Image();
  img.src = url;
  img.style.width = `${page.w}mm`;
  img.style.height = `${page.h}mm`;
  area.append(img);
  let style = document.getElementById('print-page-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'print-page-style';
    document.head.append(style);
  }
  style.textContent = `@page { size: ${page.w}mm ${page.h}mm; margin: 0; }`;
  await img.decode().catch(() => undefined);
  window.print();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

import { coverPlacement } from './crop';
import { floatBox } from './floats';
import { computeLayout } from './geometry';
import { docPageSize } from './page';
import type { Doc, Photo } from './types';

/** The subset of CanvasRenderingContext2D used for export (mockable in tests). */
export type Ctx = Pick<
  CanvasRenderingContext2D,
  | 'save'
  | 'restore'
  | 'beginPath'
  | 'closePath'
  | 'rect'
  | 'moveTo'
  | 'arcTo'
  | 'clip'
  | 'fill'
  | 'fillRect'
  | 'translate'
  | 'rotate'
  | 'drawImage'
> & {
  fillStyle: CanvasRenderingContext2D['fillStyle'];
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
};

export function roundRectPath(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  if (rr <= 0) {
    ctx.rect(x, y, w, h);
    return;
  }
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/**
 * Draw the whole document. `pxPerMm` sets the output resolution; geometry is
 * the same as on screen because both use mm-based layout.
 */
export function drawDoc(
  ctx: Ctx,
  doc: Doc,
  photos: Map<string, Photo>,
  images: Map<string, CanvasImageSource>,
  pxPerMm: number,
): void {
  const page = docPageSize(doc);
  const k = pxPerMm;
  ctx.fillStyle = doc.style.background;
  ctx.fillRect(0, 0, page.w * k, page.h * k);

  const { cells } = computeLayout(doc.tree, { x: 0, y: 0, w: page.w, h: page.h }, doc.style.gapMm);
  for (const c of cells) {
    const p = c.node.photoId ? photos.get(c.node.photoId) : undefined;
    const img = c.node.photoId ? images.get(c.node.photoId) : undefined;
    if (!p || !img || c.rect.w <= 0 || c.rect.h <= 0) continue;
    const x = c.rect.x * k;
    const y = c.rect.y * k;
    const w = c.rect.w * k;
    const h = c.rect.h * k;
    const pl = coverPlacement(p.width, p.height, w, h, c.node.crop);
    ctx.save();
    roundRectPath(ctx, x, y, w, h, doc.style.radiusMm * k);
    ctx.clip();
    ctx.translate(x + w / 2 + pl.offsetX, y + h / 2 + pl.offsetY);
    if (c.node.crop.rotate) ctx.rotate((c.node.crop.rotate * Math.PI) / 180);
    ctx.drawImage(img, -pl.drawW / 2, -pl.drawH / 2, pl.drawW, pl.drawH);
    ctx.restore();
  }

  for (const f of doc.floats) {
    const p = photos.get(f.photoId);
    const img = images.get(f.photoId);
    if (!p || !img) continue;
    const b = floatBox(f, p, page, doc.style.gapMm);
    const w = b.w * k;
    const h = b.h * k;
    const fr = b.frame * k;
    ctx.save();
    ctx.translate(b.cx * k, b.cy * k);
    if (b.rotation) ctx.rotate((b.rotation * Math.PI) / 180);
    if (f.shadow || fr > 0) {
      if (f.shadow) {
        ctx.shadowColor = 'rgba(0,0,0,0.35)';
        ctx.shadowBlur = 3 * k;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 1 * k;
      }
      ctx.fillStyle = fr > 0 ? '#ffffff' : '#000000';
      ctx.fillRect(-w / 2 - fr, -h / 2 - fr, w + 2 * fr, h + 2 * fr);
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
    }
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
}

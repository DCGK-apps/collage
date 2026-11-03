import { describe, expect, it } from 'vitest';
import { coverPlacement, MAX_ZOOM, panBy, rotateCrop, zoomAt } from '../../src/core/crop';
import type { Crop } from '../../src/core/types';

const crop = (c: Partial<Crop> = {}): Crop => ({ zoom: 1, panX: 0, panY: 0, rotate: 0, ...c });

/** Visible bounds of the (possibly rotated) image relative to the cell centre. */
function covers(imgW: number, imgH: number, w: number, h: number, c: Crop): boolean {
  const p = coverPlacement(imgW, imgH, w, h, c);
  const rotated = c.rotate % 180 !== 0;
  const vw = rotated ? p.drawH : p.drawW;
  const vh = rotated ? p.drawW : p.drawH;
  return (
    p.offsetX - vw / 2 <= -w / 2 + 1e-6 &&
    p.offsetX + vw / 2 >= w / 2 - 1e-6 &&
    p.offsetY - vh / 2 <= -h / 2 + 1e-6 &&
    p.offsetY + vh / 2 >= h / 2 - 1e-6
  );
}

describe('coverPlacement', () => {
  it('covers the cell for any pan/zoom/rotation', () => {
    for (const rotate of [0, 90, 180, 270] as const)
      for (const zoom of [1, 1.7, 4])
        for (const panX of [-1, -0.3, 0, 1])
          for (const panY of [-1, 0.5, 1])
            for (const [iw, ih] of [[4000, 3000], [1000, 3000], [500, 500]] as const)
              expect(covers(iw, ih, 300, 200, crop({ rotate, zoom, panX, panY }))).toBe(true);
  });

  it('fits a wide image to the cell height', () => {
    const p = coverPlacement(2000, 1000, 100, 100, crop());
    expect(p.drawH).toBeCloseTo(100);
    expect(p.drawW).toBeCloseTo(200);
    expect(p.maxPanX).toBeCloseTo(50);
    expect(p.maxPanY).toBeCloseTo(0);
  });

  it('swaps axes for 90° rotation', () => {
    const p = coverPlacement(2000, 1000, 100, 100, crop({ rotate: 90 }));
    expect(p.drawW).toBeCloseTo(200);
    expect(p.maxPanY).toBeCloseTo(50);
    expect(p.maxPanX).toBeCloseTo(0);
  });

  it('keeps relative framing when the cell is resized', () => {
    const c = crop({ panX: 1 });
    const a = coverPlacement(2000, 1000, 100, 100, c);
    const b = coverPlacement(2000, 1000, 50, 50, c);
    expect(a.offsetX / a.maxPanX).toBeCloseTo(b.offsetX / b.maxPanX);
  });

  it('handles degenerate sizes', () => {
    expect(coverPlacement(0, 0, 100, 100, crop()).drawW).toBe(0);
  });
});

describe('panBy', () => {
  it('pans in cell units and clamps to the image edge', () => {
    const p = coverPlacement(2000, 1000, 100, 100, crop());
    expect(panBy(crop(), 25, 0, p).panX).toBeCloseTo(0.5);
    expect(panBy(crop(), 1000, 0, p).panX).toBe(1);
    expect(panBy(crop(), 0, 30, p).panY).toBe(0); // no overflow vertically
  });
});

describe('zoomAt', () => {
  it('clamps zoom range', () => {
    expect(zoomAt(crop(), 0.2, 0, 0, 100, 100, 100, 100).zoom).toBe(1);
    expect(zoomAt(crop(), 99, 0, 0, 100, 100, 100, 100).zoom).toBe(MAX_ZOOM);
  });

  it('keeps the focus point fixed', () => {
    const c0 = crop();
    const fx = 30;
    const before = coverPlacement(1000, 1000, 100, 100, c0);
    const c1 = zoomAt(c0, 2, fx, 0, 1000, 1000, 100, 100);
    const after = coverPlacement(1000, 1000, 100, 100, c1);
    // image-space coordinate under fx must be the same
    const u0 = (fx - before.offsetX) / before.drawW;
    const u1 = (fx - after.offsetX) / after.drawW;
    expect(u1).toBeCloseTo(u0);
  });
});

describe('rotateCrop', () => {
  it('cycles through 90° steps and recentres', () => {
    let c = crop({ panX: 0.5 });
    const seen = [];
    for (let i = 0; i < 4; i++) {
      c = rotateCrop(c);
      seen.push(c.rotate);
    }
    expect(seen).toEqual([90, 180, 270, 0]);
    expect(c.panX).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import {
  createFloat,
  floatBox,
  hitFloat,
  MIN_FLOAT_MM,
  moveFloat,
  normalizeAngle,
  reorder,
  setFloatSize,
  snapAngle,
} from '../../src/core/floats';
import type { FloatLayer, Photo } from '../../src/core/types';

const A4 = { w: 210, h: 297 };
const landscape: Photo = { id: 'l', src: '', width: 3000, height: 2000 };
const portrait: Photo = { id: 'p', src: '', width: 2000, height: 3000 };

describe('createFloat', () => {
  it('places a new layer centred on the page with frame and shadow', () => {
    const f = createFloat(landscape, A4, 0);
    expect(f.cx).toBe(0.5);
    expect(f.cy).toBe(0.5);
    expect(f.frame).toBe(true);
    const b = floatBox(f, landscape, A4);
    expect(b.w / b.h).toBeCloseTo(1.5);
    expect(b.w).toBeLessThan(A4.w);
  });

  it('staggers successive layers so they do not hide each other', () => {
    const a = createFloat(portrait, A4, 0);
    const b = createFloat(portrait, A4, 1);
    expect(b.cx).toBeGreaterThan(a.cx);
  });
});

describe('moveFloat / setFloatSize', () => {
  it('keeps the centre on the page', () => {
    const f = createFloat(landscape, A4, 0);
    moveFloat(f, -1000, 1000, A4);
    expect([f.cx, f.cy]).toEqual([0, 1]);
  });

  it('enforces size limits', () => {
    const f = createFloat(landscape, A4, 0);
    setFloatSize(f, 0.0001, landscape, A4);
    expect(floatBox(f, landscape, A4).h).toBeCloseTo(MIN_FLOAT_MM);
    setFloatSize(f, 100, landscape, A4);
    expect(floatBox(f, landscape, A4).w).toBeLessThanOrEqual(A4.w * 1.5 + 1e-9);
  });
});

describe('angles', () => {
  it('normalises into (-180, 180]', () => {
    expect(normalizeAngle(190)).toBe(-170);
    expect(normalizeAngle(-190)).toBe(170);
    expect(normalizeAngle(360)).toBe(0);
  });

  it('snaps near right angles only', () => {
    expect(snapAngle(2)).toBe(0);
    expect(snapAngle(88)).toBe(90);
    expect(snapAngle(45)).toBe(45);
  });
});

describe('reorder', () => {
  const fl = (id: string) => ({ id }) as FloatLayer;
  const order = (a: FloatLayer[]) => a.map((f) => f.id).join('');
  const list = [fl('a'), fl('b'), fl('c')];

  it('moves layers in the z-stack without mutating input', () => {
    expect(order(reorder(list, 'a', 'front'))).toBe('bca');
    expect(order(reorder(list, 'c', 'back'))).toBe('cab');
    expect(order(reorder(list, 'a', 'up'))).toBe('bac');
    expect(order(reorder(list, 'c', 'up'))).toBe('abc');
    expect(order(reorder(list, 'b', 'down'))).toBe('bac');
    expect(order(reorder(list, 'x', 'down'))).toBe('abc');
    expect(order(list)).toBe('abc');
  });
});

describe('hitFloat', () => {
  it('respects rotation', () => {
    const f = { ...createFloat(landscape, A4, 0), rotation: 90, frame: false };
    const b = floatBox(f, landscape, A4);
    // after 90° the long side is vertical
    expect(hitFloat(b, b.cx, b.cy + b.w / 2 - 1)).toBe(true);
    expect(hitFloat(b, b.cx + b.w / 2 - 1, b.cy)).toBe(false);
  });
});

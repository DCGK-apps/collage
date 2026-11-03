import { describe, expect, it } from 'vitest';
import { createDoc } from '../../src/core/doc';
import { createFloat } from '../../src/core/floats';
import { drawDoc, type Ctx } from '../../src/core/render';
import type { Photo } from '../../src/core/types';
import { cell, split } from './helpers';

/** Records calls so we can assert what an export would draw. */
function mockCtx() {
  const calls: { op: string; args: unknown[] }[] = [];
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      return (...args: unknown[]) => calls.push({ op: prop, args });
    },
    set(target, prop: string, value) {
      target[prop] = value;
      calls.push({ op: `set:${prop}`, args: [value] });
      return true;
    },
  };
  return { ctx: new Proxy({}, handler) as unknown as Ctx, calls };
}

const photos = new Map<string, Photo>([
  ['a', { id: 'a', src: '', width: 100, height: 100 }],
  ['b', { id: 'b', src: '', width: 100, height: 100 }],
]);
const images = new Map<string, CanvasImageSource>([
  ['a', {} as CanvasImageSource],
  ['b', {} as CanvasImageSource],
]);

describe('drawDoc', () => {
  it('fills the full page with the background at the given resolution', () => {
    const doc = createDoc();
    const { ctx, calls } = mockCtx();
    drawDoc(ctx, doc, photos, images, 10);
    expect(calls[0]).toEqual({ op: 'set:fillStyle', args: ['#ffffff'] });
    expect(calls[1]).toEqual({ op: 'fillRect', args: [0, 0, 2100, 2970] });
  });

  it('draws one image per cell, then floats on top in z-order', () => {
    const doc = createDoc();
    doc.style.gapMm = 0;
    doc.tree = split('s', 'v', 0.5, cell('c1', 'a'), cell('c2', 'b'));
    doc.floats = [createFloat(photos.get('b')!, { w: 210, h: 297 }, 0)];
    const { ctx, calls } = mockCtx();
    drawDoc(ctx, doc, photos, images, 1);
    const draws = calls.filter((c) => c.op === 'drawImage');
    expect(draws).toHaveLength(3);
    // last draw is the float, centred on the page (translate before it)
    const translates = calls.filter((c) => c.op === 'translate');
    expect(translates.at(-1)!.args).toEqual([105, 148.5]);
  });

  it('skips cells without a photo', () => {
    const doc = createDoc();
    doc.tree = split('s', 'v', 0.5, cell('c1', 'a'), cell('c2', null));
    const { ctx, calls } = mockCtx();
    drawDoc(ctx, doc, photos, images, 1);
    expect(calls.filter((c) => c.op === 'drawImage')).toHaveLength(1);
  });
});

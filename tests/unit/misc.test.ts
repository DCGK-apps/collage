import { describe, expect, it } from 'vitest';
import { createDoc } from '../../src/core/doc';
import { History } from '../../src/core/history';
import { DEFAULT_FORMAT_ID, docPageSize, fitScale, getFormat, pageSizeMm, pageSizePx } from '../../src/core/page';
import { buildPdf, mmToPt } from '../../src/core/pdf';

describe('page formats', () => {
  it('defaults to portrait A4 for print', () => {
    const doc = createDoc();
    expect(DEFAULT_FORMAT_ID).toBe('a4');
    expect(getFormat(doc.formatId).print).toBe(true);
    expect(docPageSize(doc)).toEqual({ w: 210, h: 297 });
    expect(doc.style.background).toBe('#ffffff');
  });

  it('A4 at 300 DPI is 2480×3508 px', () => {
    expect(pageSizePx(pageSizeMm('a4', 'portrait'), 300)).toEqual({ w: 2480, h: 3508 });
  });

  it('landscape swaps dimensions', () => {
    expect(pageSizeMm('a4', 'landscape')).toEqual({ w: 297, h: 210 });
  });

  it('unknown format falls back to A4', () => {
    expect(getFormat('nope').id).toBe('a4');
  });

  it('fitScale fits inside the box', () => {
    const s = fitScale({ w: 210, h: 297 }, 400, 400);
    expect(297 * s).toBeCloseTo(400);
    expect(210 * s).toBeLessThan(400);
  });
});

describe('History', () => {
  it('undo / redo restore snapshots', () => {
    const h = new History<{ v: number }>();
    let state = { v: 1 };
    h.checkpoint(state);
    state.v = 2; // mutation after checkpoint must not leak into the snapshot
    h.checkpoint(state);
    state = { v: 3 };
    state = h.undo(state)!;
    expect(state.v).toBe(2);
    state = h.undo(state)!;
    expect(state.v).toBe(1);
    expect(h.undo(state)).toBeNull();
    state = h.redo(state)!;
    expect(state.v).toBe(2);
    state = h.redo(state)!;
    expect(state.v).toBe(3);
    expect(h.canRedo).toBe(false);
  });

  it('a new checkpoint clears redo', () => {
    const h = new History<number>();
    h.checkpoint(1);
    h.undo(2);
    expect(h.canRedo).toBe(true);
    h.checkpoint(1);
    expect(h.canRedo).toBe(false);
  });

  it('respects the limit', () => {
    const h = new History<number>(3);
    for (let i = 0; i < 10; i++) h.checkpoint(i);
    let n = 0;
    let s: number | null = 99;
    while ((s = h.undo(s!)) !== null) n++;
    expect(n).toBe(3);
  });
});

describe('buildPdf', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const pdf = buildPdf(jpeg, 2480, 3508, 210, 297);
  const text = new TextDecoder('latin1').decode(pdf);

  it('is a PDF with an A4 MediaBox', () => {
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/MediaBox [0 0 595.28 841.89]');
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(mmToPt(25.4)).toBe(72);
  });

  it('embeds the JPEG with its pixel size', () => {
    expect(text).toContain('/Width 2480 /Height 3508');
    expect(text).toContain('/Filter /DCTDecode /Length 4');
  });

  it('has a correct xref table', () => {
    const startxref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
    const entries = [...text.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(entries).toHaveLength(5);
    entries.forEach((off, i) => {
      // byte offsets: compare on the raw bytes
      const head = new TextDecoder('latin1').decode(pdf.slice(off, off + 10));
      expect(head.startsWith(`${i + 1} 0 obj`)).toBe(true);
    });
  });
});

import { describe, expect, it } from 'vitest';
import builtin from '../../src/templates/builtin.collage-template.json';
import { createDoc } from '../../src/core/doc';
import { createFloat } from '../../src/core/floats';
import { computeLayout } from '../../src/core/geometry';
import {
  applyTemplate,
  makePack,
  parseTemplate,
  parseTemplateFile,
  photoOrder,
  templateFileName,
  templateFromDoc,
  templateKey,
  templateSvg,
} from '../../src/core/templates';
import { listCells } from '../../src/core/tree';
import type { Doc } from '../../src/core/types';
import { cell, split } from './helpers';

const A4 = { w: 210, h: 297 };
const photo = (id: string) => ({ id, src: '', width: 300, height: 200 });

function docWith(): Doc {
  const doc = createDoc();
  doc.tree = split('r', 'h', 0.6, cell('c0', 'a'), split('s', 'v', 0.3, cell('c1', 'b'), cell('c2', 'c')));
  doc.floats = [{ ...createFloat(photo('d'), A4, 0), rotation: 12 }];
  doc.library = ['a', 'b', 'c', 'd', 'e'];
  doc.style = { gapMm: 6, radiusMm: 2, background: '#f5f0e6' };
  return doc;
}

const geometry = (doc: Doc) =>
  computeLayout(doc.tree, { x: 0, y: 0, w: 210, h: 297 }, doc.style.gapMm).cells.map((c) => [c.rect, c.node.photoId]);

describe('templateFromDoc', () => {
  it('strips photos and numbers slots in reading order (cells, then layers)', () => {
    const t = templateFromDoc(docWith(), '  Moje  ');
    expect(t.name).toBe('Moje');
    expect(t.slots).toBe(4);
    expect(JSON.stringify(t)).not.toMatch(/"a"|photoId|"c0"/);
    expect(t.layout).toEqual({ split: 'h', ratio: 0.6, first: { slot: 0 }, second: { split: 'v', ratio: 0.3, first: { slot: 1 }, second: { slot: 2 } } });
    expect(t.layers[0]).toMatchObject({ slot: 3, rotation: 12, frame: true });
  });
});

describe('applyTemplate', () => {
  it('round-trips: applying a document’s template gives the same layout and photos', () => {
    const src = docWith();
    const t = templateFromDoc(src, 'x');
    const target = docWith();
    target.tree = cell('only', 'a');
    target.floats = [];
    // photo order: a (cell), then library b, c, d, e
    applyTemplate(target, t);
    expect(geometry(target)).toEqual(geometry(src));
    expect(target.floats.map((f) => f.photoId)).toEqual(['d']);
    expect(target.style).toEqual(src.style);
  });

  it('leaves empty cells and skips layers when photos run out', () => {
    const t = templateFromDoc(docWith(), 'x');
    const doc = createDoc();
    doc.library = ['p'];
    applyTemplate(doc, t);
    expect(listCells(doc.tree).map((c) => c.photoId)).toEqual(['p', null, null]);
    expect(doc.floats).toEqual([]);
  });

  it('keeps extra photos in the library and keeps the page format', () => {
    const doc = docWith();
    doc.formatId = 'a3';
    const t = parseTemplate((builtin as any).templates[0])!; // 2 slots
    applyTemplate(doc, t);
    expect(listCells(doc.tree)).toHaveLength(2);
    expect(doc.library).toEqual(expect.arrayContaining(['a', 'b', 'c', 'd', 'e']));
    expect(doc.formatId).toBe('a3');
  });

  it('photoOrder: cells first, then library, then layers, without duplicates', () => {
    expect(photoOrder(docWith())).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('parseTemplate / parseTemplateFile', () => {
  it('accepts every built-in template', () => {
    const { templates, rejected } = parseTemplateFile(builtin);
    expect(rejected).toBe(0);
    expect(templates.length).toBeGreaterThanOrEqual(8);
    expect(new Set(templates.map(templateKey)).size).toBe(templates.length);
  });

  it('survives a JSON round trip unchanged', () => {
    const t = templateFromDoc(docWith(), 'x');
    expect(parseTemplate(JSON.parse(JSON.stringify(t)))).toEqual(t);
  });

  it('rejects broken or foreign files', () => {
    const t: any = templateFromDoc(docWith(), 'x');
    expect(parseTemplate({ ...t, type: 'other' })).toBeNull();
    expect(parseTemplate({ ...t, version: 2 })).toBeNull();
    expect(parseTemplate({ ...t, layout: { split: 'v', ratio: 0.5, first: { slot: 0 } } })).toBeNull();
    expect(parseTemplate({ ...t, layout: null, layers: [] })).toBeNull(); // nothing in it
    expect(parseTemplate({ ...t, layers: [{ slot: 'x' }] })).toBeNull();
    expect(parseTemplate('nope')).toBeNull();
  });

  it('clamps values and ignores unknown fields', () => {
    const t: any = templateFromDoc(docWith(), 'x');
    t.extra = 'ignored';
    t.layout.ratio = 7;
    t.style.gapMm = 999;
    const out = parseTemplate(t)!;
    expect((out as any).extra).toBeUndefined();
    expect((out.layout as any).ratio).toBe(0.95);
    expect(out.style!.gapMm).toBe(30);
  });

  it('reads packs and counts rejected entries', () => {
    const good = templateFromDoc(docWith(), 'a');
    const pack = { ...makePack([good]), templates: [good, { type: 'collage-template', version: 1, layout: 5 }] };
    expect(parseTemplateFile(JSON.parse(JSON.stringify(pack)))).toMatchObject({ rejected: 1, templates: [good] });
  });
});

describe('templateKey', () => {
  it('ignores the name but not the layout', () => {
    const a = templateFromDoc(docWith(), 'A');
    const b = templateFromDoc(docWith(), 'B');
    expect(templateKey(a)).toBe(templateKey(b));
    const d = docWith();
    (d.tree as any).ratio = 0.4;
    expect(templateKey(templateFromDoc(d, 'A'))).not.toBe(templateKey(a));
  });
});

describe('preview and file name', () => {
  it('draws one rect per cell and a group per layer', () => {
    const svg = templateSvg(templateFromDoc(docWith(), 'x'), A4);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.match(/fill="#94a3b8"/g)).toHaveLength(3);
    expect(svg.match(/<g /g)).toHaveLength(1);
  });

  it('does not let a background value inject markup', () => {
    const t = templateFromDoc(docWith(), 'x');
    t.style!.background = '"/><script>alert(1)</script>';
    expect(templateSvg(t, A4)).not.toMatch(/<script/);
  });

  it('makes safe file names', () => {
    expect(templateFileName({ ...templateFromDoc(docWith(), 'Wakacje – Łeba 2026!') })).toBe('wakacje-leba-2026.collage-template.json');
  });
});

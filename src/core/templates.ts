import { computeLayout } from './geometry';
import { makeCell, makeSplit } from './tree';
import { uid } from './ids';
import type { Dir, Doc, FloatLayer, LayoutNode, Orientation, Size, Style } from './types';

/**
 * Layout templates: a layout without photos. Geometry is relative (ratios and
 * page fractions), so a template fits any page format. Templates are plain JSON
 * files (`*.collage-template.json`) that can be copied between devices.
 */

export const TEMPLATE_TYPE = 'collage-template';
export const PACK_TYPE = 'collage-template-pack';
export const TEMPLATE_VERSION = 1;
export const TEMPLATE_EXT = '.collage-template.json';

export type TemplateNode = { slot: number } | { split: Dir; ratio: number; first: TemplateNode; second: TemplateNode };

export interface TemplateLayer {
  slot: number;
  cx: number;
  cy: number;
  size: number;
  rotation: number;
  frame: boolean;
  shadow: boolean;
}

export interface Template {
  type: typeof TEMPLATE_TYPE;
  version: number;
  name: string;
  tags?: string[];
  /** Number of photo slots (cells + layers). */
  slots: number;
  page: { orientation: Orientation; formatId?: string };
  style?: Style;
  layout: TemplateNode | null;
  layers: TemplateLayer[];
}

export interface TemplatePack {
  type: typeof PACK_TYPE;
  version: number;
  templates: Template[];
}

/* ------------------------------------------------------------------ create */

/** Turn the current document into a template (photos removed, slots numbered in reading order). */
export function templateFromDoc(doc: Doc, name: string): Template {
  let next = 0;
  const conv = (n: LayoutNode): TemplateNode =>
    n.type === 'cell'
      ? { slot: next++ }
      : { split: n.dir, ratio: round(n.ratio), first: conv(n.first), second: conv(n.second) };
  const layout = doc.tree ? conv(doc.tree) : null;
  const layers = doc.floats.map((f) => ({
    slot: next++,
    cx: round(f.cx),
    cy: round(f.cy),
    size: round(f.size),
    rotation: round(f.rotation),
    frame: f.frame,
    shadow: f.shadow,
  }));
  return {
    type: TEMPLATE_TYPE,
    version: TEMPLATE_VERSION,
    name: name.trim() || 'Szablon',
    slots: next,
    page: { orientation: doc.orientation, formatId: doc.formatId },
    style: { ...doc.style },
    layout,
    layers,
  };
}

function round(v: number): number {
  return Math.round(v * 10000) / 10000;
}

/* ------------------------------------------------------------------ validate */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const MAX_SLOTS = 64;

function parseNode(n: unknown, depth: number): TemplateNode | null {
  if (!isObj(n) || depth > MAX_SLOTS) return null;
  if ('slot' in n) return Number.isInteger(n.slot) && (n.slot as number) >= 0 ? { slot: n.slot as number } : null;
  if ((n.split === 'v' || n.split === 'h') && isNum(n.ratio)) {
    const first = parseNode(n.first, depth + 1);
    const second = parseNode(n.second, depth + 1);
    if (!first || !second) return null;
    return { split: n.split, ratio: Math.min(0.95, Math.max(0.05, n.ratio)), first, second };
  }
  return null;
}

function countSlots(n: TemplateNode | null): number {
  if (!n) return 0;
  return 'slot' in n ? 1 : countSlots(n.first) + countSlots(n.second);
}

/** Validate one template from untrusted JSON. Unknown fields are ignored. */
export function parseTemplate(raw: unknown): Template | null {
  if (!isObj(raw) || raw.type !== TEMPLATE_TYPE || raw.version !== TEMPLATE_VERSION) return null;
  const layout = raw.layout === null ? null : parseNode(raw.layout, 0);
  if (raw.layout !== null && !layout) return null;
  const layers: TemplateLayer[] = [];
  if (raw.layers !== undefined) {
    if (!Array.isArray(raw.layers)) return null;
    for (const l of raw.layers) {
      if (!isObj(l) || !Number.isInteger(l.slot) || !isNum(l.cx) || !isNum(l.cy) || !isNum(l.size)) return null;
      layers.push({
        slot: l.slot as number,
        cx: Math.min(1, Math.max(0, l.cx)),
        cy: Math.min(1, Math.max(0, l.cy)),
        size: Math.min(2, Math.max(0.02, l.size)),
        rotation: isNum(l.rotation) ? l.rotation : 0,
        frame: l.frame !== false,
        shadow: l.shadow !== false,
      });
    }
  }
  const slots = countSlots(layout) + layers.length;
  if (slots === 0 || slots > MAX_SLOTS) return null;
  const page = isObj(raw.page) ? raw.page : {};
  const s = isObj(raw.style) ? raw.style : null;
  const t: Template = {
    type: TEMPLATE_TYPE,
    version: TEMPLATE_VERSION,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 80) : 'Szablon',
    slots,
    page: {
      orientation: page.orientation === 'landscape' ? 'landscape' : 'portrait',
      ...(typeof page.formatId === 'string' ? { formatId: page.formatId } : {}),
    },
    layout,
    layers,
  };
  if (Array.isArray(raw.tags)) t.tags = raw.tags.filter((x): x is string => typeof x === 'string').slice(0, 10);
  if (s && isNum(s.gapMm) && isNum(s.radiusMm) && typeof s.background === 'string') {
    t.style = {
      gapMm: Math.min(30, Math.max(0, s.gapMm)),
      radiusMm: Math.min(30, Math.max(0, s.radiusMm)),
      background: s.background,
    };
  }
  return t;
}

/** Read a file's JSON: a single template or a pack. Returns valid templates and how many were rejected. */
export function parseTemplateFile(json: unknown): { templates: Template[]; rejected: number } {
  const items = isObj(json) && json.type === PACK_TYPE && Array.isArray(json.templates) ? json.templates : [json];
  const templates = items.map(parseTemplate).filter((t): t is Template => t !== null);
  return { templates, rejected: items.length - templates.length };
}

export function makePack(templates: Template[]): TemplatePack {
  return { type: PACK_TYPE, version: TEMPLATE_VERSION, templates };
}

/**
 * Content fingerprint (name excluded): the same layout imported twice is
 * recognised as a duplicate even under another name.
 */
export function templateKey(t: Template): string {
  const body = JSON.stringify({ l: t.layout, y: t.layers, s: t.style ?? null, o: t.page.orientation });
  let h = 0x811c9dc5;
  for (let i = 0; i < body.length; i++) {
    h ^= body.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return 't' + (h >>> 0).toString(36) + body.length.toString(36);
}

/* ------------------------------------------------------------------ apply */

/**
 * Photos in the order they fill slots: current cells (reading order), then
 * library photos not in the layout, then photos of current layers.
 */
export function photoOrder(doc: Doc): string[] {
  const out: string[] = [];
  const add = (id: string | null | undefined) => {
    if (id && !out.includes(id)) out.push(id);
  };
  const walk = (n: LayoutNode | null): void => {
    if (!n) return;
    if (n.type === 'cell') add(n.photoId);
    else {
      walk(n.first);
      walk(n.second);
    }
  };
  walk(doc.tree);
  doc.library.forEach(add);
  doc.floats.forEach((f) => add(f.photoId));
  return out;
}

/**
 * Apply a template to the document: layout, layers and style come from the
 * template, photos fill the slots in order. Missing photos leave empty cells
 * (layers without a photo are skipped); extra photos stay in the library.
 * The page format is kept – templates fit any format – only orientation follows.
 */
export function applyTemplate(doc: Doc, t: Template): void {
  const photos = photoOrder(doc);
  const build = (n: TemplateNode): LayoutNode =>
    'slot' in n ? makeCell(photos[n.slot] ?? null) : makeSplit(n.split, n.ratio, build(n.first), build(n.second));
  doc.orientation = t.page.orientation;
  doc.tree = t.layout ? build(t.layout) : null;
  doc.floats = t.layers.flatMap((l): FloatLayer[] => {
    const photoId = photos[l.slot];
    return photoId
      ? [{ id: uid('f'), photoId, cx: l.cx, cy: l.cy, size: l.size, rotation: l.rotation, frame: l.frame, shadow: l.shadow }]
      : [];
  });
  if (t.style) doc.style = { ...t.style };
  for (const id of photos) if (!doc.library.includes(id)) doc.library.push(id);
}

/* ------------------------------------------------------------------ preview */

/** Small SVG preview of a template (no photos), for the template gallery. */
export function templateSvg(t: Template, size: Size): string {
  const W = 100;
  const H = Math.round((W * size.h) / size.w);
  const gap = t.style ? Math.min(6, (t.style.gapMm / size.w) * W) : 2;
  const r = t.style ? Math.min(6, (t.style.radiusMm / size.w) * W) : 1;
  const bg = t.style?.background ?? '#ffffff';
  const build = (n: TemplateNode): LayoutNode =>
    'slot' in n ? makeCell(null) : makeSplit(n.split, n.ratio, build(n.first), build(n.second));
  const { cells } = computeLayout(t.layout ? build(t.layout) : null, { x: 0, y: 0, w: W, h: H }, gap);
  const rects = cells
    .map((c) => `<rect x="${f(c.rect.x)}" y="${f(c.rect.y)}" width="${f(c.rect.w)}" height="${f(c.rect.h)}" rx="${f(r)}" fill="#94a3b8"/>`)
    .join('');
  const layers = t.layers
    .map((l) => {
      const w = l.size * W;
      const h = w * 0.75;
      const fr = l.frame ? Math.min(w, h) * 0.06 : 0;
      return `<g transform="translate(${f(l.cx * W)} ${f(l.cy * H)}) rotate(${f(l.rotation)})"><rect x="${f(-w / 2 - fr)}" y="${f(-h / 2 - fr)}" width="${f(w + 2 * fr)}" height="${f(h + 2 * fr)}" fill="#ffffff" stroke="#64748b" stroke-width="0.6"/><rect x="${f(-w / 2)}" y="${f(-h / 2)}" width="${f(w)}" height="${f(h)}" fill="#6366f1"/></g>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${escapeAttr(bg)}"/>${rects}${layers}</svg>`;
}

function f(v: number): string {
  return (Math.round(v * 10) / 10).toString();
}

function escapeAttr(s: string): string {
  return s.replace(/[^#a-zA-Z0-9(),.% -]/g, '');
}

/** Safe file name for exporting a template. */
export function templateFileName(t: Template): string {
  const base = t.name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return (base || 'szablon') + TEMPLATE_EXT;
}

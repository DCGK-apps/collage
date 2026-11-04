import './styles.css';
import { rotateCrop, zoomAt } from './core/crop';
import { createFloat, reorder, type ZMove } from './core/floats';
import { randomLayout } from './core/random';
import {
  CUSTOM_FORMAT_ID,
  DEFAULT_CUSTOM_MM,
  FORMATS,
  docPageSize,
  getFormat,
  mmToPx,
  normalizeCustom,
  pageSizePx,
  pxToMm,
  readCustom,
} from './core/page';
import {
  buildPreset,
  equalize,
  findNode,
  insertPhoto,
  listCells,
  removeCell,
  removePhotoFromTree,
  setCellPhoto,
  shufflePhotos,
  smartFit,
  type Preset,
} from './core/tree';
import type { CellNode, Doc } from './core/types';
import { Autosaver } from './core/persist';
import { IdbStorage, requestPersistentStorage, restoreProject } from './persist';
import { initPwa } from './pwa';
import { initTemplates } from './ui/templates';
import { Store, loadPref, savePref, type Mode } from './store';
import { askWhereToSave, canAskWhereToSave, saveFile, setAskWhereToSave, type SaveResult } from './ui/saveFile';
import { downloadBlob, canvasToBlob, effectiveDpi, exportPdf, printDoc, renderToCanvas } from './ui/export';
import { loadDemoPhotos, loadFiles, type LoadedPhoto } from './ui/images';
import { Stage, vibrate } from './ui/stage';
import { openProjectFile, ProjectError, saveProjectFile } from './ui/projectFile';

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => document.querySelector<T>(sel)!;
const $$ = <T extends HTMLElement = HTMLElement>(sel: string): T[] => [...document.querySelectorAll<T>(sel)];

const store = new Store();
let pendingCellId: string | null = null;

const stage = new Stage($('#workspace'), store, {
  onRequestPhotoForCell(cellId) {
    pendingCellId = cellId;
    $<HTMLInputElement>('#file-cell').click();
  },
  toast,
});

/* ================================================================ helpers */

function pageRect(doc: Doc = store.doc) {
  const p = docPageSize(doc);
  return { x: 0, y: 0, w: p.w, h: p.h };
}

function toast(text: string): void {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout((toast as unknown as { timer: number }).timer);
  (toast as unknown as { timer: number }).timer = window.setTimeout(() => t.classList.remove('show'), 2000);
}

function selectedCell(): CellNode | null {
  const id = store.ui.selectedCellId;
  const n = id ? findNode(store.doc.tree, id) : null;
  return n && n.type === 'cell' ? n : null;
}

function registerPhotos(items: LoadedPhoto[]): string[] {
  for (const { photo, img } of items) store.addPhoto(photo, img);
  return items.map((i) => i.photo.id);
}

function addToGrid(items: LoadedPhoto[]): void {
  if (!items.length) return;
  const ids = registerPhotos(items);
  store.edit((doc) => {
    doc.library.push(...ids.filter((id) => !doc.library.includes(id)));
    for (const id of ids) doc.tree = insertPhoto(doc.tree, id, pageRect(doc), doc.style.gapMm);
  });
  toast(ids.length === 1 ? 'Dodano zdjęcie do układu' : `Dodano ${ids.length} zdjęć do układu`);
}

function addAsLayers(ids: string[]): void {
  if (!ids.length) return;
  let last = '';
  store.edit((doc) => {
    for (const id of ids) {
      const p = store.photos.get(id);
      if (!p) continue;
      if (!doc.library.includes(id)) doc.library.push(id);
      const f = createFloat(p, docPageSize(doc), doc.floats.length);
      doc.floats.push(f);
      last = f.id;
    }
  });
  store.ui.selectedFloatId = last;
  setMode('layers');
  toast(ids.length === 1 ? 'Dodano warstwę – przeciągnij, aby ustawić' : `Dodano ${ids.length} warstwy`);
}

/* ================================================================ modes */

const HINTS: Record<Mode, string> = {
  edges: 'Przeciągnij krawędź · kropka na skrzyżowaniu przesuwa całą linię · dwuklik obraca',
  crop: 'Przeciągnij zdjęcie · szczypnij lub kółko myszy, aby przybliżyć',
  layers: 'Przeciągnij warstwę · uchwyty: rozmiar i obrót',
};

function setMode(mode: Mode): void {
  store.ui.mode = mode;
  store.ui.swapFromCellId = null;
  if (mode === 'layers') store.ui.selectedCellId = null;
  if (mode === 'layers' && !store.ui.selectedFloatId && store.doc.floats.length) {
    store.ui.selectedFloatId = store.doc.floats[store.doc.floats.length - 1]!.id;
  }
  store.notify();
}

$$('.mode-btn').forEach((b) =>
  b.addEventListener('click', () => {
    vibrate(8);
    setSheetOpen(false);
    setMode(b.dataset.mode as Mode);
  }),
);

/* ================================================================ edge handles */

function toggleHandles(): void {
  store.ui.showHandles = !store.ui.showHandles;
  savePref('showHandles', store.ui.showHandles);
  toast(store.ui.showHandles ? 'Uchwyty krawędzi widoczne' : 'Uchwyty ukryte – krawędzie nadal można przeciągać');
  store.notify();
}
$('#btn-handles').addEventListener('click', toggleHandles);

/* ================================================================ header */

// Show text labels only when everything fits; otherwise icons only, and on very
// narrow screens tighter spacing as well. Measured, so it works for any width,
// font size or orientation.
const topbar = $('.topbar');
function fitTopbar(): void {
  topbar.classList.remove('compact', 'tight');
  if (topbar.scrollWidth > topbar.clientWidth + 1) topbar.classList.add('compact');
  if (topbar.scrollWidth > topbar.clientWidth + 1) topbar.classList.add('tight');
}
// Watch the bar and its contents: content grows when the text size changes.
const topbarObserver = new ResizeObserver(fitTopbar);
for (const el of [topbar, ...Array.from(topbar.children)]) topbarObserver.observe(el);
window.addEventListener('resize', fitTopbar);
void document.fonts?.ready.then(fitTopbar);
fitTopbar();

$('#btn-undo').addEventListener('click', () => store.undo());
$('#btn-redo').addEventListener('click', () => store.redo());
$('#btn-smart').addEventListener('click', () => {
  if (!store.doc.tree) return;
  store.edit((doc) => smartFit(doc.tree, store.photos, pageRect(doc), doc.style.gapMm));
  toast('Dopasowano podziały do proporcji zdjęć');
});

/* ================================================================ cell toolbar */

$('#cell-toolbar').addEventListener('click', (e) => {
  const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
  const cell = selectedCell();
  if (!act || !cell) return;
  const photo = cell.photoId ? store.photos.get(cell.photoId) : undefined;
  const box = stage.page.querySelector<HTMLElement>(`.cell[data-id="${cell.id}"]`);
  const w = box?.clientWidth ?? 1;
  const h = box?.clientHeight ?? 1;
  switch (act) {
    case 'zoom-in':
    case 'zoom-out':
      if (!photo) return;
      store.edit(() => {
        cell.crop = zoomAt(cell.crop, cell.crop.zoom * (act === 'zoom-in' ? 1.25 : 0.8), 0, 0, photo.width, photo.height, w, h);
      });
      break;
    case 'center':
      store.edit(() => {
        cell.crop = { ...cell.crop, panX: 0, panY: 0 };
      });
      break;
    case 'rotate':
      store.edit(() => {
        cell.crop = rotateCrop(cell.crop);
      });
      break;
    case 'swap':
      store.ui.swapFromCellId = store.ui.swapFromCellId === cell.id ? null : cell.id;
      if (store.ui.swapFromCellId) toast('Stuknij zdjęcie, z którym zamienić');
      store.notify();
      break;
    case 'replace':
      pendingCellId = cell.id;
      $<HTMLInputElement>('#file-cell').click();
      break;
    case 'remove':
      store.edit((doc) => {
        doc.tree = removeCell(doc.tree, cell.id);
      });
      store.ui.selectedCellId = null;
      toast('Usunięto komórkę');
      break;
  }
});

/* ================================================================ float toolbar */

function floatAction(act: string): void {
  const id = store.ui.selectedFloatId;
  if (!id) return;
  if (['front', 'back', 'up', 'down'].includes(act)) {
    store.edit((doc) => {
      doc.floats = reorder(doc.floats, id, act as ZMove);
    });
    return;
  }
  if (act === 'remove') {
    store.edit((doc) => {
      doc.floats = doc.floats.filter((f) => f.id !== id);
    });
    store.ui.selectedFloatId = null;
    toast('Usunięto warstwę');
    return;
  }
  store.edit((doc) => {
    const f = doc.floats.find((x) => x.id === id);
    if (!f) return;
    if (act === 'frame') f.frame = !f.frame;
    if (act === 'shadow') f.shadow = !f.shadow;
    if (act === 'straighten') f.rotation = 0;
  });
}

$('#float-toolbar').addEventListener('click', (e) => {
  const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
  if (act) floatAction(act);
});

/* ================================================================ sheet & tabs */

// The settings sheet starts collapsed so the page gets the most room; it opens
// from the handle or a tab and folds away again when the editing mode changes.
function setSheetOpen(open: boolean): void {
  $('#sheet').classList.toggle('collapsed', !open);
  $('#sheet-handle').setAttribute('aria-expanded', String(open));
}
const sheetIsOpen = (): boolean => !$('#sheet').classList.contains('collapsed');
$('#sheet-handle').addEventListener('click', () => setSheetOpen(!sheetIsOpen()));

$$('.tab').forEach((t) =>
  t.addEventListener('click', () => {
    // Tapping the tab that is already open folds the sheet away.
    if (sheetIsOpen() && t.classList.contains('active')) {
      setSheetOpen(false);
      return;
    }
    setSheetOpen(true);
    $$('.tab').forEach((x) => x.classList.toggle('active', x === t));
    $$('.panel').forEach((p) => p.classList.toggle('active', p.id === t.dataset.tab));
    if (t.dataset.tab === 'tab-layers' && store.doc.floats.length) setMode('layers');
  }),
);

// Formats
const formatChips = $('#format-chips');
for (const f of FORMATS) {
  const b = document.createElement('button');
  b.className = 'chip';
  b.dataset.format = f.id;
  b.textContent = f.print ? `${f.label}` : f.label;
  b.title = `${f.widthMm} × ${f.heightMm} mm`;
  b.addEventListener('click', () => {
    store.edit((doc) => {
      doc.formatId = f.id;
    });
  });
  formatChips.append(b);
}

// Custom format: stored in mm (like the rest of the model); px are converted at the export DPI.
// The last size and unit are remembered per browser, so a new collage gets them back.
type SizeUnit = 'mm' | 'px';
let customUnit: SizeUnit = loadPref<SizeUnit>('customUnit', 'mm') === 'px' ? 'px' : 'mm';
const inpW = $<HTMLInputElement>('#custom-w');
const inpH = $<HTMLInputElement>('#custom-h');
{
  const b = document.createElement('button');
  b.className = 'chip';
  b.dataset.format = CUSTOM_FORMAT_ID;
  b.dataset.testid = 'format-custom';
  b.textContent = 'Własny';
  b.title = 'Własny rozmiar strony w mm lub px';
  b.addEventListener('click', () => {
    if (store.doc.formatId === CUSTOM_FORMAT_ID) return;
    store.edit((doc) => {
      doc.formatId = CUSTOM_FORMAT_ID;
      if (!doc.customMm) {
        // Last size as entered (w × h in page orientation).
        const s = readCustomEntered(loadPref<unknown>('customMm', null)) ?? DEFAULT_CUSTOM_MM;
        doc.customMm = normalizeCustom(s);
        doc.orientation = s.w > s.h ? 'landscape' : 'portrait';
      }
    });
  });
  formatChips.append(b);
}

function readCustomEntered(raw: unknown): { w: number; h: number } | undefined {
  if (!readCustom(raw)) return undefined;
  const { w, h } = raw as { w: number; h: number };
  return { w, h };
}

function fmtSize(mm: number): string {
  return customUnit === 'px' ? String(mmToPx(mm, store.ui.exportDpi)) : String(Math.round(mm * 10) / 10);
}

function applyCustomInputs(): void {
  const w = parseFloat(inpW.value.replace(',', '.'));
  const h = parseFloat(inpH.value.replace(',', '.'));
  if (!(w > 0) || !(h > 0)) {
    renderControls();
    return;
  }
  const toMm = (v: number) => (customUnit === 'px' ? pxToMm(v, store.ui.exportDpi) : v);
  const entered = { w: toMm(w), h: toMm(h) };
  const norm = normalizeCustom(entered);
  const orientation = entered.w > entered.h ? 'landscape' : entered.w < entered.h ? 'portrait' : store.doc.orientation;
  const next = orientation === 'portrait' ? norm : { w: norm.h, h: norm.w };
  const cur = docPageSize(store.doc);
  if (Math.abs(cur.w - next.w) > 0.001 || Math.abs(cur.h - next.h) > 0.001) {
    store.edit((doc) => {
      doc.customMm = norm;
      doc.orientation = orientation;
    });
  }
  savePref('customMm', next);
  // Show clamped / rounded values right away.
  inpW.value = fmtSize(next.w);
  inpH.value = fmtSize(next.h);
}
for (const inp of [inpW, inpH]) {
  inp.addEventListener('change', applyCustomInputs);
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') inp.blur();
  });
}
$$('#custom-size [data-unit]').forEach((c) =>
  c.addEventListener('click', () => {
    customUnit = c.dataset.unit === 'px' ? 'px' : 'mm';
    savePref('customUnit', customUnit);
    renderControls();
  }),
);
$('#btn-orientation').addEventListener('click', () => {
  store.edit((doc) => {
    doc.orientation = doc.orientation === 'portrait' ? 'landscape' : 'portrait';
  });
});

// Presets
$$('.preset-btn[data-preset]').forEach((b) =>
  b.addEventListener('click', () => {
    const preset = b.dataset.preset as Preset;
    store.ui.preset = preset;
    store.edit((doc) => {
      const photos = listCells(doc.tree).map((c) => c.photoId);
      const ids = photos.length ? photos : doc.library.slice();
      const p = docPageSize(doc);
      doc.tree = buildPreset(preset, ids, p.w / p.h);
    });
    store.ui.selectedCellId = null;
  }),
);
$('#btn-random').addEventListener('click', () => {
  // Only the layout is drawn; the style (separators, corners, background) stays as set.
  store.edit((doc) => {
    const cellsNow = listCells(doc.tree).map((c) => c.photoId);
    const ids = cellsNow.length ? cellsNow : doc.library.slice();
    doc.tree = randomLayout(ids, pageRect(doc), doc.style.gapMm, Math.random, store.photos);
  });
  store.ui.preset = 'random';
  store.ui.selectedCellId = null;
  vibrate(12);
  toast('Wylosowano układ');
});

$('#btn-equalize').addEventListener('click', () => {
  store.edit((doc) => equalize(doc.tree));
  toast('Wyrównano podziały');
});

// Style
const rngGap = $<HTMLInputElement>('#rng-gap');
const rngRadius = $<HTMLInputElement>('#rng-radius');
let styleGesture = false;
function styleInput(apply: (doc: Doc, v: number) => void) {
  return (e: Event) => {
    if (!styleGesture) {
      store.beginGesture();
      styleGesture = true;
    }
    store.touchGesture();
    apply(store.doc, parseFloat((e.target as HTMLInputElement).value));
    store.notify();
  };
}
const endStyle = () => {
  if (styleGesture) store.endGesture();
  styleGesture = false;
};
rngGap.addEventListener('input', styleInput((d, v) => (d.style.gapMm = v)));
rngRadius.addEventListener('input', styleInput((d, v) => (d.style.radiusMm = v)));
rngGap.addEventListener('change', endStyle);
rngRadius.addEventListener('change', endStyle);
$$('.color').forEach((b) =>
  b.addEventListener('click', () =>
    store.edit((doc) => {
      doc.style.background = b.dataset.color!;
    }),
  ),
);
$<HTMLInputElement>('#color-custom').addEventListener('change', (e) =>
  store.edit((doc) => {
    doc.style.background = (e.target as HTMLInputElement).value;
  }),
);

// Photos
async function onFiles(input: HTMLInputElement, handler: (items: LoadedPhoto[]) => void): Promise<void> {
  const files = input.files;
  if (!files || !files.length) return;
  const items = await loadFiles(files);
  input.value = '';
  if (!items.length) {
    toast('Nie udało się wczytać zdjęć');
    return;
  }
  handler(items);
}
$<HTMLInputElement>('#file-grid').addEventListener('change', (e) => onFiles(e.target as HTMLInputElement, addToGrid));
for (const sel of ['#file-layer', '#file-layer-2']) {
  $<HTMLInputElement>(sel).addEventListener('change', (e) =>
    onFiles(e.target as HTMLInputElement, (items) => addAsLayers(registerPhotos(items))),
  );
}
$<HTMLInputElement>('#file-cell').addEventListener('change', (e) =>
  onFiles(e.target as HTMLInputElement, (items) => {
    const cellId = pendingCellId;
    pendingCellId = null;
    const [first, ...rest] = items;
    if (!first) return;
    registerPhotos(items);
    store.edit((doc) => {
      for (const it of items) if (!doc.library.includes(it.photo.id)) doc.library.push(it.photo.id);
      if (cellId && findNode(doc.tree, cellId)) setCellPhoto(doc.tree, cellId, first.photo.id);
      else doc.tree = insertPhoto(doc.tree, first.photo.id, pageRect(doc), doc.style.gapMm);
      for (const it of rest) doc.tree = insertPhoto(doc.tree, it.photo.id, pageRect(doc), doc.style.gapMm);
    });
  }),
);
$('#btn-shuffle').addEventListener('click', () => {
  store.edit((doc) => shufflePhotos(doc.tree, Math.random, { photos: store.photos, page: pageRect(doc), gap: doc.style.gapMm }));
  toast('Wymieszano zdjęcia');
});

/* ================================================================ export */

const modal = $('#export-modal');
function updateExportInfo(): void {
  const f = getFormat(store.doc.formatId, store.doc.customMm);
  const page = docPageSize(store.doc);
  const mm = (v: number) => String(Math.round(v * 10) / 10);
  const dpi = effectiveDpi(store, store.ui.exportDpi);
  const px = pageSizePx(page, dpi);
  $('#export-info').textContent =
    `${f.label} ${store.doc.orientation === 'portrait' ? 'pionowo' : 'poziomo'} · ${mm(page.w)} × ${mm(page.h)} mm ·` +
    `${px.w} × ${px.h} px przy ${dpi} DPI` +
    (dpi !== store.ui.exportDpi ? ' (ograniczono ze względu na pamięć)' : '');
  $$('#dpi-chips .chip').forEach((c) => c.classList.toggle('active', Number(c.dataset.dpi) === store.ui.exportDpi));
}
$('#btn-open-export').addEventListener('click', () => {
  updateExportInfo();
  modal.classList.add('open');
});
$('#btn-close-export').addEventListener('click', () => modal.classList.remove('open'));
modal.addEventListener('click', (e) => {
  if (e.target === modal) modal.classList.remove('open');
});
$$('#dpi-chips .chip').forEach((c) =>
  c.addEventListener('click', () => {
    store.ui.exportDpi = Number(c.dataset.dpi);
    updateExportInfo();
    store.notify();
  }),
);

async function guarded(fn: () => Promise<void>): Promise<void> {
  if (!store.doc.tree && !store.doc.floats.length) {
    toast('Dodaj najpierw zdjęcia');
    return;
  }
  try {
    await fn();
  } catch (err) {
    console.error(err);
    toast('Eksport nie powiódł się');
  }
}
/** Toast after saving; nothing to say when the user closed the save dialog. */
function savedToast(r: SaveResult, what: string): void {
  if (r.how === 'saved') toast(`Zapisano ${what} ${r.name}`);
  else if (r.how !== 'cancelled') toast(`Pobrano ${what}`);
}
const exportImage = (name: string, type: string, quality?: number) =>
  saveFile(name, 'collage', () => canvasToBlob(renderToCanvas(store, store.ui.exportDpi).canvas, type, quality));
$('#btn-export-pdf').addEventListener('click', () =>
  guarded(async () => savedToast(await saveFile('kolaz.pdf', 'collage', () => exportPdf(store, store.ui.exportDpi)), 'PDF')),
);
$('#btn-export-png').addEventListener('click', () =>
  guarded(async () => savedToast(await exportImage('kolaz.png', 'image/png'), 'PNG')),
);
$('#btn-export-jpg').addEventListener('click', () =>
  guarded(async () => savedToast(await exportImage('kolaz.jpg', 'image/jpeg', 0.93), 'JPG')),
);
$('#btn-project-save').addEventListener('click', () =>
  guarded(async () => {
    const r = await saveProjectFile(store);
    if (r.how !== 'cancelled') toast(`Zapisano projekt ${r.name}`);
  }),
);
const askSave = $<HTMLInputElement>('#ask-save');
if (canAskWhereToSave()) {
  askSave.checked = askWhereToSave();
  askSave.addEventListener('change', () => setAskWhereToSave(askSave.checked));
  $('#save-where').hidden = false;
} else {
  $('#save-where-hint').hidden = false;
}
$<HTMLInputElement>('#file-project').addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const { missing } = await openProjectFile(file, store, registerPhotos);
    modal.classList.remove('open');
    toast(missing ? `Otwarto projekt · brakujące zdjęcia: ${missing}` : 'Otwarto projekt – „Cofnij” wraca do poprzedniego');
  } catch (err) {
    console.error(err);
    toast(err instanceof ProjectError ? err.message : 'Nie udało się otworzyć projektu');
  }
});
$('#btn-print').addEventListener('click', () => guarded(() => printDoc(store, store.ui.exportDpi)));
$('#btn-share').addEventListener('click', () =>
  guarded(async () => {
    const blob = await canvasToBlob(renderToCanvas(store, store.ui.exportDpi).canvas, 'image/jpeg', 0.93);
    const file = new File([blob], 'kolaz.jpg', { type: 'image/jpeg' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Kolaż' }).catch(() => undefined);
    } else {
      downloadBlob(blob, 'kolaz.jpg');
      toast('Udostępnianie niedostępne – pobrano JPG');
    }
  }),
);

/* ================================================================ keyboard */

window.addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement).tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) store.redo();
    else store.undo();
    return;
  }
  if (mod && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    store.redo();
    return;
  }
  if (!mod && !e.altKey && e.key.toLowerCase() === 'h') {
    toggleHandles();
    return;
  }
  if (e.key === 'Escape') {
    store.ui.selectedCellId = null;
    store.ui.selectedFloatId = null;
    store.ui.swapFromCellId = null;
    modal.classList.remove('open');
    store.notify();
    return;
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && store.ui.mode === 'layers' && store.ui.selectedFloatId) {
    e.preventDefault();
    floatAction('remove');
    return;
  }
  const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const a = arrows[e.key];
  if (a && store.ui.mode === 'layers' && store.ui.selectedFloatId) {
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    const page = docPageSize(store.doc);
    store.edit((doc) => {
      const f = doc.floats.find((x) => x.id === store.ui.selectedFloatId);
      if (!f) return;
      f.cx = Math.max(0, Math.min(1, f.cx + (a[0] * step) / page.w));
      f.cy = Math.max(0, Math.min(1, f.cy + (a[1] * step) / page.h));
    });
  }
});

/* ================================================================ render */

function renderControls(): void {
  const { doc, ui } = store;
  $$('.mode-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === ui.mode));
  $('#mode-hint').textContent = HINTS[ui.mode];
  document.body.dataset.handles = ui.showHandles ? 'shown' : 'hidden';
  $('#btn-handles').setAttribute('aria-pressed', String(ui.showHandles));
  $<HTMLButtonElement>('#btn-undo').disabled = !store.history.canUndo;
  $<HTMLButtonElement>('#btn-redo').disabled = !store.history.canRedo;
  $$('#format-chips .chip').forEach((c) => c.classList.toggle('active', c.dataset.format === doc.formatId));
  const custom = doc.formatId === CUSTOM_FORMAT_ID;
  $('#custom-size').hidden = !custom;
  if (custom) {
    const p = docPageSize(doc);
    if (document.activeElement !== inpW) inpW.value = fmtSize(p.w);
    if (document.activeElement !== inpH) inpH.value = fmtSize(p.h);
    $$('#custom-size [data-unit]').forEach((c) => c.classList.toggle('active', c.dataset.unit === customUnit));
    $('#custom-hint').textContent =
      customUnit === 'px'
        ? `Piksele przy ${ui.exportDpi} DPI (zmiana w oknie Zapisz) · ${Math.round(p.w * 10) / 10} × ${Math.round(p.h * 10) / 10} mm`
        : `${mmToPx(p.w, ui.exportDpi)} × ${mmToPx(p.h, ui.exportDpi)} px przy ${ui.exportDpi} DPI`;
  }
  $('#btn-orientation').textContent = doc.orientation === 'portrait' ? 'Pionowo ⟳' : 'Poziomo ⟳';
  $$('.preset-btn[data-preset]').forEach((b) => b.classList.toggle('active', b.dataset.preset === ui.preset));
  $('#btn-random').classList.toggle('active', ui.preset === 'random');
  $$('.color').forEach((c) => c.classList.toggle('active', c.dataset.color === doc.style.background));
  rngGap.value = String(doc.style.gapMm);
  rngRadius.value = String(doc.style.radiusMm);
  $('#lbl-gap').textContent = `${doc.style.gapMm} mm`;
  $('#lbl-radius').textContent = `${doc.style.radiusMm} mm`;

  const cell = selectedCell();
  const showCellTb = !!cell && ui.mode !== 'layers';
  $('#cell-toolbar').hidden = !showCellTb;
  if (cell) $('#tb-zoom').textContent = `${cell.crop.zoom.toFixed(1)}×`;
  $('#cell-toolbar [data-act="swap"]').classList.toggle('on', !!ui.swapFromCellId);

  const fsel = doc.floats.find((f) => f.id === ui.selectedFloatId);
  $('#float-toolbar').hidden = !(fsel && ui.mode === 'layers');
  if (fsel) {
    $('#float-toolbar [data-act="frame"]').classList.toggle('on', fsel.frame);
    $('#float-toolbar [data-act="shadow"]').classList.toggle('on', fsel.shadow);
  }
  renderThumbs();
  renderLayerList();
}

let thumbsKey = '';
function renderThumbs(): void {
  const used = new Set(listCells(store.doc.tree).map((c) => c.photoId));
  const key = store.doc.library.join(',') + '|' + [...used].join(',');
  if (key === thumbsKey) return;
  thumbsKey = key;
  const list = $('#thumbs');
  list.innerHTML = '';
  for (const id of store.doc.library) {
    const p = store.photos.get(id);
    if (!p) continue;
    const item = document.createElement('div');
    item.className = 'thumb' + (used.has(id) ? ' used' : '');
    item.dataset.testid = 'thumb';
    item.title = 'Stuknij, aby wstawić do zaznaczonej komórki (lub dodać do układu)';
    item.innerHTML = `<img alt="" src="${p.src}"><button class="mini as-layer" title="Dodaj jako warstwę">⧉</button><button class="mini del" title="Usuń z projektu">✕</button>`;
    item.addEventListener('click', () => {
      const cell = selectedCell();
      store.edit((doc) => {
        if (cell) setCellPhoto(doc.tree, cell.id, id);
        else doc.tree = insertPhoto(doc.tree, id, pageRect(doc), doc.style.gapMm);
      });
      toast(cell ? 'Wstawiono do komórki' : 'Dodano do układu');
    });
    item.querySelector('.as-layer')!.addEventListener('click', (e) => {
      e.stopPropagation();
      addAsLayers([id]);
    });
    item.querySelector('.del')!.addEventListener('click', (e) => {
      e.stopPropagation();
      store.edit((doc) => {
        doc.library = doc.library.filter((x) => x !== id);
        doc.tree = removePhotoFromTree(doc.tree, id);
        doc.floats = doc.floats.filter((f) => f.photoId !== id);
      });
      store.sanitizeSelection();
    });
    list.append(item);
  }
}

let layersKey = '';
function renderLayerList(): void {
  const { doc, ui } = store;
  const key = doc.floats.map((f) => f.id).join(',') + '|' + ui.selectedFloatId;
  if (key === layersKey) return;
  layersKey = key;
  const list = $('#layer-list');
  list.innerHTML = '';
  if (!doc.floats.length) {
    list.innerHTML = '<p class="empty-note">Brak warstw. Dodaj zdjęcie, które będzie leżeć swobodnie na układzie – możesz je przesuwać, skalować i obracać.</p>';
    return;
  }
  [...doc.floats].reverse().forEach((f, i) => {
    const p = store.photos.get(f.photoId);
    const row = document.createElement('div');
    row.className = 'layer-item' + (f.id === ui.selectedFloatId ? ' active' : '');
    row.dataset.testid = 'layer-item';
    row.innerHTML = `<img alt="" src="${p?.src ?? ''}"><span>Warstwa ${doc.floats.length - i}</span>
      <button class="tool-btn" data-z="up" title="Wyżej">↑</button><button class="tool-btn" data-z="down" title="Niżej">↓</button>`;
    row.addEventListener('click', (e) => {
      const z = (e.target as HTMLElement).dataset.z;
      store.ui.selectedFloatId = f.id;
      if (z) store.edit((d) => void (d.floats = reorder(d.floats, f.id, z as ZMove)));
      setMode('layers');
    });
    list.append(row);
  });
}

store.subscribe(() => {
  stage.render();
  renderControls();
});

/* ================================================================ init */

/* ================================================================ saving on the device */

let storage: IdbStorage | null = null;
try {
  storage = 'indexedDB' in window ? new IdbStorage() : null;
} catch {
  storage = null;
}
const autosaver = storage
  ? new Autosaver(
      storage,
      () => store.doc,
      (id) => store.photos.get(id),
      async (photo) => (await fetch(photo.src)).blob(),
      (err) => {
        console.error(err);
        toast('Nie udało się zapisać projektu w telefonie');
      },
    )
  : null;
// Saving starts only after the saved project was restored – otherwise the empty
// start-up document could overwrite it.
let saveEnabled = false;
if (autosaver) {
  store.subscribe(() => {
    if (saveEnabled) autosaver.schedule();
  });
  // Save immediately when the app is hidden or closed.
  document.addEventListener('visibilitychange', () => {
    if (saveEnabled && document.visibilityState === 'hidden') void autosaver.flush();
  });
  window.addEventListener('pagehide', () => {
    if (saveEnabled) void autosaver.flush();
  });
}

async function startDemo(): Promise<void> {
  const demo = await loadDemoPhotos();
  const ids = registerPhotos(demo);
  const p = docPageSize(store.doc);
  store.doc.library = ids;
  store.doc.tree = buildPreset('grid', ids, p.w / p.h);
}

async function init(): Promise<void> {
  let restored = false;
  if (storage) {
    try {
      const saved = await restoreProject(storage);
      if (saved) {
        registerPhotos(saved.photos);
        store.doc = saved.doc;
        autosaver?.markStored(saved.photos.map((p) => p.photo.id));
        autosaver?.markSaved();
        restored = true;
      }
    } catch (err) {
      console.error(err);
    }
  }
  if (!restored) await startDemo();
  store.history.clear();
  store.flush();
  requestPersistentStorage();
  saveEnabled = true;
  if (!restored) autosaver?.schedule();
  document.body.dataset.ready = 'true';
}

$('#btn-new-project').addEventListener('click', () => {
  const p = docPageSize(store.doc);
  store.edit((doc) => {
    doc.tree = buildPreset('grid', [null, null, null, null], p.w / p.h);
    doc.floats = [];
    doc.library = [];
  });
  store.ui.selectedCellId = null;
  store.ui.selectedFloatId = null;
  toast('Nowy kolaż – „Cofnij” przywraca poprzedni');
});

// Test/debug hook (used by the e2e suite).
(window as unknown as { __collage: unknown }).__collage = { store, stage, flushSave: () => autosaver?.flush() };

store.flush();
void init();
initPwa({ loadPref, savePref, toast });
initTemplates(store, toast);

import './styles.css';
import { rotateCrop, zoomAt } from './core/crop';
import { createFloat, reorder, type ZMove } from './core/floats';
import { FORMATS, docPageSize, getFormat, pageSizePx } from './core/page';
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
import { Store, savePref, type Mode } from './store';
import { downloadBlob, canvasToBlob, effectiveDpi, exportPdf, printDoc, renderToCanvas } from './ui/export';
import { loadDemoPhotos, loadFiles, type LoadedPhoto } from './ui/images';
import { Stage, vibrate } from './ui/stage';

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
  edges: 'Przeciągnij krawędź · dwuklik na krawędzi obraca podział',
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

$('#sheet-handle').addEventListener('click', () => $('#sheet').classList.toggle('collapsed'));

$$('.tab').forEach((t) =>
  t.addEventListener('click', () => {
    $('#sheet').classList.remove('collapsed');
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
$('#btn-orientation').addEventListener('click', () => {
  store.edit((doc) => {
    doc.orientation = doc.orientation === 'portrait' ? 'landscape' : 'portrait';
  });
});

// Presets
$$('.preset-btn').forEach((b) =>
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
$('#btn-equalize').addEventListener('click', () => {
  store.edit((doc) => equalize(doc.tree));
  toast('Wyrównano podziały');
});
$<HTMLInputElement>('#chk-link').addEventListener('change', (e) => {
  store.ui.linkEdges = (e.target as HTMLInputElement).checked;
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
  store.edit((doc) => shufflePhotos(doc.tree));
  toast('Wymieszano zdjęcia');
});

/* ================================================================ export */

const modal = $('#export-modal');
function updateExportInfo(): void {
  const f = getFormat(store.doc.formatId);
  const page = docPageSize(store.doc);
  const dpi = effectiveDpi(store, store.ui.exportDpi);
  const px = pageSizePx(page, dpi);
  $('#export-info').textContent =
    `${f.label} ${store.doc.orientation === 'portrait' ? 'pionowo' : 'poziomo'} · ${page.w} × ${page.h} mm · ` +
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
$('#btn-export-pdf').addEventListener('click', () =>
  guarded(async () => {
    downloadBlob(await exportPdf(store, store.ui.exportDpi), 'kolaz.pdf');
    toast('Pobrano PDF');
  }),
);
$('#btn-export-png').addEventListener('click', () =>
  guarded(async () => {
    downloadBlob(await canvasToBlob(renderToCanvas(store, store.ui.exportDpi).canvas, 'image/png'), 'kolaz.png');
    toast('Pobrano PNG');
  }),
);
$('#btn-export-jpg').addEventListener('click', () =>
  guarded(async () => {
    downloadBlob(await canvasToBlob(renderToCanvas(store, store.ui.exportDpi).canvas, 'image/jpeg', 0.93), 'kolaz.jpg');
    toast('Pobrano JPG');
  }),
);
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
  $('#btn-orientation').textContent = doc.orientation === 'portrait' ? 'Pionowo ⟳' : 'Poziomo ⟳';
  $$('.preset-btn').forEach((b) => b.classList.toggle('active', b.dataset.preset === ui.preset));
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

async function init(): Promise<void> {
  const demo = await loadDemoPhotos();
  const ids = registerPhotos(demo);
  const p = docPageSize(store.doc);
  store.doc.library = ids;
  store.doc.tree = buildPreset('grid', ids, p.w / p.h);
  store.history.clear();
  store.flush();
  document.body.dataset.ready = 'true';
}

// Test/debug hook (used by the e2e suite).
(window as unknown as { __collage: unknown }).__collage = { store, stage };

store.flush();
void init();

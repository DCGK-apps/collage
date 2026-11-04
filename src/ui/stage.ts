import { coverPlacement, panBy, zoomAt } from '../core/crop';
import { floatBox, moveFloat, normalizeAngle, setFloatSize, snapAngle } from '../core/floats';
import {
  applyDragPosition,
  beginDividerDrag,
  computeLayout,
  type DragSession,
  type Layout,
  type PickOptions,
  dividersAt,
  needsDirection,
  pickDivider,
  resolveDragPosition,
} from '../core/geometry';
import { docPageSize, fitScale } from '../core/page';
import { findNode, toggleSplitDir } from '../core/tree';
import type { CellNode, Crop, FloatLayer, Size } from '../core/types';
import type { Store } from '../store';

/** Snap distance for edges, in screen pixels. */
const SNAP_PX = 8;
/** Movement (px) below which a pointer interaction counts as a tap. */
const TAP_SLOP = 5;
const DOUBLE_TAP_MS = 380;
/** Half of the visible edge pill length (CSS: 42px) and extra tolerance for fingers. */
const PILL_HALF_PX = 21;
const PILL_SLOP_PX = 8;
/** Movement needed at a crossing before we decide which line is being dragged. */
const DIRECTION_SLOP_PX = 4;

export interface StageCallbacks {
  onRequestPhotoForCell(cellId: string): void;
  toast(text: string): void;
}

interface CellEls {
  el: HTMLDivElement;
  img: HTMLImageElement;
  photoId: string | null;
}

interface FloatEls {
  el: HTMLDivElement;
  img: HTMLImageElement;
  photoId: string;
}

type Pt = { x: number; y: number };

/**
 * Preview renderer + gesture handling. DOM nodes are keyed by model id and only
 * their styles are updated on each frame, so dragging never recreates elements
 * (no image re-decoding, pointer capture is preserved, motion stays smooth).
 */
export class Stage {
  readonly page: HTMLDivElement;
  private cellsLayer: HTMLDivElement;
  private floatsLayer: HTMLDivElement;
  private dividersLayer: HTMLDivElement;
  private cellEls = new Map<string, CellEls>();
  private floatEls = new Map<string, FloatEls>();
  private dividerEls = new Map<string, HTMLDivElement>();
  private layout: Layout = { cells: [], dividers: [] };
  scale = 1;
  private pageSize: Size = { w: 210, h: 297 };
  private lastDividerTap: { id: string; time: number } | null = null;
  private activeDividerIds = new Set<string>();

  constructor(
    private readonly workspace: HTMLElement,
    private readonly store: Store,
    private readonly cb: StageCallbacks,
  ) {
    this.page = el('div', 'page');
    this.page.id = 'page';
    this.page.dataset.testid = 'page';
    this.cellsLayer = el('div', 'layer cells-layer');
    this.floatsLayer = el('div', 'layer floats-layer');
    this.dividersLayer = el('div', 'layer dividers-layer');
    this.page.append(this.cellsLayer, this.floatsLayer, this.dividersLayer);
    workspace.append(this.page);

    this.bindDividers();
    this.bindCells();
    this.bindFloats();
    this.bindOutsideDismiss();
    new ResizeObserver(() => this.render()).observe(workspace);
  }

  /* ------------------------------------------------------------ render */

  render(): void {
    const { doc, ui } = this.store;
    this.pageSize = docPageSize(doc);
    const pad = 14;
    const cs = getComputedStyle(this.workspace);
    const availH = this.workspace.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    this.scale = fitScale(this.pageSize, this.workspace.clientWidth - pad * 2, availH - pad * 2);
    const s = this.scale;
    this.page.style.width = `${this.pageSize.w * s}px`;
    this.page.style.height = `${this.pageSize.h * s}px`;
    this.page.style.background = doc.style.background;
    document.body.dataset.mode = ui.mode;

    this.layout = computeLayout(doc.tree, { x: 0, y: 0, w: this.pageSize.w, h: this.pageSize.h }, doc.style.gapMm);
    this.renderCells();
    this.renderDividers();
    this.renderFloats();
  }

  private renderCells(): void {
    const { doc, ui, photos } = this.store;
    const s = this.scale;
    const seen = new Set<string>();
    this.layout.cells.forEach((c, i) => {
      seen.add(c.id);
      let ce = this.cellEls.get(c.id);
      if (!ce) {
        const node = el('div', 'cell');
        node.dataset.id = c.id;
        node.dataset.testid = 'cell';
        const img = document.createElement('img');
        img.draggable = false;
        img.alt = '';
        const ph = el('div', 'cell-empty');
        ph.innerHTML = '<span>+</span><small>Dodaj zdjęcie</small>';
        node.append(img, ph);
        this.cellsLayer.append(node);
        ce = { el: node, img, photoId: null };
        this.cellEls.set(c.id, ce);
      }
      const w = c.rect.w * s;
      const h = c.rect.h * s;
      const st = ce.el.style;
      st.transform = `translate(${c.rect.x * s}px, ${c.rect.y * s}px)`;
      st.width = `${w}px`;
      st.height = `${h}px`;
      st.borderRadius = `${doc.style.radiusMm * s}px`;
      st.zIndex = String(i);
      ce.el.classList.toggle('selected', ui.selectedCellId === c.id);
      ce.el.classList.toggle('swap-source', ui.swapFromCellId === c.id);

      const photo = c.node.photoId ? photos.get(c.node.photoId) : undefined;
      ce.el.classList.toggle('empty', !photo);
      if (c.node.photoId !== ce.photoId) {
        ce.photoId = c.node.photoId;
        if (photo) ce.img.src = photo.src;
        else ce.img.removeAttribute('src');
      }
      if (photo) {
        const pl = coverPlacement(photo.width, photo.height, w, h, c.node.crop);
        const is = ce.img.style;
        is.width = `${pl.drawW}px`;
        is.height = `${pl.drawH}px`;
        is.transform =
          `translate(${w / 2 + pl.offsetX - pl.drawW / 2}px, ${h / 2 + pl.offsetY - pl.drawH / 2}px)` +
          (c.node.crop.rotate ? ` rotate(${c.node.crop.rotate}deg)` : '');
      }
    });
    for (const [id, ce] of this.cellEls) {
      if (!seen.has(id)) {
        ce.el.remove();
        this.cellEls.delete(id);
      }
    }
  }

  private renderDividers(): void {
    const s = this.scale;
    const seen = new Set<string>();
    for (const d of this.layout.dividers) {
      seen.add(d.id);
      let node = this.dividerEls.get(d.id);
      if (!node) {
        node = el('div', 'divider');
        node.dataset.id = d.id;
        node.dataset.testid = 'divider';
        node.title = 'Przeciągnij, aby zmienić rozmiar · kliknij dwukrotnie, aby obrócić podział';
        node.append(el('div', 'pill'));
        this.dividersLayer.append(node);
        this.dividerEls.set(d.id, node);
      }
      node.dataset.dir = d.dir;
      node.classList.toggle('v', d.dir === 'v');
      node.classList.toggle('h', d.dir === 'h');
      node.classList.toggle('active', this.activeDividerIds.has(d.id));
      const st = node.style;
      const len = (d.spanEnd - d.spanStart) * s;
      if (d.dir === 'v') {
        st.transform = `translate(${d.pos * s}px, ${d.spanStart * s}px) translateX(-50%)`;
        st.height = `${len}px`;
        st.width = '';
      } else {
        st.transform = `translate(${d.spanStart * s}px, ${d.pos * s}px) translateY(-50%)`;
        st.width = `${len}px`;
        st.height = '';
      }
    }
    for (const [id, node] of this.dividerEls) {
      if (!seen.has(id)) {
        node.remove();
        this.dividerEls.delete(id);
      }
    }
  }

  private renderFloats(): void {
    const { doc, ui, photos } = this.store;
    const s = this.scale;
    const seen = new Set<string>();
    doc.floats.forEach((f, i) => {
      seen.add(f.id);
      let fe = this.floatEls.get(f.id);
      if (!fe) {
        const node = el('div', 'float');
        node.dataset.id = f.id;
        node.dataset.testid = 'float';
        const img = document.createElement('img');
        img.draggable = false;
        img.alt = '';
        const rz = el('div', 'handle h-resize');
        rz.dataset.handle = 'resize';
        rz.title = 'Zmień rozmiar';
        const rt = el('div', 'handle h-rotate');
        rt.dataset.handle = 'rotate';
        rt.title = 'Obróć';
        node.append(img, rz, rt);
        this.floatsLayer.append(node);
        fe = { el: node, img, photoId: '' };
        this.floatEls.set(f.id, fe);
      }
      const photo = photos.get(f.photoId);
      if (fe.photoId !== f.photoId && photo) {
        fe.photoId = f.photoId;
        fe.img.src = photo.src;
      }
      const b = floatBox(f, photo, this.pageSize, doc.style.gapMm);
      const st = fe.el.style;
      const fw = (b.w + 2 * b.frame) * s;
      const fh = (b.h + 2 * b.frame) * s;
      st.width = `${fw}px`;
      st.height = `${fh}px`;
      st.padding = `${b.frame * s}px`;
      st.transform = `translate(${b.cx * s - fw / 2}px, ${b.cy * s - fh / 2}px) rotate(${b.rotation}deg)`;
      st.zIndex = String(10 + i);
      fe.el.classList.toggle('framed', f.frame);
      fe.el.classList.toggle('shadow', f.shadow);
      fe.el.classList.toggle('selected', ui.selectedFloatId === f.id && ui.mode === 'layers');
      if (fe.el.parentElement !== this.floatsLayer || this.floatsLayer.children[i] !== fe.el) {
        this.floatsLayer.insertBefore(fe.el, this.floatsLayer.children[i] ?? null);
      }
    });
    for (const [id, fe] of this.floatEls) {
      if (!seen.has(id)) {
        fe.el.remove();
        this.floatEls.delete(id);
      }
    }
  }

  /* ------------------------------------------------------------ helpers */

  /** Client px → page mm. */
  toPage(clientX: number, clientY: number): Pt {
    const r = this.page.getBoundingClientRect();
    return { x: (clientX - r.left) / this.scale, y: (clientY - r.top) / this.scale };
  }

  private cellAt(id: string): { node: CellNode; w: number; h: number } | null {
    const c = this.layout.cells.find((x) => x.id === id);
    if (!c) return null;
    return { node: c.node, w: c.rect.w * this.scale, h: c.rect.h * this.scale };
  }

  private wheelTimer = 0;

  /** Groups a burst of wheel events into one undo step. */
  private wheelGesture(mutate: () => void): void {
    if (!this.wheelTimer) this.store.beginGesture();
    else clearTimeout(this.wheelTimer);
    this.store.touchGesture();
    mutate();
    this.store.notify();
    this.wheelTimer = window.setTimeout(() => {
      this.wheelTimer = 0;
      this.store.endGesture();
    }, 400);
  }

  /* ------------------------------------------------------------ dividers */

  private bindDividers(): void {
    this.dividersLayer.addEventListener('pointerdown', (e) => {
      const target = (e.target as HTMLElement).closest<HTMLDivElement>('.divider');
      if (!target || this.store.ui.mode !== 'edges' || e.button > 0) return;
      e.preventDefault();
      e.stopPropagation();

      // Which line is meant is decided from geometry, not from which element is
      // on top: where lines cross, the hit areas overlap.
      const p = this.toPage(e.clientX, e.clientY);
      const thicknessPx = target.dataset.dir === 'v' ? target.offsetWidth : target.offsetHeight;
      const pick: PickOptions = {
        hitHalf: thicknessPx / 2 / this.scale,
        pillHalf: (PILL_HALF_PX + PILL_SLOP_PX) / this.scale,
      };
      let cands = dividersAt(this.layout, p.x, p.y, pick.hitHalf);
      if (!cands.length) cands = this.layout.dividers.filter((d) => d.id === target.dataset.id);
      if (!cands.length) return;

      target.setPointerCapture(e.pointerId);
      const start = { x: e.clientX, y: e.clientY };
      const linked = this.store.ui.linkEdges && !e.altKey;
      let session: DragSession | null = null;
      let moved = false;

      const begin = (id: string): void => {
        session = beginDividerDrag(this.layout, id, this.store.doc.style.gapMm, {
          linked,
          pageRect: { x: 0, y: 0, w: this.pageSize.w, h: this.pageSize.h },
        });
        this.activeDividerIds = new Set(session?.group.map((g) => g.id) ?? []);
        this.render();
      };

      this.store.beginGesture();
      // An unambiguous press highlights its line immediately; at a crossing we
      // wait for the first movement to see which way the user drags.
      if (!needsDirection(cands)) begin(pickDivider(cands, p.x, p.y, null, pick)!.id);

      const onMove = (me: PointerEvent): void => {
        if (me.pointerId !== e.pointerId) return;
        const dx = me.clientX - start.x;
        const dy = me.clientY - start.y;
        if (!session) {
          if (Math.hypot(dx, dy) < DIRECTION_SLOP_PX) return;
          begin(pickDivider(cands, p.x, p.y, { dx, dy }, pick)!.id);
          if (!session) return;
        }
        const s: DragSession = session;
        const deltaPx = s.dir === 'v' ? dx : dy;
        if (!moved && Math.abs(deltaPx) < 2) return;
        moved = true;
        const pos = resolveDragPosition(s, deltaPx / this.scale, me.shiftKey ? 0 : SNAP_PX / this.scale);
        this.store.touchGesture();
        applyDragPosition(s, pos);
        this.store.notify();
      };
      const onEnd = (ue: PointerEvent): void => {
        if (ue.pointerId !== e.pointerId) return;
        target.removeEventListener('pointermove', onMove);
        target.removeEventListener('pointerup', onEnd);
        target.removeEventListener('pointercancel', onEnd);
        this.activeDividerIds.clear();
        this.store.endGesture();
        const dist = Math.hypot(ue.clientX - start.x, ue.clientY - start.y);
        if (!moved && dist < TAP_SLOP && ue.type === 'pointerup') {
          this.onDividerTap(pickDivider(cands, p.x, p.y, null, pick)!.id);
        } else {
          this.lastDividerTap = null;
        }
      };
      target.addEventListener('pointermove', onMove);
      target.addEventListener('pointerup', onEnd);
      target.addEventListener('pointercancel', onEnd);
    });
    // Native dblclick is handled by our own tap logic (works for touch too).
    this.dividersLayer.addEventListener('dblclick', (e) => e.preventDefault());
  }

  private onDividerTap(id: string): void {
    const now = performance.now();
    const last = this.lastDividerTap;
    if (last && last.id === id && now - last.time < DOUBLE_TAP_MS) {
      this.lastDividerTap = null;
      this.toggleDivider(id);
    } else {
      this.lastDividerTap = { id, time: now };
    }
  }

  toggleDivider(id: string): void {
    const node = findNode(this.store.doc.tree, id);
    if (!node || node.type !== 'split') return;
    this.store.edit((doc) => {
      toggleSplitDir(doc.tree, id);
    });
    const dir = node.dir === 'v' ? 'obok siebie' : 'jedno pod drugim';
    this.cb.toast(`Zmieniono układ: ${dir}`);
    vibrate(15);
  }

  /* ------------------------------------------------------------ cells */

  private bindCells(): void {
    const pointers = new Map<number, Pt>();
    let gesture:
      | null
      | {
          cellId: string;
          start: Pt;
          crop0: Crop;
          moved: boolean;
          pinch: null | { d0: number; zoom0: number };
        } = null;

    const dist = (): number => {
      const [a, b] = [...pointers.values()];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };
    const mid = (): Pt => {
      const pts = [...pointers.values()];
      return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
    };

    this.cellsLayer.addEventListener('pointerdown', (e) => {
      const target = (e.target as HTMLElement).closest<HTMLDivElement>('.cell');
      if (!target || e.button > 0) return;
      const id = target.dataset.id!;
      const mode = this.store.ui.mode;
      if (mode === 'layers') return;
      e.preventDefault();
      const c = this.cellAt(id);
      if (!c) return;
      if (gesture && gesture.cellId !== id) return; // second finger on another cell
      target.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!gesture) {
        gesture = { cellId: id, start: { x: e.clientX, y: e.clientY }, crop0: { ...c.node.crop }, moved: false, pinch: null };
        this.store.beginGesture();
      }
      if (pointers.size === 2 && mode === 'crop') {
        gesture.pinch = { d0: dist(), zoom0: c.node.crop.zoom };
        gesture.moved = true;
      }
    });

    this.cellsLayer.addEventListener('pointermove', (e) => {
      if (!gesture || !pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.store.ui.mode !== 'crop') return;
      const c = this.cellAt(gesture.cellId);
      if (!c || !c.node.photoId) return;
      const photo = this.store.photos.get(c.node.photoId);
      if (!photo) return;
      if (gesture.pinch && pointers.size >= 2) {
        const d = dist();
        if (gesture.pinch.d0 <= 0) return;
        const m = mid();
        const r = this.cellsLayer.querySelector<HTMLElement>(`.cell[data-id="${gesture.cellId}"]`)!.getBoundingClientRect();
        const fx = m.x - (r.left + r.width / 2);
        const fy = m.y - (r.top + r.height / 2);
        this.store.touchGesture();
        c.node.crop = zoomAt(c.node.crop, gesture.pinch.zoom0 * (d / gesture.pinch.d0), fx, fy, photo.width, photo.height, c.w, c.h);
        this.store.notify();
        return;
      }
      const dx = e.clientX - gesture.start.x;
      const dy = e.clientY - gesture.start.y;
      if (!gesture.moved && Math.hypot(dx, dy) < TAP_SLOP) return;
      gesture.moved = true;
      const pl = coverPlacement(photo.width, photo.height, c.w, c.h, gesture.crop0);
      this.store.touchGesture();
      c.node.crop = panBy(gesture.crop0, dx, dy, pl);
      this.store.notify();
    });

    const end = (e: PointerEvent): void => {
      if (!gesture || !pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (pointers.size > 0) {
        // Pinch ended with one finger left: continue as a pan from here.
        const [p] = [...pointers.values()];
        const c = this.cellAt(gesture.cellId);
        if (p && c) {
          gesture.start = p;
          gesture.crop0 = { ...c.node.crop };
          gesture.pinch = null;
        }
        return;
      }
      const g = gesture;
      gesture = null;
      this.store.endGesture();
      if (!g.moved && e.type === 'pointerup') this.onCellTap(g.cellId);
    };
    this.cellsLayer.addEventListener('pointerup', end);
    this.cellsLayer.addEventListener('pointercancel', end);

    this.cellsLayer.addEventListener(
      'wheel',
      (e) => {
        if (this.store.ui.mode !== 'crop') return;
        const target = (e.target as HTMLElement).closest<HTMLDivElement>('.cell');
        if (!target) return;
        const c = this.cellAt(target.dataset.id!);
        const photo = c?.node.photoId ? this.store.photos.get(c.node.photoId) : undefined;
        if (!c || !photo) return;
        e.preventDefault();
        const r = target.getBoundingClientRect();
        const factor = Math.exp(-e.deltaY * 0.0015);
        this.wheelGesture(() => {
          c.node.crop = zoomAt(
            c.node.crop,
            c.node.crop.zoom * factor,
            e.clientX - (r.left + r.width / 2),
            e.clientY - (r.top + r.height / 2),
            photo.width,
            photo.height,
            c.w,
            c.h,
          );
        });
        this.store.ui.selectedCellId = c.node.id;
      },
      { passive: false },
    );
  }

  private onCellTap(id: string): void {
    const { ui, doc } = this.store;
    const node = findNode(doc.tree, id);
    if (!node || node.type !== 'cell') return;
    if (ui.swapFromCellId && ui.swapFromCellId !== id) {
      const from = ui.swapFromCellId;
      ui.swapFromCellId = null;
      this.store.edit((d) => {
        const a = findNode(d.tree, from);
        const b = findNode(d.tree, id);
        if (a?.type === 'cell' && b?.type === 'cell') {
          [a.photoId, b.photoId] = [b.photoId, a.photoId];
          [a.crop, b.crop] = [b.crop, a.crop];
        }
      });
      ui.selectedCellId = id;
      this.cb.toast('Zamieniono zdjęcia');
      return;
    }
    if (!node.photoId) {
      ui.selectedCellId = id;
      this.store.notify();
      this.cb.onRequestPhotoForCell(id);
      return;
    }
    ui.swapFromCellId = null;
    // Tapping the selected tile again, or any other tile while one is
    // selected, closes the menu. The next tap selects the new tile.
    ui.selectedCellId = ui.selectedCellId ? null : id;
    vibrate(8);
    this.store.notify();
  }

  /** Close the cell menu on a press outside photos and the toolbar. */
  private bindOutsideDismiss(): void {
    this.workspace.addEventListener('pointerdown', (e) => {
      const { ui } = this.store;
      if (!ui.selectedCellId && !ui.swapFromCellId) return;
      const t = e.target as HTMLElement;
      if (t.closest('.cell, .toolbar, .divider')) return;
      if (ui.mode === 'layers' && t.closest('.float')) return;
      ui.selectedCellId = null;
      ui.swapFromCellId = null;
      this.store.notify();
    });
  }

  /* ------------------------------------------------------------ floats */

  private bindFloats(): void {
    const pointers = new Map<number, Pt>();
    type G = {
      id: string;
      kind: 'move' | 'resize' | 'rotate';
      start: Pt;
      last: Pt;
      f0: FloatLayer;
      moved: boolean;
      pinch: null | { d0: number; a0: number; size0: number; rot0: number };
    };
    let g: G | null = null;

    const centerClient = (f: FloatLayer): Pt => {
      const r = this.page.getBoundingClientRect();
      return { x: r.left + f.cx * this.pageSize.w * this.scale, y: r.top + f.cy * this.pageSize.h * this.scale };
    };
    const live = (id: string): FloatLayer | undefined => this.store.doc.floats.find((f) => f.id === id);

    this.floatsLayer.addEventListener('pointerdown', (e) => {
      if (this.store.ui.mode !== 'layers' || e.button > 0) return;
      const target = (e.target as HTMLElement).closest<HTMLDivElement>('.float');
      if (!target) return;
      e.preventDefault();
      e.stopPropagation();
      const id = target.dataset.id!;
      const f = live(id);
      if (!f) return;
      if (g && g.id !== id) return;
      target.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const handle = (e.target as HTMLElement).dataset.handle as 'resize' | 'rotate' | undefined;
      if (!g) {
        g = { id, kind: handle ?? 'move', start: { x: e.clientX, y: e.clientY }, last: { x: e.clientX, y: e.clientY }, f0: { ...f }, moved: false, pinch: null };
        this.store.beginGesture();
        if (this.store.ui.selectedFloatId !== id) {
          this.store.ui.selectedFloatId = id;
          this.store.notify();
        }
      }
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()] as [Pt, Pt];
        g.pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y), a0: Math.atan2(b.y - a.y, b.x - a.x), size0: f.size, rot0: f.rotation };
        g.moved = true;
      }
    });

    this.floatsLayer.addEventListener('pointermove', (e) => {
      if (!g || !pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const f = live(g.id);
      if (!f) return;
      const photo = this.store.photos.get(f.photoId);
      if (g.pinch && pointers.size >= 2) {
        const [a, b] = [...pointers.values()] as [Pt, Pt];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        this.store.touchGesture();
        if (g.pinch.d0 > 0) setFloatSize(f, g.pinch.size0 * (d / g.pinch.d0), photo, this.pageSize);
        f.rotation = snapAngle(g.pinch.rot0 + ((ang - g.pinch.a0) * 180) / Math.PI);
        this.store.notify();
        return;
      }
      if (!g.moved && Math.hypot(e.clientX - g.start.x, e.clientY - g.start.y) < 2) return;
      g.moved = true;
      this.store.touchGesture();
      if (g.kind === 'move') {
        moveFloat(f, (e.clientX - g.last.x) / this.scale, (e.clientY - g.last.y) / this.scale, this.pageSize);
      } else {
        const c = centerClient(g.f0);
        if (g.kind === 'resize') {
          const d0 = Math.hypot(g.start.x - c.x, g.start.y - c.y);
          const d = Math.hypot(e.clientX - c.x, e.clientY - c.y);
          if (d0 > 0) setFloatSize(f, g.f0.size * (d / d0), photo, this.pageSize);
        } else {
          const a0 = Math.atan2(g.start.y - c.y, g.start.x - c.x);
          const a = Math.atan2(e.clientY - c.y, e.clientX - c.x);
          const deg = g.f0.rotation + ((a - a0) * 180) / Math.PI;
          f.rotation = e.shiftKey ? normalizeAngle(deg) : snapAngle(deg);
        }
      }
      g.last = { x: e.clientX, y: e.clientY };
      this.store.notify();
    });

    const end = (e: PointerEvent): void => {
      if (!g || !pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (pointers.size > 0) {
        const [p] = [...pointers.values()];
        const f = live(g.id);
        if (p && f) {
          g.pinch = null;
          g.kind = 'move';
          g.last = p;
          g.f0 = { ...f };
        }
        return;
      }
      g = null;
      this.store.endGesture();
    };
    this.floatsLayer.addEventListener('pointerup', end);
    this.floatsLayer.addEventListener('pointercancel', end);

    this.floatsLayer.addEventListener(
      'wheel',
      (e) => {
        if (this.store.ui.mode !== 'layers') return;
        const target = (e.target as HTMLElement).closest<HTMLDivElement>('.float');
        if (!target) return;
        const id = target.dataset.id!;
        e.preventDefault();
        this.store.ui.selectedFloatId = id;
        this.wheelGesture(() => {
          const f = this.store.doc.floats.find((x) => x.id === id);
          if (!f) return;
          if (e.shiftKey) f.rotation = normalizeAngle(f.rotation + (e.deltaY > 0 ? 3 : -3));
          else setFloatSize(f, f.size * Math.exp(-e.deltaY * 0.0015), this.store.photos.get(f.photoId), this.pageSize);
        });
      },
      { passive: false },
    );

    // Tap on empty page area in layers mode clears the float selection.
    this.page.addEventListener('pointerdown', (e) => {
      if (this.store.ui.mode === 'layers' && !(e.target as HTMLElement).closest('.float') && this.store.ui.selectedFloatId) {
        this.store.ui.selectedFloatId = null;
        this.store.notify();
      }
    });
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  n.className = cls;
  return n;
}

export function vibrate(ms: number): void {
  if ('vibrate' in navigator) {
    try {
      navigator.vibrate(ms);
    } catch {
      /* ignore */
    }
  }
}

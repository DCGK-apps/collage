/**
 * Core document model. All geometry is expressed in millimetres of the
 * printed page, so the on-screen preview and the exported file (at any DPI)
 * are always identical.
 */

/** 'v' – vertical dividing line (children side by side), 'h' – horizontal line (children stacked). */
export type Dir = 'v' | 'h';

export type Rotation = 0 | 90 | 180 | 270;

export interface Crop {
  /** >= 1, 1 = image just covers the cell. */
  zoom: number;
  /** -1..1, fraction of the available overflow (0 = centred). */
  panX: number;
  panY: number;
  rotate: Rotation;
}

export interface CellNode {
  type: 'cell';
  id: string;
  photoId: string | null;
  crop: Crop;
}

export interface SplitNode {
  type: 'split';
  id: string;
  dir: Dir;
  /** Share of the parent extent given to `first` (0..1). */
  ratio: number;
  first: LayoutNode;
  second: LayoutNode;
}

export type LayoutNode = CellNode | SplitNode;

/** A free-floating photo placed above the grid. Array order = z-order (last on top). */
export interface FloatLayer {
  id: string;
  photoId: string;
  /** Centre, normalised to page size (0..1). */
  cx: number;
  cy: number;
  /** Width as a fraction of page width. Height follows the photo aspect ratio. */
  size: number;
  /** Degrees, clockwise. */
  rotation: number;
  /** White passe-partout frame around the photo. */
  frame: boolean;
  shadow: boolean;
}

export interface Style {
  gapMm: number;
  radiusMm: number;
  background: string;
}

export type Orientation = 'portrait' | 'landscape';

export interface Doc {
  formatId: string;
  orientation: Orientation;
  style: Style;
  tree: LayoutNode | null;
  floats: FloatLayer[];
  /** Photos shown in the library strip (order of insertion). */
  library: string[];
}

export interface Photo {
  id: string;
  src: string;
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Size {
  w: number;
  h: number;
}

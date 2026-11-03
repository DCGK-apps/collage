import { DEFAULT_FORMAT_ID } from './page';
import type { Doc } from './types';

export function createDoc(): Doc {
  return {
    formatId: DEFAULT_FORMAT_ID,
    orientation: 'portrait',
    style: { gapMm: 4, radiusMm: 1.5, background: '#ffffff' },
    tree: null,
    floats: [],
    library: [],
  };
}

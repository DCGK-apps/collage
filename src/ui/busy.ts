/**
 * "Working…" indicator for long operations (export, saving and opening projects,
 * loading photos).
 *
 * Rendering a page at 300 DPI runs on the main thread, so the page freezes for a
 * moment. While it does, a blocking overlay stops clicks and a sunflower from
 * the app icon spins in the bottom-right corner. The spin is a CSS transform
 * animation, which the browser keeps running on the compositor even while
 * JavaScript is busy – so the indicator keeps moving during the freeze.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

function sunflowerSvg(): string {
  const petals = (n: number, offset: number, fill: string, len: number) =>
    Array.from(
      { length: n },
      (_, i) =>
        `<ellipse cx="0" cy="${-(7 + len / 2)}" rx="3.1" ry="${len / 2}" fill="${fill}" transform="rotate(${(i * 360) / n + offset})"/>`,
    ).join('');
  const seeds = Array.from({ length: 21 }, (_, i) => {
    // Golden-angle spiral, like the seeds of a real sunflower.
    const a = i * 2.39996;
    const r = 1.35 * Math.sqrt(i + 0.5);
    return `<circle cx="${(r * Math.cos(a)).toFixed(2)}" cy="${(r * Math.sin(a)).toFixed(2)}" r="0.65" fill="#3b1d0b"/>`;
  }).join('');
  return `<svg xmlns="${SVG_NS}" viewBox="-24 -24 48 48" aria-hidden="true">
    ${petals(13, 360 / 26, '#f59e0b', 15)}
    ${petals(13, 0, '#fbbf24', 16)}
    <circle r="8" fill="#7c3f12"/>
    <circle r="8" fill="none" stroke="#92400e" stroke-width="1.2"/>
    ${seeds}
  </svg>`;
}

let el: HTMLElement | null = null;
let label: HTMLElement | null = null;
let depth = 0;

function ensure(): HTMLElement {
  if (el) return el;
  el = document.createElement('div');
  el.id = 'busy';
  el.dataset.testid = 'busy';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.hidden = true;
  el.innerHTML = `<div class="busy-pill">
      <div class="busy-flower"><div class="busy-spin">${sunflowerSvg()}</div></div>
      <span class="busy-label"></span>
    </div>`;
  label = el.querySelector('.busy-label');
  document.body.append(el);
  return el;
}

/** True while a long operation runs (the interface is blocked). */
export function isBusy(): boolean {
  return depth > 0;
}

/** Resolve after the browser has painted the current frame (so the overlay is visible). */
function afterPaint(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    // rAF runs right before the paint; a task queued from it runs after the paint.
    requestAnimationFrame(() => setTimeout(finish, 0));
    // Hidden tabs don't paint – don't wait forever.
    setTimeout(finish, 100);
  });
}

/**
 * Run `fn` with the interface blocked and the progress indicator shown.
 * Calls may nest; the indicator stays until the outermost one finishes.
 */
export async function withBusy<T>(text: string, fn: () => T | Promise<T>): Promise<T> {
  const node = ensure();
  depth++;
  label!.textContent = text;
  node.hidden = false;
  document.body.setAttribute('aria-busy', 'true');
  // Drop focus so Enter/Space can't trigger the same button again.
  (document.activeElement as HTMLElement | null)?.blur?.();
  try {
    await afterPaint();
    return await fn();
  } finally {
    depth--;
    if (depth === 0) {
      node.hidden = true;
      document.body.removeAttribute('aria-busy');
    }
  }
}

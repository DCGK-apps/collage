import { expect, test, type Page } from '@playwright/test';
import { box, cells, drag, getDoc, openApp } from './fixtures';

test.beforeEach(async ({ page }) => openApp(page));

/** Cell boxes in reading order (top-left, top-right, bottom-left, bottom-right in the demo 2×2). */
const boxes = async (page: Page) => Promise.all([0, 1, 2, 3].map(async (i) => box(cells(page).nth(i))));

/** A point on the horizontal line, at a fraction of the page width. */
async function onHorizontalLine(page: Page, fx: number) {
  const pg = await box(page.getByTestId('page'));
  const [tl, , bl] = await boxes(page);
  const y = (tl!.y + tl!.height + bl!.y) / 2;
  return { x: pg.x + pg.width * fx, y };
}

test('2×2: the left half of the horizontal line moves on its own', async ({ page }) => {
  const [tl0, tr0, bl0, br0] = await boxes(page);
  const p = await onHorizontalLine(page, 0.25);
  await drag(page, p, { x: p.x, y: p.y + 50 }, 8);
  const [tl, tr, bl, br] = await boxes(page);
  expect(tl!.height).toBeGreaterThan(tl0!.height + 40);
  expect(bl!.height).toBeLessThan(bl0!.height - 40);
  // Right half untouched.
  expect(tr!.height).toBeCloseTo(tr0!.height, 0);
  expect(br!.height).toBeCloseTo(br0!.height, 0);
});

test('2×2: left half down, right half up', async ({ page }) => {
  const l = await onHorizontalLine(page, 0.25);
  await drag(page, l, { x: l.x, y: l.y + 40 }, 8);
  const [, tr0] = await boxes(page);
  const r = await onHorizontalLine(page, 0.75);
  const ry = tr0!.y + tr0!.height + 2; // the right half is still at the original height
  await drag(page, { x: r.x, y: ry }, { x: r.x, y: ry - 40 }, 8);
  const [tl, tr, bl, br] = await boxes(page);
  expect(tl!.height).toBeGreaterThan(tr!.height + 60);
  expect(bl!.height).toBeLessThan(br!.height - 60);
});

test('after splitting the horizontal line and re-aligning it, the vertical halves split again', async ({ page }) => {
  const l = await onHorizontalLine(page, 0.25);
  await drag(page, l, { x: l.x, y: l.y + 40 }, 8);
  const l2 = await onHorizontalLine(page, 0.25);
  const [tl1] = await boxes(page);
  const ly = tl1!.y + tl1!.height + 2;
  await drag(page, { x: l2.x, y: ly }, { x: l2.x, y: ly - 39 }, 8); // snaps back into line
  await expect(page.getByTestId('junction')).toHaveCount(1);

  const [tl, , bl] = await boxes(page);
  const top = { x: tl!.x + tl!.width + 2, y: tl!.y + tl!.height / 2 };
  await drag(page, top, { x: top.x + 30, y: top.y }, 6);
  const after = await boxes(page);
  expect(after[0]!.width).toBeGreaterThan(tl!.width + 20);
  expect(after[2]!.width).toBeCloseTo(bl!.width, 0);
});

test('with T-junctions (halves misaligned) the vertical line moves as a whole – nothing gets cut', async ({ page }) => {
  const l = await onHorizontalLine(page, 0.25);
  await drag(page, l, { x: l.x, y: l.y + 40 }, 8);
  const [tl, , bl] = await boxes(page);
  const top = { x: tl!.x + tl!.width + 2, y: tl!.y + tl!.height / 2 };
  await drag(page, top, { x: top.x + 30, y: top.y }, 6);
  const after = await boxes(page);
  expect(after[0]!.width - tl!.width).toBeCloseTo(after[2]!.width - bl!.width, 0);
});

test('the rewrite does not move anything by itself and one undo restores the layout', async ({ page }) => {
  const before = await getDoc(page);
  const pics0 = await boxes(page);
  const p = await onHorizontalLine(page, 0.25);
  // A tiny drag (3 px) – enough to start, the picture must stay essentially the same.
  await drag(page, p, { x: p.x, y: p.y + 3 }, 3);
  const pics1 = await boxes(page);
  for (let i = 0; i < 4; i++) {
    expect(Math.abs(pics1[i]!.x - pics0[i]!.x)).toBeLessThan(1);
    expect(Math.abs(pics1[i]!.width - pics0[i]!.width)).toBeLessThan(1);
  }
  await page.getByTestId('undo').click();
  expect((await getDoc(page)).tree).toEqual(before.tree);
});

test('the knob still moves the whole horizontal line... and the whole vertical line', async ({ page }) => {
  const k = await box(page.getByTestId('junction'));
  const c = { x: k.x + k.width / 2, y: k.y + k.height / 2 };
  const [tl0, tr0] = await boxes(page);
  await drag(page, c, { x: c.x, y: c.y + 40 }, 6);
  const [tl, tr] = await boxes(page);
  expect(tl!.height - tl0!.height).toBeCloseTo(tr!.height - tr0!.height, 0);
});

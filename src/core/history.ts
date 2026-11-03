/**
 * Snapshot-based undo/redo. Snapshots are deep clones, so callers can freely
 * mutate the live value between checkpoints.
 */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];

  constructor(private readonly limit = 100) {}

  /** Remember `current` before it gets modified. */
  checkpoint(current: T): void {
    this.past.push(structuredClone(current));
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  /** Drop the most recent checkpoint (e.g. a gesture that changed nothing). */
  discardLast(): void {
    this.past.pop();
  }

  undo(current: T): T | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.future.push(structuredClone(current));
    return prev;
  }

  redo(current: T): T | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(structuredClone(current));
    return next;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }
}

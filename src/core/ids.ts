let counter = 0;

/** Short unique id. Uniqueness only needs to hold within one session. */
export function uid(prefix: string): string {
  counter += 1;
  return `${prefix}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

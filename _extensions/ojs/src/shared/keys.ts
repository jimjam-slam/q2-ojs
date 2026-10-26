/**
 * Stable cell keys (design D4): the engine and the browser must compute the
 * same key for the same cell, so this module is pure and synchronous.
 *
 * key = `<hash of normalized body>:<occurrence>`, where occurrence counts
 * earlier cells with the same hash, in document order. A `//| label` gives
 * `label:<name>:<occurrence>` instead, which survives edits to the source.
 */

import { normalizeBody, type OptionValue } from "./cell.ts";

/** cyrb53: a fast, well-distributed 53-bit string hash, as hex. */
export function hash(text: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

export interface KeyInput {
  /** The cell body, without option lines. */
  body: string;
  options: Record<string, OptionValue>;
}

/** A key without its occurrence: the label if there is one, else the hash. */
export function keyBase({ body, options }: KeyInput): string {
  const label = options.label;
  return label !== undefined && String(label).trim() !== "" ? `label:${String(label).trim()}` : hash(normalizeBody(body));
}

/** Split a key into its base and occurrence. */
export function splitKey(key: string): { base: string; occurrence: number } {
  const at = key.lastIndexOf(":");
  return { base: key.slice(0, at), occurrence: Number(key.slice(at + 1)) };
}

/** Compute every cell's key, in document order. */
export function cellKeys(cells: readonly KeyInput[]): string[] {
  const seen = new Map<string, number>();
  return cells.map((cell) => {
    const base = keyBase(cell);
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);
    return `${base}:${occurrence}`;
  });
}

/**
 * One reconciler per page, kept on `globalThis` so a module evaluated twice
 * (the preview re-imports component modules) reuses it instead of starting a
 * second runtime.
 */

import { builtins } from "./builtins.ts";
import { Reconciler } from "./reconciler.ts";

const holder = globalThis as { __q2ojs?: Reconciler };

export function getReconciler(): Reconciler {
  return (holder.__q2ojs ??= new Reconciler(builtins));
}

/** Dispose the page's reconciler, if any; the next `getReconciler` starts fresh. */
export function disposeReconciler(): void {
  holder.__q2ojs?.dispose();
  delete holder.__q2ojs;
}

/**
 * Rendered-page bootstrap: one classic script, shipped as the engine's html
 * dependency (design D6). It runs in <head> before the body is parsed, so it
 * waits for the DOM, then reconciles every `.ojs-cell` once from the
 * definitions the engine compiled (`script.ojs-def`). No transpiler loads.
 */

import type { CellDefinition } from "../shared/compile.ts";
import { readDefines } from "./data.ts";
import { disposeReconciler, getReconciler } from "./singleton.ts";
import "./ojs.css";

function start(): void {
  const reconciler = getReconciler();
  reconciler.defineData(readDefines(document));

  for (const cell of document.querySelectorAll<HTMLElement>(".ojs-cell")) {
    const key = cell.dataset.ojsKey;
    if (!key) continue;
    const host = cell.querySelector<HTMLElement>(".ojs-output") ?? cell;
    let definition: CellDefinition | null = null;
    try {
      definition = JSON.parse(cell.querySelector("script.ojs-def")?.textContent ?? "null");
    } catch (e) {
      console.error(`ojs: unreadable definition for cell ${key}`, e);
    }
    reconciler.upsert(key, { definition, output: cell.dataset.ojsOutput !== "false" }, host);
  }
  reconciler.flush();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}

// Stop generators and timers when the page goes away for good. A page kept in
// the back/forward cache (`persisted`) may come back, so leave it running.
addEventListener("pagehide", (event) => {
  if (!event.persisted) disposeReconciler();
});

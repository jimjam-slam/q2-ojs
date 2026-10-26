/**
 * Page bootstrap: one classic script, shipped as an engine html dependency
 * (design D6; spikes S9, S10). It runs in <head> before the body is parsed, so
 * it waits for the DOM.
 *
 * Spike stage: proves the runtime loads, then shows a marker in each
 * `.ojs-cell` using the offline `md` built-in. The reconciler replaces this in
 * task group 4.
 */

import { NotebookRuntime } from "@observablehq/notebook-kit/runtime";
import { builtins } from "./builtins.ts";
import "./ojs.css";

function start() {
  const runtime = new NotebookRuntime(builtins);
  // Spike: a handle for checking built-ins from the console.
  (window as unknown as { __q2ojsRuntime: NotebookRuntime }).__q2ojsRuntime = runtime;

  document.querySelectorAll<HTMLElement>(".ojs-cell").forEach((cell, i) => {
    let root = cell.querySelector<HTMLDivElement>(".ojs-output");
    if (!root) {
      root = document.createElement("div");
      root.className = "ojs-output";
      cell.append(root);
    }
    const mode = cell.dataset.ojsMode ?? "?";
    runtime.define(
      { root, expanded: [], variables: [] },
      { id: i + 1, body: (md: (s: TemplateStringsArray, ...v: unknown[]) => unknown) => md`**runtime loaded** (mode ${mode})`, inputs: ["md"], autodisplay: true },
    );
  });

  document.documentElement.dataset.ojsRuntime = "loaded";
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}

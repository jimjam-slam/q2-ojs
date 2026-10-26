// Browser check for the `require` shim (task 1b.2): compiles Observable 1.0
// cells in the page and runs them on a runtime built with our built-ins.
import { transpile } from "@observablehq/notebook-kit";
import { NotebookRuntime } from "@observablehq/notebook-kit/runtime";
import { builtins } from "../../_extensions/ojs/src/runtime/builtins.ts";

const cells = [
  `d3 = require("d3@7")`,
  `d3.version`,
  `topo = require("topojson-client@3")`,
  `typeof topo.feature`,
  `noRequire = typeof require`,
];

const runtime = new NotebookRuntime(builtins);
const results: Record<string, unknown> = {};
(window as unknown as { __results: typeof results }).__results = results;

cells.forEach((value, i) => {
  const id = i + 1;
  const root = document.createElement("div");
  root.id = `cell-${id}`;
  document.body.append(Object.assign(document.createElement("pre"), { textContent: value }), root);
  const t = transpile({ id, value, mode: "ojs" });
  const body = (0, eval)(`(${t.body})`);
  runtime.define(
    { root, expanded: [], variables: [] },
    { id, body, inputs: t.inputs, outputs: t.outputs, output: t.output, autodisplay: t.autodisplay, autoview: t.autoview, automutable: t.automutable },
    (state) => ({
      _error: false,
      _node: state.root,
      pending() {},
      fulfilled(v: unknown) { results[value] = v; state.root.textContent = String(v); },
      rejected(e: unknown) { results[value] = `ERROR: ${e}`; state.root.textContent = `ERROR: ${e}`; },
    }),
  );
});

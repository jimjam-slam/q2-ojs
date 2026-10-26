// Reconciler tests (task 4.7) against a real Notebook Kit runtime in jsdom.
import { window } from "./dom.ts";
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { parseCell } from "../../_extensions/ojs/src/shared/cell.ts";
import { compileCell, type CellDefinition, type OjsLanguage } from "../../_extensions/ojs/src/shared/compile.ts";
import { Reconciler } from "../../_extensions/ojs/src/runtime/reconciler.ts";
import { builtins } from "../../_extensions/ojs/src/runtime/builtins.ts";
import { readDefines, transpose } from "../../_extensions/ojs/src/runtime/data.ts";

const runs = (globalThis as unknown as { __runs: string[] });

function def(source: string, language: OjsLanguage = "ojs2"): CellDefinition {
  const cell = parseCell(source);
  const result = compileCell(language, cell.body, cell.bodyLineOffset);
  if (!result.ok) throw new Error(result.error.message);
  return result.definition;
}

/** Let the runtime compute (it schedules with setImmediate under Node). */
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 5));
};

const host = () => window.document.body.appendChild(window.document.createElement("div"));
const text = (h: HTMLElement) => (h.querySelector(".ojs-cell-values") as HTMLElement).textContent?.trim();

let r: Reconciler;
beforeEach(() => {
  runs.__runs = [];
  window.document.body.replaceChildren();
  r = new Reconciler(builtins);
});
afterEach(() => r.dispose());

test("defines a cell and displays its value in the host", async () => {
  const h = host();
  r.upsert("a", { definition: def("display(1 + 1);") }, h);
  assert.equal(r.flush().defined, 1);
  await settle();
  assert.equal(text(h), "2");
});

test("upserts are batched into one reconcile per microtask", async () => {
  const h1 = host();
  const h2 = host();
  r.upsert("a", { definition: def("const x = 1;") }, h1);
  r.upsert("b", { definition: def("display(x + 1);") }, h2);
  assert.deepEqual(r.keys(), [], "nothing applied synchronously");
  await Promise.resolve();
  assert.deepEqual(r.keys().sort(), ["a", "b"]);
  await settle();
  assert.equal(text(h2), "2");
});

test("a no-op batch leaves cells alone: no redefinition, no recompute", async () => {
  const [h1, h2] = [host(), host()];
  const a = def("const x = 1; globalThis.__runs.push('a');");
  const b = def("globalThis.__runs.push('b'); display(x);");
  r.upsert("a", { definition: a }, h1);
  r.upsert("b", { definition: b }, h2);
  r.flush();
  await settle();
  assert.deepEqual(runs.__runs.sort(), ["a", "b"]);

  r.upsert("a", { definition: a }, h1);
  r.upsert("b", { definition: b }, h2);
  assert.deepEqual(r.flush(), { defined: 0, deleted: 0, moved: 0, unchanged: 2, keptLastGood: 0 });
  await settle();
  assert.deepEqual(runs.__runs.sort(), ["a", "b"], "no cell ran again");
});

test("editing a cell (new key) recomputes its dependents with the new value", async () => {
  const [h1, h2] = [host(), host()];
  r.upsert("x-v1", { definition: def("const x = 1;") }, h1);
  r.upsert("b", { definition: def("display(x * 10);") }, h2);
  r.flush();
  await settle();
  assert.equal(text(h2), "10");

  r.release("x-v1");
  r.upsert("x-v2", { definition: def("const x = 2;") }, h1);
  const stats = r.flush();
  assert.equal(stats.deleted, 1);
  assert.equal(stats.defined, 1);
  await settle();
  assert.equal(text(h2), "20");
});

test("deletes run before defines, whatever order the batch arrived in", async () => {
  const [h1, h2] = [host(), host()];
  r.upsert("x-v1", { definition: def("const x = 1;") }, h1);
  r.upsert("b", { definition: def("display(x);") }, h2);
  r.flush();
  await settle();

  // The new definition of x is queued *before* the old one is released.
  r.upsert("x-v2", { definition: def("const x = 2;") }, h1);
  r.release("x-v1");
  r.flush();
  await settle();
  assert.equal(text(h2), "2");
  assert.doesNotMatch(window.document.body.textContent ?? "", /defined more than once/);
});

test("a duplicate name, if one ever arrives, surfaces as a runtime error rather than crashing", async () => {
  const [h1, h2, h3] = [host(), host(), host()];
  r.upsert("a", { definition: def("const x = 1;") }, h1);
  r.upsert("b", { definition: def("const x = 2;") }, h2);
  r.upsert("c", { definition: def("display(x);") }, h3);
  r.flush();
  await settle();
  assert.match(h3.textContent ?? "", /x is defined more than once/);
});

test("releasing a cell stops it: invalidation resolves", async () => {
  const h = host();
  r.upsert("a", { definition: def("invalidation.then(() => globalThis.__runs.push('stopped'));\ndisplay('live');") }, h);
  r.flush();
  await settle();
  assert.equal(text(h), '"live"', "the inspector quotes strings");

  r.release("a");
  assert.equal(r.flush().deleted, 1);
  await settle();
  assert.deepEqual(runs.__runs, ["stopped"]);
  assert.equal(h.querySelector(".ojs-cell-output"), null, "the output node is removed");
});

test("moving a cell to a new host moves its output node without recomputing", async () => {
  const [h1, h2] = [host(), host()];
  const a = def("globalThis.__runs.push('a'); display('hello');");
  r.upsert("a", { definition: a }, h1);
  r.flush();
  await settle();
  const node = h1.querySelector(".ojs-cell-output");

  r.upsert("a", { definition: a }, h2);
  assert.deepEqual(r.flush(), { defined: 0, deleted: 0, moved: 1, unchanged: 1, keptLastGood: 0 });
  await settle();
  assert.equal(h2.querySelector(".ojs-cell-output"), node, "the same node, moved");
  assert.equal(h1.children.length, 0);
  assert.equal(text(h2), '"hello"');
  assert.deepEqual(runs.__runs, ["a"]);
});

test("a viewof input keeps its state across unrelated reconciles", async (t) => {
  const [h1, h2] = [host(), host()];
  const view = def("viewof n = Inputs.range([0, 10], {value: 3, step: 1})", "ojs1");
  r.upsert("n", { definition: view }, h1);
  r.upsert("show", { definition: def("display(n * 2);") }, h2);
  r.flush();
  await settle();
  // Inputs loads from a CDN, which Node can't import; checked in the browser instead.
  const input = h1.querySelector("input[type=number]") as HTMLInputElement | null;
  if (!input) return t.skip("Inputs is loaded from a CDN, which Node cannot import");
  input.value = "7";
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  await settle();
  r.upsert("n", { definition: view }, h1);
  r.flush();
  await settle();
  assert.equal((h1.querySelector("input[type=number]") as HTMLInputElement).value, "7");
});

test("a compile error keeps the last good definition running and shows a badge", async () => {
  const [h1, h2] = [host(), host()];
  r.upsert("a", { definition: def("const x = 5;") }, h1);
  r.upsert("b", { definition: def("display(x);") }, h2);
  r.flush();
  await settle();

  r.upsert("a", { definition: null, error: "Unexpected token (1:6)" }, h1);
  assert.equal(r.flush().keptLastGood, 1);
  await settle();
  const badge = h1.querySelector(".ojs-cell-badge") as HTMLElement;
  assert.equal(badge.hidden, false);
  assert.equal(badge.textContent, "Unexpected token (1:6)");
  assert.equal(text(h2), "5", "dependents keep working");

  r.upsert("a", { definition: def("const x = 6;") }, h1);
  r.flush();
  await settle();
  assert.equal(badge.hidden, true, "the badge clears once the cell compiles");
  assert.equal(text(h2), "6");
});

test("a compile error with nothing to fall back on shows the error", () => {
  const h = host();
  r.upsert("a", { definition: null, error: "Unexpected token" }, h);
  r.flush();
  const badge = h.querySelector(".ojs-cell-badge") as HTMLElement;
  assert.equal(badge.hidden, false);
  assert.equal(badge.textContent, "Unexpected token");
});

test("run-time errors show in the cell, and dependents carry the upstream message", async () => {
  const [h1, h2] = [host(), host()];
  r.upsert("a", { definition: def("a = { throw new Error('upstream'); }", "ojs1") }, h1);
  r.upsert("b", { definition: def("a + 1", "ojs1") }, h2);
  r.flush();
  await settle();
  assert.match(h1.textContent ?? "", /upstream/);
  assert.match(h2.textContent ?? "", /upstream/);
});

test("output: false hides values but still shows errors", async () => {
  const [ok, bad] = [host(), host()];
  r.upsert("ok", { definition: def("display('secret');"), output: false }, ok);
  r.upsert("bad", { definition: def("throw new Error('boom');"), output: false }, bad);
  r.flush();
  await settle();
  assert.equal((ok.querySelector(".ojs-cell-values") as HTMLElement).hidden, true);
  assert.equal((ok.querySelector(".ojs-cell-errors") as HTMLElement).hidden, true);
  const errors = bad.querySelector(".ojs-cell-errors") as HTMLElement;
  assert.equal(errors.hidden, false);
  assert.match(errors.textContent ?? "", /boom/);
});

test("unresolved names are reported by the runtime, in the cell", async () => {
  const h = host();
  r.upsert("a", { definition: def("display(windw.innerWidth);") }, h);
  r.flush();
  await settle();
  assert.match(h.textContent ?? "", /windw is not defined/);
});

test("ojs_define values are available to cells, unchanged, with transpose", async () => {
  const h = host();
  r.defineData(new Map<string, unknown>([["cars", { mpg: [21, 22.8], cyl: [6, 4] }]]));
  r.upsert("a", { definition: def("display(cars.mpg.length + ' rows; second mpg ' + transpose(cars)[1].mpg);") }, h);
  r.flush();
  await settle();
  assert.equal(text(h), '"2 rows; second mpg 22.8"');
});

test("dispose stops every cell", async () => {
  const h = host();
  r.upsert("a", { definition: def("invalidation.then(() => globalThis.__runs.push('stopped'));") }, h);
  r.flush();
  await settle();
  r.dispose();
  await settle();
  assert.deepEqual(runs.__runs, ["stopped"]);
  assert.deepEqual(r.keys(), []);
});

test("readDefines reads every payload; later names win", () => {
  const box = window.document.createElement("div");
  box.innerHTML =
    '<script type="ojs-define">{"contents":[{"name":"a","value":1},{"name":"b","value":[1,2]}]}</script>' +
    '<script type="ojs-define">{"contents":[{"name":"a","value":2}]}</script>' +
    '<script type="ojs-define">not json</script>';
  const original = console.error;
  console.error = () => {};
  try {
    assert.deepEqual([...readDefines(box)], [["a", 2], ["b", [1, 2]]]);
  } finally {
    console.error = original;
  }
});

test("transpose matches Quarto 1: columns to rows", () => {
  assert.deepEqual(transpose({ x: [1, 2], y: ["a", "b"] }), [{ x: 1, y: "a" }, { x: 2, y: "b" }]);
  assert.deepEqual(transpose({}), []);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCell } from "../../_extensions/ojs/src/shared/cell.ts";
import { compileCell, definedNames, isOjsLanguage, MODES } from "../../_extensions/ojs/src/shared/compile.ts";

function compiled(language: "ojs1" | "ojs2", source: string) {
  const cell = parseCell(source);
  const result = compileCell(language, cell.body, cell.bodyLineOffset);
  if (!result.ok) throw new Error(`expected success, got ${JSON.stringify(result.error)}`);
  return result.definition;
}

function failed(language: "ojs1" | "ojs2", source: string) {
  const cell = parseCell(source);
  const result = compileCell(language, cell.body, cell.bodyLineOffset);
  if (result.ok) throw new Error("expected a compile error");
  return result.error;
}

test("mode mapping: ojs1 → ojs, ojs2 → js", () => {
  assert.deepEqual(MODES, { ojs1: "ojs", ojs2: "js" });
  assert.equal(compiled("ojs1", "x = 1").mode, "ojs");
  assert.equal(compiled("ojs2", "const x = 1;").mode, "js");
});

test("isOjsLanguage accepts only the claimed languages", () => {
  assert.equal(isOjsLanguage("ojs1"), true);
  assert.equal(isOjsLanguage("ojs2"), true);
  assert.equal(isOjsLanguage("ojs"), false);
  assert.equal(isOjsLanguage("toString"), false);
});

test("a definition is plain JSON-safe data", () => {
  const def = compiled("ojs2", "const y = x * 2;\ndisplay(y);");
  assert.deepEqual(JSON.parse(JSON.stringify(def)), def);
  assert.deepEqual(def.inputs.sort(), ["display", "x"]);
  assert.deepEqual(def.outputs, ["y"]);
});

test("syntax error: message without suffix, 1-based column", () => {
  const error = failed("ojs2", "const x = 1;\nconst = ;");
  assert.equal(error.message, "Unexpected token");
  assert.equal(error.line, 2);
  assert.equal(error.column, 7);
});

test("error lines count the cell's option lines", () => {
  const error = failed("ojs2", "//| echo: false\n//| label: broken\nconst x = 1;\nconst = ;");
  assert.equal(error.line, 4);
  assert.equal(error.column, 7);
});

test("errors without loc fall back to the message suffix", () => {
  const error = failed("ojs2", "export const a = 1;");
  assert.equal(error.message, "Unexpected token 'export'");
  assert.equal(error.line, 1);
  assert.equal(error.column, 1);
});

test("Observable 1.0 syntax error in ojs1", () => {
  const error = failed("ojs1", "x = 1; y = 2");
  assert.equal(error.line, 1);
  assert.equal(error.column, 8);
});

test("redeclaring a name inside one ojs2 cell is a compile error", () => {
  const error = failed("ojs2", "const x = 1;\nconst x = 2;");
  assert.equal(error.message, "Identifier 'x' has already been declared");
  assert.equal(error.line, 2);
});

test("definedNames: plain ojs1 cells", () => {
  assert.deepEqual(definedNames(compiled("ojs1", "x = 1")), ["x"]);
  assert.deepEqual(definedNames(compiled("ojs1", "function f() { return 1 }")), ["f"]);
  assert.deepEqual(definedNames(compiled("ojs1", "x + 1")), []);
});

test("definedNames: viewof and mutable also define the value name", () => {
  assert.deepEqual(definedNames(compiled("ojs1", "viewof x = Inputs.range([0, 1])")), ["viewof x", "x"]);
  assert.deepEqual(definedNames(compiled("ojs1", "mutable m = 1")), ["mutable m", "m"]);
});

test("definedNames: ojs2 top-level declarations", () => {
  assert.deepEqual(definedNames(compiled("ojs2", "const a = 1, b = 2;\nfunction g() {}")), ["a", "b", "g"]);
  assert.deepEqual(definedNames(compiled("ojs2", "display(1)")), []);
});

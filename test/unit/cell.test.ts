import { test } from "node:test";
import assert from "node:assert/strict";
import { booleanOption, normalizeBody, parseCell } from "../../_extensions/ojs/src/shared/cell.ts";

test("parses leading //| options and strips them from the body", () => {
  const cell = parseCell("//| echo: false\n//| label: chart\nx = 1");
  assert.deepEqual(cell.options, { echo: false, label: "chart" });
  assert.equal(cell.body, "x = 1");
  assert.equal(cell.bodyLineOffset, 2);
});

test("parses scalar option types", () => {
  const { options } = parseCell(`//| a: true\n//| b: 3\n//| c: -1.5\n//| d: "quoted: text"\n//| e: 'single'\n//| f: bare words\n1`);
  assert.deepEqual(options, { a: true, b: 3, c: -1.5, d: "quoted: text", e: "single", f: "bare words" });
});

test("option lines after the body starts are code, not options", () => {
  const cell = parseCell("x = 1\n//| echo: false");
  assert.deepEqual(cell.options, {});
  assert.equal(cell.body, "x = 1\n//| echo: false");
  assert.equal(cell.bodyLineOffset, 0);
});

test("blank lines between leading options are allowed", () => {
  const cell = parseCell("//| echo: false\n\n//| output: false\nx = 1");
  assert.deepEqual(cell.options, { echo: false, output: false });
  assert.equal(cell.body, "x = 1");
  assert.equal(cell.bodyLineOffset, 3);
});

test("a cell with only options has an empty body", () => {
  const cell = parseCell("//| echo: false");
  assert.equal(cell.body, "");
  assert.equal(cell.bodyLineOffset, 1);
});

test("CRLF line endings are handled", () => {
  const cell = parseCell("//| echo: false\r\nx = 1\r\ny = 2");
  assert.deepEqual(cell.options, { echo: false });
  assert.equal(cell.body, "x = 1\ny = 2");
});

test("normalizeBody ignores line endings, trailing spaces and edge blank lines", () => {
  assert.equal(normalizeBody("\n\nx = 1   \r\ny = 2\t\n\n"), "x = 1\ny = 2");
  assert.equal(normalizeBody("  indented"), "  indented");
});

test("booleanOption only accepts real booleans", () => {
  assert.equal(booleanOption({ echo: false }, "echo", true), false);
  assert.equal(booleanOption({ echo: "false" }, "echo", true), true);
  assert.equal(booleanOption({}, "echo", true), true);
});

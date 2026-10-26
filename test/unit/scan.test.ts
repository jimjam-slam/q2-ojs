import { test } from "node:test";
import assert from "node:assert/strict";
import { scanCells } from "../../_extensions/ojs/src/engine/scan.ts";

test("finds ojs1 and ojs2 cells with their sources", () => {
  const md = "# Title\n\n```{ojs1}\nx = 1\n```\n\nText.\n\n```{ojs2}\nconst y = x;\ndisplay(y);\n```\n";
  const cells = scanCells(md);
  assert.deepEqual(cells.map((c) => [c.language, c.source]), [["ojs1", "x = 1"], ["ojs2", "const y = x;\ndisplay(y);"]]);
});

test("offsets cover the whole cell, fences included", () => {
  const md = "a\n```{ojs2}\n1\n```\nb\n";
  const [cell] = scanCells(md);
  assert.equal(md.slice(cell.start, cell.end), "```{ojs2}\n1\n```\n");
  assert.equal(md.slice(cell.contentStart, cell.contentStart + 1), "1");
});

test("a cell at the very end without a trailing newline", () => {
  const md = "```{ojs2}\n1\n```";
  const [cell] = scanCells(md);
  assert.equal(cell.end, md.length);
});

test("ignores other languages, plain fences and bare {ojs}", () => {
  const md = "```{r}\n1\n```\n```js\n2\n```\n```{ojs}\nz = 1\n```\n```{ojs3}\n3\n```\n";
  assert.deepEqual(scanCells(md), []);
});

test("an ojs2 cell shown inside another code block is not a cell", () => {
  const md = "````markdown\n```{ojs2}\ndisplay(1);\n```\n````\n\n```{ojs2}\ndisplay(2);\n```\n";
  const cells = scanCells(md);
  assert.equal(cells.length, 1);
  assert.equal(cells[0].source, "display(2);");
});

test("longer fences can contain triple backticks", () => {
  const md = "````{ojs2}\nconst s = `\n```\n`;\n````\n";
  const [cell] = scanCells(md);
  assert.equal(cell.source, "const s = `\n```\n`;");
});

test("tilde fences", () => {
  const [cell] = scanCells("~~~{ojs1}\nx = 1\n~~~\n");
  assert.equal(cell.source, "x = 1");
});

test("a closing fence must use the same character", () => {
  const md = "```{ojs2}\na\n~~~\nb\n```\n";
  assert.equal(scanCells(md)[0].source, "a\n~~~\nb");
});

test("attributes after the language are tolerated", () => {
  const [cell] = scanCells("```{ojs2 #my-id .wide}\n1\n```\n");
  assert.equal(cell.language, "ojs2");
});

test("indented cells keep their indent and lose it from the source", () => {
  const md = "- item\n\n    ```{ojs2}\n    display(1);\n      nested;\n    ```\n";
  const [cell] = scanCells(md);
  assert.equal(cell.indent, "    ");
  assert.equal(cell.source, "display(1);\n  nested;");
});

test("an unclosed ojs fence is not treated as a cell", () => {
  assert.deepEqual(scanCells("```{ojs2}\ndisplay(1);\n"), []);
});

test("CRLF line endings", () => {
  const [cell] = scanCells("```{ojs2}\r\ndisplay(1);\r\n```\r\n");
  assert.equal(cell.source, "display(1);");
});

test("an empty cell", () => {
  const [cell] = scanCells("```{ojs2}\n```\n");
  assert.equal(cell.source, "");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCell } from "../../_extensions/ojs/src/shared/cell.ts";
import { cellKeys, hash } from "../../_extensions/ojs/src/shared/keys.ts";

const keysOf = (...sources: string[]) => cellKeys(sources.map(parseCell));

test("hash is deterministic, fixed-width hex", () => {
  assert.equal(hash("x = 1"), hash("x = 1"));
  assert.notEqual(hash("x = 1"), hash("x = 2"));
  assert.match(hash(""), /^[0-9a-f]{14}$/);
  assert.match(hash("a much longer cell body ".repeat(50)), /^[0-9a-f]{14}$/);
});

test("hash matches cyrb53's published reference values", () => {
  // From the cyrb53 author's README (seed 0). If these change, keys from
  // older builds stop matching, and the engine and browser could disagree.
  const reference: Record<string, number> = {
    a: 7929297801672961,
    b: 8684336938537663,
    revenge: 4051478007546757,
    revenue: 8309097637345594,
  };
  for (const [text, value] of Object.entries(reference)) {
    assert.equal(parseInt(hash(text), 16), value, text);
  }
});

test("keys are hash plus occurrence", () => {
  const [a] = keysOf("x = 1");
  assert.equal(a, `${hash("x = 1")}:0`);
});

test("duplicate cells share the hash and differ in occurrence", () => {
  const [a, b, c] = keysOf("display(1)", "x = 2", "display(1)");
  assert.equal(a, `${hash("display(1)")}:0`);
  assert.equal(c, `${hash("display(1)")}:1`);
  assert.notEqual(b.split(":")[0], a.split(":")[0]);
});

test("option lines don't change the key", () => {
  const [plain] = keysOf("x = 1");
  const [withOptions] = keysOf("//| echo: false\n//| output: false\nx = 1");
  assert.equal(withOptions, plain);
});

test("whitespace-only differences don't change the key", () => {
  assert.deepEqual(keysOf("x = 1   \n"), keysOf("\nx = 1"));
});

test("a label overrides the hash and survives edits", () => {
  const [before] = keysOf("//| label: chart\nPlot.dot(data)");
  const [after] = keysOf("//| label: chart\nPlot.line(data)");
  assert.equal(before, "label:chart:0");
  assert.equal(after, before);
});

test("an empty label falls back to the hash", () => {
  const [k] = keysOf(`//| label: ""\nx = 1`);
  assert.equal(k, `${hash("x = 1")}:0`);
});

test("keys of other cells are unaffected by inserting a different cell", () => {
  const before = keysOf("a = 1", "b = 2");
  const after = keysOf("a = 1", "inserted = 0", "b = 2");
  assert.equal(after[0], before[0]);
  assert.equal(after[2], before[1]);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import type { MappedString } from "@quarto/types";
import ojsEngine, { executeOjs, locatorFor } from "../../_extensions/ojs/src/ojs-engine.ts";

/**
 * A MappedString like the one q2 hands an engine: the markdown has been
 * re-serialized with extra front matter, and `map` points back at the file.
 */
function reserialized(original: string, file = "/proj/doc.qmd", added = "---\nlots: of\nmetadata: here\n---\n\n"): MappedString {
  const source: MappedString = { value: original, fileName: file, map: (index) => ({ index, originalString: source }) };
  return {
    value: added + original,
    map: (index: number) => (index < added.length ? undefined : { index: index - added.length, originalString: source }),
  } as MappedString;
}

test("claims ojs1 and ojs2 only", () => {
  assert.deepEqual(ojsEngine.claimsLanguage("ojs1"), { kind: "primary", priority: 1 });
  assert.deepEqual(ojsEngine.claimsLanguage("ojs2"), { kind: "primary", priority: 1 });
  assert.equal(ojsEngine.claimsLanguage("ojs"), false);
  assert.equal(ojsEngine.claimsLanguage("r"), false);
});

test("a document without OJS cells gets no runtime dependency", () => {
  const result = executeOjs(reserialized("# Title\n\nText.\n"), "/proj/doc.qmd");
  assert.equal((result as { htmlDependencies?: unknown }).htmlDependencies, undefined);
  assert.equal(result.markdown, "---\nlots: of\nmetadata: here\n---\n\n# Title\n\nText.\n");
});

test("a document with OJS cells gets the runtime dependency once", () => {
  const result = executeOjs(reserialized("```{ojs2}\ndisplay(1);\n```\n\n```{ojs1}\nx = 1\n```\n"), "/proj/doc.qmd");
  const deps = (result as { htmlDependencies?: { name: string; scripts: string[] }[] }).htmlDependencies;
  assert.equal(deps?.length, 1);
  assert.equal(deps![0].name, "ojs-runtime");
  assert.match(deps![0].scripts[0], /runtime[\\/]ojs-runtime\.js$/);
});

test("errors are located in the source file, not the re-serialized markdown", () => {
  const original = "Intro.\n\n```{ojs2}\nconst x = 1;\nconst = ;\n```\n";
  assert.throws(() => executeOjs(reserialized(original), "/proj/doc.qmd"), (e: Error) => {
    assert.match(e.message, /^1 problem in OJS cells:\n {2}\/proj\/doc\.qmd:5:7: ojs2 cell: Unexpected token$/);
    return true;
  });
});

test("duplicate names fail the render with every location", () => {
  const original = "```{ojs2}\nconst x = 1;\n```\n\n```{ojs1}\nx = 2\n```\n";
  assert.throws(() => executeOjs(reserialized(original), "/proj/doc.qmd"), /`x` is defined in more than one cell \(\/proj\/doc\.qmd:2, \/proj\/doc\.qmd:6\)/);
});

test("unmappable offsets fall back to the file name", () => {
  const ms = { value: "abc", map: () => undefined } as unknown as MappedString;
  assert.deepEqual(locatorFor(ms, "/proj/doc.qmd")(1), { file: "/proj/doc.qmd" });
});

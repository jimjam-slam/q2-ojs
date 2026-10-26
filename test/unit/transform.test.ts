import { test } from "node:test";
import assert from "node:assert/strict";
import { formatProblems, transformDocument, type Locate } from "../../_extensions/ojs/src/engine/transform.ts";
import { parseCell } from "../../_extensions/ojs/src/shared/cell.ts";
import { cellKeys } from "../../_extensions/ojs/src/shared/keys.ts";

/** Stand-in for q2's source map: the input text is the source file. */
function locatorFor(text: string, file = "doc.qmd"): Locate {
  return (offset) => {
    const before = text.slice(0, offset);
    const line = before.split("\n").length;
    return { file, line, column: offset - (before.lastIndexOf("\n") + 1) + 1 };
  };
}

const run = (md: string) => transformDocument(md, locatorFor(md));

/** Pull the attributes and payload back out of emitted markup. */
function emittedCells(md: string) {
  return [...md.matchAll(/::: \{\.ojs-cell ([^}]*)\}\n(`{3,})\{\.js \.ojs-source [^}]*\}\n([\s\S]*?)\n?\2\n(`{3,})\{=html\}\n<div class="ojs-output"><\/div>\n<script type="application\/json" class="ojs-def">(.*)<\/script>\n\4\n:::/g)].map(
    (m) => ({
      attrs: Object.fromEntries([...m[1].matchAll(/([\w-]+)="((?:[^"\\]|\\.)*)"/g)].map((a) => [a[1], a[2]])),
      source: m[3],
      def: JSON.parse(m[5]),
    }),
  );
}

// ── markup (3.2) ──────────────────────────────────────────────────────────

test("content outside OJS cells is left byte-identical", () => {
  const md = "---\ntitle: T\n---\n\nIntro *text*.\n\n```{r}\n1 + 1\n```\n\n```{ojs2}\ndisplay(1);\n```\n\nOutro.\n";
  const { markdown } = run(md);
  assert.ok(markdown.startsWith("---\ntitle: T\n---\n\nIntro *text*.\n\n```{r}\n1 + 1\n```\n\n::: {.ojs-cell"));
  assert.ok(markdown.endsWith(":::\n\nOutro.\n"));
});

test("each cell becomes the D3 markup with key, mode, echo and output attributes", () => {
  const md = "```{ojs1}\nx = 1\n```\n\n```{ojs2}\n//| echo: false\n//| output: false\nconst y = x;\n```\n";
  const { markdown, cellCount, problems } = run(md);
  assert.equal(cellCount, 2);
  assert.deepEqual(problems, []);
  const [a, b] = emittedCells(markdown);
  const keys = cellKeys(["x = 1", "//| echo: false\n//| output: false\nconst y = x;"].map(parseCell));
  assert.deepEqual(a.attrs, { "data-ojs-key": keys[0], "data-ojs-mode": "ojs", "data-ojs-echo": "true", "data-ojs-output": "true" });
  assert.deepEqual(b.attrs, { "data-ojs-key": keys[1], "data-ojs-mode": "js", "data-ojs-echo": "false", "data-ojs-output": "false" });
  assert.equal(b.source, "const y = x;", "option lines are removed from the echoed source");
});

test("the payload is the compiled definition as JSON", () => {
  const [cell] = emittedCells(run("```{ojs2}\nconst y = x * 2;\ndisplay(y);\n```\n").markdown);
  assert.equal(cell.def.mode, "js");
  assert.deepEqual(cell.def.outputs, ["y"]);
  assert.deepEqual([...cell.def.inputs].sort(), ["display", "x"]);
  assert.match(cell.def.body, /display\(y\)/);
});

test("the payload can't close its <script> element early", () => {
  const { markdown } = run('```{ojs2}\ndisplay(html`</script><b>hi</b>`);\n```\n');
  const script = /<script type="application\/json" class="ojs-def">(.*)<\/script>/.exec(markdown)![1];
  assert.ok(!script.includes("</script"));
  assert.match(JSON.parse(script).body, /<\/script><b>hi<\/b>/);
});

test("line and paragraph separators are escaped in the payload", () => {
  const ls = String.fromCharCode(0x2028);
  const ps = String.fromCharCode(0x2029);
  const { markdown } = run(`\`\`\`{ojs2}\nconst s = "a${ls}b${ps}c";\n\`\`\`\n`);
  const script = /<script type="application\/json" class="ojs-def">(.*)<\/script>/.exec(markdown)![1];
  assert.ok(!script.includes(ls) && !script.includes(ps));
  assert.ok(JSON.parse(script).body.includes(`a${ls}b${ps}c`));
});

test("fences grow past backtick runs in the source", () => {
  const md = "````{ojs2}\nconst s = `\n```\n`;\n````\n";
  const [cell] = emittedCells(run(md).markdown);
  assert.equal(cell.source, "const s = `\n```\n`;");
});

test("indented cells stay indented", () => {
  const md = "- item\n\n    ```{ojs2}\n    display(1);\n    ```\n";
  const { markdown } = run(md);
  assert.ok(markdown.includes("\n    ::: {.ojs-cell "));
  assert.ok(markdown.includes("\n    display(1);\n"));
  assert.ok(markdown.trimEnd().endsWith("    :::"));
});

test("labels with quotes are escaped in attributes", () => {
  const { markdown } = run('```{ojs2}\n//| label: say "hi"\ndisplay(1);\n```\n');
  assert.ok(markdown.includes('data-ojs-key="label:say \\"hi\\":0"'));
});

test("a document without OJS cells is unchanged", () => {
  const md = "# Just text\n\n```{r}\n1\n```\n";
  assert.deepEqual(run(md), { markdown: md, cellCount: 0, problems: [] });
});

// ── compile errors (3.3) ──────────────────────────────────────────────────

test("a syntax error is located in the source file (spec: doc.qmd:13:7)", () => {
  // The cell's first content line is line 12; the error is on its 2nd line, column 7.
  const md = "\n".repeat(10) + "```{ojs2}\nconst x = 1;\nconst = ;\n```\n";
  const { problems } = run(md);
  assert.equal(problems.length, 1);
  assert.deepEqual(problems[0].locations, [{ file: "doc.qmd", line: 13, column: 7 }]);
  assert.equal(problems[0].message, "ojs2 cell: Unexpected token");
});

test("columns don't depend on q2's off-by-one source map inside code blocks", () => {
  const md = "Intro.\n\n```{ojs2}\nconst x = 1;\nconst = ;\n```\n";
  const exact = locatorFor(md);
  // q2's map lands one character later than the true position (design S12).
  const shifted: Locate = (offset) => exact(offset + 1);
  assert.deepEqual(transformDocument(md, shifted).problems[0].locations, [{ file: "doc.qmd", line: 5, column: 7 }]);
});

test("error lines account for option lines and indentation", () => {
  const md = "- item\n\n    ```{ojs2}\n    //| echo: false\n    const = ;\n    ```\n";
  const [problem] = run(md).problems;
  assert.deepEqual(problem.locations, [{ file: "doc.qmd", line: 5, column: 11 }]);
});

test("several broken cells are all reported", () => {
  const md = "```{ojs2}\nconst = ;\n```\n\n```{ojs1}\nx = 1; y = 2\n```\n";
  const { problems } = run(md);
  assert.equal(problems.length, 2);
  assert.deepEqual(problems.map((p) => p.locations[0].line), [2, 6]);
});

test("a broken cell still gets markup, with a null payload", () => {
  const [cell] = emittedCells(run("```{ojs2}\nconst = ;\n```\n").markdown);
  assert.equal(cell.def, null);
});

// ── duplicate definitions (3.3b) ──────────────────────────────────────────

test("the same name in two ojs2 cells", () => {
  const md = "```{ojs2}\nconst x = 1;\n```\n\n```{ojs2}\nconst x = 2;\n```\n";
  const { problems } = run(md);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].message, "`x` is defined in more than one cell");
  assert.deepEqual(problems[0].locations, [{ file: "doc.qmd", line: 2 }, { file: "doc.qmd", line: 6 }]);
});

test("duplicates across ojs1 and ojs2", () => {
  const md = "```{ojs1}\nx = 1\n```\n\n```{ojs2}\nconst x = 2;\n```\n";
  assert.equal(run(md).problems[0].message, "`x` is defined in more than one cell");
});

test("viewof x clashes with x = 5", () => {
  const md = "```{ojs1}\nviewof x = Inputs.range([0, 1])\n```\n\n```{ojs1}\nx = 5\n```\n";
  const messages = run(md).problems.map((p) => p.message);
  assert.deepEqual(messages, ["`x` is defined in more than one cell"]);
});

test("two viewof x cells are reported once, as x", () => {
  const md = "```{ojs1}\nviewof x = Inputs.range([0, 1])\n```\n\n```{ojs1}\nviewof x = Inputs.range([0, 2])\n```\n";
  assert.deepEqual(run(md).problems.map((p) => p.message), ["`x` is defined in more than one cell"]);
});

test("duplicates and syntax errors are reported together", () => {
  const md = "```{ojs2}\nconst x = 1;\n```\n\n```{ojs2}\nconst x = 2;\n```\n\n```{ojs2}\nconst = ;\n```\n";
  const { problems } = run(md);
  assert.equal(problems.length, 2);
  const text = formatProblems(problems);
  assert.match(text, /^2 problems in OJS cells:/);
  assert.match(text, /doc\.qmd:10:7: ojs2 cell: Unexpected token/);
  assert.match(text, /`x` is defined in more than one cell \(doc\.qmd:2, doc\.qmd:6\)/);
});

test("unresolved names don't cause problems", () => {
  assert.deepEqual(run("```{ojs2}\ndisplay(cars);\n```\n").problems, []);
});

test("a name defined once and used elsewhere is fine", () => {
  assert.deepEqual(run("```{ojs2}\nconst x = 1;\n```\n\n```{ojs2}\ndisplay(x);\n```\n").problems, []);
});

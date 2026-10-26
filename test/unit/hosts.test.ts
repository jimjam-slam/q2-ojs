// Preview host registry tests (tasks 5.3b, 5.5), in jsdom with a recording sink.
import { window } from "./dom.ts";
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { HostRegistry, type HostInput, type Sink } from "../../_extensions/ojs/src/preview/hosts.ts";
import { transformDocument } from "../../_extensions/ojs/src/engine/transform.ts";
import type { CellSpec } from "../../_extensions/ojs/src/runtime/reconciler.ts";

interface Call {
  op: "upsert" | "release";
  key: string;
  spec?: CellSpec;
  host?: HTMLElement;
}

function recordingSink(): Sink & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    upsert: (key, spec, host) => calls.push({ op: "upsert", key, spec, host }),
    release: (key) => calls.push({ op: "release", key }),
  };
}

const host = () => window.document.body.appendChild(window.document.createElement("div"));

/** Cells as raw `{ojs…}` blocks in the preview, and as one engine document. */
const cells: [string, string][] = [
  ["ojs2", "display(1);"],
  ["ojs1", "//| echo: false\nx = 1"],
  ["ojs2", "display(1);"], // identical to the first: occurrence 1
  ["ojs2", "//| label: chart\nconst c = x;"],
  ["ojs1", "y = x + 1"],
];
const engineMarkdown = cells.map(([lang, src]) => "```{" + lang + "}\n" + src + "\n```\n").join("\n");

function engineKeys(): string[] {
  const { markdown } = transformDocument(engineMarkdown, () => ({ file: "doc.qmd", line: 1 }));
  return [...markdown.matchAll(/::: \{\.ojs-cell data-ojs-key="([^"]+)"/g)].map((m) => m[1]);
}

/** The body the engine keeps in `.ojs-source` (options removed). */
function engineBodies(): string[] {
  const { markdown } = transformDocument(engineMarkdown, () => ({ file: "doc.qmd", line: 1 }));
  return [...markdown.matchAll(/`{3,}\{\.js \.ojs-source [^}]*\}\n([\s\S]*?)\n`{3,}\n/g)].map((m) => m[1]);
}

beforeEach(() => window.document.body.replaceChildren());

// ── key agreement (5.5) ──────────────────────────────────────────────────

test("raw blocks get the same keys as the engine emits", () => {
  const sink = recordingSink();
  const registry = new HostRegistry(sink);
  const hosts = cells.map(() => host());
  cells.forEach(([lang, src], i) => registry.register(hosts[i], { language: lang as HostInput["language"], source: src }));
  const keys = registry.flush();
  assert.deepEqual(hosts.map((h) => keys.get(h)), engineKeys());
});

test("keys follow document order, not registration order", () => {
  const registry = new HostRegistry(recordingSink());
  const hosts = cells.map(() => host());
  for (let i = cells.length - 1; i >= 0; i--) {
    registry.register(hosts[i], { language: cells[i][0] as HostInput["language"], source: cells[i][1] });
  }
  const keys = registry.flush();
  assert.deepEqual(hosts.map((h) => keys.get(h)), engineKeys());
});

test("a cell keeps its key moving from the engine form to the raw form", () => {
  const ek = engineKeys();
  const bodies = engineBodies();
  const engineForm = new HostRegistry(recordingSink());
  const rawForm = new HostRegistry(recordingSink());
  const hostsA = cells.map(() => host());
  const hostsB = cells.map(() => host());
  cells.forEach(([lang, src], i) => {
    const language = lang as HostInput["language"];
    engineForm.register(hostsA[i], { language, source: bodies[i], key: ek[i] });
    rawForm.register(hostsB[i], { language, source: src });
  });
  const a = engineForm.flush();
  const b = rawForm.flush();
  assert.deepEqual(hostsA.map((h) => a.get(h)), hostsB.map((h) => b.get(h)));
});

test("a mix of engine and raw blocks still agrees on occurrences", () => {
  const ek = engineKeys();
  const bodies = engineBodies();
  const registry = new HostRegistry(recordingSink());
  const hosts = cells.map(() => host());
  cells.forEach(([lang, src], i) => {
    const language = lang as HostInput["language"];
    // The first `display(1);` comes from a current capture; the duplicate is raw.
    registry.register(hosts[i], i === 0 ? { language, source: bodies[i], key: ek[i] } : { language, source: src });
  });
  const keys = registry.flush();
  assert.deepEqual(hosts.map((h) => keys.get(h)), ek);
});

// ── reconcile calls ──────────────────────────────────────────────────────

test("a compiled cell is upserted with its definition and output flag", () => {
  const sink = recordingSink();
  const registry = new HostRegistry(sink);
  const h = host();
  registry.register(h, { language: "ojs2", source: "//| output: false\nconst a = 1;" });
  registry.flush();
  const [call] = sink.calls;
  assert.equal(call.op, "upsert");
  assert.equal(call.host, h);
  assert.deepEqual(call.spec?.definition?.outputs, ["a"]);
  assert.equal(call.spec?.output, false);
});

test("engine blocks take their output flag from the block", () => {
  const sink = recordingSink();
  const registry = new HostRegistry(sink);
  registry.register(host(), { language: "ojs2", source: "const a = 1;", key: "abc:0", output: false });
  registry.flush();
  assert.equal(sink.calls[0].key, "abc:0");
  assert.equal(sink.calls[0].spec?.output, false);
});

test("a compile error goes to the reconciler as an error with its location", () => {
  const sink = recordingSink();
  const registry = new HostRegistry(sink);
  registry.register(host(), { language: "ojs2", source: "//| echo: false\nconst = ;" });
  registry.flush();
  assert.equal(sink.calls[0].spec?.definition, null);
  assert.equal(sink.calls[0].spec?.error, "SyntaxError: Unexpected token (line 2, column 7)");
});

test("editing a cell releases its old key and upserts the new one", () => {
  const sink = recordingSink();
  const registry = new HostRegistry(sink, { debounceMs: 0 });
  const h = host();
  registry.register(h, { language: "ojs2", source: "const a = 1;" });
  const [oldKey] = registry.flush().values();
  sink.calls.length = 0;
  registry.register(h, { language: "ojs2", source: "const a = 2;" });
  const [newKey] = registry.flush().values();
  assert.notEqual(newKey, oldKey);
  assert.deepEqual(sink.calls.map((c) => [c.op, c.key]), [["release", oldKey], ["upsert", newKey]]);
});

test("a key that moves to another host isn't released", () => {
  const sink = recordingSink();
  const registry = new HostRegistry(sink);
  const [h1, h2] = [host(), host()];
  registry.register(h1, { language: "ojs2", source: "display(1);" });
  registry.register(h2, { language: "ojs2", source: "display(2);" });
  registry.flush();
  sink.calls.length = 0;
  // React reused the components after a shift: each host now shows the other cell.
  registry.register(h1, { language: "ojs2", source: "display(2);" });
  registry.register(h2, { language: "ojs2", source: "display(1);" });
  registry.flush();
  assert.deepEqual(sink.calls.filter((c) => c.op === "release"), []);
});

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

test("unregistering a host releases its key after the grace period", async () => {
  const sink = recordingSink();
  const registry = new HostRegistry(sink, { orphanGraceMs: 0 });
  const h = host();
  registry.register(h, { language: "ojs2", source: "display(1);" });
  const [key] = registry.flush().values();
  registry.unregister(h);
  registry.flush();
  assert.equal(sink.calls.at(-1)?.op, "upsert", "not released straight away");
  await tick(5);
  assert.deepEqual(sink.calls.at(-1), { op: "release", key });
});

test("a cell whose host is replaced in a later task keeps its key (React remount)", async () => {
  const sink = recordingSink();
  const registry = new HostRegistry(sink, { orphanGraceMs: 50 });
  const before = host();
  const input: HostInput = { language: "ojs1", source: "viewof n = Inputs.range([0, 10])" };
  registry.register(before, input);
  const [key] = registry.flush().values();
  sink.calls.length = 0;

  // Blocks shifted: the old component unmounts now…
  registry.unregister(before);
  before.remove();
  registry.flush();
  // …and the new one mounts in a later task.
  await tick(5);
  const after = host();
  registry.register(after, input);
  registry.flush();
  await tick(80);

  assert.deepEqual(sink.calls.filter((c) => c.op === "release"), [], "never released");
  const last = sink.calls.at(-1)!;
  assert.equal(last.key, key);
  assert.equal(last.host, after, "the same key, now on the new host");
});

test("hosts detached from the document are left out", () => {
  const registry = new HostRegistry(recordingSink());
  const detached = window.document.createElement("div");
  registry.register(detached, { language: "ojs2", source: "display(1);" });
  assert.equal(registry.flush().size, 0);
});

test("batches into one flush per microtask, running beforeFlush first", async () => {
  const sink = recordingSink();
  let before = 0;
  const registry = new HostRegistry(sink, { beforeFlush: () => before++ });
  registry.register(host(), { language: "ojs2", source: "display(1);" });
  registry.register(host(), { language: "ojs2", source: "display(2);" });
  assert.equal(sink.calls.length, 0);
  await Promise.resolve();
  assert.equal(before, 1);
  assert.equal(sink.calls.length, 2);
});

test("typing is debounced: only the final source is defined, once, after a pause", async () => {
  const sink = recordingSink();
  const registry = new HostRegistry(sink, { debounceMs: 40 });
  const h = host();
  registry.register(h, { language: "ojs2", source: "display(1);" });
  const [first] = registry.flush().values();
  sink.calls.length = 0;

  for (const source of ["display(12);", "display(123);", "display(1234);"]) {
    registry.register(h, { language: "ojs2", source });
    registry.flush();
    await tick(10);
  }
  assert.ok(sink.calls.every((c) => c.op === "upsert" && c.key === first), "still the old cell while typing");

  await tick(60);
  const releases = sink.calls.filter((c) => c.op === "release");
  const newUpserts = sink.calls.filter((c) => c.op === "upsert" && c.key !== first);
  assert.deepEqual(releases.map((c) => c.key), [first]);
  assert.equal(newUpserts.length, 1);
  assert.match(newUpserts[0].spec!.definition!.body, /1234/);
});

test("a host handed a cell another host held applies at once (React reuse after a shift)", () => {
  const sink = recordingSink();
  const registry = new HostRegistry(sink, { debounceMs: 10_000, orphanGraceMs: 10_000 });
  const [h1, h2] = [host(), host()];
  const a: HostInput = { language: "ojs1", source: "viewof n = Inputs.range([0, 10])" };
  const b: HostInput = { language: "ojs2", source: "display(n);" };
  registry.register(h1, a);
  registry.register(h2, b);
  const before = registry.flush();
  sink.calls.length = 0;

  // A paragraph was inserted above: h1 now shows nothing OJS (unmounted), h2 shows a.
  registry.unregister(h1);
  h1.remove();
  registry.register(h2, a);
  const after = registry.flush();
  assert.equal(after.get(h2), before.get(h1), "a's key moved to h2 immediately, not debounced");
  // b no longer appears anywhere, so its key goes; a's must not.
  assert.deepEqual(sink.calls.filter((c) => c.op === "release").map((c) => c.key), [before.get(h2)]);
});

test("an edit that breaks a cell keeps its last good version under a badge", () => {
  const sink = recordingSink();
  const registry = new HostRegistry(sink, { debounceMs: 0 });
  const h = host();
  registry.register(h, { language: "ojs2", source: "//| echo: false\nconst d = 2;\ndisplay(d);" });
  const [good] = registry.flush().values();
  sink.calls.length = 0;

  registry.register(h, { language: "ojs2", source: "//| echo: false\nconst d = 2;\ndisplay(d;" });
  const [kept] = registry.flush().values();
  assert.equal(kept, good, "the old key stays, so its definition keeps running");
  assert.deepEqual(sink.calls.map((c) => [c.op, c.key, c.spec?.definition, c.spec?.error]), [
    ["upsert", good, null, "SyntaxError: Unexpected token (line 3, column 10)"],
  ]);

  // Fixing it is an ordinary edit: the new version replaces the old.
  sink.calls.length = 0;
  registry.register(h, { language: "ojs2", source: "//| echo: false\nconst d = 3;\ndisplay(d);" });
  const [fixed] = registry.flush().values();
  assert.notEqual(fixed, good);
  assert.deepEqual(sink.calls.map((c) => c.op), ["release", "upsert"]);
  assert.ok(sink.calls[1].spec?.definition);
});

test("an edit that duplicates a name keeps both cells' last good versions, both marked", () => {
  const sink = recordingSink();
  const registry = new HostRegistry(sink, { debounceMs: 0 });
  const [h1, h2] = [host(), host()];
  registry.register(h1, { language: "ojs2", source: "const x = 1;" });
  registry.register(h2, { language: "ojs2", source: "const y = 2;" });
  const before = registry.flush();
  sink.calls.length = 0;

  registry.register(h2, { language: "ojs2", source: "const x = 2;" });
  const after = registry.flush();
  assert.equal(after.get(h1), before.get(h1));
  assert.equal(after.get(h2), before.get(h2), "the edited cell keeps its old key: the duplicate isn't defined");
  assert.deepEqual(sink.calls.filter((c) => c.op === "release"), []);
  for (const call of sink.calls) {
    assert.equal(call.spec?.definition, null);
    assert.equal(call.spec?.error, "`x` is defined in more than one cell");
  }
});

// ── duplicates while editing (5.3b) ──────────────────────────────────────

test("a duplicated name marks both cells and defines neither", () => {
  const sink = recordingSink();
  const registry = new HostRegistry(sink);
  registry.register(host(), { language: "ojs2", source: "const x = 1;" });
  registry.register(host(), { language: "ojs2", source: "const x = 2;" });
  registry.flush();
  assert.equal(sink.calls.length, 2);
  for (const call of sink.calls) {
    assert.equal(call.spec?.definition, null);
    assert.equal(call.spec?.error, "`x` is defined in more than one cell");
  }
});

test("removing the duplicate lets the remaining cell run", () => {
  const sink = recordingSink();
  const registry = new HostRegistry(sink, { orphanGraceMs: 0 });
  const [h1, h2] = [host(), host()];
  registry.register(h1, { language: "ojs2", source: "const x = 1;" });
  registry.register(h2, { language: "ojs2", source: "const x = 2;" });
  registry.flush();
  sink.calls.length = 0;
  registry.unregister(h2);
  registry.flush();
  const upsert = sink.calls.find((c) => c.op === "upsert")!;
  assert.equal(upsert.host, h1);
  assert.deepEqual(upsert.spec?.definition?.outputs, ["x"]);
});

test("viewof x and x = 5 are reported once, as x", () => {
  const sink = recordingSink();
  const registry = new HostRegistry(sink);
  registry.register(host(), { language: "ojs1", source: "viewof x = Inputs.range([0, 1])" });
  registry.register(host(), { language: "ojs1", source: "x = 5" });
  registry.flush();
  assert.deepEqual(sink.calls.map((c) => c.spec?.error), ["`x` is defined in more than one cell", "`x` is defined in more than one cell"]);
});

test("a cell defining several duplicated names lists them all", () => {
  const sink = recordingSink();
  const registry = new HostRegistry(sink);
  registry.register(host(), { language: "ojs2", source: "const a = 1, b = 2;" });
  registry.register(host(), { language: "ojs2", source: "const a = 3, b = 4;" });
  registry.flush();
  assert.equal(sink.calls[0].spec?.error, "`a`, `b` are defined in more than one cell");
});

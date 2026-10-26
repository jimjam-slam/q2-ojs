/**
 * The engine's document transform: compile every OJS cell, replace it with
 * the cell markup (design D3), and collect problems (compile errors and
 * duplicate definitions) with source locations. Pure apart from the `locate`
 * callback, so it's unit-testable without q2.
 */

import { booleanOption, parseCell, type ParsedCell } from "../shared/cell.ts";
import { compileCell, definedNames, MODES, type CellDefinition, type CompileError } from "../shared/compile.ts";
import { cellKeys } from "../shared/keys.ts";
import { scanCells, type ScannedCell } from "./scan.ts";

export interface SourceLocation {
  file: string;
  line?: number;
  column?: number;
}

/** Map an offset in the engine's markdown to the user's source file. */
export type Locate = (offset: number) => SourceLocation;

export interface Problem {
  message: string;
  locations: SourceLocation[];
}

export interface TransformResult {
  markdown: string;
  cellCount: number;
  problems: Problem[];
}

export function transformDocument(markdown: string, locate: Locate): TransformResult {
  const cells = scanCells(markdown);
  const parsed = cells.map((cell) => parseCell(cell.source));
  const keys = cellKeys(parsed);
  const compiled = cells.map((cell, i) => compileCell(cell.language, parsed[i].body, parsed[i].bodyLineOffset));

  const problems: Problem[] = [];
  compiled.forEach((result, i) => {
    if (!result.ok) {
      problems.push({
        message: `${cells[i].language} cell: ${result.error.message}`,
        locations: [errorLocation(cells[i], result.error, locate)],
      });
    }
  });
  problems.push(...duplicateDefinitions(cells, compiled, locate));

  // Replace from the end so earlier offsets stay valid.
  let out = markdown;
  for (let i = cells.length - 1; i >= 0; i--) {
    const result = compiled[i];
    const markup = cellMarkup(cells[i], parsed[i], keys[i], result.ok ? result.definition : undefined);
    const trailing = markdown.slice(cells[i].start, cells[i].end).endsWith("\n") ? "\n" : "";
    out = out.slice(0, cells[i].start) + markup + trailing + out.slice(cells[i].end);
  }
  return { markdown: out, cellCount: cells.length, problems };
}

/** One render error listing every problem, with `file:line:column` locations. */
export function formatProblems(problems: readonly Problem[]): string {
  const lines = problems.map((p) => {
    if (p.locations.length === 1) return `  ${formatLocation(p.locations[0])}: ${p.message}`;
    return `  ${p.message} (${p.locations.map(formatLocation).join(", ")})`;
  });
  const count = problems.length === 1 ? "1 problem" : `${problems.length} problems`;
  return [`${count} in OJS cells:`, ...lines].join("\n");
}

function formatLocation({ file, line, column }: SourceLocation): string {
  return [file, line, column].filter((part) => part !== undefined).join(":");
}

// ── locations ─────────────────────────────────────────────────────────────
//
// Only the cell's fence line goes through the source map; positions inside
// the cell are counted from it. q2 keeps code-block content verbatim, and its
// map is one character off inside code blocks (design S12), which would skew
// columns but never moves the fence off its line.

/** The source file and line of a cell's opening fence. */
function fenceLocation(cell: ScannedCell, locate: Locate): SourceLocation {
  const { file, line } = locate(cell.start);
  return line === undefined ? { file } : { file, line };
}

function errorLocation(cell: ScannedCell, error: CompileError, locate: Locate): SourceLocation {
  const fence = fenceLocation(cell, locate);
  if (fence.line === undefined) return fence;
  if (error.line === undefined) return { file: fence.file, line: fence.line + 1 };
  return { file: fence.file, line: fence.line + error.line, column: cell.indent.length + (error.column ?? 1) };
}

/** The first content line of a cell. */
function cellLocation(cell: ScannedCell, locate: Locate): SourceLocation {
  const fence = fenceLocation(cell, locate);
  return fence.line === undefined ? fence : { file: fence.file, line: fence.line + 1 };
}

function duplicateDefinitions(
  cells: readonly ScannedCell[],
  compiled: ReturnType<typeof compileCell>[],
  locate: Locate,
): Problem[] {
  const definers = new Map<string, number[]>();
  compiled.forEach((result, i) => {
    if (!result.ok) return;
    for (const name of definedNames(result.definition)) {
      definers.set(name, [...(definers.get(name) ?? []), i]);
    }
  });
  const problems: Problem[] = [];
  for (const [name, indices] of definers) {
    if (indices.length < 2) continue;
    // `viewof x` and `x` both name the same pair of cells; report `x` once.
    if (/^(viewof|mutable) /.test(name) && definers.get(name.replace(/^\w+ /, ""))?.length === indices.length) continue;
    problems.push({
      message: `\`${name}\` is defined in more than one cell`,
      locations: indices.map((i) => cellLocation(cells[i], locate)),
    });
  }
  return problems;
}

// ── markup ────────────────────────────────────────────────────────────────

function cellMarkup(cell: ScannedCell, parsed: ParsedCell, key: string, definition: CellDefinition | undefined): string {
  const mode = MODES[cell.language];
  const echo = booleanOption(parsed.options, "echo", true);
  const output = booleanOption(parsed.options, "output", true);
  const attrs =
    `data-ojs-key="${escapeAttribute(key)}" data-ojs-mode="${mode}" ` +
    `data-ojs-echo="${echo}" data-ojs-output="${output}"`;
  const def = definition ? jsonForScript(definition) : "null";
  const raw = `<div class="ojs-output"></div>\n<script type="application/json" class="ojs-def">${def}</script>`;
  const sourceFence = fenceFor(parsed.body);
  const rawFence = fenceFor(raw);
  const lines = [
    `::: {.ojs-cell ${attrs}}`,
    `${sourceFence}{.js .ojs-source ${attrs}}`,
    ...(parsed.body === "" ? [] : parsed.body.split("\n")),
    sourceFence,
    `${rawFence}{=html}`,
    ...raw.split("\n"),
    rawFence,
    ":::",
  ];
  return lines.map((line) => (line === "" ? line : cell.indent + line)).join("\n");
}

/** A backtick fence longer than any backtick run in `text`. */
function fenceFor(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  return "`".repeat(Math.max(3, longest + 1));
}

function escapeAttribute(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** JSON that's safe inside a <script> element. */
function jsonForScript(value: unknown): string {
  // U+2028 and U+2029 end lines in older JavaScript parsers; escape them too.
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(LINE_SEPARATOR, "\\u2028")
    .replace(PARAGRAPH_SEPARATOR, "\\u2029");
}

const LINE_SEPARATOR = new RegExp(String.fromCharCode(0x2028), "g");
const PARAGRAPH_SEPARATOR = new RegExp(String.fromCharCode(0x2029), "g");

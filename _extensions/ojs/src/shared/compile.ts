/**
 * Compiling cells with Notebook Kit, shared by the engine (Node) and the
 * browser (live preview).
 */

import { transpile } from "@observablehq/notebook-kit";

/** Cell language → Notebook Kit mode (design D1). */
export const MODES = { ojs1: "ojs", ojs2: "js" } as const;

export type OjsLanguage = keyof typeof MODES;
export type NotebookMode = (typeof MODES)[OjsLanguage];

export function isOjsLanguage(language: string): language is OjsLanguage {
  return Object.hasOwn(MODES, language);
}

/** A compiled cell, as JSON-safe data (the `.ojs-def` payload). */
export interface CellDefinition {
  mode: NotebookMode;
  /** Source of the cell's definition function. */
  body: string;
  inputs: string[];
  outputs: string[];
  output?: string;
  autodisplay: boolean;
  autoview: boolean;
  automutable: boolean;
}

export interface CompileError {
  /** The parser's message, without its `(line:column)` suffix. */
  message: string;
  /** 1-based line within the whole cell, counting option lines, if known. */
  line?: number;
  /** 1-based column, if known. */
  column?: number;
}

export type CompileResult = { ok: true; definition: CellDefinition } | { ok: false; error: CompileError };

const LOCATION_SUFFIX = /\s*\((\d+):(\d+)\)\s*$/;

/**
 * Compile one cell body. `bodyLineOffset` is the number of lines before the
 * body in the cell (from `parseCell`), so error lines count from the cell's
 * first line.
 */
export function compileCell(language: OjsLanguage, body: string, bodyLineOffset = 0): CompileResult {
  const mode = MODES[language];
  try {
    const t = transpile({ id: 0, value: body, mode });
    return {
      ok: true,
      definition: {
        mode,
        body: t.body,
        inputs: t.inputs ?? [],
        outputs: t.outputs ?? [],
        ...(t.output !== undefined ? { output: t.output } : {}),
        autodisplay: t.autodisplay ?? false,
        autoview: t.autoview ?? false,
        automutable: t.automutable ?? false,
      },
    };
  } catch (e) {
    return { ok: false, error: toCompileError(e, bodyLineOffset) };
  }
}

function toCompileError(e: unknown, bodyLineOffset: number): CompileError {
  const raw = e instanceof Error ? e.message : String(e);
  const suffix = LOCATION_SUFFIX.exec(raw);
  const message = raw.replace(LOCATION_SUFFIX, "");
  // acorn sets `loc`; some Notebook Kit errors only carry the message suffix.
  const loc = (e as { loc?: { line: number; column: number } } | null)?.loc;
  const line = loc?.line ?? (suffix ? Number(suffix[1]) : undefined);
  const column = loc?.column ?? (suffix ? Number(suffix[2]) : undefined);
  return {
    message,
    ...(line !== undefined ? { line: line + bodyLineOffset } : {}),
    ...(column !== undefined ? { column: column + 1 } : {}),
  };
}

/**
 * The names a compiled cell defines, as authors write them. `viewof x` and
 * `mutable x` also define `x` (design S5 and spec "Duplicate definitions").
 */
export function definedNames(definition: CellDefinition): string[] {
  const { output, outputs, autoview, automutable } = definition;
  if (output !== undefined) {
    if (autoview) {
      const name = output.replace(/^viewof\$/, "");
      return [`viewof ${name}`, name];
    }
    if (automutable) {
      const name = output.replace(/^initial /, "");
      return [`mutable ${name}`, name];
    }
    return [output];
  }
  return [...outputs];
}

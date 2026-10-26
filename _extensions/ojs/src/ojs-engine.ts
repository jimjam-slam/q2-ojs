/**
 * ojs-engine: q2 engine extension for Observable JavaScript.
 *
 * Claims `{ojs1}` and `{ojs2}` cells, compiles them with Notebook Kit at
 * render time, replaces each with the cell markup (design D3), and ships the
 * page runtime as an html dependency (D6). Compile errors and names defined
 * in more than one cell fail the render (D5).
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  ExecutionEngineDiscovery,
  ExecutionEngineInstance,
  ExecutionTarget,
  ExecuteOptions,
  ExecuteResult,
  EngineProjectContext,
  PartitionedMarkdown,
  Format,
  MappedString,
  QuartoAPI,
  LanguageClaim,
} from "@quarto/types";

import { isOjsLanguage } from "./shared/compile.ts";
import { formatProblems, transformDocument, type Locate } from "./engine/transform.ts";

// Inlined from `@quarto/api/claims` (`primary(1)`): the package isn't
// published, so an installed q2 can't bundle value imports from it.
const PRIMARY: LanguageClaim = { kind: "primary", priority: 1 };

let quarto: QuartoAPI | undefined;

// The built page runtime, next to this bundle (dist/runtime/).
const RUNTIME_DIR = join(dirname(fileURLToPath(import.meta.url)), "runtime");

/**
 * The page runtime as an html dependency (design D6): one classic script plus
 * its stylesheet. q2 stores it once per site, in `site_libs`.
 */
export function runtimeDependency() {
  const css = join(RUNTIME_DIR, "ojs-runtime.css");
  return {
    name: "ojs-runtime",
    scripts: [join(RUNTIME_DIR, "ojs-runtime.js")],
    stylesheets: existsSync(css) ? [css] : [],
  };
}

/**
 * Map offsets in the markdown q2 hands us back to the user's file. q2
 * re-serializes the document, so its lines don't match the source; the
 * MappedString carries the source map. Unmappable offsets fall back to the
 * nearest mapped position, then to the file name alone.
 */
export function locatorFor(markdown: MappedString, fallbackFile: string): Locate {
  return (offset) => {
    const mapped = markdown.map(offset, true);
    if (!mapped) return { file: fallbackFile };
    const text = mapped.originalString.value;
    const before = text.slice(0, mapped.index);
    const lineStart = before.lastIndexOf("\n") + 1;
    return {
      file: mapped.originalString.fileName ?? fallbackFile,
      line: before.split("\n").length,
      column: mapped.index - lineStart + 1,
    };
  };
}

/** The engine's execute step, separated from the q2 plumbing for testing. */
export function executeOjs(markdown: MappedString, source: string): ExecuteResult {
  const { markdown: out, cellCount, problems } = transformDocument(markdown.value, locatorFor(markdown, source));
  if (problems.length > 0) throw new Error(formatProblems(problems));
  const result: ExecuteResult = { markdown: out, supporting: [], filters: [] };
  if (cellCount > 0) {
    // A q2-only field, not in Quarto 1's ExecuteResult type.
    (result as ExecuteResult & { htmlDependencies: unknown[] }).htmlDependencies = [runtimeDependency()];
  }
  return result;
}

const ojsEngine: ExecutionEngineDiscovery = {
  name: "ojs",
  defaultExt: ".qmd",
  defaultYaml: () => [],
  defaultContent: () => [],
  validExtensions: () => [],
  canFreeze: false,
  generatesFigures: false,

  init(api: QuartoAPI): void {
    quarto = api;
  },

  claimsLanguage(language: string): boolean | number | LanguageClaim | null {
    return isOjsLanguage(language) ? PRIMARY : false;
  },

  claimsFile(): boolean {
    return false;
  },

  launch(_context: EngineProjectContext): ExecutionEngineInstance {
    return {
      name: "ojs",
      canFreeze: false,

      async markdownForFile(file: string) {
        return quarto!.mappedString.fromString(readFileSync(file, "utf8"), file);
      },

      async target(file: string, _quiet?: boolean, markdown?): Promise<ExecutionTarget | undefined> {
        const ms = markdown ?? (await this.markdownForFile(file));
        return { source: file, input: file, markdown: ms, metadata: {}, data: undefined };
      },

      async partitionedMarkdown(file: string, _format?: Format): Promise<PartitionedMarkdown> {
        const ms = await this.markdownForFile(file);
        return {
          markdown: ms.value,
          yaml: undefined,
          headingText: undefined,
          headingAttr: undefined,
          containsRefs: false,
          srcMarkdownNoYaml: ms.value,
        };
      },

      async execute(opts: ExecuteOptions): Promise<ExecuteResult> {
        return executeOjs(opts.target.markdown, opts.target.source);
      },
    };
  },
};

export default ojsEngine;

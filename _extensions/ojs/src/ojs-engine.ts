/**
 * ojs-engine: q2 engine extension for Observable JavaScript.
 *
 * Spike stage (tasks 1.3, 1.4): claims `ojs1`/`ojs2`, wraps each owned cell
 * in a marker Div that records its mode, and attaches one html dependency so
 * we can see how q2 emits engine scripts. No compilation yet.
 */

import { readFileSync } from "node:fs";
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
  QuartoAPI,
  LanguageClaim,
} from "@quarto/types";

const MODES: Record<string, string> = { ojs1: "ojs", ojs2: "js" };

// Inlined from `@quarto/api/claims` (`primary(1)`): the package isn't
// published, so an installed q2 can't bundle value imports from it.
const PRIMARY: LanguageClaim = { kind: "primary", priority: 1 };

const extDir = join(dirname(fileURLToPath(import.meta.url)), "..");

let quarto: QuartoAPI | undefined;

const CELL = /^```\{(ojs[12])\}[ \t]*\n([\s\S]*?)^```[ \t]*$/gm;

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
    return language in MODES ? PRIMARY : false;
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
        let cells = 0;
        const markdown = opts.target.markdown.value.replace(CELL, (_m, lang: string, body: string) => {
          cells++;
          return (
            `::: {.ojs-cell data-ojs-mode="${MODES[lang]}"}\n` +
            "```{.ojs-source .js}\n" +
            body +
            "```\n" +
            ":::"
          );
        });
        const result: ExecuteResult = { markdown, supporting: [], filters: [] };
        if (cells > 0) {
          (result as ExecuteResult & { htmlDependencies: unknown[] }).htmlDependencies = [
            {
              name: "ojs-spike",
              stylesheets: [],
              scripts: [join(extDir, "spike", "probe.js")],
            },
          ];
        }
        return result;
      },
    };
  },
};

export default ojsEngine;

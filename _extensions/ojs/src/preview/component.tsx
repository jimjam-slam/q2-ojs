/**
 * The live-preview component (design D7): a `render-components:` override of
 * `CodeBlock`. List it in a document's front matter as
 *
 *     render-components:
 *       - \_extensions/ojs/dist/ojs-preview.tsx
 *
 * (escape the `_`: front matter is parsed as markdown; spike S6).
 *
 * q2 transpiles the file with Babel and loads it as a blob-URL module with
 * `window.React`, so the build emits plain JavaScript with no imports. OJS
 * blocks get a thin host; everything else goes to q2's own `CodeBlock`
 * (`MermaidCodeBlock`), so mermaid keeps working.
 */

import { booleanOption, parseCell } from "../shared/cell.ts";
import type { OjsLanguage } from "../shared/compile.ts";
import type { HostInput } from "./hosts.ts";

/** The preview runtime module's source, injected by the build. */
declare const __OJS_PREVIEW_RUNTIME__: string;

interface PreviewRuntime {
  register(host: HTMLElement, input: HostInput): void;
  unregister(host: HTMLElement): void;
}

type Attr = [string, string[], [string, string][]];
interface CodeBlockNode {
  t: "CodeBlock";
  c: [Attr, string];
}
interface NodeArgs {
  node: CodeBlockNode;
  [other: string]: unknown;
}

// The preview's own React, provided as a global (React's types aren't a dependency here).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ReactGlobal = any;

const w = window as unknown as {
  React: ReactGlobal;
  __Q2_PREVIEW_RENDERER__?: { previewRegistry?: Record<string, (args: NodeArgs) => unknown> };
  __q2ojsPreviewRuntime?: Promise<PreviewRuntime>;
};
const React = w.React;
const builtinCodeBlock = () => w.__Q2_PREVIEW_RENDERER__?.previewRegistry?.CodeBlock;

/** Load the runtime module once per page, the first time an OJS cell mounts. */
function loadRuntime(): Promise<PreviewRuntime> {
  if (!w.__q2ojsPreviewRuntime) {
    const url = URL.createObjectURL(new Blob([__OJS_PREVIEW_RUNTIME__], { type: "text/javascript" }));
    w.__q2ojsPreviewRuntime = import(/* @vite-ignore */ url) as Promise<PreviewRuntime>;
  }
  return w.__q2ojsPreviewRuntime;
}

interface OjsBlock {
  input: HostInput;
  /** The source to echo, without `//|` option lines. */
  echoSource: string;
  echo: boolean;
}

const RAW = /^\{(ojs[12])\}$/;

function attribute(attrs: [string, string][], name: string): string | undefined {
  // Accept the attribute with or without its `data-` prefix.
  return attrs.find(([k]) => k === `data-${name}` || k === name)?.[1];
}

/** Recognize the two forms of an OJS cell in the preview's AST (spec ojs-preview). */
function ojsBlock(node: CodeBlockNode): OjsBlock | null {
  const [[, classes, attrs], text] = node.c;
  const raw = classes.map((c) => RAW.exec(c)?.[1]).find((l) => l !== undefined);
  if (raw) {
    const cell = parseCell(text);
    return {
      input: { language: raw as OjsLanguage, source: text },
      echoSource: cell.body,
      echo: booleanOption(cell.options, "echo", true),
    };
  }
  if (classes.includes("ojs-source")) {
    const key = attribute(attrs, "ojs-key");
    const mode = attribute(attrs, "ojs-mode");
    if (!key || (mode !== "ojs" && mode !== "js")) return null;
    return {
      input: { language: mode === "ojs" ? "ojs1" : "ojs2", source: text, key, output: attribute(attrs, "ojs-output") !== "false" },
      echoSource: text,
      echo: attribute(attrs, "ojs-echo") !== "false",
    };
  }
  return null;
}

/** The thin host: the echo, plus an element React never fills. */
function OjsCell({ args, block }: { args: NodeArgs; block: OjsBlock }) {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const inputKey = JSON.stringify(block.input);

  // Register every change at once. React often hands an existing component a
  // different cell when blocks shift, and only the registry can tell that apart
  // from an edit (it debounces edits; spike S14).
  React.useEffect(() => {
    const host = hostRef.current;
    if (host) loadRuntime().then((runtime) => runtime.register(host, block.input));
  }, [inputKey]);

  React.useEffect(() => {
    const host = hostRef.current;
    return () => {
      if (host) w.__q2ojsPreviewRuntime?.then((runtime) => runtime.unregister(host));
    };
  }, []);

  const Builtin = builtinCodeBlock();
  const [[id], ] = args.node.c;
  const echoNode: CodeBlockNode = { ...args.node, c: [[id, ["js"], []], block.echoSource] };
  return React.createElement(
    "div",
    { className: "ojs-preview-cell" },
    block.echo && Builtin ? React.createElement(Builtin as never, { ...args, node: echoNode }) : null,
    React.createElement("div", { ref: hostRef, className: "ojs-preview-host" }),
  );
}

export const CodeBlock = (args: NodeArgs) => {
  const block = ojsBlock(args.node);
  if (block) return React.createElement(OjsCell, { args, block });
  const Builtin = builtinCodeBlock();
  if (Builtin) return React.createElement(Builtin as never, args);
  return React.createElement("pre", null, React.createElement("code", null, args.node.c[1]));
};

## Context

q2 (in `./q2`, git-ignored, reference only) supports TypeScript engine extensions that run in a Node 24 subprocess. They declare static language claims in `_extension.yml` and return a `TsExecuteResult` whose `includes` and `html_dependencies` are applied by `EngineExecutionStage` (`crates/quarto-core/src/stage/stages/engine_execution.rs`). Several engines can share one document: language ownership is decided before execution (`claude-notes/designs/engine-resolution.md`), and each engine gets a `handled_languages` set of cells to leave alone. Knitr and jupyter honor that set (`knitr/resources/rmd/execute.R:79-92`, `jupyter/text_execute.rs:68`).

Facts from the exploration that shape this design:

- `HANDLED_LANGUAGES = ["ojs", "mermaid", "dot"]` (`engine/mod.rs:151`) is removed from the language scan before claims are consulted (`engine/resolution.rs:138`). So **no engine can own `{ojs}`**, but `{ojs1}`/`{ojs2}` can be owned.
- q2 decided that diagram renderers are *not* engines (`claude-notes/plans/2026-07-20-mermaid-regular-rendering.md`), because the live preview only replays **recorded engine captures**, keyed by `(structural_hash, occurrence_index)`. An edited cell is a capture miss and shows stale or raw output until someone re-executes it.
- The React preview (`ts-packages/preview-renderer`) keys blocks by **array index** (`framework/dispatch.tsx`). It never runs `<script>` inside raw HTML blocks, and re-inserts header-include scripts whenever the include string changes. Capture splice folds engine `includes` back into preview, but not `html_dependencies`.
- `render-components:` is a preview-only override mechanism. Exports replace registry entries by Pandoc tag through a flat spread (`PreviewRoot.tsx:1430`). The intended future route is `components:`, whose preview half is still open (bd-s73m7at2).
- Notebook Kit 2.8.0's transpiler (`transpile(cell)`) needs only `acorn`, `acorn-walk`, `@sveltejs/acorn-typescript` and `@observablehq/parser`, so it runs in Node and in the browser. It supports `mode: "ojs"` (1.0 syntax) and `mode: "js"`/`"ts"`. Its runtime `define(state, definition)` creates fresh variables in `state.variables` and renders into `state.root`. Its own dev server does a full reload on change, with no fine-grained reconcile.
- When a document has `{ojs…}` cells, q2's knitr engine defines `ojs_define()` (its regex `\{ojs[^}]*\}` also matches `ojs1`/`ojs2`). It emits the values as `<script type="ojs-define">` in `in_header` includes.

Audience: this is a proof of concept to take into quarto-dev discussion #14877. It should be honest about where it bends q2 and which core changes would make it cleaner.

## Goals / Non-Goals

**Goals:**
- `{ojs1}` and `{ojs2}` cells render and run in `q2 render` HTML output, alone and alongside knitr or jupyter cells.
- Compile errors appear at `q2 render` time, pointing at the cell.
- Cells run and update as you edit in `q2 preview`, keeping cell state across unrelated edits.
- `ojs_define()` from R works as it did in Quarto 1.
- One runtime/reconciler codebase serves static output and preview.
- Use only existing q2 surfaces; propose core changes, don't make them.

**Non-Goals:**
- A bare `{ojs}` alias (compatibility gap; see Risks).
- Inline `${expr}` interpolation in prose.
- Quarto 1 cell options beyond `echo` and `output` (no `panel`, `layout`, `fig-cap`/`label` cross-references).
- Shiny (`server: shiny`) OJS interop.
- Non-HTML formats (q2 is HTML-first; other formats get the code block).
- A friendlier error when the extension isn't installed (it's a q2 resolution concern).
- Publishing the extension or vendoring Notebook Kit for offline use.

## Decisions

### D1. One engine, two language claims: `ojs1` → Notebook Kit `ojs`, `ojs2` → `js`

The engine statically claims `ojs1: primary` and `ojs2: primary` in `_extension.yml`. That gives no-load resolution and makes knitr/jupyter cede both languages. The names map one-to-one onto Notebook Kit modes, matching Observable's own split (1.0 notebook syntax vs. Observable JavaScript).
*Alternatives:* `{ojs}` (impossible without a core change); `{ojs .v2}` (ownership is per language, not per class, so both forms would need the same owner anyway, and it reads worse).

### D2. Engine, not filter, for the render path

At render time the engine compiles every cell in Node, so syntax errors are diagnostics on the render, and the published page carries pre-transpiled definitions. A Lua filter can't run Node, and would push all compilation and all error reporting into the browser. The engine is also what the q2 team pointed at ("ojs as an engine extension"), so the proof of concept tests that claim directly.
*Alternative:* filter-only, compiling in the browser. It would also handle bare `{ojs}` (those cells reach filters untouched), but it gives up render-time diagnostics and doesn't exercise the engine path the discussion is about. Kept in reserve as the alias route.

### D3. Cell markup: a Div containing a source block, an output root and a compiled payload

The engine replaces each owned cell with markdown of this shape:

~~~~
::: {.ojs-cell data-ojs-key="<key>" data-ojs-mode="ojs|js"}
```{.ojs-source .js data-ojs-key="<key>" data-ojs-mode="ojs|js" data-echo="true|false"}
<original cell source, with //| option lines removed>
```
```{=html}
<div class="ojs-output"></div>
<script type="application/json" class="ojs-def">{ "body": "...", "inputs": [...], ... }</script>
```
:::
~~~~

- The **`.ojs-source` CodeBlock** is the echo (CSS hides it when `data-echo="false"`). It is also how the preview finds a cell when its capture is current (D7).
- **`.ojs-output`** is a placeholder. At runtime the bootstrap puts a runtime-owned output node there; it is never used directly as `state.root` in preview (D5).
- **`.ojs-def`** holds the Notebook Kit `TranspiledJavaScript` as JSON. It's inert data in every environment, so the static page never compiles in the browser. A cell with a compile error gets an error marker instead of a definition, and the render emits a diagnostic.

*Alternative:* RawBlock-only markup. That loses q2's code highlighting and echo handling, and it gives the preview no CodeBlock to host.

### D4. Cell identity: content hash + occurrence index

`key = hash(normalizedSource) + ":" + occurrence`, where `occurrence` counts earlier cells with the same hash, in document order. An optional `//| label: name` overrides the key. The same hash function (a synchronous non-crypto hash, e.g. cyrb53) lives in a shared module bundled into both the engine and the browser code, so render and preview agree. This is the scheme q2's own capture splice uses.

| Event | Effect with this key |
|---|---|
| Edit prose elsewhere | No key changes, so nothing recomputes |
| Edit inside a cell | That key changes: delete old, define new; dependents rebind by name |
| Move a cell | Same key: output node is reparented, nothing recomputes |
| Add or remove a cell | Only that key is affected |

*Alternatives:* the React index or q2 source ranges (shift on any edit above); position among OJS cells (shifts on insert); declared names (anonymous display cells have none).

### D5. Runtime singleton + reconciler; React hosts are thin

```
 globalThis.__q2ojs  (one per page/iframe; survives AST updates and module re-imports)
 ├── NotebookRuntime (Notebook Kit) + main module
 ├── cells: Map<key, { state: {root: outputNode, variables, expanded}, defHash, lastGoodDef }>
 ├── pending: upserts/releases from the current commit
 └── reconcile()   scheduled once per microtask
        1. release keys no longer wanted  → variable.delete() (resolves `invalidation`)
        2. define new keys / changed definitions
        3. reparent output nodes into their current host element
        4. untouched keys: no-op (values, viewof state, generators survive)
```

- Hosts call only `upsert(key, def | source, hostEl)` and `release(key)`. Deletes always happen before defines, and the whole batch runs synchronously, so the Observable runtime (which defers computation) never sees two definitions of one name, or a missing one.
- **The runtime owns the output nodes.** The host renders an empty element that React never fills, and the reconciler `appendChild`s that key's output node into it. React's index-keyed re-renders can therefore swap host elements without losing output.
- **Error policy:** a definition that fails to transpile in preview keeps the last good definition running and shows an error badge on that cell. Static output has no "last good" definition, so it shows the error.
- `runtime.dispose()` runs on page unload or preview navigation, not on AST updates.
- Static output runs the same reconciler once, on `DOMContentLoaded`, over all `.ojs-cell` elements.

*Alternative:* each React component calls `define()` in `useEffect`. That churns every cell below an insertion, briefly duplicates names, and leaves observers writing into detached nodes.

### D6. Delivery of the bootstrap

- **Render:** the bootstrap is bundled into one classic IIFE script and shipped as an engine `html_dependency` (with the inspector CSS). An IIFE avoids depending on module-script support in `TsHtmlDependency`, which is unverified (task). Notebook Kit's runtime is bundled in; transpiling is not needed on the static page.
- **Preview:** capture splice drops `html_dependencies`, so the preview gets the reconciler from the preview component module (D7). That module creates or reuses `globalThis.__q2ojs`, and lazy-loads Notebook Kit's transpiler and runtime as pinned ESM. A jsDelivr `+esm` URL follows `MermaidCodeBlock`'s CDN precedent.
- **Shared code:** the reconciler, hash and cell parsing live in one TypeScript source tree. Our build emits three outputs from it: the engine bundle (`q2 call build-ts-extension` or rollup), the static IIFE, and the single-file preview component.

### D7. Preview host: a `render-components:` `CodeBlock` override

The document lists the extension's generated preview component in `render-components:`. Its `CodeBlock` export handles two cases:
- **Capture current:** the AST contains the engine's `.ojs-cell` Div. The override matches the `.ojs-source` block, which carries its own `data-ojs-key` and `data-ojs-mode` (the engine sets them on the source block as well as the Div, since the override only sees the CodeBlock). It transpiles that source in the browser too, so preview never depends on the possibly stale `.ojs-def` payload.
- **Capture missed or stale:** the AST contains the raw `{ojs1}`/`{ojs2}` CodeBlock. The override computes the key with the shared hash and transpiles in the browser (debounced about 250 ms).

Either way it renders the echo (when `echo` isn't false) plus an empty host, and calls `upsert`/`release`. Any other CodeBlock goes to the built-in `CodeBlock` it imports. It can't reach `MermaidCodeBlock` (see Risks). Hiding the static `.ojs-output`/`.ojs-def` siblings in preview is CSS on `.ojs-cell`.
*Alternative:* `components:` bound to `.ojs-cell`. That's the intended long-term route (one contract, `content: ast`), but it's blocked on bd-s73m7at2. The design keeps the host thin so it can move there.

### D8. `ojs_define` interop

The bootstrap reads every `script[type="ojs-define"]` (from `in_header`, which preview also gets through the capture includes fold). It defines each named value as a data variable in the main module, keyed `define:<name>` in the same reconciler. It replicates Quarto 1's JSON shape and its column-to-row `transpose` behavior for data frames.

## Risks / Trade-offs

- [Bare `{ojs}` is unsupported: Quarto 1 documents render their OJS as plain code blocks, silently] → Documented as a compatibility gap. The proposed q2 core change is to drop `"ojs"` from `HANDLED_LANGUAGES`, after which the alias is one more static claim. A filter-based alias (D2 alternative) stays available.
- [The preview `CodeBlock` override replaces q2's built-in `MermaidCodeBlock` in documents that use it] → Documented. It goes away when bd-s73m7at2 lands or q2 lets overrides hand off to built-ins. Example documents avoid mixing mermaid and OJS.
- [Without the extension, `{ojs1}`/`{ojs2}` fall back to jupyter with a confusing kernel error] → Documented. Install instructions go in the README. The fix belongs in q2 (an "unclaimed language" hint).
- [Keys must agree between Node and browser] → One shared hash/normalization module, plus a test that compares engine-emitted keys with browser-computed keys on the same fixtures.
- [Preview evaluates transpiled bodies (`new Function`/blob import); a future preview CSP could block it] → Acceptable for a proof of concept. Noted for the discussion.
- [The CDN load in preview needs network access] → Same trade-off q2 already made for mermaid. Pinned exact version.
- [Observable 1.0 imports (`import … from "@user/notebook"`) may need runtime support beyond what Notebook Kit provides] → A spike task, and documented as unsupported if it fails.
- [`render-components:` must be declared per document] → Documented in example front matter. Whether extensions can contribute it is an open question for the q2 team.

## Migration Plan

Not applicable: this is a new, standalone extension. To roll back, remove the extension from `_extensions/`.

## Open Questions

- Can an extension contribute `render-components:` (or, later, `components:`) so documents don't have to list it?
- Does `TsHtmlDependency.scripts` support `type="module"`, or only classic scripts?
- Where do extension files live in the preview's VFS? Could the preview load the bundle from there instead of a CDN?
- Should the default for `echo` follow Quarto 1 (shown) or Observable (hidden)? The proof of concept follows Quarto 1.

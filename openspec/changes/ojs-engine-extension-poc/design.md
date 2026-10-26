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
- Adding `ojs_define` to q2's Jupyter engine for Python/Julia (spike S8), or changing knitr's OJS detection or engine order (spike S3). These are discussion points, not changes this proof of concept makes.
- Non-HTML formats (q2 is HTML-first; other formats get the code block).
- Bundling Notebook Kit's standard-library modules (`Inputs`, `d3`, `Plot` and others) locally. They keep loading from jsDelivr, unpinned (S10). A later follow-up could bundle and pin them, keyed to the relevant Quarto options (decided 2026-10-26).
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
- **`.ojs-def`** holds the Notebook Kit `TranspiledJavaScript` as JSON. It's inert data in every environment, so the static page never compiles in the browser. A compile error fails the render (decided 2026-10-26, because q2 drops TS engine warnings: spike S7), so a rendered page never contains a broken definition.

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
- **Error policy (decided 2026-10-26; see S7, S8):**
  - *Render time:* compile errors and names defined in more than one cell fail the render, reported together with `file:line:column`. q2 drops TS engine warnings, so there is no softer option yet.
  - *Live preview:* the engine isn't involved. A cell that stops compiling keeps its last good definition and shows an error badge. A duplicated name is caught by the preview and shown as an error on each defining cell, and the duplicates are never defined.
  - *Run time:* Notebook Kit's inspector shows thrown errors, rejections, failed imports and upstream failures in the cell and logs them. Unresolved names are left to the runtime (`RuntimeError: x is not defined`), the only place `ojs_define` names are known. Errors show even with `output: false` or `echo: false`.
- `runtime.dispose()` runs on page unload or preview navigation, not on AST updates.
- Static output runs the same reconciler once, on `DOMContentLoaded`, over all `.ojs-cell` elements.

*Alternative:* each React component calls `define()` in `useEffect`. That churns every cell below an insertion, briefly duplicates names, and leaves observers writing into detached nodes.

### D6. Delivery of the bootstrap

- **Render (revised 2026-10-26; spikes S9–S11):** the bootstrap and Notebook Kit's runtime are bundled with esbuild into **one classic script** and shipped with the page as the engine html dependency `ojs-runtime` (script plus inspector CSS). q2 stores it once per website in `site_libs`, or in `<stem>_files/libs/` for a single document. The two stdlib modules with top-level `await` (`dot`, `leaflet`) are rerouted to Notebook Kit's own pinned copies on jsDelivr, which they wrap anyway. No network is needed for the runtime itself, and no transpiler ships on the static page.
- **Preview:** capture splice drops `html_dependencies`, so the preview gets the reconciler from the preview component module (D7). That module creates or reuses `globalThis.__q2ojs`, and lazy-loads Notebook Kit's transpiler and runtime as pinned ESM. A jsDelivr `+esm` URL follows `MermaidCodeBlock`'s CDN precedent.
- **Shared code:** the reconciler, hash and cell parsing live in one TypeScript source tree. Our build emits three outputs from it: the engine bundle (`q2 call build-ts-extension` or rollup), the static IIFE, and the single-file preview component.

### D7. Preview host: a `render-components:` `CodeBlock` override

The document lists the extension's generated preview component in `render-components:` as an escaped path (`\_extensions/ojs/ojs-preview.tsx`; spike S6). The file must be `.tsx`, with no static imports. Its `CodeBlock` export handles two cases:
- **Capture current:** the AST contains the engine's `.ojs-cell` Div. The override matches the `.ojs-source` block, which carries its own `data-ojs-key` and `data-ojs-mode` (the engine sets them on the source block as well as the Div, since the override only sees the CodeBlock). It transpiles that source in the browser too, so preview never depends on the possibly stale `.ojs-def` payload.
- **Capture missed or stale:** the AST contains the raw `{ojs1}`/`{ojs2}` CodeBlock. The override computes the key with the shared hash and transpiles in the browser (debounced about 250 ms).

Either way it renders the echo (when `echo` isn't false) plus an empty host, and calls `upsert`/`release`. Any other CodeBlock goes to `window.__Q2_PREVIEW_RENDERER__.previewRegistry.CodeBlock` (q2's `MermaidCodeBlock`), so mermaid keeps working. Hiding the static `.ojs-output`/`.ojs-def` siblings in preview is CSS on `.ojs-cell`.
*Alternative:* `components:` bound to `.ojs-cell`. That's the intended long-term route (one contract, `content: ast`), but it's blocked on bd-s73m7at2. The design keeps the host thin so it can move there.

### D8. `ojs_define` interop

The bootstrap reads every `script[type="ojs-define"]` (from `in_header`, which preview also gets through the capture includes fold). It defines each named value as a data variable in the main module, unchanged. R's `ojs_define` serializes data frames column-oriented (`jsonlite::toJSON(dataframe = "columns")` in `ojs_static.R`), as does Quarto 1's Python version, and Quarto 1 never converted them automatically: authors call `transpose(data)`. So the runtime provides a `transpose` built-in and passes values through as they are (corrected 2026-10-26; the original wording said the data was converted to rows).

## Risks / Trade-offs

- [Bare `{ojs}` is unsupported: Quarto 1 documents render their OJS as plain code blocks, silently] → Documented as a compatibility gap. The proposed q2 core change is to drop `"ojs"` from `HANDLED_LANGUAGES`, after which the alias is one more static claim. A filter-based alias (D2 alternative) stays available.
- [The preview `CodeBlock` override replaces q2's built-in `MermaidCodeBlock` in documents that use it] → Avoided: the override hands non-OJS blocks to `window.__Q2_PREVIEW_RENDERER__.previewRegistry.CodeBlock`, which is `MermaidCodeBlock` (spike S6). The remaining risk is that this global is an experimental surface q2 might change.
- [Implicit engine order runs our engine before knitr, so `ojs_define` is never set up (spike S3)] → **Accepted as a limitation (2026-10-26):** documents that use `ojs_define` declare `engine: [knitr, ojs]`. Option (c), an engine-ordering hint or an ownership-aware knitr check, goes to the discussion.
- [Quarto 1 `require("…")` cells fail: Notebook Kit's stdlib has no `require` (spike S5)] → Supply a `require` builtin backed by jsDelivr when constructing the runtime.
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
- Should the default for `echo` follow Quarto 1 (shown) or Observable (hidden)? The proof of concept follows Quarto 1.

## Spike findings (2026-10-26)

All run against q2 nightly `0.36.0-nightly.20261024`, built from `ab976ef21` (the same commit as `./q2`), with Node 24.22.1 and Notebook Kit 2.8.0.

**S1. Static claims resolve; knitr and jupyter cede (task 1.3).** `examples/spike-claims.qmd` (`{ojs1}`, `{ojs2}` and a bare `{ojs}`, with no `engine:` key) resolved to the `ojs` engine alone. `{ojs1}` became `data-ojs-mode="ojs"` and `{ojs2}` became `data-ojs-mode="js"`. The bare `{ojs}` cell rendered as `<pre class="{ojs}">`, untouched and with no warning (the compatibility gap, confirmed).

**S2. Extension discovery.** A single file only searches its own folder's `_extensions/`. A project searches from the file up to the project root. `examples/` is now a project whose `_extensions/ojs` is a symlink to the real extension; the engine path follows the symlink.

**S3. Implicit engine order is `[ojs, knitr]`, which breaks `ojs_define` (task 1.3).** q2 puts extension engines before built-ins in an implicit sequence (`resolution.rs:89-105`). Our engine therefore rewrites the `{ojs2}` fences before knitr runs. Knitr's `needs_ojs` check (a regex over the markdown it receives, `execute.R:164`) then finds no `{ojs…}` fence and never defines `ojs_define()`, so R fails with `could not find function "ojs_define"`. With `engine: [knitr, ojs]` in the front matter, everything works: knitr defines `ojs_define`, the `<script type="ojs-define">` payload lands in `<head>`, and the `.ojs-cell` renders. `examples/spike-knitr-order.qmd` is the working case and `examples/spike-knitr.qmd` the failing one. Options:
  - (a) Document `engine: [knitr, ojs]` for documents that use `ojs_define`. No tricks, but it's a burden on authors.
  - (b) Keep a marker line in the engine's output that knitr's regex detects but its chunk parser ignores (for example, a line beginning `` ```{ojs} `` followed by other text, inside a raw HTML comment). It works implicitly, but depends on knitr's private regexes.
  - (c) Raise it upstream: let an engine declare that it runs after other engines, or have knitr's detection consult ownership instead of the markdown. Either suits the discussion regardless of whether we pick (a) or (b).

**S4. Engine html dependencies are classic scripts only (task 1.4).** `TsHtmlDependency` is `{name, stylesheets: string[], scripts: string[]}`. The template can emit attributes (`scripts.attribs`), but the TS wire carries none. The output was `<script src="…_files/libs/ojs-spike/probe.js">` in `<head>`, with the file copied to `libs/<name>/`. D6's IIFE choice stands, and the bootstrap must wait for `DOMContentLoaded` because it runs before the body is parsed. Relative script paths resolve against `libDir`, so the engine passes absolute paths.

**S5. Notebook Kit covers Observable 1.0 imports but not `require` (task 1.5).** In a browser, with Notebook Kit's runtime loaded from `https://cdn.jsdelivr.net/npm/@observablehq/notebook-kit@2.8.0/dist/src/runtime/index.js/+esm`:
  - `import {chart} from "@d3/bar-chart"` resolved to a live `<svg>`, through `api.observablehq.com/@d3/bar-chart.js?v=4` and the runtime's `@variable` builtin.
  - `viewof` and a dependent cell worked (`n * 10` gave `40`), and a `js`-mode `display()` worked.
  - **`require` is not defined.** The stdlib instead provides `d3`, `Plot`, `Inputs`, `_`, `htl`, `md`, `tex`, `aq`, `duckdb`, `vl` and others directly. Quarto 1 documents using `require("…")` need a `require` builtin passed to `new NotebookRuntime(builtins)`.
  - `npm:` specifiers are rewritten to jsDelivr in `js` mode. In `ojs` mode a dynamic `import("npm:…")` is left raw, which is minor since 1.0 syntax predates `npm:`.
  - **Static imports in `ojs` mode are notebook imports only**, as in Observable 1.0 and Quarto 1. `import {scaleLinear} from "npm:d3"` fetches the module but links it as a notebook, so in the browser it fails with `scaleLinear is not defined`; the same import in `js` mode works. `import * as d3 from …` is a parse error in `ojs` mode. Notebook imports, including `import {chart} with {pdata as data} from "@d3/zoomable-sunburst"`, transpile correctly. In `{ojs1}`, libraries come from the stdlib built-ins, a dynamic `import("https://…/+esm")` (verified working), or `require` (once shimmed).
  - The jsDelivr `+esm` route for the preview (D6) works.

**S6. The `render-components:` host works, and the Mermaid clash is avoidable (task 1.6).** In `q2 preview`, a `CodeBlock` override received every code block, hosted the raw `{ojs2}` cell, and handed the rest to `window.__Q2_PREVIEW_RENDERER__.previewRegistry.CodeBlock`. That is `MermaidCodeBlock`, and the mermaid diagram still drew. Constraints found:
  - The file must be **`.tsx`**: q2 syncs only `.tsx` for `render-components:` (`quarto-preview/src/config.rs:541`, `quarto-hub/src/discovery.rs:143`), and other extensions are silently ignored. The content goes through Babel (TypeScript + React presets) and loads as a blob-URL ES module with `window.React` as a global. So: no static imports (the TS preset drops unused ones, and blob URLs can't resolve relative paths); dynamic `import()` of absolute URLs is fine.
  - Front-matter strings are parsed as markdown. A leading `_` opens emphasis (warning `Q-1-20`), and `!str` makes the entry invisible to the preview's path extraction. **Escape it**: `render-components: [\_extensions/ojs/ojs-preview.tsx]` works.
  - The file has to be inside the project tree. A symlink that resolves outside it isn't synced, so the dev `examples/_extensions/ojs` symlink must become a copied build output for preview testing.
  - In project mode, a component file created after `q2 preview` starts isn't picked up until a restart.
  - Live preview shows `{ojs…}` cells as raw source with a "Code has changed since the last capture. Re-execute" banner after any edit. That confirms D7's raw-cell path is the common case.

**S7. Errors and warnings (2026-10-26).**
  - *Render-time reporting.* q2 drops TS engine warnings: `ts_engine.rs:660` hardcodes `warnings: Vec::new()` (related open strand bd-yd94iyq9). A `[WARN]`-prefixed stderr line becomes a `tracing` event that shows only with `RUST_LOG=engine_host=warn`: not at default verbosity, not with `-v`, and not counted by `--strict`. A thrown error *is* shown: `Error: Execution failed in ojs: <our message>`, and that file's render fails. So today an engine can either fail the render or stay silent.
  - *What compiling gives us.* Notebook Kit throws `SyntaxError` with `loc: {line, column}` within the cell. TypeScript cells are not type-checked (types are stripped). Transpiling also yields each cell's declarations and unbound references, and `defaultGlobals` lists 84 browser globals. Notebook Kit has no checker or linter beyond this (its CLI has `build`, `download`, `preview` and `query`).
  - *Run time, observed in a browser.* The inspector shows a thrown error, a rejected promise, a failed `import()` and an undefined reference (`RuntimeError: y is not defined`) inside the cell, styled `.observablehq--error`, and also calls `console.error`. A cell depending on a failed cell shows `RuntimeError: <upstream message>`. **The same name declared in two cells shows nothing** unless another cell references it. An error thrown later from a callback (`setTimeout`) reaches only `window.onerror`.

**S8. What a render-time check can see of `ojs_define` data (2026-10-26).**
  - *R (knitr).* In the required `[knitr, ojs]` order, our engine receives knitr's output markdown. The R **source** is there only when echoed (` ```{.r .cell-code}` containing `ojs_define(cars = …)`; `echo: false` removes it). The **payload** is not: knitr puts `<script type="ojs-define">` into its header includes, which q2 collects separately and doesn't pass to later engines (`rendered.includes.header` is still `[]` when our engine runs). It shows up only in the final HTML.
  - *Python and Julia (Jupyter).* Quarto 1 injects `ojs_define` into the kernel (`quarto-cli/src/resources/jupyter/lang/python/setup.py`, `…/julia/setup.jl`). It displays `<script type="ojs-define">{"contents":[{"name":…,"value":…}]}</script>` as **cell output**, which would land in the markdown a later engine receives. But **q2's Jupyter engine has no kernel setup code and no `ojs_define`** (checked in source; not run, as Jupyter isn't installed here). So Python/Julia `ojs_define` looks unavailable in q2 today: another item for the discussion.
  - *Browser.* The runtime sees every `script[type="ojs-define"]` on the page, so names can always be checked at run time.

**S9. Notebook Kit's runtime can't be bundled as a classic script (2026-10-26, found in task 1b.2).** Its standard library uses top-level `await` (`runtime/stdlib/leaflet.js`, `runtime/stdlib/dot.js`). esbuild refuses that in `iife` format, so D6's "one classic IIFE for the rendered page" won't build. As split ES modules (`--format=esm --splitting`) it builds (1.3 MB for runtime, stdlib, transpiler and `d3-require` together, before minification) and runs. In that build, `d3 = require("d3@7")` loaded d3 7.9.0 and `require("topojson-client@3")` worked. Engine dependencies can only be classic scripts (S4), so the rendered page needs a different delivery. Resolved by S10.

**S10. Shipping the runtime with the page (2026-10-26, task 1b.5).** Decision: rendered pages must not need the network for features that don't need it, so the runtime ships with the page (no CDN).
  - *Mechanism, verified.* The build bundles `src/runtime/bootstrap.ts` with esbuild as split, minified ES modules (26 files, 568 KB) into `dist/runtime/`. When a document has OJS cells, the engine copies that folder to `<stem>_files/ojs-runtime/` next to the source, reports it in `supporting`, and adds `<script type="module" src="<stem>_files/ojs-runtime/bootstrap.js">` as a header include. Include values are raw HTML, so `type="module"` is allowed, and module scripts may use top-level `await`, so no classic loader is needed. A single document and a website with `output-dir: _site` both work: q2 copied each page's runtime into `_site/` keeping its layout (`_site/sub/page_files/ojs-runtime/`), and pages without OJS got nothing. In the browser, the runtime and the lazily loaded `md` chunk came only from the page's own files, with no external requests.
  - *Side effects.* Every page with OJS gets its own 568 KB copy; supporting files aren't shared the way html dependencies are (`site_libs`). In a project with `output-dir`, the `<stem>_files/` folders the engine writes stay in the source tree after rendering (not yet compared with what knitr or Jupyter leave behind). esbuild also emits `bootstrap.css` (the inspector styles), which needs a `<link>` in the same header include.
  - *The standard library still needs the network.* Notebook Kit loads almost every recommended library lazily from jsDelivr, **without version pins**: `Inputs`, `d3`, `Plot`, `htl`/`html`/`svg`, `_`, `aq`, `topojson`, `Arrow`, `echarts`, `React`, `duckdb`, `mermaid`, `vl`, `tex` (KaTeX), plus `dot` and `L` (Leaflet), which import from it directly. Only built-ins like `md`, `Generators`, `Mutable` and `FileAttachment` are local. Making common cells work offline means overriding these built-ins with locally bundled, pinned versions (see Open Questions).
  - *Preview is unchanged:* it still loads Notebook Kit from jsDelivr (D6).
  - *Testing note:* Observable's runtime schedules work with `requestAnimationFrame`, which doesn't fire while the browser pane is hidden, so cells look stuck. Bring the tab to the front before checking output.
  - *Superseded the same day by S11*, because of the per-page copies.

**S11. The runtime as an html dependency after all (2026-10-26).** Only two stdlib modules use top-level `await`, `runtime/stdlib/dot.js` and `runtime/stdlib/leaflet.js`. Both are imported only by the lazy `dot` and `L` loaders in `recommendedLibraries.js`, and both just wrap CDN imports. An esbuild plugin in `scripts/build.mjs` resolves those two imports to Notebook Kit's own copies on jsDelivr, pinned to 2.8.0, as external dynamic `import()`s, which classic scripts allow. With that change the whole runtime builds as **one classic script** (`dist/runtime/ojs-runtime.js`, 499 KB minified, plus a 0.4 KB stylesheet). The engine returns it as an html dependency `ojs-runtime`. Verified:
  - *Website with `output-dir`:* **one copy** at `_site/site_libs/libs/ojs-runtime/`, shared by every OJS page, with correct relative `<script src>` paths (`../site_libs/…` from `sub/page.html`). A page without OJS doesn't load it, and **nothing is left in the source tree**. This works because q2 gives every html dependency project scope and dedupes it across pages (`dependency.rs`).
  - *Single document:* a copy in `<stem>_files/libs/ojs-runtime/`, q2's usual behavior.
  - *Browser:* the nested page's cell rendered from the shared copy; the `dot` built-in loaded `…/notebook-kit@2.8.0/dist/src/runtime/stdlib/dot.js/+esm` only when used, and produced an SVG.
  - *Constraints to keep in mind:* html dependency files are stored flat by file name (no subfolders); every listed script becomes a classic `<script src>` in `<head>`, so the bootstrap waits for `DOMContentLoaded`; and nothing loads lazily any more, so the 499 KB file loads on every OJS page (cached across a site).

**S12. Source locations and q2's markup (2026-10-26, task group 3).**
  - *q2's source map is one character off inside code blocks.* The markdown an engine receives is re-serialized (the front matter alone grows by about 130 lines), and `opts.target.markdown.map(offset)` maps back to the source file. Inside an `{ojs2}` cell, every offset, the fence line included, mapped one character later than the true position (serialized `j` in `{ojs2}` → original `s`). Lines were right; columns would have been off by one. The engine therefore maps only the cell's fence line and counts within the cell itself (q2 keeps code-block content verbatim): line = fence line + the error's line in the cell, column = cell indent + Notebook Kit's column. Unit test "columns don't depend on q2's off-by-one source map" simulates the shift. Worth reporting upstream. Indentation: the column uses the serialized indent, which could differ from the source if q2 re-indents list items (not observed).
  - *q2 wraps code blocks* in `div.code-copy-outer-scaffold` (its copy button), so the echo CSS hides whichever child of `.ojs-cell` contains `.ojs-source` (`:has()`), not a direct `.sourceCode` child.
  - *End-to-end results (group 3):* `test/e2e/syntax-errors.qmd` failed the render with `syntax-errors.qmd:10:7` and `:14:8`, and `test/e2e/duplicates.qmd` with `` `x` is defined in more than one cell (duplicates.qmd:6, duplicates.qmd:10) ``; both match the source. `test/e2e/markup.qmd` rendered three cells with the D3 attributes, JSON payloads that parse back to the definitions, and one runtime script and stylesheet; in the browser, the `echo: false` cell showed only its output.

**S13. The runtime on rendered pages (2026-10-26, task group 4).**
  - *A bundling bug the unit tests couldn't see.* On the first rendered page with `Inputs`, every dependent cell failed with `Dynamic require of "https://cdn.jsdelivr.net/npm/@observablehq/inputs/+esm" is not supported`. In a classic (IIFE) bundle, esbuild turns a **static** `import … from "https://…"` into a `require()` shim. S11 rerouted only `dot` and `leaflet` and tested only `md` and `dot`, so it missed that ten stdlib modules (`inputs`, `tex`, `mermaid`, `vega-lite`, `duckdb`, `mapboxgl`, `leaflet`, `dot`, `xlsx`, `zip`) import from URLs statically. All ten are only loaded with `import()`, so the build plugin now reroutes any dynamically imported Notebook Kit module whose source has a static URL import to Notebook Kit's own pinned copy on jsDelivr (detected by content, not a list). The bundle has no remaining `require` calls (checked in an unminified build, `OJS_DEBUG_BUILD=1`).
  - *Verified in a browser:* `test/e2e/markup.qmd` showed the `viewof` slider at 4 and the hidden-source cell at 8; typing 7 updated it to 14; the `output: false` cell showed nothing. `examples/knitr-ojs-define.qmd` received R's data frame column-oriented, `transpose(cars)` gave three rows, and the last cell read "First row: 21 mpg, 6 cylinders".
  - *Unit tests:* 18 reconciler tests run against a real Notebook Kit runtime in jsdom (`npm test`). The `viewof` state test is skipped there, because Node can't import `Inputs` from the CDN; preview testing (group 5) covers it.

**S14. Live preview (2026-10-26, task group 5).**
  - *Shape.* The preview component (`dist/ojs-preview.tsx`, 15 KB, no top-level imports) overrides `CodeBlock`, hands non-OJS blocks to q2's `MermaidCodeBlock`, and renders an echo plus an empty host for OJS blocks. On first use it imports the preview runtime, a small ES module embedded as a string (blob URL) whose only imports are pinned jsDelivr URLs for Notebook Kit's compiler and runtime and d3-require; the stylesheet is inlined. All hosts register with a **host registry** (`src/preview/hosts.ts`), which once per microtask sorts hosts into document order, computes keys exactly as the engine does (unit-tested against the engine's output, including duplicates, labels and mixed engine/raw blocks), compiles, finds duplicate names, and drives the reconciler.
  - *React reuses components for different cells.* The preview keys blocks by index, so when a paragraph is inserted above OJS cells React mostly hands **existing** components different cells, rather than remounting them. A first version debounced every change in the component, so the slider's cell lost its host for 250 ms, was released and was redefined from scratch (slider reset). An instrumented run showed the sequence. Fix: components register every change at once, and the **registry** decides. A host whose new key another host held a moment ago is a move and applies immediately; a host whose key is brand new is an edit and is debounced (250 ms); keys whose host disappeared get a 100 ms grace before release, in case another host claims them.
  - *Last good definition, by host.* In the preview an edit changes a cell's key (its hash), so "keep the last good definition" can't be keyed by key. When an edit introduces a compile error or a duplicate name, the registry keeps the host's previous good input and key running and sends the problem as a badge. An unchanged cell caught up in a new duplicate is marked the same way.
  - *Verified in `q2 preview`* (`examples/preview.qmd`, one iframe throughout, checked with a marker on its window and a reference to the slider's input element): first load drew the mermaid diagram, the slider (4), the hidden-source cell (8) and "n squared is 16"; slider set to 7 gave 14 and 49; inserting a paragraph above the cells kept the **same slider element at 7**; editing a cell's code to `n * n * n` showed "n cubed is 343" without re-executing, slider untouched; typing a syntax error showed "SyntaxError: Unexpected token (line 3, column 16)" over the last good output (14); adding a second `doubled` marked both cells while both kept their output; removing it cleared both badges.
  - *Not exercised in a browser:* the preview never showed the engine's form of a cell (`.ojs-source` with `data-ojs-key`), even right after Re-execute: every host registered in the raw form. The engine-form path and the preview's hiding of static markup are covered only by unit tests. Whether q2's live preview splices TS-engine output at all is a question for the q2 team.
  - *Also fixed in passing:* Notebook Kit's inspector stylesheet wasn't bundled, so values rendered unstyled on static pages too. `ojs.css` now imports `inspector.css` and defines the theme variables it reads, scoped to cell output.

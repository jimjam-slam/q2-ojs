## Why

Quarto 2 (q2) has no Observable JavaScript (OJS) support, and the team has said it could come entirely from a third-party engine extension (quarto-dev discussion #14877). Observable's maintainer suggested building it on the official Observable Notebook Kit rather than the unofficial compiler Quarto 1 used. This change builds a proof of concept to take back to that discussion: a working extension that shows the approach is feasible and surfaces the q2 core gaps it hits.

## What Changes

- Add a q2 **TypeScript engine extension** (runs under q2's Node 24 engine host) that statically claims two cell languages in `_extension.yml`:
  - `{ojs1}`: Observable 1.0 notebook syntax (`viewof`, `mutable`, named cells, Observable imports), compiled with Notebook Kit's `ojs` mode.
  - `{ojs2}`: Observable JavaScript (Notebook 2.0), compiled with Notebook Kit's `js` mode.
- At `q2 render`, the engine compiles each cell with `@observablehq/notebook-kit`. Compile errors are reported against the source. The engine emits a placeholder cell `Div` for each cell, keeping the source for echo, plus the runtime bootstrap through the engine result's `includes` / `html_dependencies`.
- Add a **browser runtime bootstrap**: one long-lived `NotebookRuntime` per page that reconciles cells by a stable key (content hash + occurrence index). It runs one batched delete-then-define pass per microtask, and the runtime owns each cell's output node. The same bootstrap serves static output (one pass) and live preview (repeated reconciles).
- Add **live-preview support** by compiling in the browser. The preview only replays recorded engine captures, so an edited cell would otherwise show stale output. A preview-only `render-components:` `CodeBlock` override hosts the cells and feeds them to the bootstrap.
- Support **Quarto 1 `ojs_define` interop**: the bootstrap reads the `<script type="ojs-define">` header payload that q2's knitr engine already emits.
- Use the extension in documents alongside other engines (for example `{r}` + `{ojs2}`), relying on q2's per-language ownership so knitr and jupyter leave `ojs1`/`ojs2` cells alone.

## Capabilities

### New Capabilities
- `ojs-engine`: the engine extension. Static language claims for `ojs1`/`ojs2`, compiling with Notebook Kit at render time, the cell placeholder markup, compile diagnostics, and how the bootstrap is delivered through engine includes/dependencies. Also covers coexisting with other engines.
- `ojs-runtime`: the browser bootstrap. The runtime singleton, cell identity, the reconciliation algorithm, the output-node lifecycle, error policy (keep the last good definition), cleanup on invalidation, and `ojs_define` data intake.
- `ojs-preview`: the q2 live-preview integration. Compiling in the browser, the `render-components:` cell host, and how preview and render stay consistent.

### Modified Capabilities
<!-- None: no existing specs in openspec/specs/. -->

## Impact

- **New code in this repo**: the extension source (TypeScript engine, browser bootstrap, preview component), example documents, and build tooling (`q2 call build-ts-extension`).
- **Dependencies**: `@observablehq/notebook-kit` (transpiler + runtime; pinned exact version), bundled for Node (engine) and for the browser (bootstrap/preview). It pulls in `@observablehq/runtime`, `@observablehq/parser`, `@observablehq/inspector` and `acorn`.
- **q2 (no changes required)**: the proof of concept uses only existing q2 surfaces: TS engine static claims, `TsExecuteResult.includes` / `html_dependencies`, `render-components:`, and knitr's `ojs_define` header payload. q2 is consulted from `./q2` as a reference only.
- **Known gaps (recorded, not fixed here)**:
  - **Compatibility gap:** a bare Quarto 1 `{ojs}` cell is excluded by q2's hard-coded `HANDLED_LANGUAGES = ["ojs", "mermaid", "dot"]`. It renders as a plain code block, and no engine can claim it. An `{ojs}` alias is deferred, and is the obvious request to bring to the q2 team.
  - The preview `CodeBlock` override replaces q2's built-in `MermaidCodeBlock`, because the registry merge is a flat spread. This lasts until `components:` preview mounting (q2 strand bd-s73m7at2) lands.
  - Without the extension installed, `{ojs1}`/`{ojs2}` fall back to jupyter and fail with an unhelpful kernel error.
  - Shiny (`server: shiny`) OJS interop is out of scope.
  - `ojs_define` from R works only when the document declares `engine: [knitr, ojs]`: in an implicit sequence our engine runs first and knitr never sets `ojs_define` up.
  - `ojs_define` from Python or Julia is unavailable: Quarto 1 injected it into Jupyter kernels, and q2's Jupyter engine doesn't. Adding it to q2's engines is out of scope.
- **Discussion points this exposes**: OJS can be compiled and run by an extension, but `ojs_define` depends on the *other* engines (a helper inside their runtimes, knitr's detection of OJS cells, and engine order). Possible directions: move `ojs_define` into the user-installed language packages; give engines an ordering hint; and document the `<script type="ojs-define">` payload as a contract between engines.

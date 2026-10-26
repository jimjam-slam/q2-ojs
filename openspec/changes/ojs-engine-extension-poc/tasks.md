## 1. Setup and spikes

- [x] 1.1 Set up `q2` and Node 24: q2 nightly `0.36.0-nightly.20261024` (built from `ab976ef21`, the same commit as `./q2`) and Node 24.22.1, both checksum-verified, in git-ignored `.tools/`. Used instead of `cargo build` (no rustup or pinned nightly toolchain on this machine)
- [x] 1.2 Scaffold the extension (`_extensions/ojs/_extension.yml`, `src/`, `package.json` pinning `@observablehq/notebook-kit@2.8.0` exactly) plus an `examples/` q2 project
- [x] 1.3 Spike: claims resolve and knitr/jupyter cede (S1); but the implicit order `[ojs, knitr]` breaks `ojs_define` (S3, needs a decision)
- [x] 1.4 Spike: engine html dependencies are classic `<script src>` in `<head>` only (S4)
- [x] 1.5 Spike: Observable 1.0 notebook imports work, `require` is missing, and the jsDelivr route works (S5)
- [x] 1.6 Spike: a `.tsx` `render-components:` override works and can hand off to `MermaidCodeBlock` (S6)

## 1b. Follow-ups from the spikes

- [x] 1b.1 Decide the knitr ordering issue: accepted as a limitation (`engine: [knitr, ojs]` for `ojs_define`); spec and design updated; upstream ask goes in 7.3
- [x] 1b.2 Add a `require` builtin (jsDelivr-backed) to the runtime, for Quarto 1 `require("…")` cells (`src/runtime/builtins.ts`; browser check `test/browser/require.entry.ts`; surfaced S9)
- [x] 1b.3 Replace the dev symlink `examples/_extensions/ojs` with a copy produced by the build, so the preview syncs the component (`npm run build` → `scripts/build.mjs`; `examples/_extensions/` git-ignored)
- [x] 1b.5 Spike: ship the runtime's ES-module chunks with the rendered page (decided 2026-10-26: no network needed for features that don't need it). Shipped first as per-page supporting files (S10), then as one classic script in an html dependency shared via `site_libs` (S11); D6 revised
- [x] 1b.6 Decide on the standard library's network use: leave Notebook Kit's CDN loading as is for now (decided 2026-10-26). Follow-up, out of scope: bundle libraries locally, keyed to the relevant Quarto options
- [x] 1b.4 Remove the spike scaffolding: probes and their engine dependency removed; `spike-preview.qmd` and the failing `spike-knitr.qmd` deleted; the two working documents kept as fixtures (`examples/claims.qmd`, `examples/knitr-ojs-define.qmd`)

## 2. Shared core module

- [x] 2.1 Write the cell-option parser (`//| echo`, `output`, `label`) and source normalization (`src/shared/cell.ts`, 8 tests)
- [x] 2.2 Write the synchronous hash and the key function (hash + occurrence; label override), with unit tests for duplicates, labels, and option-line insensitivity (`src/shared/keys.ts`, cyrb53 checked against its published reference values; 9 tests)
- [x] 2.3 Write the mode mapping (`ojs1`→`ojs`, `ojs2`→`js`) and a `compileCell` wrapper around Notebook Kit `transpile` that returns either a definition or a structured error with a line number (`src/shared/compile.ts`, plus `definedNames` for 3.3b/5.3b; 11 tests). Bundles for Node via `q2 call build-ts-extension` (444 KB engine) and for the browser via esbuild (504 KB, no jsdom/Vite)

## 3. Engine (render path)

- [x] 3.1 Implement engine discovery/launch and `execute()`: scan the markdown for owned cells, leave everything else byte-identical (`src/engine/scan.ts`: CommonMark fences, skips cells inside other code blocks; 13 tests)
- [x] 3.2 Emit the `.ojs-cell` markup (source block with key, mode and echo attributes; `.ojs-output`; `script.ojs-def` JSON, escaped for `<`) (`src/engine/transform.ts`; also escapes U+2028/2029, grows fences past backtick runs, keeps indentation; echo CSS in `src/runtime/ojs.css`)
- [x] 3.3 Fail the render on compile errors: map each cell's in-cell `loc` to `file:line:column`, collect every broken cell, and throw one error listing them (maps only the fence line through q2's source map; S12)
- [x] 3.3b Detect names defined by more than one cell across `ojs1`/`ojs2` (counting `viewof x`/`mutable x` as also defining `x`) and report them in the same render error; unit-test each spec scenario
- [x] 3.4 Ship the runtime only when the document has owned cells, as the html dependency `ojs-runtime` (script plus CSS; prototype from S11 in place); add a unit test that documents without OJS cells get no dependency
- [x] 3.5 Build the engine bundle (`q2 call build-ts-extension`, or rollup with the documented settings) and add engine unit tests over fixture markdown (`test/unit/engine.test.ts`; end-to-end fixtures in `test/e2e/`, results in S12)

## 4. Runtime bootstrap

- [ ] 4.1 Implement the `globalThis.__q2ojs` singleton around `NotebookRuntime`, with `upsert`/`release` and a microtask-scheduled reconcile
- [ ] 4.2 Implement the reconcile order: delete released/changed, define new, reparent output nodes, skip unchanged
- [ ] 4.3 Implement runtime-owned output nodes and last-good-definition with an error badge
- [ ] 4.3b Implement `output: false` as "hide values, show errors" (a custom observer around Notebook Kit's), and check `echo: false` cells still show errors
- [ ] 4.4 Implement static initialization: scan `.ojs-cell` and define from `script.ojs-def` on DOM ready
- [ ] 4.5 Implement `ojs_define` intake from `script[type="ojs-define"]`, including Quarto 1's data-frame transpose
- [ ] 4.6 Implement disposal on page unload
- [ ] 4.7 Test the reconciler in jsdom or a headless browser: no-op batch, edit with dependent recompute, removal stopping a generator, host swap without recompute, duplicate-name safety
- [x] 4.8 Bundle the bootstrap as one IIFE with inspector CSS (done in S11: `scripts/build.mjs`, with `dot`/`leaflet` rerouted to pinned jsDelivr copies)

## 5. Preview integration

- [ ] 5.1 Implement the `CodeBlock` override: recognize `.ojs-source` and raw `{ojs1}`/`{ojs2}` blocks, and delegate the rest
- [ ] 5.2 Lazy-load Notebook Kit from a pinned ESM URL; debounce in-browser compiles
- [ ] 5.3 Thin host: echo and an empty host element; `upsert` on mount/update, `release` on unmount; CSS hiding static siblings in preview
- [ ] 5.3b Detect duplicate definitions in the reconcile batch (sharing 3.3b's name logic), mark every defining cell with an error, and skip defining them until resolved
- [ ] 5.4 Build the single-file preview component from the shared sources as a `.tsx` file with no static imports (S6)
- [ ] 5.5 Test key agreement: engine-emitted keys equal browser-computed keys over every example document

## 6. Examples and end-to-end verification

- [ ] 6.1 Examples: `ojs1` (viewof slider, mutable, named cells), `ojs2` (display, top-level declarations), a knitr + `ojs2` document using `ojs_define`, and a compile-error document
- [ ] 6.2 `q2 render` each example; inspect the HTML and check it in a browser (cells run, inputs work, the error doc shows the diagnostic and the other cells still run)
- [ ] 6.3 `q2 preview` each example: edit prose (no recompute), edit a cell (updates without re-execute), insert a paragraph above cells (no recompute), type a syntax error (last good output kept)
- [ ] 6.3b Observe a syntax error after clicking Re-execute in live preview, and after a save in `q2 preview --static`; record what the page shows, and whether R output from the same run is lost. If it's poor, consider softening via `isInteractiveSession`
- [ ] 6.4 Record the invocations and observed output for each check in a verification notes file

## 7. Write-up for the discussion

- [ ] 7.1 README: install, usage, the `ojs1`/`ojs2` naming and the Notebook Kit modes they map to, and `render-components:` setup
- [ ] 7.2 Document the gaps: bare `{ojs}` (compatibility gap and the proposed `HANDLED_LANGUAGES` change), the `MermaidCodeBlock` override clash, the unhelpful error without the extension, no Shiny, and what the spikes found
- [ ] 7.3 Draft a summary for quarto-dev discussion #14877: what worked, which q2 surfaces were used, and the small core changes that would remove each gap. Include the cross-engine points: who provides `ojs_define` (knitr does; Jupyter doesn't), knitr's OJS detection and engine order, the `ojs-define` payload as a contract, the bare `{ojs}` alias, and a warning channel for TS engines

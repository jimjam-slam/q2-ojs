## 1. Setup and spikes

- [ ] 1.1 Build `q2` from `./q2` (`cargo build --bin q2`) and record the commit used; confirm `node` 24 is on PATH
- [ ] 1.2 Scaffold the extension (`_extensions/ojs/_extension.yml`, `src/`, `package.json` pinning `@observablehq/notebook-kit@2.8.0` exactly) plus an `examples/` q2 project
- [ ] 1.3 Spike: a minimal TS engine with static claims `ojs1`/`ojs2` that echoes its input; confirm `q2 render` resolves it for an `{ojs2}`-only doc and for `{r}` + `{ojs2}` (knitr cedes the cells)
- [ ] 1.4 Spike: check whether `TsHtmlDependency.scripts` can emit `type="module"`, and where html_dependency files land in the output; record the result in design.md
- [ ] 1.5 Spike: check whether Notebook Kit handles Observable 1.0 imports (`import {x} from "@d3/…"`) at runtime; record supported or unsupported
- [ ] 1.6 Spike: confirm a `render-components:` module can be a prebuilt `.js` file, import nothing but `window.React`, and override `CodeBlock`; note how it reaches the built-in `CodeBlock`

## 2. Shared core module

- [ ] 2.1 Write the cell-option parser (`//| echo`, `output`, `label`) and source normalization
- [ ] 2.2 Write the synchronous hash and the key function (hash + occurrence; label override), with unit tests for duplicates, labels, and option-line insensitivity
- [ ] 2.3 Write the mode mapping (`ojs1`→`ojs`, `ojs2`→`js`) and a `compileCell` wrapper around Notebook Kit `transpile` that returns either a definition or a structured error with a line number

## 3. Engine (render path)

- [ ] 3.1 Implement engine discovery/launch and `execute()`: scan the markdown for owned cells, leave everything else byte-identical
- [ ] 3.2 Emit the `.ojs-cell` markup (source block with key, mode and echo attributes; `.ojs-output`; `script.ojs-def` JSON, escaped for `<`)
- [ ] 3.3 Turn compile errors into engine warnings/diagnostics with the source line, and emit an error marker for that cell
- [ ] 3.4 Attach the static bootstrap and inspector CSS via `html_dependencies` only when the document has owned cells
- [ ] 3.5 Build the engine bundle (`q2 call build-ts-extension`, or rollup with the documented settings) and add engine unit tests over fixture markdown

## 4. Runtime bootstrap

- [ ] 4.1 Implement the `globalThis.__q2ojs` singleton around `NotebookRuntime`, with `upsert`/`release` and a microtask-scheduled reconcile
- [ ] 4.2 Implement the reconcile order: delete released/changed, define new, reparent output nodes, skip unchanged
- [ ] 4.3 Implement runtime-owned output nodes and last-good-definition with an error badge
- [ ] 4.4 Implement static initialization: scan `.ojs-cell` and define from `script.ojs-def` on DOM ready
- [ ] 4.5 Implement `ojs_define` intake from `script[type="ojs-define"]`, including Quarto 1's data-frame transpose
- [ ] 4.6 Implement disposal on page unload
- [ ] 4.7 Test the reconciler in jsdom or a headless browser: no-op batch, edit with dependent recompute, removal stopping a generator, host swap without recompute, duplicate-name safety
- [ ] 4.8 Bundle the bootstrap as one IIFE with inspector CSS

## 5. Preview integration

- [ ] 5.1 Implement the `CodeBlock` override: recognize `.ojs-source` and raw `{ojs1}`/`{ojs2}` blocks, and delegate the rest
- [ ] 5.2 Lazy-load Notebook Kit from a pinned ESM URL; debounce in-browser compiles
- [ ] 5.3 Thin host: echo and an empty host element; `upsert` on mount/update, `release` on unmount; CSS hiding static siblings in preview
- [ ] 5.4 Build the single-file preview component from the shared sources
- [ ] 5.5 Test key agreement: engine-emitted keys equal browser-computed keys over every example document

## 6. Examples and end-to-end verification

- [ ] 6.1 Examples: `ojs1` (viewof slider, mutable, named cells), `ojs2` (display, top-level declarations), a knitr + `ojs2` document using `ojs_define`, and a compile-error document
- [ ] 6.2 `q2 render` each example; inspect the HTML and check it in a browser (cells run, inputs work, the error doc shows the diagnostic and the other cells still run)
- [ ] 6.3 `q2 preview` each example: edit prose (no recompute), edit a cell (updates without re-execute), insert a paragraph above cells (no recompute), type a syntax error (last good output kept)
- [ ] 6.4 Record the invocations and observed output for each check in a verification notes file

## 7. Write-up for the discussion

- [ ] 7.1 README: install, usage, the `ojs1`/`ojs2` naming and the Notebook Kit modes they map to, and `render-components:` setup
- [ ] 7.2 Document the gaps: bare `{ojs}` (compatibility gap and the proposed `HANDLED_LANGUAGES` change), the `MermaidCodeBlock` override clash, the unhelpful error without the extension, no Shiny, and what the spikes found
- [ ] 7.3 Draft a summary for quarto-dev discussion #14877: what worked, which q2 surfaces were used, and the small core changes that would remove each gap

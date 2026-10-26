# End-to-end verification

What was checked by hand, how, and what was observed. Unit tests (`npm test`,
106 passing, 1 skipped) cover the logic; these notes cover real renders and
real browsers.

## Setup

- q2 nightly `0.36.0-nightly.20261024` (built from `ab976ef21`) and Node 24.22.1, in `.tools/`.
- Notebook Kit 2.8.0, d3-require 1.3.0, esbuild 0.28.2, jsdom 26.1.0 (pinned in `package.json`).
- R 4.5.2 with knitr 1.51 and rmarkdown 2.31. Jupyter isn't installed, so nothing here exercises Python or Julia.
- Environment for every command below:

  ```bash
  export PATH="$PWD/.tools/node/bin:$PWD/.tools/q2:$PATH" QUARTO_NODE="$PWD/.tools/node/bin/node"
  npm run build   # builds the engine, runtime and preview component; installs into examples/ and test/e2e/
  ```

- Browser checks used the Claude desktop app's built-in browser (Chromium). Rendered pages were served with esbuild's static server (`.claude/launch.json`); `q2 preview` with `.tools/q2-preview.sh`.
- Observable's runtime schedules work with `requestAnimationFrame`, so a page in a hidden browser pane looks stuck. Every check below was done with the page visible.

## Render: compile errors fail the render

```bash
q2 render test/e2e/syntax-errors.qmd
```
```
Error: Execution failed in ojs: 2 problems in OJS cells:
  …/test/e2e/syntax-errors.qmd:10:7: ojs2 cell: Unexpected token
  …/test/e2e/syntax-errors.qmd:14:8: ojs1 cell: Unexpected token
```
Both locations match the source (the first counts its `//| echo: false` line). An earlier build reported columns one too high, which is how q2's off-by-one source map inside code blocks was found (design S12).

```bash
q2 render test/e2e/duplicates.qmd
```
```
Error: Execution failed in ojs: 1 problem in OJS cells:
  `x` is defined in more than one cell (…/duplicates.qmd:6, …/duplicates.qmd:10)
```
Line 6 is `const x = 1;`, line 10 is `viewof x = …`: `viewof x` counts as defining `x`.

## Render: markup and runtime

```bash
q2 render test/e2e/markup.qmd
```
The HTML has three `.ojs-cell` Divs with `data-ojs-key`, `data-ojs-mode`, `data-ojs-echo` and `data-ojs-output` (one key is `label:summary:0`, from `//| label`), three `script.ojs-def` payloads that parse back into the compiled cells (`viewof$n` with `autoview: true`), and one `<script src="markup_files/libs/ojs-runtime/ojs-runtime.js">` and stylesheet. In the browser: the slider showed 4 and the `echo: false` cell showed 8 with no source; typing 7 into the slider's field updated the cell to 14; the `output: false` cell showed nothing.

## Render: examples

```bash
q2 render examples/ojs1.qmd
q2 render examples/ojs2.qmd
q2 render examples/knitr-ojs-define.qmd
```

**`ojs1.qmd`** (Observable 1.0 syntax). The `viewof radius` slider drives `area = 1257` and an SVG circle; `mutable clicks` with a button: two clicks gave "The button has been clicked 2 times."; `require("d3-array@3")` loaded (the shim), `sum` gave 10; `import {chart} from "@d3/bar-chart"` drew the notebook's chart, 26 bars, 782 px wide. That last cell first failed with `Failed to execute 'observe' on 'ResizeObserver'`: Notebook Kit looks up the element `width` measures when its module loads, which on a rendered page is before `<main>` or `<body>` exist. The runtime now overrides `width` to look it up on first use.

**`ojs2.qmd`** (Observable JavaScript). "Mean: 17.8°"; a `view(Inputs.range(…))` threshold; "3 of 6 days at or above 18°"; a Plot bar chart (6 bars, threshold rule); `import {median} from "npm:d3-array"` gave "Median: 18°". Setting the threshold to 22 gave "1 of 6 days at or above 22°" and exactly one highlighted bar.

**`knitr-ojs-define.qmd`** (R → OJS, `engine: [knitr, ojs]`). R's data frame arrived column-oriented (`Object {mpg: Array(3), cyl: Array(3), …}`); `transpose(cars)` gave three rows; "First row: 21 mpg, 6 cylinders".

**Website** (`.tools/site-test`, `output-dir: _site`, one page in a subfolder): one runtime copy in `_site/site_libs/libs/ojs-runtime/`, linked as `../site_libs/…` from the nested page; a page without OJS doesn't load it; nothing left in the source tree.

## Live preview (`q2 preview`)

`examples/preview.qmd` (mermaid, a `viewof` slider, an `echo: false` cell, a dependent cell; `render-components: [\_extensions/ojs/dist/ojs-preview.tsx]`). Each check confirmed the same iframe (a marker on its window survived) and, where noted, the same slider `<input>` element.

| Action | Observed |
|---|---|
| Open the page | Mermaid drew; slider 4; hidden-source cell 8; "n squared is 16" |
| Slider to 7 | 14; "n squared is 49" |
| Edit prose above the cells | Same slider element, still 7; same cell keys |
| Insert a paragraph above the cells | Same slider element, still 7 (failed before the registry fix: design S14) |
| Change `n * n` to `n * n * n` | "n cubed is 343", without re-executing; slider untouched |
| Type a syntax error | Badge "SyntaxError: Unexpected token (line 3, column 16)" over the last good output, 14 |
| Add a second `const doubled` | Both cells marked "`doubled` is defined in more than one cell", both kept their output |
| Remove it | Both badges cleared |
| Re-execute | Banner cleared, slider kept its value |

`examples/knitr-ojs-define.qmd` in live preview: "First row: 21 mpg, 6 cylinders". The `ojs_define` payload reaches the preview through the capture's header includes. The preview never showed the engine's form of a cell (`.ojs-source` with `data-ojs-key`), even after Re-execute: every host registered in the raw form.

## Errors that reach the engine during preview (task 6.3b)

| Case | Observed |
|---|---|
| Live preview, typing a syntax error | Handled in the browser: badge over the last good output (above) |
| Live preview, single-engine page with an OJS syntax error | Source shown, a Warning badge; details: "[Q-PREVIEW-CAP-1] Engine capture failed … Execution failed in ojs: 1 problem in OJS cells: …/ojs-error-only.qmd:8:7: ojs2 cell: Unexpected token" |
| Live preview, single-engine page with an R error (`stop()`) | Source shown, a Warning badge; no crash |
| Live preview, `engine: [knitr, ojs]` page, syntax error in an OJS cell, then Re-execute | **The preview app crashed** to a blank page: "Minified React error #31 … object with keys {val}" in q2's preview UI (`meta-*.js`), not in this extension's code |
| Live preview, the same page with an R error instead (OJS fine) | **Same crash** on load |
| `q2 preview --static`, the same page with an OJS syntax error, on open | The render failed with "…/knitr-ojs-define.qmd:22:40: ojs2 cell: Unexpected token" **in the terminal only**; the browser showed the unexecuted page (all cells as source, R's output lost) with no error indication |

So the crash appears only when a multi-engine document's capture fails, whichever engine fails; each engine failing alone is handled. Without Jupyter, `[knitr, jupyter]` wasn't tried, so "any multi-engine document" is a likely but untested generalization. The rule that compile errors fail the render stays: the problems are in q2's handling of a failed multi-engine capture and its static-mode fallback, and softening our engine via `isInteractiveSession` would only hide them.

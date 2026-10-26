# Observable JavaScript for Quarto 2

A proof-of-concept engine extension that brings Observable JavaScript (OJS) to
[Quarto 2 (q2)](https://github.com/quarto-dev/q2), built on Observable's
[Notebook Kit](https://github.com/observablehq/notebook-kit). It was written to
test, for [quarto-dev discussion #14877](https://github.com/orgs/quarto-dev/discussions/14877),
whether OJS can live entirely in a third-party extension. The short answer:
mostly yes, with a handful of small q2 changes that would close the gaps
listed below.

> [!WARNING]
> This is a proof of concept, built against a q2 nightly
> (`0.36.0-nightly.20261024`). q2 is pre-release and its extension surfaces
> are changing.

## What it does

- Two cell languages:
  - **`{ojs1}`**: the syntax of original Observable notebooks and Quarto 1's
    `{ojs}` cells (`viewof`, `mutable`, named cells, notebook imports),
    compiled with Notebook Kit's `ojs` mode.
  - **`{ojs2}`**: Observable JavaScript, the language of Observable
    Notebooks 2.0 (plain JavaScript; top-level declarations are reactive,
    `display()` shows values), compiled with Notebook Kit's `js` mode.
- Cells are compiled at render time. **Syntax errors and names defined in more
  than one cell fail the render**, with `file:line:column` for each problem.
- Rendered pages run cells with Notebook Kit's runtime, shipped with the page
  (one script, shared across a website in `site_libs`), so the runtime itself
  needs no network.
- Mixes with R: `ojs_define()` in knitr cells passes data to OJS cells.
- **Live preview**: with the preview component, cells run in `q2 preview` and
  update as you edit, keeping state (like a slider's value) across unrelated
  edits.

## Requirements

- q2 with TypeScript engine extensions (tested with nightly
  `0.36.0-nightly.20261024`).
- Node.js 24 or newer, which q2 uses to run TypeScript engines. Point
  `QUARTO_NODE` at it if it isn't first on your `PATH`.

## Installing

Use q2's `q2 add`, from your project's folder (for a single document outside a
project, from the document's folder):

```bash
q2 add jimjam-slam/q2-ojs        # from GitHub
q2 add path/to/q2-ojs            # from a local checkout or a .zip/.tar.gz of one
```

Where it lands matters for live preview (see below):

| Installed from | Installed to |
|---|---|
| GitHub (`q2 add jimjam-slam/q2-ojs`) | `_extensions/jimjam-slam/ojs/` |
| A local folder or archive | `_extensions/ojs/` |

Copying `_extensions/ojs/` into your project's `_extensions/` folder by hand
works too. The built files in `_extensions/ojs/dist/` are committed, so no
build step is needed. (The TypeScript sources in `src/` come along; nothing
uses them at render time.)

Quarto 1's `quarto add` won't install it: Quarto 1's extension schema rejects
the static engine keys q2 uses (`name`, `claims` and so on). `q2 install` is
only for TinyTeX and Chromium.

## Writing cells

````markdown
```{ojs1}
viewof radius = Inputs.range([5, 50], {value: 20, label: "Radius"})
```

```{ojs2}
const area = Math.PI * radius ** 2;
display(`Area: ${area.toFixed(0)}`);
```
````

Cell options go in `//|` lines at the top of a cell:

| Option | Effect |
|---|---|
| `//| echo: false` | Hide the source; the cell still runs. |
| `//| output: false` | Hide the cell's values. Errors are still shown. |
| `//| label: name` | Give the cell a stable identity, so live preview keeps its state while you edit it. |

Libraries: the standard library provides `d3`, `Plot`, `Inputs`, `htl`, `md`,
`tex` and more. In `{ojs2}` cells, import from npm with
`import {median} from "npm:d3-array"`. In `{ojs1}` cells, static `import`
loads Observable notebooks (`import {chart} from "@d3/bar-chart"`), as it did
in Quarto 1; use `require("d3-array@3")` (UMD packages) or
`import("https://…")` for npm packages.

### Data from R

````markdown
---
engine: [knitr, ojs]
---

```{r}
ojs_define(cars = head(mtcars, 3))
```

```{ojs1}
rows = transpose(cars)
```
````

As in Quarto 1, data frames arrive column-oriented and `transpose()` turns them
into rows. **The `engine: [knitr, ojs]` line is required** for `ojs_define`:
see the known gaps below.

### Live preview (optional)

Rendered pages, and `q2 preview --static`, work without any extra setup. The
live `q2 preview` is different: it draws pages in the browser and doesn't
re-run engines as you type, so on its own it shows OJS cells as plain code.

Adding the preview component makes OJS cells run in live preview too:

- cells update as you edit, without re-executing anything;
- inputs keep their state (a slider's value, say) across unrelated edits;
- a cell that stops compiling while you type keeps its last good output under
  an error badge.

Add it to the front matter of each document you want to preview this way
(`_quarto.yml` doesn't work for this yet; see the known gaps):

```yaml
render-components:
  - \_extensions/ojs/dist/ojs-preview.tsx
```

The path is relative to the document and depends on where the extension was
installed: from GitHub, it's `\_extensions/jimjam-slam/ojs/dist/ojs-preview.tsx`.
For a document in a subfolder, start it from the project root with a `/`
(`/\_extensions/ojs/dist/ojs-preview.tsx`).

Keep the backslash before the leading `_`. q2 parses front-matter strings as
markdown, quoted or not, so `"_extensions/…"` starts emphasis and fails; the
backslash escapes it.

The first time a page with OJS cells is previewed, Notebook Kit is loaded from
jsDelivr (pinned to 2.8.0), so live preview needs the network at that point.

## Known gaps

**Needs a small q2 change to fix:**

- **Bare `{ojs}` cells aren't supported.** q2 removes `ojs` from engine
  resolution (`HANDLED_LANGUAGES = ["ojs", "mermaid", "dot"]` in
  `crates/quarto-core/src/engine/mod.rs`), so no extension can claim it. Quarto 1
  documents render their OJS cells as plain code blocks, with no warning.
  Renaming to `{ojs1}` works; removing `"ojs"` from that list would let this
  extension claim it as an alias.
- **`ojs_define` from R needs `engine: [knitr, ojs]`.** In an implicit engine
  sequence, q2 runs extension engines before knitr, and knitr only defines
  `ojs_define()` when it sees `{ojs…}` cells, which this engine has already
  replaced. Without the line, R fails with `could not find function
  "ojs_define"`.
- **`ojs_define` from Python or Julia isn't available.** Quarto 1 installed it
  into Jupyter kernels; q2's Jupyter engine doesn't. (Not tested: Jupyter
  wasn't available here.)
- **Errors are all-or-nothing at render time.** q2 drops warnings from
  TypeScript engines, so the engine can't report a problem without failing the
  render.
- **The preview component must be listed in each document's front matter.**
  Neither route that should make it automatic reaches the live preview yet.
  `contributes: metadata: render-components:` in `_extension.yml` merges into
  every document (`q2 get-config` shows it), and so does `render-components:` in
  `_quarto.yml`, but the preview ignores both. Two small q2 changes would fix it:
  - add `render-components` to `FORMAT_PATH_KEYS`
    (`crates/quarto-core/src/project/format_paths.rs`), as `components` already
    is, so an extension-relative path like `dist/ojs-preview.tsx` is rebased; a
    project-root path would otherwise depend on where the extension was
    installed (`q2 add jimjam-slam/q2-ojs` installs to
    `_extensions/jimjam-slam/ojs/`);
  - make the preview read plain strings as well as markdown. Front-matter
    strings are parsed as markdown, but `_quarto.yml` and `_extension.yml`
    values are kept literal (q2's `InterpretationContext`), and the preview
    only reads markdown inlines (`.c[0].c` in `extractRenderComponentPaths`,
    `ts-packages/preview-renderer/src/utils/renderComponents.ts`), so it
    silently drops paths from either file.

  With both, this extension's `_extension.yml` could contribute the component,
  and every document in a project with the extension installed would get live
  preview without any setup.
- **Live preview crashes when a multi-engine document fails.** If a document with
  `engine: [knitr, ojs]` has an error in either engine, q2's preview UI goes blank
  ("Minified React error #31"). Single-engine failures are handled fine.
- **`q2 preview --static` hides render errors.** The page falls back to its
  unexecuted form (all output, including R's, missing), and the error only
  appears in the terminal.
- **Without the extension installed**, `{ojs1}`/`{ojs2}` fall back to Jupyter,
  and the error doesn't mention OJS: "Engine 'jupyter' is registered but its
  runtime is not available…".

**Limits of this proof of concept:**

- HTML output only; other formats show the code.
- No inline `` ${…} `` expressions in prose, and no `panel`, `layout` or figure
  cross-references for cells.
- Notebook Kit's standard library (`d3`, `Plot`, `Inputs` and others) loads
  from jsDelivr when first used, without version pins, so cells that use it
  need the network.
- `require` only loads UMD/AMD packages (as in Quarto 1).
- No Shiny (`server: shiny`) support.
- TypeScript in cells isn't type-checked (Notebook Kit strips types).
- Live preview always compiles cells in the browser; it never showed the
  engine's compiled form of a cell in testing.

**Resolved along the way:** the preview component overrides q2's `CodeBlock`,
which originally risked breaking mermaid diagrams; it hands non-OJS blocks back
to q2's built-in (`window.__Q2_PREVIEW_RENDERER__.previewRegistry.CodeBlock`), so
mermaid still works. That relies on an experimental q2 global.

## Building from source

```bash
npm install
npm run build   # engine (q2's bundler), page runtime and preview component (esbuild)
npm test        # unit tests (node --test); the runtime tests use jsdom
```

`npm run build` needs `q2` on `PATH`, at `.tools/q2/q2`, or named in `Q2`. It
also installs the built extension into `examples/` and `test/e2e/` for
rendering. `OJS_DEBUG_BUILD=1 npm run build` keeps the bundles readable.

Layout:

| Path | What |
|---|---|
| `_extensions/ojs/src/ojs-engine.ts` | The engine: claims, compiling, errors, the runtime dependency |
| `_extensions/ojs/src/engine/` | Finding cells, the cell markup, error locations |
| `_extensions/ojs/src/shared/` | Cell options, cell keys and compiling, used by both the engine and the browser |
| `_extensions/ojs/src/runtime/` | The page runtime: one reconciler per page, built-ins, `ojs_define` |
| `_extensions/ojs/src/preview/` | The live-preview component and its host registry |
| `scripts/build.mjs` | Builds and installs everything |
| `examples/` | Example documents |
| `test/unit/`, `test/e2e/` | Unit tests; documents that should fail to render |
| `docs/verification.md` | What was checked end to end, and what was seen |
| `openspec/changes/ojs-engine-extension-poc/` | Proposal, design (with every spike's findings), specs and tasks |

## Credits

Built on [Observable Notebook Kit](https://github.com/observablehq/notebook-kit)
and the [Observable runtime](https://github.com/observablehq/runtime), with
[d3-require](https://github.com/d3/d3-require) for Quarto 1's `require`.

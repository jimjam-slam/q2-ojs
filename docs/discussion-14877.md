# Draft: reply to quarto-dev discussion #14877

<!-- Paste from the line below. Links assume the repository is public at
     github.com/jimjam-slam/q2-ojs on `main`; check them after pushing. -->

I took the suggestions in this thread at face value and built a proof of
concept: **Observable JavaScript in Quarto 2 as a third-party engine
extension, on top of Observable's Notebook Kit**.
It's at [jimjam-slam/q2-ojs](https://github.com/jimjam-slam/q2-ojs).

**Short version:** it works. An extension can own compiling, running, live
preview and error reporting for OJS using surfaces q2 already has. A handful of
small q2 changes would close the remaining gaps, and the biggest ones are about
how *other* engines cooperate with OJS (mainly `ojs_define`), not about OJS
itself.

## What works

- **Two cell languages.** `{ojs1}` is Observable 1.0 / Quarto 1 syntax
  (`viewof`, `mutable`, named cells, notebook imports), compiled with Notebook
  Kit's `ojs` mode. `{ojs2}` is Observable JavaScript (Notebooks 2.0),
  compiled with its `js` mode. Notebook Kit handles both, so one compiler and
  one runtime cover old and new syntax. (`{ojs}` itself can't be claimed yet;
  see below.)
- **Compiling at render time.** Syntax errors and names defined in more than
  one cell fail the render with `file:line:column` for every problem.
- **Rendered pages need no network for the runtime.** Notebook Kit's runtime
  ships as one engine html dependency, so a website stores a single copy in
  `site_libs`.
- **R → OJS** with `ojs_define()` and Quarto 1's `transpose()`.
- **Live preview.** A `render-components:` `CodeBlock` override compiles cells
  in the browser, so edits show up without re-executing. Cells keep their
  state (a slider's value, say) across unrelated edits, including blocks
  shifting when you insert a paragraph. A cell that stops compiling keeps its
  last good output under an error badge. Mermaid keeps working.

The examples, and what I checked end to end, are in
[`docs/verification.md`](https://github.com/jimjam-slam/q2-ojs/blob/main/docs/verification.md).
The design, with the findings from each spike, is in
[`openspec/changes/ojs-engine-extension-poc/design.md`](https://github.com/jimjam-slam/q2-ojs/blob/main/openspec/changes/ojs-engine-extension-poc/design.md).

## q2 surfaces it uses

- TypeScript engine extensions (Node 24), with **static claims** in
  `_extension.yml` for `ojs1`/`ojs2`, and multi-engine ownership:
  knitr and Jupyter leave `{ojs1}`/`{ojs2}` cells alone without any special
  casing.
- The engine result's `htmlDependencies` (the runtime script and stylesheet)
  and the `MappedString` source map (for error locations).
- `render-components:` and `window.__Q2_PREVIEW_RENDERER__.previewRegistry` in
  the preview.
- knitr's existing `ojs_define()` and its `<script type="ojs-define">` header
  payload, unchanged from Quarto 1.

## Small q2 changes that would help

Roughly in order of impact:

1. **Let an extension claim `{ojs}`.** `HANDLED_LANGUAGES = ["ojs", "mermaid", "dot"]`
   removes `ojs` from engine resolution before claims are consulted. Today a
   Quarto 1 document's `{ojs}` cells silently render as code. Dropping `"ojs"`
   from that list would let this extension claim it as an alias.

2. **`ojs_define` and engine order.** In an implicit sequence, extension engines
   run before knitr. knitr only defines `ojs_define()` when a regex finds
   `` ```{ojs `` fences in the markdown it receives, and by then the OJS engine
   has replaced them. So documents need `engine: [knitr, ojs]`. Either an
   engine-ordering hint ("run after knitr and jupyter") or knitr's detection
   consulting language ownership instead of raw fences would fix it.

3. **`ojs_define` for Python and Julia.** Quarto 1 injected `ojs_define` into
   Jupyter kernels (`resources/jupyter/lang/python/setup.py`). As far as I can
   tell, q2's Jupyter engine doesn't, so Python and Julia can't pass data to
   OJS. (I couldn't run Jupyter to confirm.) More broadly, if OJS is meant to
   live in an extension, `ojs_define` might be better owned by the language
   packages users install (the `quarto` R and Python packages), with the
   `<script type="ojs-define">{"contents": [{"name", "value"}]}` payload
   written down as a contract between engines.

4. **A warning channel for TypeScript engines.** `ts_engine.rs` currently
   drops engine warnings (`warnings: Vec::new()`), and `[WARN]` stderr lines
   only show with `RUST_LOG`. So a TS engine can either fail the render or stay
   silent. I'd have reported unresolved names as warnings if I could.

5. **Live preview robustness.**
   - When a multi-engine document's capture fails (an error in either engine of
     `[knitr, ojs]`), the preview UI crashes to a blank page with "Minified React
     error #31 … object with keys {val}". Single-engine failures show a proper
     Warning instead.
   - `q2 preview --static` shows the unexecuted page when a render fails, with
     the error only in the terminal.
   - I never saw the preview splice this engine's captured output: OJS blocks
     always arrived raw, even after Re-execute. That's fine here, since the
     preview compiles in the browser, but I'm not sure it's intended.

6. **Extension-contributed preview components.** Documents currently have to
   list the component in `render-components:` themselves (as
   `\_extensions/…`, since front matter is parsed as markdown). The
   `components:` preview half (bd-s73m7at2) or an extension `contributes` key
   would remove that, and avoid relying on the experimental
   `__Q2_PREVIEW_RENDERER__` global.

7. **Minor:** inside code blocks, the engine `MappedString` maps every offset
   one character later than the source (the engine works around it by mapping
   only the fence line), and a better message when no installed engine claims a
   language would help: today an uninstalled `{ojs2}` reports that Jupyter's
   runtime is missing.

## Notes for Notebook Kit

@mbostock, in case it's useful, Notebook Kit worked well, and its transpiler
running in both Node and the browser was what made live preview simple. Things
I had to work around to ship it inside someone else's page:

- **`width` looks up its element when the module loads**
  (`document.querySelector("main") ?? document.body`), so it's `null` when the
  runtime loads in `<head>`. I override `width` to look it up on first use.
- **Bundling into a classic script.** Several stdlib modules (`inputs`, `tex`,
  `dot`, `leaflet` and others) statically import from jsDelivr, and `dot` and
  `leaflet` use top-level `await`. Since they're only loaded with `import()`,
  I point those imports at Notebook Kit's own copies on jsDelivr, pinned to
  2.8.0.
- **Unpinned CDN versions.** Most of the stdlib loads `…/npm/d3/+esm` and so on
  without a version, so a page can pick up a new major version silently.
- **`require` is gone** from the stdlib, which Quarto 1 documents used a lot; I
  added it back with d3-require.

None of these blocked anything, and they may well be deliberate for Notebook
Kit's own use.

Happy to adjust any of this, or to turn individual items into issues or pull requests.

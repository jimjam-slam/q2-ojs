## ADDED Requirements

### Requirement: Static language claims for ojs1 and ojs2
The extension SHALL declare an engine in `_extension.yml` with static claims `ojs1: primary` and `ojs2: primary`, so q2 resolves ownership without loading the engine.

#### Scenario: Document with only OJS cells
- **WHEN** a `.qmd` with no `engine:` key contains only `{ojs2}` cells and the extension is installed
- **THEN** q2 resolves the engine sequence to the OJS engine alone and `q2 render` runs it

#### Scenario: Both languages in one document
- **WHEN** a document contains `{ojs1}` and `{ojs2}` cells
- **THEN** both languages are owned by the OJS engine

### Requirement: Mode mapping
The engine SHALL compile `{ojs1}` cells with Notebook Kit mode `ojs` and `{ojs2}` cells with Notebook Kit mode `js`.

#### Scenario: Observable 1.0 syntax in ojs1
- **WHEN** an `{ojs1}` cell contains `viewof x = Inputs.range([0, 10])`
- **THEN** the compiled definition declares output `viewof x` and the derived value `x` is available to other cells

#### Scenario: Observable JavaScript in ojs2
- **WHEN** an `{ojs2}` cell contains `const y = 2 * 3;`
- **THEN** the compiled definition declares output `y`

### Requirement: Cell markup emitted at render
For each owned cell the engine SHALL replace the cell with a `.ojs-cell` Div carrying `data-ojs-key` and `data-ojs-mode`. The Div SHALL contain a `.ojs-source` CodeBlock (with the same key and mode attributes, and `data-echo`), an empty `.ojs-output` element, and a `script.ojs-def` element holding the compiled definition as JSON. Content outside owned cells SHALL pass through unchanged.

#### Scenario: Echoed cell
- **WHEN** a cell has no `//| echo` option
- **THEN** the `.ojs-source` block has `data-echo="true"` and its source excludes `//|` option lines

#### Scenario: Hidden source
- **WHEN** a cell has `//| echo: false`
- **THEN** the `.ojs-source` block has `data-echo="false"` and the rendered page doesn't show the source

#### Scenario: Output suppressed
- **WHEN** a cell has `//| output: false`
- **THEN** the cell's definition runs and its value isn't displayed (errors still are; see `ojs-runtime`)

### Requirement: Stable cell keys
The engine SHALL compute each cell's key as a hash of its normalized source plus an occurrence index among earlier cells with the same hash, in document order. A `//| label` option SHALL override it. The hash and normalization SHALL come from the module shared with the browser code.

#### Scenario: Duplicate cells
- **WHEN** two cells have identical source
- **THEN** their keys share the hash and differ in occurrence index (`:0`, `:1`)

#### Scenario: Labelled cell
- **WHEN** a cell has `//| label: chart`
- **THEN** its key is derived from `chart` and doesn't change when its source is edited

### Requirement: Compile errors fail the render
When any owned cell fails to compile, the engine SHALL fail the render with an error naming the source file, and the line and column in that file (the cell's position plus Notebook Kit's in-cell location). When a document has several broken cells, the error SHALL list all of them. Live-preview edits are compiled in the browser instead (see `ojs-preview`), so this requirement doesn't apply to them.

#### Scenario: Syntax error at render
- **WHEN** an `{ojs2}` cell starting on line 12 of `doc.qmd` contains `const = ;` on its second line
- **THEN** `q2 render` fails, and the message includes `doc.qmd:13:7` and the parser's message

#### Scenario: Several broken cells
- **WHEN** two cells in one document fail to compile
- **THEN** the single render error lists both locations

#### Scenario: Valid document
- **WHEN** every owned cell compiles
- **THEN** the render succeeds, with no OJS output on stderr

### Requirement: Duplicate definitions fail the render
`{ojs1}` and `{ojs2}` cells share one namespace. When a name is defined by more than one owned cell, the engine SHALL fail the render with an error naming the duplicated name and the `file:line` of every cell that defines it. `viewof x` and `mutable x` SHALL count as defining both their own name and `x`. Duplicate definitions and compile errors in the same document SHALL be reported together in one error. Names supplied by `ojs_define` are not known at render time and are not part of this check.

#### Scenario: Same name in two cells
- **WHEN** a document has `const x = 1;` in one `{ojs2}` cell and `const x = 2;` in another
- **THEN** `q2 render` fails, naming `x` and both cells' locations

#### Scenario: Across ojs1 and ojs2
- **WHEN** an `{ojs1}` cell defines `x = 1` and an `{ojs2}` cell defines `const x = 2;`
- **THEN** the render fails with the duplicate-name error

#### Scenario: viewof clashes with its value name
- **WHEN** one cell defines `viewof x = Inputs.range([0, 1])` and another defines `x = 5`
- **THEN** the render fails, naming `x`

#### Scenario: Reported with compile errors
- **WHEN** a document has a duplicated name and a cell with a syntax error
- **THEN** one render error lists both problems

#### Scenario: Unresolved names don't fail the render
- **WHEN** a cell references `cars`, which no OJS cell defines
- **THEN** the render succeeds; whether `cars` exists is checked in the browser (see `ojs-runtime`)

### Requirement: Bootstrap delivery
When at least one owned cell exists, the engine SHALL attach the static runtime bootstrap and inspector CSS to the page through `html_dependencies`. Otherwise it SHALL attach nothing.

#### Scenario: Page with OJS cells
- **WHEN** a document with OJS cells is rendered
- **THEN** the output HTML loads the bootstrap script and inspector stylesheet once

#### Scenario: Page without OJS cells
- **WHEN** another page in the same project has no OJS cells
- **THEN** that page loads no OJS assets

### Requirement: Coexistence with other engines
The engine SHALL leave every cell not in its owned languages exactly as received.

#### Scenario: knitr and ojs2 together
- **WHEN** a document has `{r}` cells and `{ojs2}` cells and both engines are available
- **THEN** knitr runs the `{r}` cells, the OJS engine compiles the `{ojs2}` cells, and both outputs appear in document order

#### Scenario: ojs_define needs knitr first (known limitation)
- **WHEN** a document calls `ojs_define()` in an `{r}` cell without declaring an engine order
- **THEN** rendering fails because knitr runs after the OJS engine and never defines `ojs_define()`; declaring `engine: [knitr, ojs]` makes it work

#### Scenario: Bare ojs cell is untouched
- **WHEN** a document contains a bare `{ojs}` cell
- **THEN** the OJS engine doesn't process it, and it renders as a plain code block (documented compatibility gap)

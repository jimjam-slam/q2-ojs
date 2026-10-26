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
- **THEN** the cell's definition runs but nothing is displayed in its output root

### Requirement: Stable cell keys
The engine SHALL compute each cell's key as a hash of its normalized source plus an occurrence index among earlier cells with the same hash, in document order. A `//| label` option SHALL override it. The hash and normalization SHALL come from the module shared with the browser code.

#### Scenario: Duplicate cells
- **WHEN** two cells have identical source
- **THEN** their keys share the hash and differ in occurrence index (`:0`, `:1`)

#### Scenario: Labelled cell
- **WHEN** a cell has `//| label: chart`
- **THEN** its key is derived from `chart` and doesn't change when its source is edited

### Requirement: Compile diagnostics
The engine SHALL report a cell that fails to compile as a render diagnostic naming the source file and the cell's line, and SHALL emit an error marker in place of that cell's definition. Other cells SHALL still render.

#### Scenario: Syntax error
- **WHEN** an `{ojs2}` cell contains `const = ;`
- **THEN** `q2 render` reports an error that points at that cell's line, and the page shows the other cells working

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

#### Scenario: Bare ojs cell is untouched
- **WHEN** a document contains a bare `{ojs}` cell
- **THEN** the OJS engine doesn't process it, and it renders as a plain code block (documented compatibility gap)

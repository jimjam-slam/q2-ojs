## ADDED Requirements

### Requirement: Preview component via render-components
The extension SHALL ship a single-file preview component that a document lists under `render-components:`. Its `CodeBlock` export handles OJS cells and passes every other CodeBlock to q2's built-in `CodeBlock`.

#### Scenario: Non-OJS code block
- **WHEN** the preview renders a `{r}` or plain fenced code block
- **THEN** it looks the same as without the component

### Requirement: Recognize both cell forms
The component SHALL host a cell when it sees either an `.ojs-source` CodeBlock (engine capture current) or a raw `{ojs1}`/`{ojs2}` CodeBlock (capture missing or stale).

#### Scenario: Fresh preview of a rendered document
- **WHEN** the preview shows a document whose engine capture matches the source
- **THEN** each `.ojs-source` block is hosted using its `data-ojs-key` and `data-ojs-mode`

#### Scenario: Cell edited in preview
- **WHEN** the user edits an `{ojs2}` cell and the preview shows the raw cell
- **THEN** the component computes the key with the shared hash, compiles in the browser, and the output updates without re-executing engines

### Requirement: In-browser compile with debounce
The component SHALL compile cell source in the browser with the same Notebook Kit version as the engine, loaded lazily the first time a page has OJS cells, and SHALL debounce compiles while the user types.

#### Scenario: Page without OJS
- **WHEN** a previewed page has no OJS cells
- **THEN** Notebook Kit is never loaded

#### Scenario: Rapid typing
- **WHEN** the user types several characters in quick succession in an OJS cell
- **THEN** the cell is compiled once after typing pauses, not once per keystroke

### Requirement: Duplicate definitions while editing
Live-preview edits never reach the engine, so the preview SHALL detect a name defined by more than one cell itself, and SHALL show an error on every cell defining it, naming the name. It SHALL NOT define the duplicates in the runtime. When the duplicate is removed, the remaining cell SHALL run normally.

#### Scenario: Duplicate typed in preview
- **WHEN** the user adds `const x = 2;` in a new cell while another cell defines `x`
- **THEN** both cells show an error naming `x`, and neither crashes the preview

#### Scenario: Duplicate removed
- **WHEN** the user deletes one of the two cells defining `x`
- **THEN** the error clears and the remaining cell runs

### Requirement: Key agreement with the engine
For the same cell source and position, the key computed in the preview SHALL equal the key the engine emits at render.

#### Scenario: Capture current then missed
- **WHEN** a cell is hosted first from its `.ojs-source` form, then from its raw form with identical source
- **THEN** the key is unchanged and the cell is not redefined

### Requirement: Thin host
The component SHALL render the echo (unless `echo` is false) and one empty host element, and SHALL use only the runtime's `upsert` on mount or update and `release` on unmount.

#### Scenario: Index-shifted re-render
- **WHEN** a paragraph is inserted above several OJS cells, so React passes different nodes to existing component instances
- **THEN** each instance releases its old key and upserts its new one in the same batch, and no cell recomputes

### Requirement: Hide static-only markup in preview
In preview, the static `.ojs-output` and `script.ojs-def` siblings SHALL NOT be visible or used.

#### Scenario: Capture-current cell
- **WHEN** a `.ojs-cell` Div from the engine capture is shown in preview
- **THEN** only the hosted output appears, with no empty static output box

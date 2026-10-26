## ADDED Requirements

### Requirement: Single runtime per page
The bootstrap SHALL create at most one Notebook Kit runtime per page. It SHALL store it on `globalThis` so re-imported modules reuse it instead of creating another.

#### Scenario: Module evaluated twice
- **WHEN** the bootstrap module is evaluated a second time in the same page
- **THEN** it reuses the existing runtime, and cells are not defined twice

### Requirement: Host API
The runtime SHALL expose `upsert(key, definitionOrSource, hostElement)` and `release(key)` as the only ways hosts change cells. Hosts SHALL NOT call Notebook Kit `define` directly.

#### Scenario: Host registers a cell
- **WHEN** a host calls `upsert` with a new key
- **THEN** the cell is defined at the next reconcile and its output appears in the host element

### Requirement: Batched reconciliation
The runtime SHALL collect upserts and releases and apply them in a single synchronous reconcile per microtask. Inside it, it SHALL delete released and changed cells' variables before defining new ones, and SHALL leave unchanged keys alone.

#### Scenario: Prose edited above cells
- **WHEN** all hosts re-register the same keys and definitions after a re-render
- **THEN** no variables are deleted or redefined, and `viewof` input state is kept

#### Scenario: Cell edited
- **WHEN** a cell defining `x` changes so that its key changes in the same batch
- **THEN** the old variables are deleted before the new ones are defined, no "defined more than once" error appears, and cells depending on `x` recompute with the new value

#### Scenario: Cell removed
- **WHEN** a key is released and not upserted again in the same batch
- **THEN** its variables are deleted and its `invalidation` promise resolves, stopping its generators and timers

### Requirement: Runtime-owned output nodes
The runtime SHALL create and own each cell's output node, and SHALL attach it to whichever host element was last registered for that key. Moving a cell between hosts SHALL NOT redefine it.

#### Scenario: Host element replaced
- **WHEN** React replaces the host element for an unchanged key
- **THEN** the existing output node is moved into the new host, with no recompute

### Requirement: Last-good-definition on compile error
When a definition for an existing key fails to compile, the runtime SHALL keep the previous definition running and mark the cell with a visible error. A key with no previous definition SHALL display the error.

#### Scenario: Typing mid-expression
- **WHEN** a previously valid cell gets a syntax error while being edited
- **THEN** its last valid output stays, an error badge shows on that cell, and dependent cells don't fail

### Requirement: Static page initialization
On a rendered page the bootstrap SHALL reconcile all `.ojs-cell` elements once after the DOM is ready, using their `script.ojs-def` payloads, without loading a transpiler.

#### Scenario: Static render
- **WHEN** a rendered HTML page with OJS cells is opened in a browser
- **THEN** every cell's output appears in its `.ojs-output`, and no transpiler code is loaded

### Requirement: ojs_define data intake
The runtime SHALL read every `script[type="ojs-define"]` on the page and define each named value as a variable available to cells. Data frames SHALL be converted to row arrays as Quarto 1 did.

#### Scenario: R data frame to OJS
- **WHEN** an `{r}` cell calls `ojs_define(cars = mtcars)` and an `{ojs2}` cell references `cars`
- **THEN** `cars` is an array of row objects in the OJS cell

### Requirement: Disposal
The runtime SHALL dispose itself when the page unloads or the preview navigates to another document, and SHALL NOT dispose on content updates.

#### Scenario: Preview navigation
- **WHEN** the preview switches to a different document
- **THEN** the old runtime is disposed and its generators stop

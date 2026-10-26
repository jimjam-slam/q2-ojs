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

### Requirement: Run-time errors display in the cell
When a cell's evaluation fails (a thrown error, a rejected promise, a failed import, or an upstream failure), the runtime SHALL display the error in that cell's output, styled as an error, and SHALL log it to the console. A cell that depends on a failed cell SHALL show an error carrying the upstream message.

#### Scenario: Thrown error
- **WHEN** an `{ojs2}` cell runs `throw new Error("boom");`
- **THEN** the cell shows `Error: boom` styled as an error, and the console logs it

#### Scenario: Dependent of a failed cell
- **WHEN** cell `a` throws `Error("upstream")` and another cell computes `a + 1`
- **THEN** the second cell shows an error containing `upstream`

#### Scenario: Failed import
- **WHEN** a cell imports a URL that doesn't exist
- **THEN** the cell shows the import failure

### Requirement: Errors always show
An error in a cell SHALL be displayed even when the cell sets `//| output: false` or `//| echo: false`. `output: false` hides only successful values, and `echo: false` hides only the source.

#### Scenario: Hidden output, failing cell
- **WHEN** a cell with `//| output: false` throws
- **THEN** its error is displayed where its output would be

#### Scenario: Hidden output, working cell
- **WHEN** a cell with `//| output: false` succeeds
- **THEN** nothing is displayed for it

#### Scenario: Hidden source, failing cell
- **WHEN** a cell with `//| echo: false` throws
- **THEN** its error is displayed, and its source stays hidden

### Requirement: Unresolved names are checked in the browser
Whether a referenced name exists SHALL be decided at run time, after `ojs_define` data has been read. A reference resolves if another cell defines it, an `ojs_define` payload supplies it, or it is a runtime built-in or browser global. A reference that doesn't resolve SHALL be shown as an error in the referencing cell, naming the missing name, and SHALL NOT fail the render.

#### Scenario: Name from ojs_define
- **WHEN** an `{ojs2}` cell references `cars`, and an `{r}` cell called `ojs_define(cars = …)`
- **THEN** `cars` resolves, and no error is shown

#### Scenario: Typo
- **WHEN** a cell references `windw.innerWidth`
- **THEN** that cell shows an error saying `windw` is not defined, and other cells run normally

### Requirement: Static page initialization
On a rendered page the bootstrap SHALL reconcile all `.ojs-cell` elements once after the DOM is ready, using their `script.ojs-def` payloads, without loading a transpiler.

#### Scenario: Static render
- **WHEN** a rendered HTML page with OJS cells is opened in a browser
- **THEN** every cell's output appears in its `.ojs-output`, and no transpiler code is loaded

### Requirement: ojs_define data intake
The runtime SHALL read every `script[type="ojs-define"]` on the page (Quarto 1's payload, `{"contents": [{"name": …, "value": …}]}`) and define each named value, unchanged, as a variable available to cells. As in Quarto 1, data frames arrive column-oriented (`{column: [values]}`), and the runtime SHALL provide a `transpose` built-in that turns them into an array of row objects.

#### Scenario: R data frame to OJS
- **WHEN** an `{r}` cell calls `ojs_define(cars = head(mtcars, 3))` and an `{ojs2}` cell references `cars`
- **THEN** `cars` is the column-oriented object `{mpg: [...], cyl: [...], …}`, and `transpose(cars)` is an array of 3 row objects

#### Scenario: Several payloads
- **WHEN** a page has two `ojs-define` scripts defining `a` and `b`
- **THEN** cells can reference both `a` and `b`

### Requirement: Disposal
The runtime SHALL dispose itself when the page unloads or the preview navigates to another document, and SHALL NOT dispose on content updates.

#### Scenario: Preview navigation
- **WHEN** the preview switches to a different document
- **THEN** the old runtime is disposed and its generators stop

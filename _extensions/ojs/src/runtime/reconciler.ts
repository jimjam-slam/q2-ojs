/**
 * The page runtime (design D5): one Notebook Kit runtime per page, holding
 * cells by stable key. Hosts (the static page, or the preview's React
 * components) only call `upsert` and `release`; changes are applied together
 * in one synchronous reconcile per microtask:
 *
 *   1. delete the variables of released and changed cells (resolving their
 *      `invalidation`, so generators and timers stop);
 *   2. define new and changed cells;
 *   3. move each cell's output node into its current host;
 *   4. leave unchanged cells alone (values and `viewof` state survive).
 *
 * Deleting before defining means a renamed or edited cell never briefly
 * coexists with its old self ("x is defined more than once").
 */

import { NotebookRuntime, inspectError, observe } from "@observablehq/notebook-kit/runtime";
import type { DefineState } from "@observablehq/notebook-kit/runtime";
import type { CellDefinition } from "../shared/compile.ts";
import type { Builtins } from "./builtins.ts";

export interface CellSpec {
  /** The compiled cell, or null when it failed to compile. */
  definition: CellDefinition | null;
  /** The compile error, shown when `definition` is null. */
  error?: string;
  /** `//| output: false` hides values but still shows errors. Default true. */
  output?: boolean;
}

export interface ReconcileStats {
  defined: number;
  deleted: number;
  moved: number;
  unchanged: number;
  /** Cells whose new source failed to compile, kept on their last good definition. */
  keptLastGood: number;
}

interface CellRecord {
  /** The runtime-owned output node, moved between hosts as needed. */
  node: HTMLDivElement;
  /** Compile errors: a badge over the last good output, or the only content. */
  badge: HTMLDivElement;
  /** Run-time errors, shown here when values are hidden (`output: false`). */
  errors: HTMLDivElement;
  /** Where Notebook Kit displays values (`state.root`). */
  values: HTMLDivElement;
  state: DefineState;
  /** The definition currently running, as JSON, or null if none. */
  running: string | null;
  output: boolean;
}

type Pending = { kind: "upsert"; spec: CellSpec; host: HTMLElement } | { kind: "release" };

// The runtime's Variable type isn't exported by Notebook Kit's runtime entry.
interface Variable {
  define(name: string, inputs: string[], value: () => unknown): Variable;
  delete(): void;
}

export class Reconciler {
  readonly notebook: NotebookRuntime;
  private readonly cells = new Map<string, CellRecord>();
  private pending = new Map<string, Pending>();
  private scheduled = false;
  private nextId = 1;
  private readonly data = new Map<string, Variable>();
  private disposed = false;

  constructor(builtins: Builtins) {
    this.notebook = new NotebookRuntime(builtins);
  }

  /** Register or update a cell; applied at the next reconcile. */
  upsert(key: string, spec: CellSpec, host: HTMLElement): void {
    this.pending.set(key, { kind: "upsert", spec, host });
    this.schedule();
  }

  /** Forget a cell; applied at the next reconcile (an upsert in the same batch wins). */
  release(key: string): void {
    this.pending.set(key, { kind: "release" });
    this.schedule();
  }

  /** Keys of the cells currently held. */
  keys(): string[] {
    return [...this.cells.keys()];
  }

  private schedule(): void {
    if (this.scheduled || this.disposed) return;
    this.scheduled = true;
    queueMicrotask(() => this.flush());
  }

  /** Apply pending changes now. Normally called from a microtask. */
  flush(): ReconcileStats {
    const stats: ReconcileStats = { defined: 0, deleted: 0, moved: 0, unchanged: 0, keptLastGood: 0 };
    const batch = this.pending;
    this.pending = new Map();
    this.scheduled = false;
    if (this.disposed) return stats;

    // 1. Delete. Nothing is defined until every deletion in the batch is done.
    const toDefine: [CellRecord, CellDefinition, string][] = [];
    const placements: [CellRecord, HTMLElement][] = [];
    for (const [key, change] of batch) {
      const existing = this.cells.get(key);
      if (change.kind === "release") {
        if (existing) {
          this.deleteVariables(existing);
          existing.node.remove();
          this.cells.delete(key);
          stats.deleted++;
        }
        continue;
      }
      const { spec, host } = change;
      const output = spec.output ?? true;
      const record = existing ?? this.createRecord(key);
      placements.push([record, host]);

      if (spec.definition === null) {
        // Compile error: keep any running definition (last good), show the error.
        this.showBadge(record, spec.error ?? "This cell failed to compile.");
        if (record.running !== null) stats.keptLastGood++;
        continue;
      }
      this.hideBadge(record);
      const json = JSON.stringify(spec.definition);
      if (existing && json === record.running && output === record.output) {
        stats.unchanged++;
        continue;
      }
      if (existing) this.deleteVariables(record);
      record.output = output;
      toDefine.push([record, spec.definition, json]);
    }

    // 2. Define.
    for (const [record, definition, json] of toDefine) {
      this.define(record, definition);
      record.running = json;
      stats.defined++;
    }

    // 3. Move output nodes into their current hosts.
    for (const [record, host] of placements) {
      if (record.node.parentElement !== host) {
        if (record.node.parentElement !== null) stats.moved++;
        host.append(record.node);
      }
    }
    return stats;
  }

  /** Define (or redefine) the values passed in by `ojs_define`. */
  defineData(values: ReadonlyMap<string, unknown>): void {
    for (const [name, variable] of this.data) {
      if (!values.has(name)) {
        variable.delete();
        this.data.delete(name);
      }
    }
    for (const [name, value] of values) {
      const existing = this.data.get(name);
      if (existing) existing.define(name, [], () => value);
      else this.data.set(name, (this.notebook.main as unknown as { define: Variable["define"] }).define(name, [], () => value));
    }
  }

  /** Stop every cell (resolving invalidation) and release the runtime. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pending.clear();
    for (const record of this.cells.values()) record.node.remove();
    this.cells.clear();
    this.data.clear();
    this.notebook.runtime.dispose();
  }

  // ── internals ──────────────────────────────────────────────────────────

  private createRecord(key: string): CellRecord {
    const node = document.createElement("div");
    node.className = "ojs-cell-output";
    node.dataset.ojsKey = key;
    const badge = Object.assign(document.createElement("div"), { className: "ojs-cell-badge", hidden: true });
    badge.setAttribute("role", "status");
    const errors = Object.assign(document.createElement("div"), { className: "ojs-cell-errors", hidden: true });
    const values = Object.assign(document.createElement("div"), { className: "ojs-cell-values" });
    node.append(badge, errors, values);
    const record: CellRecord = {
      node,
      badge,
      errors,
      values,
      state: { root: values, expanded: [], variables: [] },
      running: null,
      output: true,
    };
    this.cells.set(key, record);
    return record;
  }

  private define(record: CellRecord, definition: CellDefinition): void {
    record.values.replaceChildren();
    record.errors.replaceChildren();
    record.errors.hidden = true;
    record.values.hidden = !record.output;
    record.state = { root: record.values, expanded: [], variables: [] };
    const body = (0, eval)(`(${definition.body})`);
    this.notebook.define(
      record.state,
      {
        id: this.nextId++,
        body,
        inputs: definition.inputs,
        outputs: definition.outputs,
        output: definition.output,
        autodisplay: definition.autodisplay,
        autoview: definition.autoview,
        automutable: definition.automutable,
        // Notebook Kit gives `display` and `view` to JavaScript cells only.
        display: definition.mode === "js",
      },
      this.observerFor(record),
    );
  }

  /** Notebook Kit's observer, plus visible errors when values are hidden. */
  private observerFor(record: CellRecord): typeof observe {
    return (state, definition) => {
      const base = observe(state, definition);
      return {
        _error: false,
        _node: state.root,
        pending() {
          base.pending.call(this);
        },
        fulfilled(value: unknown) {
          base.fulfilled.call(this, value);
          if (!record.output) {
            record.errors.replaceChildren();
            record.errors.hidden = true;
          }
        },
        rejected(error: unknown) {
          base.rejected.call(this, error);
          if (!record.output) {
            record.errors.replaceChildren(inspectError(error, definition.output));
            record.errors.hidden = false;
          }
        },
      };
    };
  }

  private deleteVariables(record: CellRecord): void {
    for (const variable of record.state.variables) variable.delete();
    record.state.variables = [];
    record.running = null;
  }

  private showBadge(record: CellRecord, message: string): void {
    record.badge.textContent = message;
    record.badge.hidden = false;
  }

  private hideBadge(record: CellRecord): void {
    record.badge.textContent = "";
    record.badge.hidden = true;
  }
}

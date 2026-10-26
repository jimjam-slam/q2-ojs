/**
 * The live preview's host registry (design D4, D7; spec ojs-preview).
 *
 * A preview component sees one code block at a time, but a cell's key counts
 * earlier cells with the same source across the whole document. So every OJS
 * host registers its element here, and once per microtask the registry:
 *
 *   1. sorts hosts into document order and computes keys exactly as the
 *      engine does (or takes the engine's key from a capture-current block);
 *   2. compiles each cell (cached by source);
 *   3. marks every cell defining a name that another cell also defines, so
 *      neither copy is defined (spec "Duplicate definitions while editing");
 *   4. hands the result to the reconciler: `upsert` each cell, `release` keys
 *      that went away.
 *
 * React may reuse a component (and its host element) for a different cell when
 * blocks shift; the registry keys by element, so that's just an update.
 */

import { parseCell, type OptionValue } from "../shared/cell.ts";
import { compileCell, definedNames, type CompileResult, type OjsLanguage } from "../shared/compile.ts";
import { keyBase, splitKey } from "../shared/keys.ts";
import type { CellSpec } from "../runtime/reconciler.ts";

export interface HostInput {
  language: OjsLanguage;
  /**
   * The cell source. For a raw `{ojs1}`/`{ojs2}` block, the whole content
   * including `//|` options; for an engine block, the body the engine kept.
   */
  source: string;
  /** The engine's key, for a block from a current capture (`.ojs-source`). */
  key?: string;
  /** For engine blocks, `data-ojs-output`; raw blocks read `//| output`. */
  output?: boolean;
}

export interface Sink {
  upsert(key: string, spec: CellSpec, host: HTMLElement): void;
  release(key: string): void;
}

interface Prepared {
  base: string;
  explicitKey?: string;
  options: Record<string, OptionValue>;
  result: CompileResult;
}

export interface RegistryOptions {
  /** Runs at the start of each flush (the preview re-reads `ojs_define` data). */
  beforeFlush?: () => void;
  /**
   * How long a key whose host was unregistered stays alive, waiting for
   * another host to claim it. When blocks shift, React unmounts a component
   * and mounts a new one for the same cell, not always in the same batch;
   * without this grace the cell would be deleted and redefined, losing state.
   */
  orphanGraceMs?: number;
  /**
   * How long an edited cell waits for typing to pause before it's recompiled
   * and redefined. Only edits wait: a host handed a cell that another host
   * held a moment ago (React reusing a component after blocks shift) or a new
   * host updates at once, so cells that merely moved keep their state.
   */
  debounceMs?: number;
}

type Timer = ReturnType<typeof setTimeout>;

export class HostRegistry {
  /** The latest input each host registered. */
  private readonly hosts = new Map<HTMLElement, HostInput>();
  /** The input each host's cell is currently defined from. */
  private applied = new Map<HTMLElement, HostInput>();
  private readonly cache = new Map<string, Prepared>();
  private assigned = new Map<HTMLElement, string>();
  private readonly orphans = new Map<string, Timer>();
  private readonly edits = new Map<HTMLElement, Timer>();
  private readonly editsDue = new Set<HTMLElement>();
  private scheduled = false;
  private readonly sink: Sink;
  private readonly beforeFlush: () => void;
  private readonly orphanGraceMs: number;
  private readonly debounceMs: number;

  constructor(sink: Sink, options: RegistryOptions = {}) {
    this.sink = sink;
    this.beforeFlush = options.beforeFlush ?? (() => {});
    this.orphanGraceMs = options.orphanGraceMs ?? 100;
    this.debounceMs = options.debounceMs ?? 250;
  }

  register(host: HTMLElement, input: HostInput): void {
    this.hosts.set(host, input);
    this.schedule();
  }

  unregister(host: HTMLElement): void {
    if (!this.hosts.delete(host)) return;
    clearTimeout(this.edits.get(host));
    this.edits.delete(host);
    this.editsDue.delete(host);
    this.applied.delete(host);
    this.schedule();
  }

  /** Keys (and prepared cells) for hosts in document order, as the engine counts them. */
  private keysFor(inputs: ReadonlyMap<HTMLElement, HostInput>) {
    const ordered = [...inputs.keys()].filter((h) => h.isConnected).sort(documentOrder);
    const counts = new Map<string, number>();
    const keys = new Map<HTMLElement, string>();
    const prepared = new Map<HTMLElement, Prepared>();
    for (const host of ordered) {
      const p = this.prepare(inputs.get(host)!);
      prepared.set(host, p);
      const occurrence = counts.get(p.base) ?? 0;
      counts.set(p.base, occurrence + 1);
      keys.set(host, p.explicitKey ?? `${p.base}:${occurrence}`);
    }
    return { keys, prepared };
  }

  /** Wait for typing to pause before applying an edit to `host`. */
  private deferEdit(host: HTMLElement): void {
    clearTimeout(this.edits.get(host));
    this.edits.set(
      host,
      setTimeout(() => {
        this.edits.delete(host);
        this.editsDue.add(host);
        this.schedule();
      }, this.debounceMs),
    );
  }

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => this.flush());
  }

  /** Recompute keys and push every cell to the sink. Returns the keys by host. */
  flush(): Map<HTMLElement, string> {
    this.scheduled = false;
    this.beforeFlush();

    // 1. Keys in document order, exactly as the engine computes them. A host
    //    whose key is brand new (not held by any host a moment ago) is being
    //    edited: until typing pauses, it keeps the input it was defined from.
    //    Anything else (a new host, or a cell moving between hosts) applies now.
    const inputs = new Map(this.hosts);
    let { keys, prepared } = this.keysFor(inputs);
    if (this.debounceMs > 0) {
      const held = new Set(this.assigned.values());
      let deferred = false;
      for (const [host, key] of keys) {
        const previous = this.assigned.get(host);
        const editing = previous !== undefined && key !== previous && !held.has(key) && this.applied.has(host);
        if (editing && !this.editsDue.has(host)) {
          inputs.set(host, this.applied.get(host)!);
          this.deferEdit(host);
          deferred = true;
        }
      }
      if (deferred) ({ keys, prepared } = this.keysFor(inputs));
    }
    this.editsDue.clear();

    // 2–3. Problems: compile errors, and names defined by more than one cell.
    let duplicates = duplicatesIn(prepared);

    // An edit that introduces a problem keeps the host's last good version
    // running, under a badge (spec "Last-good-definition on compile error").
    // In the preview an edit changes the cell's key, so the old key is kept.
    // An unchanged cell caught up in a new duplicate keeps running too, marked.
    const badges = new Map<HTMLElement, string>();
    for (const [host, p] of prepared) {
      const problem = problemOf(p, duplicates.get(host));
      const previous = this.applied.get(host);
      if (problem === undefined || previous === undefined || !this.prepare(previous).result.ok) continue;
      inputs.set(host, previous);
      badges.set(host, problem);
    }
    if (badges.size > 0) {
      ({ keys, prepared } = this.keysFor(inputs));
      duplicates = duplicatesIn(prepared);
    }

    // 4. Release keys that went away, then upsert every cell. A key replaced on
    //    a host that's still here is an edit: release it now, so its old
    //    definition is deleted before the new one is defined. A key whose host
    //    went away may be about to move to a new host: release it after a grace
    //    period, unless something claims it first.
    const live = new Set(keys.values());
    for (const [host, key] of this.assigned) {
      if (live.has(key)) continue;
      if (keys.has(host)) this.sink.release(key);
      else this.orphan(key);
    }
    for (const key of live) this.adopt(key);
    for (const [host, key] of keys) {
      const input = inputs.get(host)!;
      const p = prepared.get(host)!;
      const badge = badges.get(host);
      const spec: CellSpec =
        badge === undefined
          ? this.specFor(input, p, duplicates.get(host))
          : { definition: null, error: badge, output: input.output ?? p.options.output !== false };
      this.sink.upsert(key, spec, host);
    }
    this.assigned = keys;
    this.applied = new Map([...keys.keys()].map((host) => [host, inputs.get(host)!]));
    return keys;
  }

  private orphan(key: string): void {
    if (this.orphans.has(key)) return;
    this.orphans.set(
      key,
      setTimeout(() => {
        this.orphans.delete(key);
        this.sink.release(key);
      }, this.orphanGraceMs),
    );
  }

  private adopt(key: string): void {
    const timer = this.orphans.get(key);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.orphans.delete(key);
  }

  private prepare(input: HostInput): Prepared {
    const cacheKey = `${input.language}\u0000${input.key ?? ""}\u0000${input.source}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    const cell = input.key === undefined ? parseCell(input.source) : { options: {}, body: input.source, bodyLineOffset: 0 };
    const p: Prepared = {
      base: input.key === undefined ? keyBase(cell) : splitKey(input.key).base,
      explicitKey: input.key,
      options: cell.options,
      result: compileCell(input.language, cell.body, cell.bodyLineOffset),
    };
    if (this.cache.size > 500) this.cache.clear();
    this.cache.set(cacheKey, p);
    return p;
  }

  private specFor(input: HostInput, p: Prepared, duplicateNames?: string[]): CellSpec {
    const output = input.output ?? p.options.output !== false;
    const problem = problemOf(p, duplicateNames);
    if (problem !== undefined || !p.result.ok) return { definition: null, error: problem, output };
    return { definition: p.result.definition, output };
  }
}

/** The message for a cell's compile error or duplicated names, if any. */
function problemOf(p: Prepared, duplicateNames?: string[]): string | undefined {
  if (!p.result.ok) {
    const { message, line, column } = p.result.error;
    const where = line === undefined ? "" : ` (line ${line}${column === undefined ? "" : `, column ${column}`})`;
    return `SyntaxError: ${message}${where}`;
  }
  if (duplicateNames) {
    const names = duplicateNames.map((n) => `\`${n}\``).join(", ");
    return `${names} ${duplicateNames.length === 1 ? "is" : "are"} defined in more than one cell`;
  }
  return undefined;
}

/** Hosts whose cells define a name that another cell also defines. */
function duplicatesIn(prepared: ReadonlyMap<HTMLElement, Prepared>): Map<HTMLElement, string[]> {
  const definers = new Map<string, HTMLElement[]>();
  for (const [host, p] of prepared) {
    if (!p.result.ok) continue;
    for (const name of definedNames(p.result.definition)) {
      definers.set(name, [...(definers.get(name) ?? []), host]);
    }
  }
  const duplicates = new Map<HTMLElement, string[]>();
  for (const [name, hosts] of definers) {
    if (hosts.length < 2) continue;
    // `viewof x` also defines `x`; report the pair once, as `x`.
    if (/^(viewof|mutable) /.test(name) && definers.get(name.replace(/^\w+ /, ""))?.length === hosts.length) continue;
    for (const host of hosts) duplicates.set(host, [...(duplicates.get(host) ?? []), name]);
  }
  return duplicates;
}

function documentOrder(a: Node, b: Node): number {
  if (a === b) return 0;
  return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

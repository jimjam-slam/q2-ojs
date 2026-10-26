/**
 * Data passed in from other engines with `ojs_define` (design D8).
 *
 * knitr (and Quarto 1's Jupyter setup) write `<script type="ojs-define">`
 * elements holding `{"contents": [{"name": …, "value": …}]}`. Data frames
 * arrive column-oriented, `{column: [values]}`; as in Quarto 1, authors call
 * `transpose()` to get rows.
 */

interface DefinePayload {
  contents?: { name?: unknown; value?: unknown }[];
}

/** Read every `ojs-define` payload under `root`; a later name replaces an earlier one. */
export function readDefines(root: ParentNode): Map<string, unknown> {
  const values = new Map<string, unknown>();
  for (const script of root.querySelectorAll<HTMLScriptElement>('script[type="ojs-define"]')) {
    let payload: DefinePayload;
    try {
      payload = JSON.parse(script.textContent ?? "");
    } catch (e) {
      console.error("ojs: ignoring an ojs-define payload that isn't valid JSON", e);
      continue;
    }
    for (const entry of payload.contents ?? []) {
      if (typeof entry.name === "string" && entry.name !== "") values.set(entry.name, entry.value);
    }
  }
  return values;
}

/** Quarto 1's `transpose`: column-oriented data to an array of rows. */
export function transpose(columns: Record<string, ArrayLike<unknown>>): Record<string, unknown>[] {
  const names = Object.keys(columns);
  const length = names.length === 0 ? 0 : Math.max(...names.map((name) => columns[name].length));
  return Array.from({ length }, (_, i) => Object.fromEntries(names.map((name) => [name, columns[name][i]])));
}

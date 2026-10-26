/**
 * Cell source handling shared by the engine (Node) and the browser runtime.
 *
 * A cell's options are `//| key: value` lines at the top of the cell, as in
 * Quarto 1 OJS. Values are YAML-style scalars (booleans, numbers, quoted or
 * bare strings); nested YAML isn't supported and is kept as the raw string.
 */

export type OptionValue = string | number | boolean;

export interface ParsedCell {
  /** Options from the leading `//|` lines. */
  options: Record<string, OptionValue>;
  /** The cell source without its option lines. */
  body: string;
  /** How many lines precede `body` in the original cell (options, blanks). */
  bodyLineOffset: number;
}

const OPTION_LINE = /^\s*\/\/\|\s?(.*)$/;
const KEY_VALUE = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/;

/** Split a cell's source into its `//|` options and the remaining body. */
export function parseCell(source: string): ParsedCell {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const options: Record<string, OptionValue> = {};
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i];
    const option = OPTION_LINE.exec(line);
    if (option) {
      const kv = KEY_VALUE.exec(option[1].trim());
      if (kv) options[kv[1]] = parseScalar(kv[2]);
      continue;
    }
    // Blank lines among the leading options don't end them.
    if (line.trim() === "" && i + 1 < lines.length && OPTION_LINE.test(lines[i + 1])) continue;
    break;
  }
  return { options, body: lines.slice(i).join("\n"), bodyLineOffset: i };
}

function parseScalar(raw: string): OptionValue {
  const value = raw.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  const quoted = /^(["'])(.*)\1$/.exec(value);
  return quoted ? quoted[2] : value;
}

/**
 * Normalize a cell body for hashing: line endings, trailing whitespace on each
 * line, and leading or trailing blank lines don't change a cell's identity.
 */
export function normalizeBody(body: string): string {
  return body
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
}

/** Read a boolean option, accepting only real booleans. */
export function booleanOption(options: Record<string, OptionValue>, key: string, fallback: boolean): boolean {
  const value = options[key];
  return typeof value === "boolean" ? value : fallback;
}

/**
 * Find `{ojs1}` / `{ojs2}` cells in the markdown an engine receives.
 *
 * Line-based, following CommonMark fences: an opening fence is 3+ backticks
 * or tildes; it closes at a line of the same character, at least as long.
 * Fences of other languages are skipped whole, so an `{ojs2}` example shown
 * inside a ````markdown block isn't treated as a cell.
 */

import { isOjsLanguage, type OjsLanguage } from "../shared/compile.ts";

export interface ScannedCell {
  language: OjsLanguage;
  /** Offset of the opening fence line's first character. */
  start: number;
  /** Offset just past the closing fence line (including its newline, if any). */
  end: number;
  /** Offset of the first content line (after the opening fence). */
  contentStart: number;
  /** The cell's content: everything between the fences. */
  source: string;
  /** Whitespace before the opening fence, reused for the replacement. */
  indent: string;
}

const OPEN = /^([ \t]*)(`{3,}|~{3,})[ \t]*(.*?)[ \t]*$/;
const OJS_INFO = /^\{(ojs\d)(?:[ \t][^}]*)?\}$/;

interface Line {
  text: string;
  start: number;
  /** Offset just past this line, including its newline. */
  next: number;
}

function splitLines(markdown: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  while (start < markdown.length) {
    const nl = markdown.indexOf("\n", start);
    const end = nl === -1 ? markdown.length : nl;
    const text = markdown.slice(start, end).replace(/\r$/, "");
    lines.push({ text, start, next: nl === -1 ? end : nl + 1 });
    start = nl === -1 ? markdown.length : nl + 1;
  }
  return lines;
}

function isClosing(text: string, char: string, length: number): boolean {
  const trimmed = text.trim();
  return trimmed.length >= length && [...trimmed].every((c) => c === char);
}

export function scanCells(markdown: string): ScannedCell[] {
  const lines = splitLines(markdown);
  const cells: ScannedCell[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = OPEN.exec(lines[i].text);
    if (!open) continue;
    const [, indent, fence, info] = open;
    const char = fence[0];
    // Backtick fences can't have backticks in their info string.
    if (char === "`" && info.includes("`")) continue;

    // Find the closing fence; an unclosed fence runs to the end of the text.
    let close = i + 1;
    while (close < lines.length && !isClosing(lines[close].text, char, fence.length)) close++;

    const language = OJS_INFO.exec(info)?.[1];
    if (language !== undefined && isOjsLanguage(language) && close < lines.length) {
      const contentStart = lines[i].next;
      const contentEnd = lines[close].start;
      cells.push({
        language,
        start: lines[i].start,
        end: lines[close].next,
        contentStart,
        source: stripIndent(markdown.slice(contentStart, contentEnd).replace(/\r\n?/g, "\n").replace(/\n$/, ""), indent),
        indent,
      });
    }
    i = close; // skip the whole block, OJS or not
  }
  return cells;
}

/** Remove the fence's indentation from each content line, as CommonMark does. */
function stripIndent(content: string, indent: string): string {
  if (indent === "") return content;
  return content
    .split("\n")
    .map((line) => (line.startsWith(indent) ? line.slice(indent.length) : line.trimStart()))
    .join("\n");
}

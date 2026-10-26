/**
 * Runtime built-ins: Notebook Kit's standard library plus the compatibility
 * shims Quarto 1 and Observable 1.0 documents expect.
 *
 * Notebook Kit 2.x dropped `require` in favour of ES module imports (spike S5).
 * `{ojs1}` cells still use it (`d3 = require("d3@7")`), so it comes back here,
 * backed by d3-require resolving against jsDelivr, as in Quarto 1. It loads
 * UMD/AMD bundles only; ESM-only packages need `import()` or `{ojs2}`.
 */

import { library } from "@observablehq/notebook-kit/runtime";
import { require as d3Require } from "d3-require";
import { transpose } from "./data.ts";

export type Builtins = Record<string, () => unknown>;

type Generators = { width(target: Element): unknown };

export const builtins: Builtins = {
  ...(library as Builtins),
  // Notebook Kit measures `document.querySelector("main") ?? document.body`,
  // looked up when its module loads. On a rendered page the runtime loads in
  // <head>, before either exists, so look the element up on first use.
  width: () => ((library as Builtins).Generators() as Generators).width(document.querySelector("main") ?? document.body),
  require: () => d3Require,
  // Quarto 1's helper for column-oriented `ojs_define` data frames.
  transpose: () => transpose,
};

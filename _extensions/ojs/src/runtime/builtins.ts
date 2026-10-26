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

export type Builtins = Record<string, () => unknown>;

export const builtins: Builtins = {
  ...(library as Builtins),
  require: () => d3Require,
};

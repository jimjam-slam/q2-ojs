// Build the extension and install a copy into examples/.
//
// examples/_extensions/ojs is a real copy, not a symlink: q2 preview syncs only
// files inside the project tree, and a symlink resolving outside it is dropped
// (design spike S6). Run with `npm run build`.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ext = join(root, "_extensions", "ojs");
// Projects that render with the extension: the examples and the e2e fixtures.
const installs = ["examples", join("test", "e2e")].map((dir) => join(root, dir, "_extensions", "ojs"));

// Prefer an explicit Q2, then the project-local download in .tools/, then PATH.
const localQ2 = join(root, ".tools", "q2", "q2");
const q2 = process.env.Q2 ?? (existsSync(localQ2) ? localQ2 : "q2");

execFileSync(q2, ["call", "build-ts-extension", ext], { stdio: "inherit" });

// The page runtime: one classic script, so the engine can ship it as an html
// dependency (stored once per site in site_libs). A classic script can't hold
// static imports of URLs or top-level await (S9), and some of Notebook Kit's
// stdlib modules (inputs, tex, dot, leaflet, …) have both. Each is only ever
// loaded lazily with `import()` and only wraps CDN imports, so we load
// Notebook Kit's own copy of it from jsDelivr, pinned to the version we
// bundle, as a native dynamic import (design S11, S13).
const NOTEBOOK_KIT_VERSION = JSON.parse(
  readFileSync(join(root, "node_modules", "@observablehq", "notebook-kit", "package.json"), "utf8"),
).version;
const NOTEBOOK_KIT_SRC = join(root, "node_modules", "@observablehq", "notebook-kit", "dist", "src");
const NOTEBOOK_KIT_CDN = `https://cdn.jsdelivr.net/npm/@observablehq/notebook-kit@${NOTEBOOK_KIT_VERSION}/dist/src`;
const STATIC_URL_IMPORT = /^\s*(?:import|export)\b[^;(]*?\bfrom\s*["']https?:|^\s*import\s*["']https?:/m;

const cdnStdlib = {
  name: "cdn-stdlib",
  setup(b) {
    b.onResolve({ filter: /^\.\.?\/.*\.js$/ }, (args) => {
      if (args.kind !== "dynamic-import" || !args.importer.startsWith(NOTEBOOK_KIT_SRC + sep)) return undefined;
      const target = resolve(dirname(args.importer), args.path);
      if (!existsSync(target) || !STATIC_URL_IMPORT.test(readFileSync(target, "utf8"))) return undefined;
      const path = relative(NOTEBOOK_KIT_SRC, target).split(sep).join("/");
      return { path: `${NOTEBOOK_KIT_CDN}/${path}/+esm`, external: true };
    });
  },
};

const runtimeOut = join(ext, "dist", "runtime");
rmSync(runtimeOut, { recursive: true, force: true });
await build({
  entryPoints: { "ojs-runtime": join(ext, "src", "runtime", "bootstrap.ts") },
  outdir: runtimeOut,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  // OJS_DEBUG_BUILD=1 keeps the runtime readable for debugging.
  minify: process.env.OJS_DEBUG_BUILD !== "1",
  plugins: [cdnStdlib],
  logLevel: "warning",
});
console.log(`Built ${runtimeOut}`);

// Only what a user installs: the manifest and built files, not sources.
for (const installed of installs) {
  rmSync(installed, { recursive: true, force: true });
  mkdirSync(installed, { recursive: true });
  for (const entry of ["_extension.yml", "dist"]) {
    const from = join(ext, entry);
    if (existsSync(from)) cpSync(from, join(installed, entry), { recursive: true });
  }
  console.log(`Installed ${installed}`);
}

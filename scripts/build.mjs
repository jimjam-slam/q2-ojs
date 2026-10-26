// Build the extension and install a copy into examples/.
//
// examples/_extensions/ojs is a real copy, not a symlink: q2 preview syncs only
// files inside the project tree, and a symlink resolving outside it is dropped
// (design spike S6). Run with `npm run build`.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
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
// dependency (stored once per site in site_libs). Notebook Kit's dot.js and
// leaflet.js use top-level await, which a classic script can't contain (S9);
// they only wrap CDN imports, so load Notebook Kit's own copies from jsDelivr,
// pinned to the version we bundle.
const NOTEBOOK_KIT_STDLIB =
  "https://cdn.jsdelivr.net/npm/@observablehq/notebook-kit@2.8.0/dist/src/runtime/stdlib";
const cdnStdlib = {
  name: "cdn-stdlib",
  setup(b) {
    b.onResolve({ filter: /^\.\/(dot|leaflet)\.js$/ }, (args) =>
      args.importer.includes("notebook-kit")
        ? { path: `${NOTEBOOK_KIT_STDLIB}/${args.path.slice(2)}/+esm`, external: true }
        : undefined,
    );
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
  minify: true,
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

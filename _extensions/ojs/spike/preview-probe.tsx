// Spike 1.6 probe: a prebuilt render-components module that hosts OJS code
// blocks and hands every other CodeBlock to q2's built-in registry entry.
const R = window.React;
const builtins = window.__Q2_PREVIEW_RENDERER__ && window.__Q2_PREVIEW_RENDERER__.previewRegistry;
const Builtin = builtins && builtins.CodeBlock;
const OJS = new Set(["{ojs1}", "{ojs2}", "ojs-source"]);

export const CodeBlock = (args) => {
  const classes = args.node.c[0][1];
  const hit = classes.find((c) => OJS.has(c));
  if (hit) {
    return R.createElement("div", { "data-ojs-probe": hit }, "OJS HOST for " + hit);
  }
  return Builtin ? R.createElement(Builtin, args) : R.createElement("pre", null, args.node.c[1]);
};

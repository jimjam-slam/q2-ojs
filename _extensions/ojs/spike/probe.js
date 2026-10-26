// Spike 1.4 probe: reports how q2 loaded this engine dependency script.
document.documentElement.dataset.ojsProbe =
  document.currentScript ? `classic:${document.currentScript.type || "text/javascript"}` : "module";

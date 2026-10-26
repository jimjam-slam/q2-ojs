// A jsdom window installed as the global DOM, for tests that run Notebook
// Kit's runtime. Import this before importing any runtime module: Notebook
// Kit reads `document` when its standard library loads.
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", { url: "http://localhost/" });
const { window } = dom;

const globals: Record<string, unknown> = {
  window,
  document: window.document,
  navigator: window.navigator,
  location: window.location,
  HTMLElement: window.HTMLElement,
  HTMLDivElement: window.HTMLDivElement,
  HTMLScriptElement: window.HTMLScriptElement,
  Element: window.Element,
  Node: window.Node,
  Text: window.Text,
  Comment: window.Comment,
  DocumentFragment: window.DocumentFragment,
  Event: window.Event,
  CustomEvent: window.CustomEvent,
  EventTarget: window.EventTarget,
  MutationObserver: window.MutationObserver,
  getComputedStyle: window.getComputedStyle.bind(window),
  ResizeObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
};
for (const [name, value] of Object.entries(globals)) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

export { window };

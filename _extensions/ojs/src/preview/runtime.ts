/**
 * The live preview's runtime module (design D6, D7). The preview component
 * embeds this as a string and imports it lazily (a blob-URL module), the first
 * time a page has an OJS cell. Notebook Kit and d3-require are imported from
 * pinned jsDelivr URLs (the build marks them external), so this stays small.
 */

import { readDefines } from "../runtime/data.ts";
import { getReconciler } from "../runtime/singleton.ts";
import { HostRegistry, type HostInput } from "./hosts.ts";

/** The runtime's stylesheet (ojs.css with the inspector), injected by the build. */
declare const __OJS_CSS__: string;

const holder = globalThis as { __q2ojsHosts?: HostRegistry };

function registry(): HostRegistry {
  if (!holder.__q2ojsHosts) {
    const style = document.createElement("style");
    style.id = "q2-ojs-style";
    style.textContent = __OJS_CSS__;
    document.head.append(style);
    const reconciler = getReconciler();
    // `ojs_define` payloads arrive as header includes; re-read them each batch.
    holder.__q2ojsHosts = new HostRegistry(reconciler, {
      beforeFlush: () => reconciler.defineData(readDefines(document)),
    });
  }
  return holder.__q2ojsHosts;
}

export function register(host: HTMLElement, input: HostInput): void {
  registry().register(host, input);
}

export function unregister(host: HTMLElement): void {
  holder.__q2ojsHosts?.unregister(host);
}

import { createRoot } from "@shadow-js/core";
import { describe, expect, it } from "vitest";
import { Portal } from "../src/control-flow/portal";
import { PortalContext, type PortalSink } from "../src/internal/portal-context";
import { createServerPortals, renderToString } from "../src/server/index";

/** Runs `Portal` the way a renderer does: with `sink` provided through the context. */
function portalWith(sink: PortalSink, children: unknown): void {
  createRoot(() => {
    const view = PortalContext({
      value: sink,
      get children() {
        return Portal({ children });
      },
    });
    (view as () => unknown)();
  });
}

describe("Portal reaches the server writer through its sink", () => {
  it("[WEB-SZ-1] a sink with render receives the portal's key and a thunk for its content", () => {
    const calls: Array<{ key: string | undefined; content: unknown }> = [];
    const sink: PortalSink = {
      add: () => {
        throw new Error("Portal must go through render");
      },
      render: (key, children) => {
        calls.push({ key, content: children() });
      },
    };
    portalWith(sink, "hello");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.content).toBe("hello");
  });

  it("[WEB-SZ-1] a sink without render receives nothing and nothing throws", () => {
    const added: string[] = [];
    portalWith({ add: (_key, html) => added.push(html) }, "hello");
    expect(added).toEqual([]);
  });

  it("[WEB-SZ-1] the collector of createServerPortals still gets the escaped markup", () => {
    const portals = createServerPortals();
    const html = renderToString(() => Portal({ children: "<b>x</b>" }), { portals });
    expect(html).toBe("");
    expect(portals.html()).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
});

import { flushSync } from "@shadow-js/core";
import { clearDelegatedEvents, delegateEvents } from "@shadow-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

describe("clearDelegatedEvents (Solid parity, R-CLEARDELEGATED)", () => {
  it("[EVT-10] removes the document listeners, so delegated handlers stop running until delegateEvents is called again", () => {
    const host = document.createElement("button");
    document.body.append(host);
    hosts.push(host);
    const handler = vi.fn();
    delegateEvents(["click"]);
    (host as unknown as { $$click: unknown }).$$click = handler;
    host.click();
    expect(handler).toHaveBeenCalledTimes(1);
    const remove = vi.spyOn(document, "removeEventListener");
    clearDelegatedEvents();
    expect(remove).toHaveBeenCalledWith("click", expect.any(Function));
    remove.mockRestore();
    host.click();
    expect(handler).toHaveBeenCalledTimes(1);
    delegateEvents(["click"]);
    host.click();
    expect(handler).toHaveBeenCalledTimes(2);
    flushSync();
  });

  it("[EVT-11] calling clearDelegatedEvents twice is harmless", () => {
    clearDelegatedEvents();
    expect(() => clearDelegatedEvents()).not.toThrow();
  });
});

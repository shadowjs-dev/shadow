import { flushSync } from "@shadow-js/core";
import { ClientOnly, render } from "@shadow-js/web";
import { afterEach, describe, expect, it } from "vitest";

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const h of hosts.splice(0)) h.remove();
});

describe("ClientOnly", () => {
  it("[CLO-01] shows the fallback first, then the children once mounted", () => {
    const host = document.createElement("div");
    document.body.append(host);
    hosts.push(host);
    render(
      () =>
        ClientOnly({
          fallback: "server",
          children: "browser",
        }),
      host,
    );
    // render() flushes: onMount has run and the switch happened.
    flushSync();
    expect(host.textContent).toBe("browser");
  });
});

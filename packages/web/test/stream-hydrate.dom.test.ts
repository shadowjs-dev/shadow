import { createComponent, hydrate } from "@shadow-js/web";
import { deserialize, renderToStream } from "@shadow-js/web/server";
import { afterEach, describe, expect, it } from "vitest";
import { load } from "./support/compile";

const SOURCE = `
import { useResource } from "@shadow-js/core";
import { Suspense } from "@shadow-js/web";
const Data = (props) => {
  const data = useResource(() => props.load(), { key: props.name });
  return <p class="data">{data()}</p>;
};
export const App = (props) => (
  <main>
    <h1>title</h1>
    <Suspense fallback={<i class="wait">loading</i>}>
      <Data name="a" load={props.load} />
    </Suspense>
    <footer>end</footer>
  </main>
);`;

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const h of hosts.splice(0)) h.remove();
  delete (window as unknown as { $S?: unknown }).$S;
});

function comments(root: Node): number {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  let n = 0;
  while (walker.nextNode()) n += 1;
  return n;
}

/** Plays the browser: appends a chunk to the host, then runs the inline scripts it contained. */
function appendChunk(host: HTMLElement, chunk: string): string | null {
  const bodies: string[] = [];
  let data: string | null = null;
  const html = chunk.replace(
    /<script([^>]*)>([\s\S]*?)<\/script>/g,
    (_match, attributes: string, body: string) => {
      if (attributes.includes("application/json")) data = body;
      else bodies.push(body);
      return "";
    },
  );
  host.insertAdjacentHTML("beforeend", html);
  for (const body of bodies) new Function(body)();
  return data;
}

/** Decodes every remaining chunk of a reader, appending them to `out`. */
async function readRest(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  out: string[],
): Promise<string[]> {
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out;
    out.push(decoder.decode(value));
  }
}

/** A promise the test settles when it decides; nothing waits on a timer. */
function gate<T>(): { promise: Promise<T>; open(value: T): void } {
  let open!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

const HELD_SOURCE = `
import { useResource } from "@shadow-js/core";
const Data = (props) => {
  const data = useResource(() => props.load(), { key: "held", deferStream: true });
  return <p class="data">{data() ?? "pending"}</p>;
};
export const App = (props) => (
  <main>
    <h1>title</h1>
    <Data load={props.load} />
    <footer>end</footer>
  </main>
);`;

describe("streamed output reaches the client", () => {
  it("[STH-01] swap runtime replaces the fallback, then hydrate adopts every node", async () => {
    const ssr = await load<{ App: (props: { load: () => Promise<string> }) => unknown }>(
      SOURCE,
      "ssr",
    );
    const dom = await load<{ App: (props: { load: () => Promise<string> }) => unknown }>(
      SOURCE,
      "dom",
    );
    // The define is a global in tests: serve the render as a server would, then go back to the browser.
    const flag = globalThis as unknown as { __SERVER__: boolean };
    const data = gate<string>();
    const decoder = new TextDecoder();
    let chunks: string[];
    flag.__SERVER__ = true;
    try {
      const reader = renderToStream(() =>
        createComponent(ssr.App, { load: () => data.promise }),
      ).getReader();
      // The shell is read while the data is still pending: the fallback is what the first chunk shows.
      const first = await reader.read();
      if (first.done) throw new Error("the stream ended before its shell");
      data.open("streamed");
      chunks = [decoder.decode(first.value), ...(await readRest(reader, decoder, []))];
    } finally {
      flag.__SERVER__ = false;
    }
    expect(chunks.length).toBeGreaterThan(2);

    const host = document.createElement("div");
    document.body.append(host);
    hosts.push(host);

    // The shell: the fallback is visible and the swap runtime is installed.
    host.insertAdjacentHTML(
      "beforeend",
      chunks[0]?.replace(/<script[\s\S]*?<\/script>/g, "") ?? "",
    );
    const shellScript = /<script[^>]*>([\s\S]*?)<\/script>/.exec(chunks[0] ?? "")?.[1];
    expect(shellScript).toBeDefined();
    new Function(shellScript ?? "")();
    expect(host.querySelector(".wait")?.textContent).toBe("loading");

    // The content chunk swaps the fallback out.
    let serialized: string | null = null;
    for (const chunk of chunks.slice(1)) {
      const found = appendChunk(host, chunk);
      if (found !== null) serialized = found;
    }
    expect(host.querySelector(".wait")).toBeNull();
    expect(host.querySelector(".data")?.textContent).toBe("streamed");
    expect(host.querySelector("template")).toBeNull();
    expect(serialized).not.toBeNull();

    // Hydration claims the swapped-in markup instead of rebuilding it.
    const p = host.querySelector(".data");
    const main = host.querySelector("main");
    let clientLoads = 0;
    hydrate(
      () =>
        createComponent(dom.App, {
          load: () => {
            clientLoads += 1;
            return Promise.resolve("client");
          },
        }),
      host,
      { data: deserialize(serialized ?? "null") as Record<string, unknown> },
    );
    expect(clientLoads).toBe(0);
    expect(host.querySelector("main")).toBe(main);
    expect(host.querySelector(".data")).toBe(p);
    expect(host.textContent).toBe("titlestreamedend");
    expect(comments(host)).toBe(0);
  });

  it("[STH-02] a deferStream resource is in the first chunk, and hydrate adopts it without fetching", async () => {
    const ssr = await load<{ App: (props: { load: () => Promise<string> }) => unknown }>(
      HELD_SOURCE,
      "ssr",
    );
    const dom = await load<{ App: (props: { load: () => Promise<string> }) => unknown }>(
      HELD_SOURCE,
      "dom",
    );
    const flag = globalThis as unknown as { __SERVER__: boolean };
    const data = gate<string>();
    const decoder = new TextDecoder();
    let chunks: string[];
    flag.__SERVER__ = true;
    try {
      const reader = renderToStream(() =>
        createComponent(ssr.App, { load: () => data.promise }),
      ).getReader();
      data.open("held");
      chunks = await readRest(reader, decoder, []);
    } finally {
      flag.__SERVER__ = false;
    }
    // The shell is the first chunk and already carries the value: no fallback is streamed for it.
    expect(chunks[0]).toContain("held");
    expect(chunks[0]).not.toContain("pending");
    expect(chunks[0]).not.toContain("$S=function");

    const host = document.createElement("div");
    document.body.append(host);
    hosts.push(host);
    let serialized: string | null = null;
    host.insertAdjacentHTML(
      "beforeend",
      chunks[0]?.replace(/<script[\s\S]*?<\/script>/g, "") ?? "",
    );
    for (const chunk of chunks.slice(1)) {
      const found = appendChunk(host, chunk);
      if (found !== null) serialized = found;
    }
    expect(serialized).not.toBeNull();
    const p = host.querySelector(".data");
    const main = host.querySelector("main");

    let clientLoads = 0;
    hydrate(
      () =>
        createComponent(dom.App, {
          load: () => {
            clientLoads += 1;
            return Promise.resolve("client");
          },
        }),
      host,
      { data: deserialize(serialized ?? "null") as Record<string, unknown> },
    );
    expect(clientLoads).toBe(0);
    expect(host.querySelector("main")).toBe(main);
    expect(host.querySelector(".data")).toBe(p);
    expect(host.querySelector(".data")?.textContent).toBe("held");
  });
});

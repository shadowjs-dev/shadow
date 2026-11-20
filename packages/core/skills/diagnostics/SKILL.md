---
name: shadowjs-diagnostics
description: What each ShadowJS runtime diagnostic code means, what triggers it and how to fix it. Read the section named after the code in a `[shadow CODE]` message or a `SHADOW_CODE` error.
---

# ShadowJS runtime diagnostics

Generated from the diagnostics page (https://shadowjs.net/faq/diagnostics/) for the version of the package it ships in. Do not edit by hand.

A development message names its code, where it happened and this file:

```text
[shadow EACH_KEY_DUPLICATE] Duplicate key in a keyed list; later duplicates get fresh rows each update.
    in <App> > <TodoList> > memo
    https://shadowjs.net/faq/diagnostics/#each_key_duplicate
    offline: node_modules/@shadow-js/core/skills/diagnostics/SKILL.md
```

The second line is the owner path: the components above the code that made the mistake, from the outside in, then the effect or memo it ran in. Open the innermost component first. Find the code below; each section says what triggers it and how to fix it. Codes of the compiler, the router and the other packages are on the page.

## Reading a diagnostic

**Development builds** carry the full text: `[shadow CODE] message`. Warnings go to `console.warn`. Errors are thrown: `ShadowError` (core) with a `code` property, `SsrError` (server renderer) with a `code` property, a `TypeError`/`RangeError` whose message starts with `[shadow CODE]`, or a `CompileError` (compiler) whose `diagnostic.code` is the code.

**Production builds** keep only the code, so message strings never reach your bundle. `formatMessage(code)` returns `SHADOW_<CODE>`, a `ShadowError` message is `SHADOW_<CODE>`, and `warn` compiles to nothing. Search your logs for `SHADOW_` followed by the code from this page.

```text
development:  [shadow WRITE_IN_MEMO] A signal was written inside a useMemo() computation. ...
production:   SHADOW_WRITE_IN_MEMO
```

**Where it happened.** From 1.2.0 a development message continues on more lines: the owner path, the address of the code's section on this page and, the first time a code is reported, the copy of this page inside the installed package. An error (`ShadowError`) carries the first two.

```text
[shadow EACH_KEY_DUPLICATE] Duplicate key in a keyed list; later duplicates get fresh rows each update.
    in <App> > <TodoList> > memo
    https://shadowjs.net/faq/diagnostics/#each_key_duplicate
    offline: node_modules/@shadow-js/core/skills/diagnostics/SKILL.md
```

The owner path names the components above the code that made the mistake, from the outside in, then the effect or memo it ran in (with its `name` option when it has one). Open the innermost component first. `ownerPath(owner)` and `diagnosticUrl(code)` from `@shadow-js/core/extend` return the two lines for your own messages. `node_modules/@shadow-js/core/skills/diagnostics/` holds the runtime sections of this page as `SKILL.md` and the list of codes as `diagnostics.json`, for a reader with no network.

**Once per code and place.** `warn` reports a code once for each owner path it comes from: two components that make the same mistake are two reports, a thousand instances of one component are one. At most sixteen places are kept per code. `resetWarningDedupe()` forgets them all, for core and the DOM runtime. `setWarningListener(listener)` redirects core warnings to your function (devtools, error reporters); it returns the previous listener. `subscribeDiagnostics(listener)` delivers the warnings of every package as data (`code`, `message`, `ownerPath`, `url`) and leaves the console as it is.

```ts
import {
  formatMessage,
  MESSAGES,
  resetWarningDedupe,
  setWarningListener,
  warn,
} from "@shadow-js/core/extend";
import { captureWarnings } from "@shadow-js/testing";
import { beforeEach, describe, expect, it } from "vitest";

describe("reading diagnostics", () => {
  beforeEach(() => {
    resetWarningDedupe();
  });

  it("formats dev messages as [shadow CODE] text", () => {
    expect(formatMessage("WRITE_IN_MEMO")).toBe(`[shadow WRITE_IN_MEMO] ${MESSAGES.WRITE_IN_MEMO}`);
  });

  it("reports a code once, until the dedupe is reset", () => {
    const first = captureWarnings(() => {
      warn("NO_OWNER_CLEANUP");
      warn("NO_OWNER_CLEANUP");
    });
    expect(first.messages).toHaveLength(1);
    resetWarningDedupe();
    expect(captureWarnings(() => warn("NO_OWNER_CLEANUP")).messages).toHaveLength(1);
  });

  it("setWarningListener receives the code and the message instead of the console", () => {
    const received: string[] = [];
    const previous = setWarningListener((code) => {
      received.push(code);
    });
    try {
      const { messages } = captureWarnings(() => warn("NO_OWNER_ERROR"));
      expect(messages).toEqual([]);
      expect(received).toEqual(["NO_OWNER_ERROR"]);
    } finally {
      setWarningListener(previous);
    }
  });
});
```

Web warnings other than `UNSAFE_URL_BLOCKED` are not deduplicated by code (each is described below). The router's warning is not deduplicated either.

## Core

Codes of the table `MESSAGES` in `@shadow-js/core/extend`.

### NO_OWNER_EFFECT

**Warning.** `useEffect`, `useRenderEffect` or `onMount` ran with no current owner. The effect still runs, but nothing can ever dispose it, so it leaks for the life of the page.

*Why:* effect creation at module level, or after an `await`, a timer or an event callback, where the owner is gone. *Fix:* create the effect inside a component or `createRoot`; after an `await`, restore the owner with `runWithOwner` (see [ownership](https://shadowjs.net/concepts/ownership/#getowner-and-runwithowner)).

```ts
import { createRoot, flushSync, useEffect } from "@shadow-js/core";
import { resetWarningDedupe } from "@shadow-js/core/extend";
import { captureWarnings } from "@shadow-js/testing";
import { beforeEach, describe, expect, it } from "vitest";

describe("NO_OWNER_EFFECT", () => {
  beforeEach(() => {
    resetWarningDedupe();
  });

  it("warns outside an owner, not inside createRoot", () => {
    // Before: no owner.
    const before = captureWarnings(() => useEffect(() => undefined));
    expect(before.messages[0]).toContain("NO_OWNER_EFFECT");
    flushSync();

    // After: the effect has an owner and is disposed with it.
    resetWarningDedupe();
    const after = captureWarnings(() => {
      const dispose = createRoot((stop) => {
        useEffect(() => undefined);
        return stop;
      });
      flushSync();
      dispose();
    });
    expect(after.messages).toEqual([]);
  });
});
```

### NO_OWNER_CLEANUP

**Warning.** `onCleanup(fn)` ran with no current owner; `fn` is dropped and never runs. *Fix:* register cleanups inside a component, effect or `createRoot`, or inside `runWithOwner(owner, ...)` after an `await`.

```ts
import { createRoot, getOwner, onCleanup, runWithOwner } from "@shadow-js/core";
import { resetWarningDedupe } from "@shadow-js/core/extend";
import { captureWarnings } from "@shadow-js/testing";
import { beforeEach, describe, expect, it } from "vitest";

describe("NO_OWNER_CLEANUP", () => {
  beforeEach(() => {
    resetWarningDedupe();
  });

  it("drops the cleanup outside an owner; runWithOwner restores it", () => {
    let ran = false;
    const lost = captureWarnings(() =>
      onCleanup(() => {
        ran = true;
      }),
    );
    expect(lost.messages[0]).toContain("NO_OWNER_CLEANUP");
    expect(ran).toBe(false);

    const owner = createRoot((dispose) => ({ owner: getOwner(), dispose }));
    const kept: string[] = [];
    const quiet = captureWarnings(() =>
      runWithOwner(owner.owner, () => {
        onCleanup(() => kept.push("cleaned"));
      }),
    );
    expect(quiet.messages).toEqual([]);
    owner.dispose();
    expect(kept).toEqual(["cleaned"]);
  });
});
```

### NO_OWNER_ERROR

**Warning.** `onError(handler)` ran with no current owner; the handler can never be reached. *Fix:* call it inside the scope whose errors it should handle, or use `catchError(fn, handler)`, which creates the scope for you.

```ts
import { catchError, onError } from "@shadow-js/core";
import { resetWarningDedupe } from "@shadow-js/core/extend";
import { captureWarnings } from "@shadow-js/testing";
import { beforeEach, describe, expect, it } from "vitest";

describe("NO_OWNER_ERROR", () => {
  beforeEach(() => {
    resetWarningDedupe();
  });

  it("warns for onError at top level; catchError needs no owner", () => {
    const before = captureWarnings(() => onError(() => undefined));
    expect(before.messages[0]).toContain("NO_OWNER_ERROR");

    resetWarningDedupe();
    const caught: unknown[] = [];
    const after = captureWarnings(() =>
      catchError(
        () => {
          throw new Error("boom");
        },
        (error) => caught.push(error),
      ),
    );
    expect(after.messages).toEqual([]);
    expect(caught).toHaveLength(1);
  });
});
```

### NO_OWNER_ID

**Error** (`ShadowError`, thrown). `useId()` ran outside any owner. An id comes from the position in the owner tree, so without an owner no id exists that matches between server and client. *Fix:* call `useId()` in a component body or inside `createRoot`.

```ts
import { createRoot, useId } from "@shadow-js/core";
import { ShadowError } from "@shadow-js/core/extend";
import { describe, expect, it } from "vitest";

describe("NO_OWNER_ID", () => {
  it("throws outside an owner, returns an id inside one", () => {
    let failure: unknown;
    try {
      useId();
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ShadowError);
    expect((failure as ShadowError).code).toBe("NO_OWNER_ID");

    const id = createRoot((dispose) => {
      const value = useId();
      dispose();
      return value;
    });
    expect(id).toMatch(/^s[\d-]*_0$/);
  });
});
```

### WRITE_IN_MEMO

**Error** (`ShadowError`, development only). A signal or store was written while a `useMemo` (or a compiler-derived constant) was computing. A memo must be a pure function of its sources, because it may run at any time or not at all. The error is stored in the memo and thrown to whoever reads it.

*Fix:* compute the value instead of storing it elsewhere; if a write is a real side effect, do it in `useEffect`.

```ts
import { createRoot, flushSync, useEffect, useMemo, useStore } from "@shadow-js/core";
import { ShadowError } from "@shadow-js/core/extend";
import { describe, expect, it } from "vitest";

describe("WRITE_IN_MEMO", () => {
  it("before: a memo that writes a signal or a store throws to its readers", () => {
    const [source] = useStore(1);
    const [, setTarget] = useStore(0);
    const [, setStore] = useStore({ total: 0 });
    const viaSignal = useMemo(() => {
      setTarget(source() * 2);
      return source();
    });
    const viaStore = useMemo(() => {
      setStore("total", source() * 2);
      return source();
    });
    for (const read of [viaSignal, viaStore]) {
      let failure: unknown;
      try {
        read();
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(ShadowError);
      expect((failure as ShadowError).code).toBe("WRITE_IN_MEMO");
    }
  });

  it("after: derive with a memo, or write from an effect", () => {
    const [source, setSource] = useStore(1);
    const doubled = useMemo(() => source() * 2); // pure
    const [mirror, setMirror] = useStore(0);
    const dispose = createRoot((stop) => {
      useEffect(() => {
        setMirror(source() * 2); // a side effect belongs here
      });
      return stop;
    });
    flushSync();
    setSource(5);
    flushSync();
    expect(doubled()).toBe(10);
    expect(mirror()).toBe(10);
    dispose();
  });
});
```

### CYCLE_DETECTED

**Error** (`ShadowError`). A memo read itself while it was running, directly or through another memo that had to recompute in the same pull. The error is stored in the memo and thrown to its readers. (Two memos that only *depend* on each other without recomputing inside one another read the previous value; the error appears when a computation re-enters one that is still running.)

*Fix:* a value that depends on its own previous value is not a derivation. Use the `previous` argument that `useMemo` passes to its function, or keep the accumulator in a signal.

```ts
import { useMemo, useStore } from "@shadow-js/core";
import type { Accessor } from "@shadow-js/core";
import { ShadowError } from "@shadow-js/core/extend";
import { describe, expect, it } from "vitest";

describe("CYCLE_DETECTED", () => {
  it("before: a memo reading itself throws; after: use the previous value", () => {
    const [on, setOn] = useStore(false);
    let self: Accessor<number> = () => 0;
    self = useMemo(() => (on() ? self() + 1 : 0));
    setOn(true);
    let failure: unknown;
    try {
      self();
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ShadowError);
    expect((failure as ShadowError).code).toBe("CYCLE_DETECTED");

    const [enabled, setEnabled] = useStore(false);
    const counted = useMemo((previous: number | undefined) =>
      enabled() ? (previous ?? 0) + 1 : 0,
    );
    setEnabled(true);
    expect(counted()).toBe(1);
  });
});
```

### INFINITE_LOOP

**Error** (`ShadowError`, raised when the flush ends). Effects kept re-triggering each other for more than 1000 passes, so the flush was aborted and its queues cleared. Typically an effect writes a signal it also reads.

*Fix:* read the previous value untracked (the updater form `set((n) => n + 1)` does), derive with a memo, or write from an event handler. See [scheduler](https://shadowjs.net/concepts/scheduler/#the-loop-guard).

```ts
import { createRoot, flushSync, useEffect, useStore } from "@shadow-js/core";
import { ShadowError } from "@shadow-js/core/extend";
import { describe, expect, it } from "vitest";

describe("INFINITE_LOOP", () => {
  it("before: the effect rewrites its own source; after: an updater does not subscribe", () => {
    const [n, setN] = useStore(0);
    let runs = 0;
    const loop = createRoot((stop) => {
      useEffect(() => {
        runs += 1;
        setN(n() + 1);
      });
      return stop;
    });
    let failure: unknown;
    try {
      flushSync();
    } catch (error) {
      failure = error;
    }
    expect((failure as ShadowError).code).toBe("INFINITE_LOOP");
    expect(runs).toBe(1000);
    loop();

    const [m, setM] = useStore(0);
    let fixedRuns = 0;
    const fixed = createRoot((stop) => {
      useEffect(() => {
        fixedRuns += 1;
        setM((value) => value + 1);
      });
      return stop;
    });
    flushSync();
    expect(fixedRuns).toBe(1);
    expect(m()).toBe(1);
    fixed();
  });
});
```

### FLUSH_IN_EFFECT

**Warning.** `flushSync()` was called while a flush was already draining (inside an effect or a cleanup). The call is ignored apart from running its callback. *Fix:* remove the call. The flush that is running will process everything you write; if you need the DOM updated, read it in a later effect or after the flush.

```ts
import { createRoot, flushSync, useEffect, useStore } from "@shadow-js/core";
import { resetWarningDedupe } from "@shadow-js/core/extend";
import { captureWarnings } from "@shadow-js/testing";
import { beforeEach, describe, expect, it } from "vitest";

describe("FLUSH_IN_EFFECT", () => {
  beforeEach(() => {
    resetWarningDedupe();
  });

  it("before: flushSync inside an effect warns; after: write signals", () => {
    const [n, setN] = useStore(0);
    const before = captureWarnings(() => {
      const dispose = createRoot((stop) => {
        useEffect(() => {
          flushSync();
        });
        return stop;
      });
      flushSync();
      dispose();
    });
    expect(before.messages[0]).toContain("FLUSH_IN_EFFECT");

    resetWarningDedupe();
    const after = captureWarnings(() => {
      const dispose = createRoot((stop) => {
        useEffect(() => {
          setN(1);
        });
        return stop;
      });
      flushSync();
      dispose();
    });
    expect(after.messages).toEqual([]);
    expect(n()).toBe(1);
  });
});
```

### RUN_WITH_DISPOSED_OWNER

**Warning.** `runWithOwner(owner, fn)` received an owner that was already disposed. The callback runs without an owner, so anything it creates is not owned (and may trigger the `NO_OWNER_*` warnings). It happens when an async callback outlives the component that captured the owner. *Fix:* check `owner.disposed` before scheduling more work, or cancel the work in `onCleanup`.

```ts
import { createRoot, getOwner, runWithOwner } from "@shadow-js/core";
import { resetWarningDedupe } from "@shadow-js/core/extend";
import { captureWarnings } from "@shadow-js/testing";
import { beforeEach, describe, expect, it } from "vitest";

describe("RUN_WITH_DISPOSED_OWNER", () => {
  beforeEach(() => {
    resetWarningDedupe();
  });

  it("warns for a disposed owner; a guard avoids it", () => {
    const { owner, dispose } = createRoot((stop) => ({ owner: getOwner(), dispose: stop }));
    dispose();

    const before = captureWarnings(() => runWithOwner(owner, () => "late work"));
    expect(before.messages[0]).toContain("RUN_WITH_DISPOSED_OWNER");

    resetWarningDedupe();
    const after = captureWarnings(() => {
      if (owner !== null && !owner.disposed) runWithOwner(owner, () => "late work");
    });
    expect(after.messages).toEqual([]);
  });
});
```

### DUPLICATE_CORE

**Raised in development builds.** `createRoot` lists each copy of `@shadow-js/core` in a registry at `globalThis[Symbol.for("shadow-js.core.instances")]`, with the number of its live roots, and warns `DUPLICATE_CORE` ("More than one copy of `@shadow-js/core` is loaded. Signals created by one copy are invisible to the other.") once when a root is created while another copy has live roots. Copies that never run at the same time (separate test files, a reload that disposed the old roots) do not warn. Production builds print nothing; the symptom there is distinctive: components render once and never update, with no warning.

*Why:* two copies of core each own their own tracking registers. A signal created by one copy and read in an effect of the other is a plain value to that effect. Typical causes are two versions of `@shadow-js/core` in `node_modules`, a bundler that inlines core into a library and also resolves it separately, or a pre-bundled dependency (`optimizeDeps`) next to the source copy.

*Fix:* make every package resolve one copy: `npm ls @shadow-js/core` must show a single version, deduplicated; in Vite add `resolve.dedupe: ["@shadow-js/core", "@shadow-js/web"]`; library packages must list core and web as `peerDependencies`.

```ts
import { formatMessage, MESSAGES } from "@shadow-js/core/extend";
import { describe, expect, it } from "vitest";

describe("DUPLICATE_CORE", () => {
  it("is in the catalog", () => {
    expect(Object.keys(MESSAGES)).toContain("DUPLICATE_CORE");
    expect(formatMessage("DUPLICATE_CORE")).toContain("More than one copy of @shadow-js/core");
  });
});
```

### CONTEXT_MISSING

**Error** (`ShadowError`, thrown). `useContext(context)` found no provider above it and the context has no default value. There is no correct value to return. *Fix:* render the provider above the consumer, or give the context a default: `createContext(defaultValue)`.

```ts
import { createContext, createRoot, useContext } from "@shadow-js/core";
import { ShadowError } from "@shadow-js/core/extend";
import { describe, expect, it } from "vitest";

describe("CONTEXT_MISSING", () => {
  it("before: no provider and no default; after: a default value", () => {
    const Theme = createContext<string>();
    let failure: unknown;
    try {
      createRoot((dispose) => {
        useContext(Theme);
        dispose();
      });
    } catch (error) {
      failure = error;
    }
    expect((failure as ShadowError).code).toBe("CONTEXT_MISSING");

    const Fixed = createContext("light");
    const value = createRoot((dispose) => {
      const result = useContext(Fixed);
      dispose();
      return result;
    });
    expect(value).toBe("light");
  });
});
```

### EACH_KEY_DUPLICATE

**Warning.** Two items of a keyed list (`<For key={...}>` or `mapArray` with `key`) have the same key. The first copy owns the row; later copies get a fresh row on every update, so their state is lost. *Fix:* use a key that is unique in the list, normally a database id.

```ts
import { createRoot, mapArray } from "@shadow-js/core";
import { resetWarningDedupe } from "@shadow-js/core/extend";
import { captureWarnings } from "@shadow-js/testing";
import { beforeEach, describe, expect, it } from "vitest";

describe("EACH_KEY_DUPLICATE", () => {
  beforeEach(() => {
    resetWarningDedupe();
  });

  const rows = (items: Array<{ id: number; label: string }>) =>
    createRoot((dispose) => {
      const mapped = mapArray(
        () => items,
        (item) => item().label,
        { key: (item) => item.id },
      );
      const result = mapped();
      dispose();
      return result;
    });

  it("before: duplicate ids warn; after: unique ids do not", () => {
    const before = captureWarnings(() =>
      rows([
        { id: 1, label: "a" },
        { id: 1, label: "b" },
      ]),
    );
    expect(before.messages[0]).toContain("EACH_KEY_DUPLICATE");

    resetWarningDedupe();
    const after = captureWarnings(() =>
      rows([
        { id: 1, label: "a" },
        { id: 2, label: "b" },
      ]),
    );
    expect(after.messages).toEqual([]);
  });
});
```

### EFFECT_DEPS_IGNORED

**Warning.** `useEffect(fn, [deps])` was called with a React-style dependency array. ShadowJS tracks the signals the effect reads, so the array is ignored and the effect re-runs whenever any signal it reads changes. *Fix:* drop the array to track what the body reads, or use `useEffect(deps, fn)` to track only what `deps` reads.

```ts
import { createRoot, flushSync, useEffect, useSignal } from "@shadow-js/core";
import { resetWarningDedupe } from "@shadow-js/core/extend";
import { captureWarnings } from "@shadow-js/testing";
import { beforeEach, describe, expect, it } from "vitest";

describe("EFFECT_DEPS_IGNORED", () => {
  beforeEach(() => {
    resetWarningDedupe();
  });

  it("before: an array warns once; after: the deps function tracks only what it reads", () => {
    const before = captureWarnings(() =>
      createRoot((dispose) => {
        const [count] = useSignal(0);
        // TypeScript refuses the array; plain JavaScript (or a cast) reaches the warning.
        useEffect(() => void count(), [count] as never);
        flushSync();
        dispose();
      }),
    );
    expect(before.messages.filter((m) => m.includes("EFFECT_DEPS_IGNORED"))).toHaveLength(1);

    resetWarningDedupe();
    const after = captureWarnings(() =>
      createRoot((dispose) => {
        const [count] = useSignal(0);
        useEffect(count, () => undefined);
        flushSync();
        dispose();
      }),
    );
    expect(after.messages).toEqual([]);
  });
});
```

## DOM runtime

Raised by `@shadow-js/web` in the browser.

### UNSAFE_URL_BLOCKED

**Warning, once per place.** A URL attribute (`href`, `src`, `action`, `formaction`, `xlink:href`, `poster`, `data`) was given a value that, after removing control characters and whitespace and lower-casing, starts with `javascript:`, `data:text/html` or `vbscript:`. The attribute is **not written**. `useHead` tags are checked the same way. The server renderer applies the same rule silently and writes nothing.

*Fix:* never pass untrusted strings straight to a URL attribute; allow-list the scheme first.

```ts
import { createRoot, flushSync } from "@shadow-js/core";
import { captureWarnings } from "@shadow-js/testing";
import { setAttribute, useHead } from "@shadow-js/web";
import { describe, expect, it } from "vitest";

/** Returns the value only when it is a relative path or an http(s) URL. */
function safeHref(value: string): string | undefined {
  try {
    const url = new URL(value, "https://app.example");
    return url.protocol === "https:" || url.protocol === "http:" ? value : undefined;
  } catch {
    return undefined;
  }
}

describe("UNSAFE_URL_BLOCKED", () => {
  it("before: the value is dropped with a warning; after: it is filtered first", () => {
    const link = document.createElement("a");
    const before = captureWarnings(() => setAttribute(link, "href", " JavaScript:alert(1)"));
    expect(link.hasAttribute("href")).toBe(false);
    expect(before.messages).toHaveLength(1);
    // The first line is the text; the lines after it say where and which page explains the code.
    expect(before.messages[0]?.split("\n")).toEqual([
      '[shadow UNSAFE_URL_BLOCKED] Blocked a script URL in the "href" attribute.',
      "    https://shadowjs.net/faq/diagnostics/#unsafe_url_blocked",
      "    offline: node_modules/@shadow-js/core/skills/diagnostics/SKILL.md",
    ]);

    expect(safeHref("javascript:alert(1)")).toBeUndefined();
    expect(safeHref("/docs")).toBe("/docs");
    setAttribute(link, "href", safeHref("/docs"));
    expect(link.getAttribute("href")).toBe("/docs");
  });

  it("useHead applies the same rule: the tag is dropped, and this second place is reported too", () => {
    const { messages, value: dispose } = captureWarnings(() => {
      const stop = createRoot((end) => {
        useHead({ tag: "link", props: { rel: "stylesheet", href: "javascript:alert(1)" } });
        return end;
      });
      flushSync();
      return stop;
    });
    // Reported once more: the code is the same, the place (and here the text) is not.
    expect(messages.map((message) => message.split("\n")[0])).toEqual([
      '[shadow UNSAFE_URL_BLOCKED] Dropped the unsafe "href" value of a <link> head tag.',
    ]);
    expect(document.head.querySelector('link[href^="javascript"]')).toBeNull();
    dispose();
  });
});
```

### INVALID_ATTRIBUTE_NAME

**Error** (`TypeError`, thrown). An attribute name that cannot appear in markup reached `setAttribute`, `setAttributeNS`, `setBoolAttribute` or, on the server, `ssrAttribute` / `ssrElement`. Valid names match `^[A-Za-z_:][A-Za-z0-9_:.-]*$`. It happens when object keys from user data are spread onto an element (`<div {...data} />`): names with spaces, quotes or `@` are refused instead of being written into markup. In production the message is `SHADOW_INVALID_ATTRIBUTE_NAME: "<name>"`.

*Fix:* spread only keys you control, or filter them first.

```ts
import { setAttribute } from "@shadow-js/web";
import { describe, expect, it } from "vitest";

describe("INVALID_ATTRIBUTE_NAME", () => {
  it("before: an invalid name throws; after: filter the keys", () => {
    const element = document.createElement("div");
    expect(() => setAttribute(element, 'x" onmouseover="alert(1)', "v")).toThrow(
      '[shadow INVALID_ATTRIBUTE_NAME] "x" onmouseover="alert(1)" is not a valid attribute name.',
    );

    const data: Record<string, string> = { title: "ok", "bad name": "x" };
    for (const [name, value] of Object.entries(data)) {
      if (/^[A-Za-z_:][A-Za-z0-9_:.-]*$/.test(name)) setAttribute(element, name, value);
    }
    expect(element.outerHTML).toBe('<div title="ok"></div>');
  });
});
```

The server-side variant of the same code is tested under [Server rendering](#server-rendering).

### SRCDOC_DYNAMIC

**Warning, once per place.** A value computed at run time was written to `srcdoc`. The attribute is not a URL but a whole HTML document that the frame runs, so it is an HTML sink with the trust of `innerHTML`: the value is written as it is, with no scheme check, on the client and on the server. A literal `srcdoc` in JSX is part of the template and never warns. *Fix:* sanitize the document before it reaches the attribute, and give the frame a `sandbox` attribute (without `allow-scripts` and `allow-same-origin` together) so a document that slips through cannot reach your page.

```ts
import { captureWarnings } from "@shadow-js/testing";
import { setAttribute } from "@shadow-js/web";
import { describe, expect, it } from "vitest";

describe("SRCDOC_DYNAMIC", () => {
  it("the computed document is written as it is and the warning names the sandbox attribute", () => {
    const frame = document.createElement("iframe");
    const { messages } = captureWarnings(() => setAttribute(frame, "srcdoc", "<p>hello</p>"));
    expect(frame.getAttribute("srcdoc")).toBe("<p>hello</p>");
    expect(messages.some((message) => message.includes("SRCDOC_DYNAMIC") && message.includes("sandbox"))).toBe(
      true,
    );
  });
});
```

### DYNAMIC_SVG_CASE

**Warning, once per name.** `Dynamic` was given an SVG element name in a case SVG does not spell it in (`clippath`, `CLIPPATH`, `lineargradient`, `fegaussianblur`, `textpath`, ...). The element is created in the SVG namespace with the name exactly as written, because the namespace is case-sensitive: a `clippath` element is not the `clipPath` that `clip-path="url(#...)"`, CSS and `querySelector` mean, so it does nothing. The warning names the canonical spelling. *Fix:* write the name as SVG spells it.

```ts
import { createRoot } from "@shadow-js/core";
import { captureWarnings } from "@shadow-js/testing";
import { Dynamic } from "@shadow-js/web";
import { describe, expect, it } from "vitest";

describe("DYNAMIC_SVG_CASE", () => {
  it("the element keeps the written name and the warning names the canonical one", () => {
    const { messages } = captureWarnings(() => {
      createRoot((dispose) => {
        const made = Dynamic({ component: "lineargradient" });
        expect(made()).toBeInstanceOf(SVGElement);
        expect((made() as Element).localName).toBe("lineargradient");
        dispose();
      });
    });
    expect(messages.some((message) => message.includes("DYNAMIC_SVG_CASE") && message.includes('"linearGradient"'))).toBe(
      true,
    );
  });
});
```

### DUPLICATE_CLASS_ATTRIBUTE

**Warning.** One element carries both `class` and `className` (or `class` twice). Both compile to the `class` attribute, the HTML parser keeps the first and drops the rest, so the second set of classes never applies. *Fix:* keep one, and join the class names into it.

```ts
import { template } from "@shadow-js/web";
import { resetWarningDedupe } from "@shadow-js/core/extend";
import { captureWarnings } from "@shadow-js/testing";
import { beforeEach, describe, expect, it } from "vitest";

describe("DUPLICATE_CLASS_ATTRIBUTE", () => {
  beforeEach(() => {
    resetWarningDedupe();
  });

  it("before: two class attributes warn and the second is lost; after: one attribute", () => {
    const before = captureWarnings(() => template('<div class="a" class="b"></div>')());
    expect(before.messages.some((m) => m.includes("DUPLICATE_CLASS_ATTRIBUTE"))).toBe(true);

    resetWarningDedupe();
    const after = captureWarnings(() => template('<div class="a b"></div>')());
    expect(after.messages).toEqual([]);
  });
});
```

### HYDRATION_KEY_MISS

**Warning, every time it happens** (not deduplicated). During `hydrate()` the client asked for the server element with a given key and the server HTML has none. The client creates the node itself, so the page still works, but the server's work for that part is wasted. Causes: the client rendered a different tree than the server (a branch chosen by `isServer`, `window`, `localStorage`, time or randomness), a different `renderId`, or HTML that was cached from an older build. Keys are explained in [hydration keys](https://shadowjs.net/concepts/hydration-keys/).

*Fix:* render the same components in the same order on both sides; defer client-only content to `onMount`.

```tsx
import { captureWarnings } from "@shadow-js/testing";
import { hydrate } from "@shadow-js/web";
import { describe, expect, it } from "vitest";

describe("HYDRATION_KEY_MISS", () => {
  it("warns for every template the server did not send", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const { messages, value: dispose } = captureWarnings(() =>
      hydrate(() => <p>client only</p>, host), // the container has no server HTML
    );
    expect(messages.map((message) => message.split("\n")[0])).toEqual(['[shadow HYDRATION_KEY_MISS] No server element for key "0-0".']);
    expect(host.innerHTML).toBe("<p>client only</p>");
    dispose();
    host.remove();
  });

  it("is silent when the server sent the element", () => {
    const host = document.createElement("div");
    host.innerHTML = '<p data-hk="0-0">client only</p>';
    document.body.append(host);
    const server = host.querySelector("p");
    const { messages, value: dispose } = captureWarnings(() =>
      hydrate(() => <p>client only</p>, host),
    );
    expect(messages).toEqual([]);
    expect(host.querySelector("p")).toBe(server);
    dispose();
    host.remove();
  });
});
```

### HEAD_OUTSIDE_OWNER

**Warning, every call** (with where it happened and this page). `useHead()` ran with no current owner, so nothing was registered (a head tag must be removed when its owner is disposed). *Fix:* call `useHead` inside a component or `createRoot`.

```ts
import { createRoot } from "@shadow-js/core";
import { captureWarnings } from "@shadow-js/testing";
import { useHead } from "@shadow-js/web";
import { describe, expect, it } from "vitest";

describe("HEAD_OUTSIDE_OWNER", () => {
  it("before: no owner, nothing registered; after: inside a root", () => {
    const before = captureWarnings(() => useHead({ tag: "title", children: "Lost" }));
    expect(before.messages.map((message) => message.split("\n")[0])).toEqual([
      "[shadow HEAD_OUTSIDE_OWNER] useHead() needs an owner; nothing was registered.",
    ]);

    const after = captureWarnings(() => {
      const dispose = createRoot((stop) => {
        useHead({ tag: "title", children: "Kept" });
        return stop;
      });
      dispose();
    });
    expect(after.messages).toEqual([]);
  });
});
```

### PORTAL_TARGET_MISSING

**Warning, once per `Portal`.** `Portal` has no mount element: `mount` was `null`, `undefined` from a function, or `document.getElementById(...)` found nothing. The portal renders nothing. *Fix:* make sure the element exists when the portal is created, pass a function that returns it later, or omit `mount` to render into `document.body`.

```ts
import { createRoot, flushSync } from "@shadow-js/core";
import { captureWarnings } from "@shadow-js/testing";
import { Portal } from "@shadow-js/web";
import { describe, expect, it } from "vitest";

describe("PORTAL_TARGET_MISSING", () => {
  it("before: a missing target warns; after: an existing element mounts the content", () => {
    const before = captureWarnings(() => {
      const dispose = createRoot((stop) => {
        Portal({ mount: document.getElementById("not-there"), children: "lost" });
        return stop;
      });
      flushSync();
      dispose();
    });
    expect(before.messages.map((message) => message.split("\n")[0])).toEqual([
      "[shadow PORTAL_TARGET_MISSING] Portal has no mount element; nothing is rendered.",
    ]);

    const target = document.createElement("div");
    document.body.append(target);
    const after = captureWarnings(() => {
      const dispose = createRoot((stop) => {
        Portal({ mount: target, children: "kept" });
        return stop;
      });
      flushSync();
      expect(target.textContent).toBe("kept");
      dispose();
    });
    expect(after.messages).toEqual([]);
    target.remove();
  });
});
```

## Server rendering

Raised by `@shadow-js/web/server`. These blocks are compiled for the server target and run with `__SERVER__` set, like a real server.

### SSR_BOUNDARY_WATERFALL

**Error** (`SsrError`, `code` property). `renderToStringAsync` needed more than `maxPasses` passes (default 10): each pass resolved resources that, once resolved, made the app create *new* resources, a request waterfall. *Fix:* start independent requests together (create the resources in the same component pass), flatten the data flow, or raise `maxPasses` when the depth is intended.

```ts
import { useResource } from "@shadow-js/core";
import { renderToStringAsync } from "@shadow-js/web/server";
import { describe, expect, it } from "vitest";

/** Each level starts its resource only after the previous one has a value. */
function chain(depth: number): unknown {
  const level = useResource(async () => depth);
  const value = level();
  return value === undefined ? "loading" : [String(value), chain(depth + 1)];
}

describe("SSR_BOUNDARY_WATERFALL", () => {
  it("fails when the chain is longer than maxPasses", async () => {
    await expect(renderToStringAsync(() => chain(0), { maxPasses: 3 })).rejects.toMatchObject({
      name: "SsrError",
      code: "SSR_BOUNDARY_WATERFALL",
    });
  });

  it("a flat request set finishes in two passes", async () => {
    function Flat() {
      const a = useResource(async () => "a");
      const b = useResource(async () => "b");
      const c = useResource(async () => "c");
      return [a(), b(), c()];
    }
    const { html } = await renderToStringAsync(() => Flat(), { maxPasses: 2 });
    expect(html).toBe("abc");
  });
});
```

### SSR_TIMEOUT

**Error** (`SsrError`, `code` property). The render (`renderToStringAsync`, default 10 000 ms) or the stream (`renderToStream`, default 30 000 ms) did not finish within `timeoutMs`; the render is canceled and its roots are disposed. *Fix:* find the resource that never settles (a request without its own timeout), or raise `timeoutMs`.

```ts
import { useResource } from "@shadow-js/core";
import { renderToStringAsync } from "@shadow-js/web/server";
import { describe, expect, it } from "vitest";

describe("SSR_TIMEOUT", () => {
  it("rejects when a resource never settles", async () => {
    function Stuck() {
      const never = useResource(() => new Promise<string>(() => undefined));
      return never();
    }
    await expect(renderToStringAsync(() => Stuck(), { timeoutMs: 20 })).rejects.toMatchObject({
      code: "SSR_TIMEOUT",
    });
  });
});
```

### UNRECOGNIZED_INSERT_VALUE

**Error** (`TypeError`). A value that cannot become markup reached the renderer (a plain object throws in development and renders nothing in production; a `Symbol` throws in both): a plain object, a `Symbol` (also as an attribute value, class name, style value or `innerHTML`), or a style that is not a string, object or array. This is the guard that keeps untrusted objects out of the HTML: only strings, numbers, booleans, `null`/`undefined`, arrays, functions returning those, and trusted `SsrNode` values render.

*Fix:* render a field (`{user.name}`), not the object; stringify explicitly with `JSON.stringify` if you really want text.

```ts
import { escape, renderToString } from "@shadow-js/web/server";
import { describe, expect, it } from "vitest";

describe("UNRECOGNIZED_INSERT_VALUE", () => {
  it("before: an object throws; after: render a field", () => {
    const user = { name: "Ada <b>" };
    expect(() => escape(user)).toThrow("[shadow UNRECOGNIZED_INSERT_VALUE]");
    expect(() => escape(Symbol("s"))).toThrow("[shadow UNRECOGNIZED_INSERT_VALUE]");
    expect(renderToString(() => user.name)).toBe("Ada &lt;b&gt;");
  });
});
```

### INVALID_TAG_NAME

**Error** (`TypeError`). `ssrElement(tag, ...)` (used for elements with spread props) received a tag name that is not letters, digits and dashes starting with a letter. *Fix:* never build tag names from user input; map to an allow-list.

```ts
import { ssrElement } from "@shadow-js/web/server";
import { describe, expect, it } from "vitest";

describe("INVALID_TAG_NAME", () => {
  it("before: a hostile tag throws; after: an allow-list", () => {
    expect(() => ssrElement("div onclick=alert(1)", {}, undefined, false)).toThrow(
      '[shadow INVALID_TAG_NAME] "div onclick=alert(1)" is not a valid tag name.',
    );
    const allowed = new Set(["div", "section"]);
    const tag = allowed.has("section") ? "section" : "div";
    expect(ssrElement(tag, { id: "a" }, undefined, false).t).toBe('<section id="a"></section>');
  });
});
```

### INVALID_STYLE_PROPERTY

**Error** (`TypeError`). An object passed as `style` (or inside a style array) has a key that is not a valid CSS property name, so it could break out of the `style` attribute. camelCase keys (`backgroundColor`) and custom properties (`--gap`) are valid. *Fix:* use real property names; do not take property names from user input.

```ts
import { ssrStyle } from "@shadow-js/web/server";
import { describe, expect, it } from "vitest";

describe("INVALID_STYLE_PROPERTY", () => {
  it("before: a hostile key throws; after: valid names", () => {
    expect(() => ssrStyle({ "color:red;background": "blue" })).toThrow(
      '[shadow INVALID_STYLE_PROPERTY] "color:red;background" is not a valid CSS property name.',
    );
    expect(ssrStyle({ backgroundColor: "blue", "--gap": "4px" })).toBe(
      ' style="background-color:blue;--gap:4px"',
    );
  });
});
```

### UNSERIALIZABLE_VALUE

**Error** (`TypeError`). `serialize(data)` found a value it cannot represent: a function, a symbol, a class instance or another non-plain object. Supported: plain objects, arrays, `Map`, `Set`, `Date`, `URL`, `bigint`, `undefined`, `NaN`, `±Infinity`, `-0`, cycles and shared references. *Fix:* convert to plain data before it goes into resource results.

```ts
import { deserialize, serialize } from "@shadow-js/web/server";
import { describe, expect, it } from "vitest";

describe("UNSERIALIZABLE_VALUE", () => {
  it("before: a function throws; after: plain data round-trips", () => {
    expect(() => serialize({ onDone: () => 1 })).toThrow("[shadow UNSERIALIZABLE_VALUE]");
    const text = serialize({ when: new Date(0), tags: new Set(["a"]), n: 10n });
    const back = deserialize(text) as { when: Date; tags: Set<string>; n: bigint };
    expect(back.when.getTime()).toBe(0);
    expect([...back.tags]).toEqual(["a"]);
    expect(back.n).toBe(10n);
  });
});
```

`INVALID_ATTRIBUTE_NAME` on the server has the same meaning as in the DOM runtime entry above: `ssrAttribute` and `ssrElement` throw it for invalid names.

```ts
import { ssrAttribute } from "@shadow-js/web/server";
import { describe, expect, it } from "vitest";

describe("INVALID_ATTRIBUTE_NAME (server)", () => {
  it("throws for a name that could break out of the tag", () => {
    expect(() => ssrAttribute('a" onload="x', "v")).toThrow("[shadow INVALID_ATTRIBUTE_NAME]");
    expect(ssrAttribute("title", "v")).toBe(' title="v"');
  });

  it("URL attributes with a script scheme are dropped silently on the server", () => {
    expect(ssrAttribute("href", "javascript:alert(1)")).toBe("");
    expect(ssrAttribute("href", "/docs")).toBe(' href="/docs"');
  });
});
```

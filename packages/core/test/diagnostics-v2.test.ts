import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createComputation,
  createOwner,
  diagnosticUrl,
  disposeOwner,
  formatMessage,
  nameOwner,
  ownerPath,
  type ReportedDiagnostic,
  reportDiagnostic,
  resetWarningDedupe,
  runInScope,
  ShadowError,
  setWarningListener,
  subscribeDiagnostics,
  warn,
} from "../src/extend";
import { createRoot, flushSync, useEffect, useMemo, useSignal } from "../src/index";

/** The texts printed with `console.warn` since the last call, which also marks them as asserted. */
function takeWarnings(): string[] {
  const calls = vi.mocked(console.warn).mock.calls.map((args) => String(args[0]));
  vi.mocked(console.warn).mockClear();
  return calls;
}

/** Runs `fn` under an owner named like a component, as the DOM runtime names component owners. */
function component<T>(name: string, fn: () => T): T {
  const owner = createOwner();
  nameOwner(owner, name);
  return runInScope({ owner, listener: null }, fn);
}

describe("diagnostics: where a report comes from", () => {
  beforeEach(() => {
    resetWarningDedupe();
  });
  afterEach(() => {
    resetWarningDedupe();
  });

  it("[DX-1] ownerPath names the components above an owner and the effect or memo it is, from the outside in", () => {
    let path = "";
    let named = "";
    const dispose = createRoot((end) => {
      component("App", () => {
        component("TodoList", () => {
          createOwner(); // a plain scope says nothing and is left out
          const effect = createComputation({ kind: "effect", render: true, fn: () => undefined });
          path = ownerPath(effect);
          const memo = createComputation({ kind: "memo", fn: () => 1, name: "total" });
          named = ownerPath(memo);
        });
      });
      return end;
    });
    expect(path).toBe("<App> > <TodoList> > effect");
    expect(named).toBe('<App> > <TodoList> > memo "total"');
    expect(ownerPath(null)).toBe("");
    dispose();
  });

  it("[DX-2] a path keeps the innermost eight entries of a deep tree and says that it was cut", () => {
    const root = createOwner(null);
    let owner = root;
    for (let depth = 0; depth < 12; depth += 1) {
      owner = createOwner(owner);
      nameOwner(owner, `L${depth}`);
    }
    expect(ownerPath(owner)).toBe("... > <L4> > <L5> > <L6> > <L7> > <L8> > <L9> > <L10> > <L11>");
    disposeOwner(root);
  });

  it("[DX-3] a warning prints its text, the owner path, the page of the code and, the first time, the offline guide", () => {
    const dispose = createRoot((end) => {
      component("Clock", () => warn("EFFECT_DEPS_IGNORED"));
      component("Timer", () => warn("EFFECT_DEPS_IGNORED"));
      return end;
    });
    const [first, second] = takeWarnings();
    expect(first).toBe(
      `${formatMessage("EFFECT_DEPS_IGNORED")}\n    in <Clock>\n    https://shadowjs.net/faq/diagnostics/#effect_deps_ignored\n    offline: node_modules/@shadow-js/core/skills/diagnostics/SKILL.md`,
    );
    expect(second).toBe(
      `${formatMessage("EFFECT_DEPS_IGNORED")}\n    in <Timer>\n    https://shadowjs.net/faq/diagnostics/#effect_deps_ignored`,
    );
    dispose();
  });

  it("[DX-4] one code is reported once per place: a second component reports, a second instance of the same one does not", () => {
    const dispose = createRoot((end) => {
      for (let i = 0; i < 3; i += 1) component("Row", () => warn("EFFECT_DEPS_IGNORED"));
      component("Header", () => warn("EFFECT_DEPS_IGNORED"));
      return end;
    });
    expect(takeWarnings().map((text) => text.split("\n")[1])).toEqual([
      "    in <Row>",
      "    in <Header>",
    ]);
    dispose();
  });

  it("[DX-5] the places kept for one code are bounded: the seventeenth place of a code is not reported", () => {
    const dispose = createRoot((end) => {
      for (let i = 0; i < 40; i += 1) component(`Place${i}`, () => warn("EFFECT_DEPS_IGNORED"));
      return end;
    });
    expect(takeWarnings()).toHaveLength(16);
    dispose();
  });

  it("[DX-6] the listener of setWarningListener still receives the code and the plain message, once per place", () => {
    const received: string[] = [];
    const previous = setWarningListener((code, message) => {
      received.push(`${code}|${message}`);
    });
    try {
      warn("NO_OWNER_CLEANUP");
      warn("NO_OWNER_CLEANUP");
    } finally {
      setWarningListener(previous);
    }
    expect(received).toEqual([`NO_OWNER_CLEANUP|${formatMessage("NO_OWNER_CLEANUP")}`]);
    expect(takeWarnings()).toEqual([]);
  });

  it("[DX-7] subscribeDiagnostics receives core warnings and reportDiagnostic calls as data, until it is stopped", () => {
    const found: ReportedDiagnostic[] = [];
    const stop = subscribeDiagnostics((diagnostic) => {
      found.push(diagnostic);
    });
    const dispose = createRoot((end) => {
      component("Player", () => {
        warn("EFFECT_DEPS_IGNORED");
        expect(reportDiagnostic("VOLUME_RANGE", "[player VOLUME_RANGE] too loud")).toBe(true);
        expect(reportDiagnostic("VOLUME_RANGE", "[player VOLUME_RANGE] too loud")).toBe(false);
      });
      return end;
    });
    stop();
    warn("NO_OWNER_ERROR");
    expect(found).toEqual([
      {
        code: "EFFECT_DEPS_IGNORED",
        message: formatMessage("EFFECT_DEPS_IGNORED"),
        ownerPath: "<Player>",
        url: diagnosticUrl("EFFECT_DEPS_IGNORED"),
      },
      {
        code: "VOLUME_RANGE",
        message: "[player VOLUME_RANGE] too loud",
        ownerPath: "<Player>",
        url: "",
      },
    ]);
    const printed = takeWarnings();
    expect(printed).toHaveLength(3);
    // A code of a library has no section on the ShadowJS page: no address and no offline guide is printed for it.
    expect(printed[1]).toBe("[player VOLUME_RANGE] too loud\n    in <Player>");
    dispose();
  });

  it("[DX-7b] a reporter that names its own page gets that address printed, and never the ShadowJS offline guide", () => {
    reportDiagnostic("VOLUME_RANGE", "[player VOLUME_RANGE] too loud", {
      url: "https://player.example/e#v",
    });
    reportDiagnostic("SHADOW_OWN", "[shadow SHADOW_OWN] x", { url: diagnosticUrl("SHADOW_OWN") });
    expect(takeWarnings()).toEqual([
      "[player VOLUME_RANGE] too loud\n    https://player.example/e#v",
      "[shadow SHADOW_OWN] x\n    https://shadowjs.net/faq/diagnostics/#shadow_own\n    offline: node_modules/@shadow-js/core/skills/diagnostics/SKILL.md",
    ]);
  });

  it("[DX-7c] every: true reports each occurrence, with the offline guide on the first one only", () => {
    const url = diagnosticUrl("SOME_EVENT");
    expect(reportDiagnostic("SOME_EVENT", "[shadow SOME_EVENT] a", { url, every: true })).toBe(
      true,
    );
    expect(reportDiagnostic("SOME_EVENT", "[shadow SOME_EVENT] a", { url, every: true })).toBe(
      true,
    );
    expect(takeWarnings()).toEqual([
      `[shadow SOME_EVENT] a\n    ${url}\n    offline: node_modules/@shadow-js/core/skills/diagnostics/SKILL.md`,
      `[shadow SOME_EVENT] a\n    ${url}`,
    ]);
  });

  it("[DX-8] a key reports once per code and key, whatever the place, and more keys than places are kept", () => {
    for (let i = 0; i < 40; i += 1) {
      expect(reportDiagnostic("NAME_CASE", `[x NAME_CASE] ${i}`, { key: `name${i}` })).toBe(true);
    }
    expect(reportDiagnostic("NAME_CASE", "[x NAME_CASE] again", { key: "name3" })).toBe(false);
    expect(takeWarnings()).toHaveLength(40);
  });

  it("[DX-9] the codes remembered are bounded: the 257th code made up at run time is not reported", () => {
    for (let i = 0; i < 256; i += 1) reportDiagnostic(`MADE_UP_${i}`, "x");
    expect(reportDiagnostic("ONE_MORE", "x")).toBe(false);
    expect(takeWarnings()).toHaveLength(256);
  });

  it("[DX-10] a ShadowError says where it was thrown and which page explains it; its code and first line are unchanged", () => {
    let error: unknown;
    const dispose = createRoot((end) => {
      component("Cart", () => {
        const [count, setCount] = useSignal(0);
        const doubled = useMemo(() => {
          setCount(count() + 1);
          return count() * 2;
        });
        try {
          doubled();
        } catch (caught) {
          error = caught;
        }
      });
      return end;
    });
    expect(error).toBeInstanceOf(ShadowError);
    const message = (error as ShadowError).message;
    expect((error as ShadowError).code).toBe("WRITE_IN_MEMO");
    expect(message.split("\n")).toEqual([
      formatMessage("WRITE_IN_MEMO"),
      "    in <Cart> > memo",
      "    https://shadowjs.net/faq/diagnostics/#write_in_memo",
    ]);
    dispose();
  });

  it("[DX-11] INFINITE_LOOP names an effect of the loop", () => {
    let error: unknown;
    const dispose = createRoot((end) => {
      component("Counter", () => {
        const [count, setCount] = useSignal(0);
        useEffect(() => {
          setCount(count() + 1);
        });
      });
      return end;
    });
    try {
      flushSync();
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ShadowError);
    expect((error as ShadowError).code).toBe("INFINITE_LOOP");
    expect((error as ShadowError).message).toContain("\n    in <Counter> > effect\n");
    dispose();
  });
});

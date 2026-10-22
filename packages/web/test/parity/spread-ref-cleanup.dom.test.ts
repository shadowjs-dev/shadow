import { createRoot, flushSync, useSignal } from "@shadow-js/core";
import { describe, expect, it } from "vitest";
import { spread } from "../../src/index";

describe("ref callbacks delivered through {...spread} (residual R-REFSPREAD)", () => {
  it("[RCL-03] a cleanup returned by a ref inside spread runs when the owner is disposed", () => {
    const el = document.createElement("input");
    const log: string[] = [];
    const dispose = createRoot((d) => {
      spread(el, {
        ref: () => () => {
          log.push("cleanup");
        },
      });
      return d;
    });
    flushSync();
    expect(log).toEqual([]);
    dispose();
    flushSync();
    expect(log).toEqual(["cleanup"]);
  });

  it("[RCL-04] replacing the ref inside spread runs the previous cleanup before the new ref", () => {
    const el = document.createElement("input");
    const log: string[] = [];
    let setRef: (next: (node: Element) => unknown) => void = () => undefined;
    createRoot(() => {
      const [ref, writeRef] = useSignal<(node: Element) => unknown>(() => undefined);
      setRef = writeRef;
      spread(el, () => ({ ref: ref() }));
    });
    flushSync();
    setRef(() => () => {
      log.push("first");
      return () => log.push("first cleanup");
    });
    flushSync();
    setRef(() => () => {
      log.push("second");
      return () => log.push("second cleanup");
    });
    flushSync();
    expect(log).toEqual(["first", "first cleanup", "second"]);
  });

  it("[RCL-05] removing the ref from the props runs its cleanup", () => {
    const el = document.createElement("input");
    const log: string[] = [];
    let setProps: (next: Record<string, unknown>) => void = () => undefined;
    createRoot(() => {
      const [props, writeProps] = useSignal<Record<string, unknown>>({
        ref: () => () => {
          log.push("cleanup");
        },
      });
      setProps = writeProps;
      spread(el, () => props());
    });
    flushSync();
    expect(log).toEqual([]);
    setProps({});
    flushSync();
    expect(log).toEqual(["cleanup"]);
  });
});

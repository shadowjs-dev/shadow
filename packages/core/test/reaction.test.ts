import { describe, expect, it } from "vitest";
import { createRoot, flushSync, useReaction, useSignal } from "../src/index";

describe("useReaction", () => {
  it("[RXN-01] track(fn) invalidates once when a read of fn changes, then does nothing until track runs again", () => {
    const [value, setValue] = useSignal("start");
    const log: string[] = [];
    createRoot(() => {
      const track = useReaction(() => {
        log.push("changed");
      });
      track(() => {
        value();
      });
    });
    setValue("end");
    flushSync();
    expect(log).toEqual(["changed"]);
    setValue("final");
    flushSync();
    expect(log).toEqual(["changed"]);
  });

  it("[RXN-02] track can be called again to re-arm the reaction", () => {
    const [value, setValue] = useSignal(1);
    const log: string[] = [];
    let track: ((fn: () => void) => void) | undefined;
    createRoot(() => {
      track = useReaction(() => {
        log.push("changed");
      });
      track(() => {
        value();
      });
    });
    setValue(2);
    flushSync();
    track?.(() => {
      value();
    });
    setValue(3);
    flushSync();
    expect(log).toEqual(["changed", "changed"]);
  });

  it("[RXN-03] the tracking function runs synchronously inside track()", () => {
    const seen: number[] = [];
    createRoot(() => {
      const track = useReaction(() => undefined);
      track(() => {
        seen.push(1);
      });
    });
    expect(seen).toEqual([1]);
  });

  it("[RXN-04] disposing the owner stops the reaction", () => {
    const [value, setValue] = useSignal(0);
    const log: string[] = [];
    const dispose = createRoot((d) => {
      const track = useReaction(() => log.push("changed"));
      track(() => {
        value();
      });
      return d;
    });
    dispose();
    setValue(1);
    flushSync();
    expect(log).toEqual([]);
  });
});

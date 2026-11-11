import { describe, expect, it } from "vitest";
import { createRoot, flushSync, onCleanup, useEffect, useMemo, useSignal } from "../src/index";

describe("an owner that is disposed while its own body is still running", () => {
  it("[CORE-F02] a cleanup registered after the effect disposed its root still runs", () => {
    const log: string[] = [];
    createRoot((dispose) => {
      useEffect(() => {
        dispose();
        // The owner is already gone: nobody would ever run this, so a timer or listener registered here leaked.
        onCleanup(() => log.push("late cleanup"));
      });
    });
    flushSync();
    expect(log).toEqual(["late cleanup"]);
  });

  it("[CORE-F02] an effect created after the disposal is disposed with the run and never subscribes", () => {
    const [source, setSource] = useSignal(0);
    const log: string[] = [];
    createRoot((dispose) => {
      useEffect(() => {
        dispose();
        useEffect(() => {
          log.push(`child ${source()}`);
          onCleanup(() => log.push("child cleanup"));
        });
      });
    });
    flushSync();
    setSource(1);
    flushSync();
    setSource(2);
    flushSync();
    // Before the fix the child stayed alive: it ran for every change of `source` after its root was gone.
    expect(log.filter((entry) => entry.startsWith("child ")).length).toBe(0);
  });

  it("[CORE-F02] a root body that disposes itself, then registers a cleanup and an effect, leaves nothing behind", () => {
    const log: string[] = [];
    const [source, setSource] = useSignal(0);
    createRoot((dispose) => {
      dispose();
      onCleanup(() => log.push("cleanup"));
      useEffect(() => {
        log.push(`effect ${source()}`);
      });
    });
    flushSync();
    setSource(1);
    flushSync();
    expect(log).toEqual(["cleanup"]);
  });

  it("[CORE-F02] a memo that disposes its root while it computes keeps no cleanup behind", () => {
    const log: string[] = [];
    createRoot((dispose) => {
      const value = useMemo(() => {
        dispose();
        onCleanup(() => log.push("memo cleanup"));
        return 1;
      });
      value();
    });
    expect(log).toEqual(["memo cleanup"]);
  });
});

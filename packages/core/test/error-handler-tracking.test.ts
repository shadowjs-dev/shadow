import { expect, it } from "vitest";
import { catchError, createRoot, flushSync, useEffect, useSignal } from "../src/index";

it("[ERR-TRACK-01] synchronous catch handlers cannot subscribe their caller and caller tracking resumes afterward", () => {
  const [secret, setSecret] = useSignal(0);
  const [tracked, setTracked] = useSignal(0);
  let runs = 0;
  let handled = 0;
  const dispose = createRoot((stop) => {
    useEffect(() => {
      runs += 1;
      catchError(
        () => {
          throw new Error("contained");
        },
        () => {
          handled += 1;
          secret();
        },
      );
      tracked();
    });
    return stop;
  });
  try {
    flushSync();
    expect(runs).toBe(1);
    expect(handled).toBe(1);
    setSecret(1);
    flushSync();
    expect(runs).toBe(1);
    setTracked(1);
    flushSync();
    expect(runs).toBe(2);
    expect(handled).toBe(2);
  } finally {
    dispose();
  }
});

it("[ERR-TRACK-02] rethrowing handlers remain untracked through the chain and restore tracking after the final handler", () => {
  const [secret, setSecret] = useSignal(0);
  const [tracked, setTracked] = useSignal(0);
  let runs = 0;
  const seen: string[] = [];
  const dispose = createRoot((stop) => {
    useEffect(() => {
      runs += 1;
      catchError(
        () =>
          catchError(
            () => {
              throw new Error("inner");
            },
            () => {
              secret();
              seen.push("inner");
              throw new Error("outer");
            },
          ),
        () => {
          secret();
          seen.push("outer");
        },
      );
      tracked();
    });
    return stop;
  });
  try {
    flushSync();
    expect(seen).toEqual(["inner", "outer"]);
    setSecret(1);
    flushSync();
    expect(runs).toBe(1);
    setTracked(1);
    flushSync();
    expect(runs).toBe(2);
    expect(seen).toEqual(["inner", "outer", "inner", "outer"]);
  } finally {
    dispose();
  }
});

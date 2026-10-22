import { describe, expect, it } from "vitest";
import { catchError, createRoot, flushSync, useEffect } from "../src/index";
import { hostileThrown } from "./support/hostile-thrown";

/**
 * Every thrown value reaches the nearest error handler as it was thrown. A value that is hostile to the
 * runtime's own reads (a throwing getter, a cycle, a symbol, a frozen object, a null prototype) must not
 * replace the error with one of its own.
 */
describe("hostile thrown values reach the error handler as thrown", () => {
  for (const [name, value] of hostileThrown()) {
    it(`[ERR-C1] ${name}: catchError receives the value itself`, () => {
      const seen: unknown[] = [];
      catchError(
        () => {
          throw value;
        },
        (error) => {
          seen.push(error);
        },
      );
      expect(seen).toHaveLength(1);
      expect(seen[0]).toBe(value);
    });

    it(`[ERR-C2] ${name}: an effect that throws it reaches the handler of its owner`, () => {
      const seen: unknown[] = [];
      createRoot((dispose) => {
        catchError(
          () => {
            useEffect(() => {
              throw value;
            });
          },
          (error) => {
            seen.push(error);
          },
        );
        return dispose;
      });
      flushSync();
      expect(seen).toHaveLength(1);
      expect(seen[0]).toBe(value);
    });
  }
});

import { createRoot, flushSync, useEffect } from "@shadow-js/core";
import { describe, expect, it } from "vitest";
import { ErrorBoundary } from "../../src/control-flow/index";
import { createComponent } from "../../src/index";
import { hostileThrown } from "../support/hostile-thrown";

/** Unwraps accessors the way the DOM insert does: a function value is read until a plain value appears. */
function unwrap(value: unknown): unknown {
  let current = value;
  while (typeof current === "function") current = (current as () => unknown)();
  return current;
}

/**
 * The boundary's reset path with each hostile thrown value: the fallback receives the value as thrown, and after a
 * reset the children render again, with no error of the boundary's own.
 */
describe("error boundary reset with hostile thrown values", () => {
  for (const [name, value] of hostileThrown()) {
    it(`[ERR-B3] ${name}: reset rebuilds the children after the value was shown`, () => {
      let failing = true;
      const Child = (): unknown => {
        if (failing) throw value;
        return "ok";
      };
      const seen: unknown[] = [];
      let resetFallback: (() => void) | undefined;
      const values: unknown[] = [];
      const dispose = createRoot((dispose) => {
        const view = ErrorBoundary({
          fallback: (error: unknown, reset: () => void) => {
            seen.push(error);
            resetFallback = reset;
            return "caught";
          },
          get children() {
            return createComponent(Child, {});
          },
        });
        useEffect(() => {
          values.push(unwrap(view));
        });
        return dispose;
      });
      flushSync();
      expect(values.at(-1)).toBe("caught");
      expect(seen).toHaveLength(1);
      expect(seen[0]).toBe(value);

      failing = false;
      resetFallback?.();
      flushSync();
      expect(values.at(-1)).toBe("ok");
      dispose();
    });
  }
});

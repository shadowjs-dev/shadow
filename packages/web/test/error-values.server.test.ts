import { describe, expect, it } from "vitest";
import { ErrorBoundary } from "../src/control-flow/error-boundary";
import { createComponent, renderToString } from "../src/server/index";
import { hostileThrown } from "./support/hostile-thrown";

/**
 * Every thrown value the error paths meet: the boundary, the root reporters and the fallback must take each
 * one as it was thrown, without a TypeError of their own.
 */
describe("hostile thrown values reach the error boundary and the reporters", () => {
  for (const [name, value] of hostileThrown()) {
    it(`[ERR-W1] ${name}: the boundary shows its fallback with the value as thrown`, () => {
      const seen: unknown[] = [];
      const caught: unknown[] = [];
      const Thrower = (): unknown => {
        throw value;
      };
      const Guarded = (): unknown =>
        ErrorBoundary({
          fallback: (error: unknown) => {
            seen.push(error);
            return "caught";
          },
          get children() {
            return createComponent(Thrower, {});
          },
        });
      const html = renderToString(() => createComponent(Guarded, {}), {
        onCaughtError: (error) => caught.push(error),
      });
      expect(html).toBe("caught");
      expect(seen).toHaveLength(1);
      expect(seen[0]).toBe(value);
      expect(caught).toHaveLength(1);
      expect(caught[0]).toBe(value);
    });

    it(`[ERR-W2] ${name}: a fallback that throws it hands the value to onUncaughtError as thrown`, () => {
      const uncaught: unknown[] = [];
      const Thrower = (): unknown => {
        throw new Error("component failed");
      };
      const Guarded = (): unknown =>
        ErrorBoundary({
          fallback: () => {
            throw value;
          },
          get children() {
            return createComponent(Thrower, {});
          },
        });
      const html = renderToString(() => createComponent(Guarded, {}), {
        onUncaughtError: (error) => uncaught.push(error),
      });
      expect(html).toBe("");
      expect(uncaught).toHaveLength(1);
      expect(uncaught[0]).toBe(value);
    });
  }
});

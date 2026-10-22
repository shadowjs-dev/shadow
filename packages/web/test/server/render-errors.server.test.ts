import { useResource } from "@shadow-js/core";
import { describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "../../src/control-flow/error-boundary";
import { Suspense } from "../../src/control-flow/suspense";
import {
  createComponent,
  renderToStream,
  renderToString,
  renderToStringAsync,
} from "../../src/server/index";

/** Throws when rendered. Each test that counts runs keeps its own counter. */
const Boom = (): unknown => {
  throw new Error("boom");
};

/** Rendered inside an ErrorBoundary whose fallback is "caught". */
const Guarded = (): unknown =>
  ErrorBoundary({
    fallback: "caught",
    // Read inside the boundary, so the component's error is the one the boundary takes.
    get children() {
      return createComponent(Boom, {});
    },
  });

/**
 * A boundary whose fallback throws. The fallback's error is not the boundary's to take: the owners route it
 * to the enclosing handler, and the root's onUncaughtError is the last one.
 */
const FallbackThrows = (): unknown =>
  ErrorBoundary({
    fallback: (): unknown => {
      throw new Error("fallback boom");
    },
    get children() {
      return createComponent(Boom, {});
    },
  });

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out;
    out += decoder.decode(value);
  }
}

describe("server render error reporters", () => {
  it("[SSR-197] renderToString reports a caught error to onCaughtError once, and the fallback is the markup", () => {
    const onCaughtError = vi.fn();
    const onUncaughtError = vi.fn();
    const html = renderToString(() => Guarded(), { onCaughtError, onUncaughtError });
    expect(html).toBe("caught");
    expect(onCaughtError).toHaveBeenCalledTimes(1);
    const [reported] = onCaughtError.mock.calls[0] ?? [];
    expect((reported as Error).message).toBe("boom");
    expect(onUncaughtError).not.toHaveBeenCalled();
  });

  it("[SSR-198] an error the owners route to the root goes to onUncaughtError, and renderToString does not throw it", () => {
    const onCaughtError = vi.fn();
    const onUncaughtError = vi.fn();
    const html = renderToString(() => FallbackThrows(), { onCaughtError, onUncaughtError });
    expect(html).toBe("");
    // The boundary took the component's error; its fallback's error had no boundary left to take it.
    expect(onCaughtError).toHaveBeenCalledTimes(1);
    expect(((onCaughtError.mock.calls[0] ?? [])[0] as Error).message).toBe("boom");
    expect(onUncaughtError).toHaveBeenCalledTimes(1);
    expect(((onUncaughtError.mock.calls[0] ?? [])[0] as Error).message).toBe("fallback boom");
  });

  it("[SSR-199] a synchronous throw of the render itself propagates, with or without onUncaughtError (as on the client)", () => {
    const onCaughtError = vi.fn();
    const onUncaughtError = vi.fn();
    expect(() =>
      renderToString(() => createComponent(Boom, {}), { onCaughtError, onUncaughtError }),
    ).toThrow("boom");
    expect(() => renderToString(() => createComponent(Boom, {}), { onCaughtError })).toThrow(
      "boom",
    );
    expect(onCaughtError).not.toHaveBeenCalled();
    expect(onUncaughtError).not.toHaveBeenCalled();
  });

  it("[SSR-200] each boundary that catches an error reports it, and the reports arrive in render order", () => {
    const Second = (): unknown =>
      ErrorBoundary({
        fallback: "second caught",
        get children() {
          return createComponent((): unknown => {
            throw new TypeError("second");
          }, {});
        },
      });
    const onCaughtError = vi.fn();
    const html = renderToString(() => [Guarded(), Second()], { onCaughtError });
    expect(html).toBe("caughtsecond caught");
    const messages = onCaughtError.mock.calls.map(([error]) => (error as Error).message);
    expect(messages).toEqual(["boom", "second"]);
  });

  it("[SSR-201] renderToStringAsync reports a caught error once, although every pass renders it again", async () => {
    let runs = 0;
    const Flaky = (): unknown => {
      runs += 1;
      throw new Error("flaky");
    };
    const Loaded = (props: { p: Promise<string> }): unknown => {
      const data = useResource(() => props.p, { key: "ssr-201" });
      return data() ?? "loading";
    };
    const onCaughtError = vi.fn();
    const result = await renderToStringAsync(
      () => [
        ErrorBoundary({
          fallback: "caught",
          get children() {
            return createComponent(Flaky, {});
          },
        }),
        createComponent(Loaded, { p: Promise.resolve("value") }),
      ],
      { onCaughtError },
    );
    expect(result.html).toContain("caught");
    // The final pass is the answer; the earlier passes rendered the same boundary too.
    expect(runs).toBeGreaterThanOrEqual(2);
    expect(onCaughtError).toHaveBeenCalledTimes(1);
    expect(((onCaughtError.mock.calls[0] ?? [])[0] as Error).message).toBe("flaky");
  });

  it("[SSR-202] renderToStringAsync reports an uncaught error to onUncaughtError once, on the answering pass", async () => {
    const Loaded = (props: { p: Promise<string> }): unknown => {
      const data = useResource(() => props.p, { key: "ssr-202" });
      return data() ?? "loading";
    };
    const onUncaughtError = vi.fn();
    const result = await renderToStringAsync(
      () => [createComponent(Loaded, { p: Promise.resolve("value") }), FallbackThrows()],
      { onUncaughtError },
    );
    // The answering pass has the resolved value; the fallback that threw renders nothing.
    expect(result.html).toBe("value");
    expect(onUncaughtError).toHaveBeenCalledTimes(1);
    expect(((onUncaughtError.mock.calls[0] ?? [])[0] as Error).message).toBe("fallback boom");
  });

  it("[SSR-203] renderToStream: a shell error is reported before the shell is ready, a later boundary's error after", async () => {
    const late = Promise.resolve("ready");
    const LateBoom = (props: { p: Promise<string> }): unknown => {
      const data = useResource(() => props.p, { key: "ssr-203" });
      return ErrorBoundary({
        fallback: "late-caught",
        get children() {
          if (data() !== undefined) throw new Error("late");
          return "pending";
        },
      });
    };
    const reportedAtShell: number[] = [];
    const messages: string[] = [];
    let total = 0;
    const onCaughtError = (error: unknown): void => {
      total += 1;
      messages.push((error as Error).message);
    };
    const stream = renderToStream(
      () => [
        Guarded(),
        Suspense({
          fallback: "loading",
          get children() {
            return createComponent(LateBoom, { p: late });
          },
        }),
      ],
      {
        onCaughtError,
        onShellReady: (shell) => {
          reportedAtShell.push(total);
          expect(shell).toContain("caught");
          expect(shell).toContain("loading");
        },
      },
    );
    const body = await readAll(stream);
    // The shell error is reported before the first byte; the later one only once it happens.
    expect(reportedAtShell).toEqual([1]);
    expect(messages).toEqual(["boom", "late"]);
    expect(body).toContain("late-caught");
  });

  it("[SSR-204] a bad render option is a TypeError whose message names the option", async () => {
    expect(() => renderToString(() => "x", { renderId: "a b" })).toThrow(
      new TypeError("render options: renderId must be made of letters, digits, _ and -."),
    );
    expect(() => renderToStream(() => "x", { renderId: "a b" })).toThrow(
      "render options: renderId",
    );
    await expect(renderToStringAsync(() => "x", { timeoutMs: 0 })).rejects.toThrow(
      "render options: timeoutMs must be a positive finite number.",
    );
    await expect(renderToStringAsync(() => "x", { maxPasses: 0 })).rejects.toThrow(
      "render options: maxPasses must be an integer of at least 1.",
    );
  });
});

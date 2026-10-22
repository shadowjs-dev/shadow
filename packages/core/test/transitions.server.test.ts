import { describe, expect, it } from "vitest";
import {
  createRoot,
  startTransition,
  useDeferredValue,
  useSignal,
  useTransition,
} from "../src/index";

describe("transitions on the server", () => {
  it("[TRN-S1] startTransition runs its callback synchronously and resolves at once", async () => {
    let set: (next: number) => void = () => undefined;
    let get: () => number = () => -1;
    createRoot(() => {
      const [current, setCurrent] = useSignal(0);
      set = setCurrent;
      get = current;
    });
    const done = startTransition(() => set(3));
    expect(get()).toBe(3);
    await done;
  });

  it("[TRN-S2] useDeferredValue returns the current value on the server (no lane)", () => {
    createRoot(() => {
      const [value, setValue] = useSignal(4);
      const deferred = useDeferredValue(value);
      expect(deferred()).toBe(4);
      setValue(5);
      expect(deferred()).toBe(5);
    });
  });

  it("[TRN-S3] useTransition returns [pending, start] with pending false", () => {
    createRoot(() => {
      const [pending] = useTransition();
      expect(pending()).toBe(false);
    });
  });
});

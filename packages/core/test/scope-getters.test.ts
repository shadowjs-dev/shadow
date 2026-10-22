import { expect, it, vi } from "vitest";
import { createOwner, disposeOwner, runInScope } from "../src/extend";
import { createRoot, getOwner } from "../src/index";

it("[SCOPE-GETTER-01] scope registers are evaluated once during installation", () => {
  const root = createOwner(null);
  let owners = 0;
  let listeners = 0;
  try {
    expect(
      runInScope(
        {
          get owner() {
            owners += 1;
            return root;
          },
          get listener() {
            listeners += 1;
            return null;
          },
        },
        getOwner,
      ),
    ).toBe(root);
    expect(owners).toBe(1);
    expect(listeners).toBe(1);
  } finally {
    disposeOwner(root);
  }
});

it("[SCOPE-GETTER-02] a failing scope getter cannot leave a partially installed owner", () => {
  const failure = new Error("scope getter failed");
  const fn = vi.fn();
  const dispose = createRoot((stop) => {
    const original = getOwner();
    const child = createOwner(original);
    expect(() =>
      runInScope(
        {
          owner: child,
          get listener(): never {
            throw failure;
          },
        },
        fn,
      ),
    ).toThrow(failure);
    expect(getOwner()).toBe(original);
    expect(fn).not.toHaveBeenCalled();
    return stop;
  });
  dispose();
});

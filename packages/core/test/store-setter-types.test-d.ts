/**
 * Compile-time checks for the `useStore` setter. Vitest does not run this file; `tsc -p
 * packages/core/tsconfig.json` does. The setter's public overloads are the contract that forms and
 * other packages rely on without casts.
 */
import { describe, expectTypeOf, it } from "vitest";
import { type SetStore, type Store, useStore } from "../src/store";

interface Todo {
  title: string;
  done: boolean;
}

describe("useStore setter types", () => {
  it("[SST-01] plain data gives a deep store and a setter typed for that data", () => {
    const [todos, setTodos] = useStore({ items: [] as Todo[] });
    expectTypeOf(todos.items.length).toEqualTypeOf<number>();
    // @ts-expect-error reads through a store are read-only: the array has no push
    todos.items.push;
    expectTypeOf(setTodos).toEqualTypeOf<SetStore<{ items: Todo[] }>>();
  });

  it("[SST-02] a path setter is checked against the keys and values along the path", () => {
    const [state, setState] = useStore({ items: [] as Todo[], filter: "all" });
    setState("filter", "done");
    setState("items", 0, "done", true);
    // @ts-expect-error "filter" is a string, not a number
    setState("filter", 1);
    // @ts-expect-error "nope" is not a key of the state
    setState("nope", 1);
    expectTypeOf(state.filter).toEqualTypeOf<string>();
  });

  it("[SST-03] a single value gives an accessor and a setter, not a store", () => {
    const [count, setCount] = useStore(0);
    expectTypeOf(count).toBeCallableWith();
    expectTypeOf(setCount).toBeCallableWith(1);
    expectTypeOf<Store<number>>().toEqualTypeOf<number>();
  });
});

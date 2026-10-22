import { useStore } from "@shadow-js/core";

// A single value takes the cell path; plain data keeps the deep store.
export function Counter() {
  const [count, setCount] = useStore(0);
  const [items] = useStore([1, 2]);
  return (
    <button type="button" onClick={() => setCount(count() + 1)}>
      {count()} of {items.length}
    </button>
  );
}

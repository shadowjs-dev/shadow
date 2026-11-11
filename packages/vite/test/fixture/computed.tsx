import { useSignal } from "@shadow-js/core";

export function Counter() {
  const [count] = useSignal(0);
  const double = count() * 2;
  return <p>{double}</p>;
}

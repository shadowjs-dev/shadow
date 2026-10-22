import { ssrHydrationKey as _$ssrHydrationKey, escape as _$escape, ssr as _$ssr } from "@shadow-js/web/server";
const _ssr$ = ["<button"," type=\"button\"><!--[-->","<!--]--> of <!--[-->","<!--]--></button>"];
import { useSignal as useShadowSignal } from "@shadow-js/core";
import { useStore } from "@shadow-js/core";

// A single value takes the cell path; plain data keeps the deep store.
export function Counter() {
  const [count, setCount] = useShadowSignal(0);
  const [items] = useStore([1, 2]);
  return (
    _$ssr(_ssr$, _$ssrHydrationKey(), _$escape(count()), _$escape(items.length))
  );
}

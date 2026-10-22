import { insert as _$insert, template as _$template, delegateEvents as _$delegateEvents } from "@shadow-js/web";
const _tmpl$ = /*#__PURE__*/ _$template("<button type=\"button\"> of </button>");
import { useSignal as useShadowSignal } from "@shadow-js/core";
import { useStore } from "@shadow-js/core";

// A single value takes the cell path; plain data keeps the deep store.
export function Counter() {
  const [count, setCount] = useShadowSignal(0);
  const [items] = useStore([1, 2]);
  {
const _el$ = _tmpl$(),
_el$2 = _el$.firstChild;
_el$.$$click = () => setCount(count() + 1);
_$insert(_el$, count, _el$2);
_$insert(_el$, () => items.length);
return _el$;
}
}

_$delegateEvents(["click"]);

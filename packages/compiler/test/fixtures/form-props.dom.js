import { effect as _$effect, template as _$template, delegateEvents as _$delegateEvents } from "@shadow-js/web";
const _tmpl$ = /*#__PURE__*/ _$template("<input disabled>");
export const a = (() => {
const _el$ = _tmpl$();
_el$.$$input = h;
_el$.$$inputData = d;
_$effect(() => {
_el$.value = (v()) ?? "";
});
return _el$;
})();

_$delegateEvents(["input"]);

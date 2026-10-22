import { setSelectValue as _$setSelectValue, effect as _$effect, template as _$template } from "@shadow-js/web";
const _tmpl$ = /*#__PURE__*/ _$template("<form><select name=\"c\" multiple><optgroup label=\"g\"><option value=\"a\">A</option><option>Plain</option></optgroup></select><textarea name=\"t\"></textarea></form>");
export const a = (
  (() => {
const _el$ = _tmpl$(),
_el$2 = _el$.firstChild,
_el$3 = _el$2.nextSibling;
_$effect(() => {
_$setSelectValue(_el$2, list());
});
_$effect(() => {
_el$3.value = (text()) ?? "";
});
return _el$;
})()
);

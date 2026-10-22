import { mergeProps as _$mergeProps, spread as _$spread, insert as _$insert, template as _$template } from "@shadow-js/web";
const _tmpl$ = /*#__PURE__*/ _$template("<div><p></p></div>");
export const a = (() => {
const _el$ = _tmpl$(),
_el$2 = _el$.firstChild;
_$spread(_el$, _$mergeProps(props, {
class: "x",
onClick: f
}), false, true);
_$insert(_el$2, count);
return _el$;
})();

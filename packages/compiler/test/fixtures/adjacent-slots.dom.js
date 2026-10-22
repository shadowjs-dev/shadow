import { insert as _$insert, anchor as _$anchor, template as _$template } from "@shadow-js/web";
const _tmpl$ = /*#__PURE__*/ _$template("<div><i></i></div>");
export const a = (() => {
const _el$ = _tmpl$(),
_el$2 = _el$.firstChild,
_el$3 = _$anchor(_el$, _el$2);
_$insert(_el$, a, _el$3);
_$insert(_el$, b, _el$2);
_$insert(_el$, c);
return _el$;
})();

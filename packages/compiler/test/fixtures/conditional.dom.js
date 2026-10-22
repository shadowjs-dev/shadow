import { createComponent as _$createComponent, template as _$template, memo as _$memo, insert as _$insert, anchor as _$anchor } from "@shadow-js/web";
const _tmpl$ = /*#__PURE__*/ _$template("<p>hi</p>");
const _tmpl$2 = /*#__PURE__*/ _$template("<div></div>");
export const a = (() => {
const _el$ = _tmpl$2(),
_el$2 = _$anchor(_el$, null);
_$insert(_el$, (() => {
const _c$ = _$memo(() => !!(ok()));
return () => _c$() ? _$createComponent(A, {}) : _$createComponent(B, {});
})(), _el$2);
_$insert(_el$, (() => {
const _c$ = _$memo(() => !!(ready()));
return () => _c$() && _tmpl$();
})());
return _el$;
})();

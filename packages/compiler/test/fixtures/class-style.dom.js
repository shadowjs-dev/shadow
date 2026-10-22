import { className as _$className, effect as _$effect, classList as _$classList, style as _$style, template as _$template } from "@shadow-js/web";
const _tmpl$ = /*#__PURE__*/ _$template("<div></div>");
export const a = (() => {
const _el$ = _tmpl$();
_$effect(() => {
_$className(_el$, cls());
});
_$effect(() => ({ on: on() }), (_v$, _p$) => {
_$classList(_el$, _v$, _p$);
});
_$effect(() => ({ color: c() }), (_v$, _p$) => {
_$style(_el$, _v$, _p$);
});
_$effect(() => {
_el$.classList.toggle("x", !!(y()));
});
return _el$;
})();

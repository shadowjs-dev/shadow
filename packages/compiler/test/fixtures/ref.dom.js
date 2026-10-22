import { refTo as _$refTo, use as _$use, effect as _$effect, setAttribute as _$setAttribute, setBoolAttribute as _$setBoolAttribute, template as _$template } from "@shadow-js/web";
const _tmpl$ = /*#__PURE__*/ _$template("<div></div>");
let el; export const a = (() => {
const _el$ = _tmpl$();
typeof el === "function" || (el !== null && typeof el === "object" && "current" in el) ? _$refTo(el, _el$) : (el = _el$);
_$use(tip, _el$, () => 1);
_$effect(() => {
_el$["foo"] = x();
});
_$effect(() => {
_$setAttribute(_el$, "bar", y());
});
_$effect(() => {
_$setBoolAttribute(_el$, "baz", z());
});
return _el$;
})();

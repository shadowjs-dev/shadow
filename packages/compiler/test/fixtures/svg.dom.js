import { setAttribute as _$setAttribute, effect as _$effect, template as _$template } from "@shadow-js/web";
const _tmpl$ = /*#__PURE__*/ _$template("<svg viewBox=\"0 0 1 1\"><circle></circle></svg>", 1);
export const a = (() => {
const _el$ = _tmpl$(),
_el$2 = _el$.firstChild;
_$effect(() => {
_$setAttribute(_el$2, "r", r());
});
return _el$;
})();

import { setAttribute as _$setAttribute, effect as _$effect, insert as _$insert, template as _$template } from "@shadow-js/web";
const _tmpl$ = /*#__PURE__*/ _$template("<div class=\"a\">hello  world <b>x</b></div>");
export const a = (() => {
const _el$ = _tmpl$(),
_el$2 = _el$.firstChild,
_el$3 = _el$2.splitText(6);
_$effect(() => {
_$setAttribute(_el$, "id", id());
});
_$insert(_el$, name, _el$3);
_$insert(_el$, other);
return _el$;
})();

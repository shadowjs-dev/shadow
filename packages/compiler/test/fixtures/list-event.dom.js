import { insert as _$insert, template as _$template, delegateEvents as _$delegateEvents } from "@shadow-js/web";
const _tmpl$ = /*#__PURE__*/ _$template("<li></li>");
const _tmpl$2 = /*#__PURE__*/ _$template("<ul></ul>");
export const a = (() => {
const _el$ = _tmpl$2();
_$insert(_el$, () => items().map((i) => {
const _el$ = _tmpl$();
_el$.$$click = () => pick(i);
_$insert(_el$, i);
return _el$;
}));
return _el$;
})();

_$delegateEvents(["click"]);

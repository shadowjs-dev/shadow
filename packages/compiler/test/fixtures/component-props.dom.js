import { template as _$template, insert as _$insert, createComponent as _$createComponent } from "@shadow-js/web";
const _tmpl$ = /*#__PURE__*/ _$template("<p>no</p>");
const _tmpl$2 = /*#__PURE__*/ _$template("<span></span>");
export const a = _$createComponent(Show, {
get when() {
return a();
},
get fallback() {
return _tmpl$();
},
get children() {
return [(() => {
const _el$ = _tmpl$2();
_$insert(_el$, b);
return _el$;
})(), " text"];
}
});

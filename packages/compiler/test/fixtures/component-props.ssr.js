import { ssrHydrationKey as _$ssrHydrationKey, ssr as _$ssr, createComponent as _$createComponent, escape as _$escape, mergeProps as _$mergeProps } from "@shadow-js/web/server";
const _ssr$ = ["<p",">no</p>"];
const _ssr$2 = ["<span","><!--[-->","<!--]--></span>"];
export const a = _$createComponent(Show, _$mergeProps({
get when() {
return a();
},
get fallback() {
return _$ssr(_ssr$, _$ssrHydrationKey());
}
}, {
get children() {
return [_$ssr(_ssr$2, _$ssrHydrationKey(), _$escape(b)), " text"];
}
}));

import { createComponent as _$createComponent, ssrHydrationKey as _$ssrHydrationKey, ssr as _$ssr, escape as _$escape } from "@shadow-js/web/server";
const _ssr$ = ["<p",">hi</p>"];
const _ssr$2 = ["<div","><!--[-->","<!--]--><!--[-->","<!--]--></div>"];
export const a = _$ssr(_ssr$2, _$ssrHydrationKey(), _$escape(ok() ? _$createComponent(A, {}) : _$createComponent(B, {})), _$escape(ready() && _$ssr(_ssr$, _$ssrHydrationKey())));

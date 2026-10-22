import { ssrHydrationKey as _$ssrHydrationKey, escape as _$escape, ssr as _$ssr } from "@shadow-js/web/server";
const _ssr$ = ["<li","><!--[-->","<!--]--></li>"];
const _ssr$2 = ["<ul","><!--[-->","<!--]--></ul>"];
export const a = _$ssr(_ssr$2, _$ssrHydrationKey(), _$escape(items().map((i) => _$ssr(_ssr$, _$ssrHydrationKey(), _$escape(i)))));

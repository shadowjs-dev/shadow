import { ssrHydrationKey as _$ssrHydrationKey, ssrAttribute as _$ssrAttribute, escape as _$escape, ssr as _$ssr } from "@shadow-js/web/server";
const _ssr$ = ["<div"," class=\"a\"",">hello <!--[-->","<!--]--> world <b>x</b><!--[-->","<!--]--></div>"];
export const a = _$ssr(_ssr$, _$ssrHydrationKey(), _$ssrAttribute("id", id()), _$escape(name()), _$escape(other));

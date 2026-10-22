import { escape as _$escape, ssr as _$ssr, ssrElement as _$ssrElement, mergeProps as _$mergeProps } from "@shadow-js/web/server";
const _ssr$ = ["<p><!--[-->","<!--]--></p>"];
export const a = _$ssrElement("div", _$mergeProps(props, {
class: "x"
}), () => _$ssr(_ssr$, _$escape(count())), true);

/**
 * The XHTML namespace URI: the `namespaceURI` of ordinary HTML elements.
 *
 * @example
 * import { HTML_NS } from "@shadow-js/web/extend";
 *
 * const isHtml = (el: Element): boolean => el.namespaceURI === HTML_NS;
 * @since 1.0.0
 */
export const HTML_NS = "http://www.w3.org/1999/xhtml";
/**
 * The SVG namespace URI, for `createElementNS` and `namespaceURI` checks.
 *
 * @example
 * import { SVG_NS } from "@shadow-js/web/extend";
 *
 * const circle = document.createElementNS(SVG_NS, "circle");
 * @since 1.0.0
 */
export const SVG_NS = "http://www.w3.org/2000/svg";
/**
 * The MathML namespace URI, for `createElementNS` and `namespaceURI` checks.
 *
 * @example
 * import { MATHML_NS } from "@shadow-js/web/extend";
 *
 * const fraction = document.createElementNS(MATHML_NS, "mfrac");
 * @since 1.0.0
 */
export const MATHML_NS = "http://www.w3.org/1998/Math/MathML";

/** `template()` flag: the markup is SVG. @internal */
export const TEMPLATE_SVG = 1;
/** `template()` flag: the markup is MathML. @internal */
export const TEMPLATE_MATHML = 2;
/** `template()` flag: clone with `document.importNode` (custom elements). @internal */
export const TEMPLATE_IMPORT_NODE = 4;

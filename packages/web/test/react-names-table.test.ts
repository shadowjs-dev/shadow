import { describe, expect, it } from "vitest";
import { attributeName } from "../src/internal/react-names";

/*
 * Table equivalence for the SVG spelling rule. The expected pairs below were generated once from the old
 * full table (a list of 68 presentation names, replaced by the rule) by running the old `attributeName`
 * on every entry and on the universe of SVG names. The rule must write each of them the same way.
 * The universe is the SVG attributes a page uses, and the names the table covers; a name outside both is
 * not part of this claim.
 */

/** Each old table entry: its camelCase spelling and the hyphenated name the old table wrote. */
const OLD_ENTRIES: ReadonlyArray<readonly [string, string]> = [
  ["alignmentBaseline", "alignment-baseline"],
  ["baselineShift", "baseline-shift"],
  ["clip", "clip"],
  ["clipPath", "clip-path"],
  ["clipRule", "clip-rule"],
  ["color", "color"],
  ["colorInterpolation", "color-interpolation"],
  ["colorInterpolationFilters", "color-interpolation-filters"],
  ["colorProfile", "color-profile"],
  ["colorRendering", "color-rendering"],
  ["cursor", "cursor"],
  ["direction", "direction"],
  ["display", "display"],
  ["dominantBaseline", "dominant-baseline"],
  ["enableBackground", "enable-background"],
  ["fill", "fill"],
  ["fillOpacity", "fill-opacity"],
  ["fillRule", "fill-rule"],
  ["filter", "filter"],
  ["floodColor", "flood-color"],
  ["floodOpacity", "flood-opacity"],
  ["fontFamily", "font-family"],
  ["fontSize", "font-size"],
  ["fontSizeAdjust", "font-size-adjust"],
  ["fontStretch", "font-stretch"],
  ["fontStyle", "font-style"],
  ["fontVariant", "font-variant"],
  ["fontWeight", "font-weight"],
  ["glyphOrientationHorizontal", "glyph-orientation-horizontal"],
  ["glyphOrientationVertical", "glyph-orientation-vertical"],
  ["imageRendering", "image-rendering"],
  ["isolation", "isolation"],
  ["kerning", "kerning"],
  ["letterSpacing", "letter-spacing"],
  ["lightingColor", "lighting-color"],
  ["markerEnd", "marker-end"],
  ["markerMid", "marker-mid"],
  ["markerStart", "marker-start"],
  ["mask", "mask"],
  ["maskType", "mask-type"],
  ["mixBlendMode", "mix-blend-mode"],
  ["opacity", "opacity"],
  ["overflow", "overflow"],
  ["paintOrder", "paint-order"],
  ["pointerEvents", "pointer-events"],
  ["shapeRendering", "shape-rendering"],
  ["stopColor", "stop-color"],
  ["stopOpacity", "stop-opacity"],
  ["stroke", "stroke"],
  ["strokeDasharray", "stroke-dasharray"],
  ["strokeDashoffset", "stroke-dashoffset"],
  ["strokeLinecap", "stroke-linecap"],
  ["strokeLinejoin", "stroke-linejoin"],
  ["strokeMiterlimit", "stroke-miterlimit"],
  ["strokeOpacity", "stroke-opacity"],
  ["strokeWidth", "stroke-width"],
  ["textAnchor", "text-anchor"],
  ["textDecoration", "text-decoration"],
  ["textOverflow", "text-overflow"],
  ["textRendering", "text-rendering"],
  ["transform", "transform"],
  ["transformOrigin", "transform-origin"],
  ["unicodeBidi", "unicode-bidi"],
  ["vectorEffect", "vector-effect"],
  ["visibility", "visibility"],
  ["whiteSpace", "white-space"],
  ["wordSpacing", "word-spacing"],
  ["writingMode", "writing-mode"],
];

/** The old runtime result for each name of the universe (generated with the old table). */
const OLD_RESULTS: ReadonlyArray<readonly [string, string]> = [
  ["viewBox", "viewBox"],
  ["preserveAspectRatio", "preserveAspectRatio"],
  ["gradientUnits", "gradientUnits"],
  ["gradientTransform", "gradientTransform"],
  ["patternUnits", "patternUnits"],
  ["patternContentUnits", "patternContentUnits"],
  ["patternTransform", "patternTransform"],
  ["clipPathUnits", "clipPathUnits"],
  ["maskUnits", "maskUnits"],
  ["maskContentUnits", "maskContentUnits"],
  ["markerWidth", "markerWidth"],
  ["markerHeight", "markerHeight"],
  ["markerUnits", "markerUnits"],
  ["refX", "refX"],
  ["refY", "refY"],
  ["baseFrequency", "baseFrequency"],
  ["numOctaves", "numOctaves"],
  ["stitchTiles", "stitchTiles"],
  ["pathLength", "pathLength"],
  ["textLength", "textLength"],
  ["lengthAdjust", "lengthAdjust"],
  ["startOffset", "startOffset"],
  ["stdDeviation", "stdDeviation"],
  ["tableValues", "tableValues"],
  ["specularConstant", "specularConstant"],
  ["specularExponent", "specularExponent"],
  ["surfaceScale", "surfaceScale"],
  ["diffuseConstant", "diffuseConstant"],
  ["kernelMatrix", "kernelMatrix"],
  ["kernelUnitLength", "kernelUnitLength"],
  ["edgeMode", "edgeMode"],
  ["filterUnits", "filterUnits"],
  ["primitiveUnits", "primitiveUnits"],
  ["limitingConeAngle", "limitingConeAngle"],
  ["pointsAtX", "pointsAtX"],
  ["pointsAtY", "pointsAtY"],
  ["pointsAtZ", "pointsAtZ"],
  ["xChannelSelector", "xChannelSelector"],
  ["yChannelSelector", "yChannelSelector"],
  ["targetX", "targetX"],
  ["targetY", "targetY"],
  ["attributeName", "attributeName"],
  ["attributeType", "attributeType"],
  ["calcMode", "calcMode"],
  ["keyPoints", "keyPoints"],
  ["keySplines", "keySplines"],
  ["keyTimes", "keyTimes"],
  ["repeatCount", "repeatCount"],
  ["repeatDur", "repeatDur"],
  ["baseProfile", "baseProfile"],
  ["contentScriptType", "contentScriptType"],
  ["contentStyleType", "contentStyleType"],
  ["zoomAndPan", "zoomAndPan"],
  ["requiredFeatures", "requiredFeatures"],
  ["requiredExtensions", "requiredExtensions"],
  ["systemLanguage", "systemLanguage"],
  ["glyphRef", "glyphRef"],
  ["arabicForm", "arabicForm"],
  ["externalResourcesRequired", "externalResourcesRequired"],
  ["preserveAlpha", "preserveAlpha"],
  ["spreadMethod", "spreadMethod"],
  ["viewTarget", "viewTarget"],
  ["filterRes", "filterRes"],
  ["xHeight", "xHeight"],
  ["tabIndex", "tabIndex"],
  ["crossOrigin", "crossOrigin"],
  ["className", "class"],
  ["htmlFor", "for"],
  ["colSpan", "colSpan"],
  ["strokeWidth", "stroke-width"],
  ["fillRule", "fill-rule"],
  ["xlinkHref", "xlink:href"],
  ["xmlLang", "xml:lang"],
  ["onClick", "onClick"],
  ["fooBar", "fooBar"],
  ["x", "x"],
  ["d", "d"],
  ["points", "points"],
];

describe("SVG spelling rule equals the old table (RCW-TBL)", () => {
  it("[RCW-TBL-01] every old presentation entry is written hyphenated from its camelCase spelling", () => {
    for (const [camel, hyphenated] of OLD_ENTRIES) {
      expect(attributeName(camel, true), camel).toBe(hyphenated);
    }
  });

  it("[RCW-TBL-02] a hyphenated presentation name is written as it is", () => {
    for (const [, hyphenated] of OLD_ENTRIES) {
      expect(attributeName(hyphenated, true), hyphenated).toBe(hyphenated);
    }
  });

  it("[RCW-TBL-03] every name of the universe is written as the old table wrote it", () => {
    for (const [name, expected] of OLD_RESULTS) {
      expect(attributeName(name, true), name).toBe(expected);
    }
  });
});

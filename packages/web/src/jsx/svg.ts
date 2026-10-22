/**
 * Per-element attribute maps for every SVG element the DOM library types (`SVGElementTagNameMap`).
 *
 * Presentation attributes (`fill`, `stroke-*`, `font-*`, `transform`, ...) are accepted on every SVG
 * element. That is wider than the SVG spec, which lists the elements each one applies to, but it
 * never rejects valid markup. Geometry, filter-primitive and animation attributes are per element.
 *
 * Attribute names keep their SVG case (`viewBox`, `preserveAspectRatio`): the compiler writes SVG
 * attributes with `setAttribute`, which does not lower-case them.
 *
 * @since 1.0.0
 */
import type {
  ElementProps,
  TextElementProps,
  VoidElementProps,
  WindowElementProps,
} from "./global";
import type { LooseString, Maybe } from "./types";

/** A length, coordinate, or other SVG number. Plain numbers are user units. @since 1.0.0 */
export type SvgValue = Maybe<number | string>;

/** Coordinate-system units of gradients, patterns, clip paths and masks. @since 1.0.0 */
export type SvgUnits = "userSpaceOnUse" | "objectBoundingBox";

/**
 * Presentation attributes: CSS properties with an SVG attribute form. Accepted on every SVG element.
 *
 * @since 1.0.0
 */
export interface SVGPresentationAttributes {
  "alignment-baseline"?: SvgValue;
  "baseline-shift"?: SvgValue;
  clip?: SvgValue;
  "clip-path"?: SvgValue;
  "clip-rule"?: SvgValue;
  color?: SvgValue;
  "color-interpolation"?: SvgValue;
  "color-interpolation-filters"?: SvgValue;
  "color-rendering"?: SvgValue;
  cursor?: SvgValue;
  direction?: SvgValue;
  display?: SvgValue;
  "dominant-baseline"?: SvgValue;
  fill?: SvgValue;
  "fill-opacity"?: SvgValue;
  "fill-rule"?: Maybe<"nonzero" | "evenodd" | "inherit">;
  filter?: SvgValue;
  "flood-color"?: SvgValue;
  "flood-opacity"?: SvgValue;
  "font-family"?: SvgValue;
  "font-size"?: SvgValue;
  "font-size-adjust"?: SvgValue;
  "font-stretch"?: SvgValue;
  "font-style"?: SvgValue;
  "font-variant"?: SvgValue;
  "font-weight"?: SvgValue;
  "image-rendering"?: SvgValue;
  isolation?: SvgValue;
  "letter-spacing"?: SvgValue;
  "lighting-color"?: SvgValue;
  "marker-end"?: SvgValue;
  "marker-mid"?: SvgValue;
  "marker-start"?: SvgValue;
  mask?: SvgValue;
  "mix-blend-mode"?: SvgValue;
  opacity?: SvgValue;
  overflow?: SvgValue;
  "paint-order"?: SvgValue;
  "pointer-events"?: SvgValue;
  "shape-rendering"?: SvgValue;
  "stop-color"?: SvgValue;
  "stop-opacity"?: SvgValue;
  stroke?: SvgValue;
  "stroke-dasharray"?: SvgValue;
  "stroke-dashoffset"?: SvgValue;
  "stroke-linecap"?: Maybe<"butt" | "round" | "square" | "inherit">;
  "stroke-linejoin"?: Maybe<"miter" | "miter-clip" | "round" | "bevel" | "arcs" | "inherit">;
  "stroke-miterlimit"?: SvgValue;
  "stroke-opacity"?: SvgValue;
  "stroke-width"?: SvgValue;
  "text-anchor"?: SvgValue;
  "text-decoration"?: SvgValue;
  "text-overflow"?: SvgValue;
  "text-rendering"?: SvgValue;
  transform?: SvgValue;
  "transform-origin"?: SvgValue;
  "unicode-bidi"?: SvgValue;
  "vector-effect"?: SvgValue;
  visibility?: Maybe<"visible" | "hidden" | "collapse" | "inherit">;
  "white-space"?: SvgValue;
  "word-spacing"?: SvgValue;
  "writing-mode"?: SvgValue;
}

/**
 * React spellings of the presentation attributes above (`strokeWidth` for `stroke-width`). They are
 * accepted for React compatibility: the compiler writes the hyphenated attribute, and each has the same
 * type as the hyphenated name, which stays the canonical one.
 *
 * @since 1.0.0
 */
export interface SVGReactPresentationAttributes {
  /** React spelling of `alignment-baseline`. Accepted for React compatibility. */
  alignmentBaseline?: SVGPresentationAttributes["alignment-baseline"];
  /** React spelling of `baseline-shift`. Accepted for React compatibility. */
  baselineShift?: SVGPresentationAttributes["baseline-shift"];
  /** React spelling of `clip-path`. Accepted for React compatibility. */
  clipPath?: SVGPresentationAttributes["clip-path"];
  /** React spelling of `clip-rule`. Accepted for React compatibility. */
  clipRule?: SVGPresentationAttributes["clip-rule"];
  /** React spelling of `color-interpolation`. Accepted for React compatibility. */
  colorInterpolation?: SVGPresentationAttributes["color-interpolation"];
  /** React spelling of `color-interpolation-filters`. Accepted for React compatibility. */
  colorInterpolationFilters?: SVGPresentationAttributes["color-interpolation-filters"];
  /** React spelling of `color-rendering`. Accepted for React compatibility. */
  colorRendering?: SVGPresentationAttributes["color-rendering"];
  /** React spelling of `dominant-baseline`. Accepted for React compatibility. */
  dominantBaseline?: SVGPresentationAttributes["dominant-baseline"];
  /** React spelling of `fill-opacity`. Accepted for React compatibility. */
  fillOpacity?: SVGPresentationAttributes["fill-opacity"];
  /** React spelling of `fill-rule`. Accepted for React compatibility. */
  fillRule?: SVGPresentationAttributes["fill-rule"];
  /** React spelling of `flood-color`. Accepted for React compatibility. */
  floodColor?: SVGPresentationAttributes["flood-color"];
  /** React spelling of `flood-opacity`. Accepted for React compatibility. */
  floodOpacity?: SVGPresentationAttributes["flood-opacity"];
  /** React spelling of `font-family`. Accepted for React compatibility. */
  fontFamily?: SVGPresentationAttributes["font-family"];
  /** React spelling of `font-size`. Accepted for React compatibility. */
  fontSize?: SVGPresentationAttributes["font-size"];
  /** React spelling of `font-size-adjust`. Accepted for React compatibility. */
  fontSizeAdjust?: SVGPresentationAttributes["font-size-adjust"];
  /** React spelling of `font-stretch`. Accepted for React compatibility. */
  fontStretch?: SVGPresentationAttributes["font-stretch"];
  /** React spelling of `font-style`. Accepted for React compatibility. */
  fontStyle?: SVGPresentationAttributes["font-style"];
  /** React spelling of `font-variant`. Accepted for React compatibility. */
  fontVariant?: SVGPresentationAttributes["font-variant"];
  /** React spelling of `font-weight`. Accepted for React compatibility. */
  fontWeight?: SVGPresentationAttributes["font-weight"];
  /** React spelling of `image-rendering`. Accepted for React compatibility. */
  imageRendering?: SVGPresentationAttributes["image-rendering"];
  /** React spelling of `letter-spacing`. Accepted for React compatibility. */
  letterSpacing?: SVGPresentationAttributes["letter-spacing"];
  /** React spelling of `lighting-color`. Accepted for React compatibility. */
  lightingColor?: SVGPresentationAttributes["lighting-color"];
  /** React spelling of `marker-end`. Accepted for React compatibility. */
  markerEnd?: SVGPresentationAttributes["marker-end"];
  /** React spelling of `marker-mid`. Accepted for React compatibility. */
  markerMid?: SVGPresentationAttributes["marker-mid"];
  /** React spelling of `marker-start`. Accepted for React compatibility. */
  markerStart?: SVGPresentationAttributes["marker-start"];
  /** React spelling of `mix-blend-mode`. Accepted for React compatibility. */
  mixBlendMode?: SVGPresentationAttributes["mix-blend-mode"];
  /** React spelling of `paint-order`. Accepted for React compatibility. */
  paintOrder?: SVGPresentationAttributes["paint-order"];
  /** React spelling of `pointer-events`. Accepted for React compatibility. */
  pointerEvents?: SVGPresentationAttributes["pointer-events"];
  /** React spelling of `shape-rendering`. Accepted for React compatibility. */
  shapeRendering?: SVGPresentationAttributes["shape-rendering"];
  /** React spelling of `stop-color`. Accepted for React compatibility. */
  stopColor?: SVGPresentationAttributes["stop-color"];
  /** React spelling of `stop-opacity`. Accepted for React compatibility. */
  stopOpacity?: SVGPresentationAttributes["stop-opacity"];
  /** React spelling of `stroke-dasharray`. Accepted for React compatibility. */
  strokeDasharray?: SVGPresentationAttributes["stroke-dasharray"];
  /** React spelling of `stroke-dashoffset`. Accepted for React compatibility. */
  strokeDashoffset?: SVGPresentationAttributes["stroke-dashoffset"];
  /** React spelling of `stroke-linecap`. Accepted for React compatibility. */
  strokeLinecap?: SVGPresentationAttributes["stroke-linecap"];
  /** React spelling of `stroke-linejoin`. Accepted for React compatibility. */
  strokeLinejoin?: SVGPresentationAttributes["stroke-linejoin"];
  /** React spelling of `stroke-miterlimit`. Accepted for React compatibility. */
  strokeMiterlimit?: SVGPresentationAttributes["stroke-miterlimit"];
  /** React spelling of `stroke-opacity`. Accepted for React compatibility. */
  strokeOpacity?: SVGPresentationAttributes["stroke-opacity"];
  /** React spelling of `stroke-width`. Accepted for React compatibility. */
  strokeWidth?: SVGPresentationAttributes["stroke-width"];
  /** React spelling of `text-anchor`. Accepted for React compatibility. */
  textAnchor?: SVGPresentationAttributes["text-anchor"];
  /** React spelling of `text-decoration`. Accepted for React compatibility. */
  textDecoration?: SVGPresentationAttributes["text-decoration"];
  /** React spelling of `text-overflow`. Accepted for React compatibility. */
  textOverflow?: SVGPresentationAttributes["text-overflow"];
  /** React spelling of `text-rendering`. Accepted for React compatibility. */
  textRendering?: SVGPresentationAttributes["text-rendering"];
  /** React spelling of `transform-origin`. Accepted for React compatibility. */
  transformOrigin?: SVGPresentationAttributes["transform-origin"];
  /** React spelling of `unicode-bidi`. Accepted for React compatibility. */
  unicodeBidi?: SVGPresentationAttributes["unicode-bidi"];
  /** React spelling of `vector-effect`. Accepted for React compatibility. */
  vectorEffect?: SVGPresentationAttributes["vector-effect"];
  /** React spelling of `white-space`. Accepted for React compatibility. */
  whiteSpace?: SVGPresentationAttributes["white-space"];
  /** React spelling of `word-spacing`. Accepted for React compatibility. */
  wordSpacing?: SVGPresentationAttributes["word-spacing"];
  /** React spelling of `writing-mode`. Accepted for React compatibility. */
  writingMode?: SVGPresentationAttributes["writing-mode"];
}

/**
 * Attributes every SVG element accepts besides presentation attributes: identity, language and the
 * `xml:` attributes the compiler passes through.
 *
 * @since 1.0.0
 */
export interface SVGCoreAttributes {
  "xml:lang"?: Maybe<string>;
  "xml:space"?: Maybe<"default" | "preserve">;
  /** React spelling of `xml:lang`. Accepted for React compatibility. */
  xmlLang?: Maybe<string>;
  /** React spelling of `xml:space`. Accepted for React compatibility. */
  xmlSpace?: Maybe<"default" | "preserve">;
  requiredExtensions?: Maybe<string>;
  systemLanguage?: Maybe<string>;
}

/** Links through `href` and the legacy `xlink:href`. @since 1.0.0 */
export interface SVGHrefAttributes {
  href?: Maybe<string>;
  "xlink:href"?: Maybe<string>;
  /** React spelling of `xlink:href`. Accepted for React compatibility. */
  xlinkHref?: Maybe<string>;
}

/** Attributes of the root `svg` element. @since 1.0.0 */
export interface SVGRootAttributes {
  xmlns?: Maybe<string>;
  "xmlns:xlink"?: Maybe<string>;
  baseProfile?: Maybe<string>;
  contentScriptType?: Maybe<string>;
  contentStyleType?: Maybe<string>;
  height?: SvgValue;
  preserveAspectRatio?: Maybe<string>;
  version?: Maybe<string>;
  viewBox?: Maybe<string>;
  width?: SvgValue;
  x?: SvgValue;
  y?: SvgValue;
  zoomAndPan?: Maybe<"disable" | "magnify">;
}

/** A rectangle box. @since 1.0.0 */
export interface SVGBoxAttributes {
  height?: SvgValue;
  width?: SvgValue;
  x?: SvgValue;
  y?: SvgValue;
}

/** The `viewBox` box and aspect-ratio rules. @since 1.0.0 */
export interface SVGViewportAttributes {
  preserveAspectRatio?: Maybe<string>;
  viewBox?: Maybe<string>;
}

/** Path length hint. @since 1.0.0 */
export interface SVGPathLengthAttributes {
  pathLength?: SvgValue;
}

/** Text positioning. @since 1.0.0 */
export interface SVGTextPositionAttributes {
  dx?: SvgValue;
  dy?: SvgValue;
  lengthAdjust?: Maybe<"spacing" | "spacingAndGlyphs">;
  rotate?: SvgValue;
  textLength?: SvgValue;
  x?: SvgValue;
  y?: SvgValue;
}

/** Gradient geometry shared by linear and radial gradients. @since 1.0.0 */
export interface SVGGradientAttributes extends SVGHrefAttributes {
  gradientTransform?: Maybe<string>;
  gradientUnits?: Maybe<SvgUnits>;
  spreadMethod?: Maybe<"pad" | "reflect" | "repeat">;
}

/** Timing and value attributes of the SMIL animation elements. @since 1.0.0 */
export interface SVGAnimationAttributes extends SVGHrefAttributes {
  accumulate?: Maybe<"none" | "sum">;
  additive?: Maybe<"replace" | "sum">;
  attributeName?: Maybe<string>;
  attributeType?: Maybe<"CSS" | "XML" | "auto">;
  begin?: Maybe<string>;
  by?: Maybe<string>;
  calcMode?: Maybe<"discrete" | "linear" | "paced" | "spline">;
  dur?: Maybe<string>;
  end?: Maybe<string>;
  fill?: Maybe<"freeze" | "remove">;
  from?: Maybe<string>;
  keySplines?: Maybe<string>;
  keyTimes?: Maybe<string>;
  max?: Maybe<string>;
  min?: Maybe<string>;
  repeatCount?: Maybe<number | string>;
  repeatDur?: Maybe<string>;
  restart?: Maybe<"always" | "whenNotActive" | "never">;
  to?: Maybe<string>;
  values?: Maybe<number | string>;
}

/** Filter primitive inputs and results. @since 1.0.0 */
export interface SVGFilterPrimitiveAttributes extends SVGBoxAttributes {
  in?: Maybe<
    LooseString<
      | "SourceGraphic"
      | "SourceAlpha"
      | "BackgroundImage"
      | "BackgroundAlpha"
      | "FillPaint"
      | "StrokePaint"
    >
  >;
  result?: Maybe<string>;
}

/** Shared attributes of the `fe*` lighting elements. @since 1.0.0 */
export interface SVGLightingAttributes extends SVGFilterPrimitiveAttributes {
  kernelUnitLength?: SvgValue;
}

/** Element-specific attributes for `a`. @since 1.0.0 */
export interface SVGAnchorAttributes extends SVGHrefAttributes {
  download?: Maybe<string | boolean>;
  hreflang?: Maybe<string>;
  ping?: Maybe<string>;
  referrerpolicy?: Maybe<string>;
  rel?: Maybe<string>;
  target?: Maybe<string>;
  type?: Maybe<string>;
}

/** Element-specific attributes for `image`. @since 1.0.0 */
export interface SVGImageAttributes
  extends SVGHrefAttributes,
    SVGBoxAttributes,
    SVGViewportAttributes {
  crossorigin?: Maybe<"anonymous" | "use-credentials" | "">;
}

/** Shared base for graphics elements: core plus transform. @since 1.0.0 */
export interface SVGGraphicsAttributes {
  transform?: Maybe<string>;
}

/**
 * Attribute maps for every SVG element, keyed by the SVG tag name.
 *
 * @since 1.0.0
 */
export interface SVGIntrinsicElements {
  /** The SVG `<a>` element: a hyperlink around SVG graphics. */
  a: ElementProps<
    SVGElementTagNameMap["a"],
    SVGAnchorAttributes &
      SVGCoreAttributes &
      SVGPresentationAttributes &
      SVGReactPresentationAttributes &
      SVGGraphicsAttributes
  >;
  /** The SVG `<animate>` element: an animation of one attribute over time. */
  animate: VoidElementProps<
    SVGElementTagNameMap["animate"],
    SVGAnimationAttributes &
      SVGCoreAttributes &
      SVGPresentationAttributes &
      SVGReactPresentationAttributes
  >;
  /** The SVG `<animateMotion>` element: an animation that moves an element along a path. */
  animateMotion: ElementProps<
    SVGElementTagNameMap["animateMotion"],
    SVGAnimationAttributes &
      SVGCoreAttributes & {
        path?: Maybe<string>;
        keyPoints?: Maybe<string>;
        origin?: Maybe<string>;
        rotate?: Maybe<string>;
      }
  >;
  /** The SVG `<animateTransform>` element: an animation of a transform attribute. */
  animateTransform: VoidElementProps<
    SVGElementTagNameMap["animateTransform"],
    SVGAnimationAttributes &
      SVGCoreAttributes & { type?: Maybe<"translate" | "scale" | "rotate" | "skewX" | "skewY"> }
  >;
  /** The SVG `<circle>` element: a circle from a center and a radius. */
  circle: ElementProps<
    SVGElementTagNameMap["circle"],
    SVGCoreAttributes &
      SVGPresentationAttributes &
      SVGReactPresentationAttributes &
      SVGGraphicsAttributes &
      SVGPathLengthAttributes & { cx?: SvgValue; cy?: SvgValue; r?: SvgValue }
  >;
  /** The SVG `<clipPath>` element: a clipping path that limits where paint applies. */
  clipPath: ElementProps<
    SVGElementTagNameMap["clipPath"],
    SVGCoreAttributes &
      SVGPresentationAttributes &
      SVGReactPresentationAttributes &
      SVGGraphicsAttributes & { clipPathUnits?: Maybe<SvgUnits> }
  >;
  /** The SVG `<defs>` element: graphical objects defined for later use, not rendered directly. */
  defs: ElementProps<
    SVGElementTagNameMap["defs"],
    SVGCoreAttributes &
      SVGPresentationAttributes &
      SVGReactPresentationAttributes &
      SVGGraphicsAttributes
  >;
  /** The SVG `<desc>` element: an accessible description of its parent. */
  desc: TextElementProps<
    SVGElementTagNameMap["desc"],
    SVGCoreAttributes & SVGPresentationAttributes & SVGReactPresentationAttributes
  >;
  /** The SVG `<ellipse>` element: an ellipse from a center and two radii. */
  ellipse: ElementProps<
    SVGElementTagNameMap["ellipse"],
    SVGCoreAttributes &
      SVGPresentationAttributes &
      SVGReactPresentationAttributes &
      SVGGraphicsAttributes &
      SVGPathLengthAttributes & { cx?: SvgValue; cy?: SvgValue; rx?: SvgValue; ry?: SvgValue }
  >;
  /** The SVG `<feBlend>` element: a filter primitive that blends two inputs. */
  feBlend: ElementProps<
    SVGElementTagNameMap["feBlend"],
    SVGCoreAttributes &
      SVGPresentationAttributes &
      SVGReactPresentationAttributes &
      SVGFilterPrimitiveAttributes & { in2?: Maybe<string>; mode?: Maybe<string> }
  >;
  /** The SVG `<feColorMatrix>` element: a filter primitive that transforms colors with a matrix. */
  feColorMatrix: ElementProps<
    SVGElementTagNameMap["feColorMatrix"],
    SVGCoreAttributes &
      SVGPresentationAttributes &
      SVGReactPresentationAttributes &
      SVGFilterPrimitiveAttributes & {
        type?: Maybe<"matrix" | "saturate" | "hueRotate" | "luminanceToAlpha">;
        values?: Maybe<number | string>;
      }
  >;
  /** The SVG `<feComponentTransfer>` element: a filter primitive that remaps each color channel. */
  feComponentTransfer: ElementProps<
    SVGElementTagNameMap["feComponentTransfer"],
    SVGCoreAttributes &
      SVGPresentationAttributes &
      SVGReactPresentationAttributes &
      SVGFilterPrimitiveAttributes
  >;
  /** The SVG `<feComposite>` element: a filter primitive that combines two inputs with a Porter-Duff operation. */
  feComposite: ElementProps<
    SVGElementTagNameMap["feComposite"],
    SVGCoreAttributes &
      SVGPresentationAttributes &
      SVGReactPresentationAttributes &
      SVGFilterPrimitiveAttributes & {
        in2?: Maybe<string>;
        k1?: Maybe<number | string>;
        k2?: Maybe<number | string>;
        k3?: Maybe<number | string>;
        k4?: Maybe<number | string>;
        operator?: Maybe<"over" | "in" | "out" | "atop" | "xor" | "arithmetic">;
      }
  >;
  /** The SVG `<feConvolveMatrix>` element: a filter primitive that applies a convolution matrix. */
  feConvolveMatrix: ElementProps<
    SVGElementTagNameMap["feConvolveMatrix"],
    SVGCoreAttributes &
      SVGPresentationAttributes &
      SVGReactPresentationAttributes &
      SVGFilterPrimitiveAttributes & {
        bias?: Maybe<number | string>;
        divisor?: Maybe<number | string>;
        edgeMode?: Maybe<"duplicate" | "wrap" | "none">;
        kernelMatrix?: Maybe<string>;
        kernelUnitLength?: SvgValue;
        order?: Maybe<number | string>;
        preserveAlpha?: Maybe<"true" | "false">;
        targetX?: Maybe<number | string>;
        targetY?: Maybe<number | string>;
      }
  >;
  /** The SVG `<feDiffuseLighting>` element: a filter primitive that lights an image with diffuse lighting. */
  feDiffuseLighting: ElementProps<
    SVGElementTagNameMap["feDiffuseLighting"],
    SVGCoreAttributes &
      SVGPresentationAttributes &
      SVGReactPresentationAttributes &
      SVGLightingAttributes & {
        diffuseConstant?: Maybe<number | string>;
        surfaceScale?: Maybe<number | string>;
      }
  >;
  /** The SVG `<feDisplacementMap>` element: a filter primitive that displaces pixels using a second input. */
  feDisplacementMap: ElementProps<
    SVGElementTagNameMap["feDisplacementMap"],
    SVGCoreAttributes &
      SVGPresentationAttributes &
      SVGReactPresentationAttributes &
      SVGFilterPrimitiveAttributes & {
        in2?: Maybe<string>;
        scale?: Maybe<number | string>;
        xChannelSelector?: Maybe<"R" | "G" | "B" | "A">;
        yChannelSelector?: Maybe<"R" | "G" | "B" | "A">;
      }
  >;
  /** The SVG `<feDistantLight>` element: a distant light source for a lighting filter. */
  feDistantLight: ElementProps<
    SVGElementTagNameMap["feDistantLight"],
    SVGCoreAttributes & { azimuth?: Maybe<number | string>; elevation?: Maybe<number | string> }
  >;
  /** The SVG `<feDropShadow>` element: a filter primitive that draws a drop shadow. */
  feDropShadow: ElementProps<
    SVGElementTagNameMap["feDropShadow"],
    SVGCoreAttributes &
      SVGPresentationAttributes &
      SVGReactPresentationAttributes &
      SVGFilterPrimitiveAttributes & {
        dx?: Maybe<number | string>;
        dy?: Maybe<number | string>;
        stdDeviation?: Maybe<number | string>;
      }
  >;
  /** The SVG `<feFlood>` element: a filter primitive that fills the region with a color. */
  feFlood: ElementProps<
    SVGElementTagNameMap["feFlood"],
    SVGCoreAttributes &
      SVGPresentationAttributes &
      SVGReactPresentationAttributes &
      SVGFilterPrimitiveAttributes
  >;
  /** The SVG `<feFuncA>` element: the alpha transfer function of feComponentTransfer. */
  feFuncA: ElementProps<
    SVGElementTagNameMap["feFuncA"],
    SVGCoreAttributes & SVGTransferFunctionAttributes
  >;
  /** The SVG `<feFuncB>` element: the blue transfer function of feComponentTransfer. */
  feFuncB: ElementProps<
    SVGElementTagNameMap["feFuncB"],
    SVGCoreAttributes & SVGTransferFunctionAttributes
  >;
  /** The SVG `<feFuncG>` element: the green transfer function of feComponentTransfer. */
  feFuncG: ElementProps<
    SVGElementTagNameMap["feFuncG"],
    SVGCoreAttributes & SVGTransferFunctionAttributes
  >;
  /** The SVG `<feFuncR>` element: the red transfer function of feComponentTransfer. */
  feFuncR: ElementProps<
    SVGElementTagNameMap["feFuncR"],
    SVGCoreAttributes & SVGTransferFunctionAttributes
  >;
  /** The SVG `<feGaussianBlur>` element: a filter primitive that applies a Gaussian blur. */
  feGaussianBlur: ElementProps<
    SVGElementTagNameMap["feGaussianBlur"],
    SVGCoreAttributes &
      SVGPresentationAttributes &
      SVGReactPresentationAttributes &
      SVGFilterPrimitiveAttributes & {
        edgeMode?: Maybe<"duplicate" | "wrap" | "none">;
        stdDeviation?: Maybe<number | string>;
      }
  >;
  /** The SVG `<feImage>` element: a filter primitive that renders an external image. */
  feImage: ElementProps<
    SVGElementTagNameMap["feImage"],
    SVGCoreAttributes &
      SVGPresentationAttributes &
      SVGReactPresentationAttributes &
      SVGFilterPrimitiveAttributes &
      SVGHrefAttributes & {
        crossorigin?: Maybe<"anonymous" | "use-credentials" | "">;
      } & SVGViewportAttributes
  >;
  /** The SVG `<feMerge>` element: a filter primitive that layers several inputs. */
  feMerge: ElementProps<
    SVGElementTagNameMap["feMerge"],
    SVGCoreAttributes &
      SVGPresentationAttributes &
      SVGReactPresentationAttributes &
      SVGFilterPrimitiveAttributes
  >;
  /** The SVG `<feMergeNode>` element: one input layer of feMerge. */
  feMergeNode: ElementProps<
    SVGElementTagNameMap["feMergeNode"],
    SVGCoreAttributes & { in?: Maybe<string> }
  >;
  /** The SVG `<feMorphology>` element: a filter primitive that erodes or dilates its input. */
  feMorphology: ElementProps<
    SVGElementTagNameMap["feMorphology"],
    SVGCoreAttributes &
      SVGPresentationAttributes &
      SVGReactPresentationAttributes &
      SVGFilterPrimitiveAttributes & {
        operator?: Maybe<"erode" | "dilate">;
        radius?: Maybe<number | string>;
      }
  >;
  /** The SVG `<feOffset>` element: a filter primitive that offsets its input. */
  feOffset: ElementProps<
    SVGElementTagNameMap["feOffset"],
    SVGCoreAttributes &
      SVGPresentationAttributes &
      SVGReactPresentationAttributes &
      SVGFilterPrimitiveAttributes & { dx?: Maybe<number | string>; dy?: Maybe<number | string> }
  >;
  /** The SVG `<fePointLight>` element: a point light source for a lighting filter. */
  fePointLight: ElementProps<
    SVGElementTagNameMap["fePointLight"],
    SVGCoreAttributes & {
      x?: Maybe<number | string>;
      y?: Maybe<number | string>;
      z?: Maybe<number | string>;
    }
  >;
  /** The SVG `<feSpecularLighting>` element: a filter primitive that lights an image with specular lighting. */
  feSpecularLighting: ElementProps<
    SVGElementTagNameMap["feSpecularLighting"],
    SVGCoreAttributes &
      SVGPresentationAttributes &
      SVGReactPresentationAttributes &
      SVGLightingAttributes & {
        specularConstant?: Maybe<number | string>;
        specularExponent?: Maybe<number | string>;
        surfaceScale?: Maybe<number | string>;
      }
  >;
  /** The SVG `<feSpotLight>` element: a spot light source for a lighting filter. */
  feSpotLight: ElementProps<
    SVGElementTagNameMap["feSpotLight"],
    SVGCoreAttributes & {
      limitingConeAngle?: Maybe<number | string>;
      pointsAtX?: Maybe<number | string>;
      pointsAtY?: Maybe<number | string>;
      pointsAtZ?: Maybe<number | string>;
      specularExponent?: Maybe<number | string>;
      x?: Maybe<number | string>;
      y?: Maybe<number | string>;
      z?: Maybe<number | string>;
    }
  >;
  /** The SVG `<feTile>` element: a filter primitive that tiles its input. */
  feTile: ElementProps<
    SVGElementTagNameMap["feTile"],
    SVGCoreAttributes &
      SVGPresentationAttributes &
      SVGReactPresentationAttributes &
      SVGFilterPrimitiveAttributes
  >;
  /** The SVG `<feTurbulence>` element: a filter primitive that generates Perlin turbulence noise. */
  feTurbulence: ElementProps<
    SVGElementTagNameMap["feTurbulence"],
    SVGCoreAttributes &
      SVGPresentationAttributes &
      SVGReactPresentationAttributes &
      SVGFilterPrimitiveAttributes & {
        baseFrequency?: Maybe<number | string>;
        numOctaves?: Maybe<number | string>;
        seed?: Maybe<number | string>;
        stitchTiles?: Maybe<"stitch" | "noStitch">;
        type?: Maybe<"fractalNoise" | "turbulence">;
      }
  >;
  /** The SVG `<filter>` element: a filter effect made of filter primitives. */
  filter: ElementProps<
    SVGElementTagNameMap["filter"],
    SVGCoreAttributes &
      SVGPresentationAttributes &
      SVGReactPresentationAttributes &
      SVGHrefAttributes &
      SVGBoxAttributes & { filterUnits?: Maybe<SvgUnits>; primitiveUnits?: Maybe<SvgUnits> }
  >;
  /** The SVG `<foreignObject>` element: a region that contains content from another namespace, such as HTML. */
  foreignObject: ElementProps<
    SVGElementTagNameMap["foreignObject"],
    SVGCoreAttributes &
      SVGPresentationAttributes &
      SVGReactPresentationAttributes &
      SVGGraphicsAttributes &
      SVGBoxAttributes
  >;
  /** The SVG `<g>` element: a group of SVG elements. */
  g: ElementProps<
    SVGElementTagNameMap["g"],
    SVGCoreAttributes &
      SVGPresentationAttributes &
      SVGReactPresentationAttributes &
      SVGGraphicsAttributes
  >;
  /** The SVG `<image>` element: a raster or SVG image. */
  image: ElementProps<
    SVGElementTagNameMap["image"],
    SVGCoreAttributes &
      SVGPresentationAttributes &
      SVGReactPresentationAttributes &
      SVGGraphicsAttributes &
      SVGImageAttributes
  >;
  /** The SVG `<line>` element: a straight line between two points. */
  line: ElementProps<
    SVGElementTagNameMap["line"],
    SVGCoreAttributes &
      SVGPresentationAttributes &
      SVGReactPresentationAttributes &
      SVGGraphicsAttributes &
      SVGPathLengthAttributes & { x1?: SvgValue; x2?: SvgValue; y1?: SvgValue; y2?: SvgValue }
  >;
  /** The SVG `<linearGradient>` element: a linear gradient paint server. */
  linearGradient: ElementProps<
    SVGElementTagNameMap["linearGradient"],
    SVGCoreAttributes &
      SVGPresentationAttributes &
      SVGReactPresentationAttributes &
      SVGGradientAttributes & { x1?: SvgValue; x2?: SvgValue; y1?: SvgValue; y2?: SvgValue }
  >;
  /** The SVG `<marker>` element: a graphic drawn at the vertices of a path, line or polyline. */
  marker: ElementProps<
    SVGElementTagNameMap["marker"],
    SVGCoreAttributes &
      SVGPresentationAttributes &
      SVGReactPresentationAttributes &
      SVGViewportAttributes & {
        markerHeight?: SvgValue;
        markerUnits?: Maybe<"strokeWidth" | "userSpaceOnUse">;
        markerWidth?: SvgValue;
        orient?: Maybe<string>;
        refX?: SvgValue;
        refY?: SvgValue;
      }
  >;
  /** The SVG `<mask>` element: a mask that sets the transparency of what it applies to. */
  mask: ElementProps<
    SVGElementTagNameMap["mask"],
    SVGCoreAttributes &
      SVGPresentationAttributes &
      SVGReactPresentationAttributes &
      SVGBoxAttributes & { maskContentUnits?: Maybe<SvgUnits>; maskUnits?: Maybe<SvgUnits> }
  >;
  /** The SVG `<metadata>` element: metadata about the SVG content. */
  metadata: ElementProps<SVGElementTagNameMap["metadata"], SVGCoreAttributes>;
  /** The SVG `<mpath>` element: a reference to the path an animateMotion follows. */
  mpath: VoidElementProps<SVGElementTagNameMap["mpath"], SVGCoreAttributes & SVGHrefAttributes>;
  /** The SVG `<path>` element: a shape drawn from path commands. */
  path: ElementProps<
    SVGElementTagNameMap["path"],
    SVGCoreAttributes &
      SVGPresentationAttributes &
      SVGReactPresentationAttributes &
      SVGGraphicsAttributes &
      SVGPathLengthAttributes & { d?: Maybe<string> }
  >;
  /** The SVG `<pattern>` element: a tiled pattern paint server. */
  pattern: ElementProps<
    SVGElementTagNameMap["pattern"],
    SVGCoreAttributes &
      SVGPresentationAttributes &
      SVGReactPresentationAttributes &
      SVGBoxAttributes &
      SVGViewportAttributes &
      SVGHrefAttributes & {
        patternContentUnits?: Maybe<SvgUnits>;
        patternTransform?: Maybe<string>;
        patternUnits?: Maybe<SvgUnits>;
      }
  >;
  /** The SVG `<polygon>` element: a closed shape of straight line segments. */
  polygon: ElementProps<
    SVGElementTagNameMap["polygon"],
    SVGCoreAttributes &
      SVGPresentationAttributes &
      SVGReactPresentationAttributes &
      SVGGraphicsAttributes &
      SVGPathLengthAttributes & { points?: Maybe<string> }
  >;
  /** The SVG `<polyline>` element: an open shape of straight line segments. */
  polyline: ElementProps<
    SVGElementTagNameMap["polyline"],
    SVGCoreAttributes &
      SVGPresentationAttributes &
      SVGReactPresentationAttributes &
      SVGGraphicsAttributes &
      SVGPathLengthAttributes & { points?: Maybe<string> }
  >;
  /** The SVG `<radialGradient>` element: a radial gradient paint server. */
  radialGradient: ElementProps<
    SVGElementTagNameMap["radialGradient"],
    SVGCoreAttributes &
      SVGPresentationAttributes &
      SVGReactPresentationAttributes &
      SVGGradientAttributes & {
        cx?: SvgValue;
        cy?: SvgValue;
        fr?: SvgValue;
        fx?: SvgValue;
        fy?: SvgValue;
        r?: SvgValue;
      }
  >;
  /** The SVG `<rect>` element: a rectangle, optionally with rounded corners. */
  rect: ElementProps<
    SVGElementTagNameMap["rect"],
    SVGCoreAttributes &
      SVGPresentationAttributes &
      SVGReactPresentationAttributes &
      SVGGraphicsAttributes &
      SVGPathLengthAttributes &
      SVGBoxAttributes & { rx?: SvgValue; ry?: SvgValue }
  >;
  /** The SVG `<script>` element: a script inside SVG content. */
  script: TextElementProps<
    SVGElementTagNameMap["script"],
    SVGCoreAttributes &
      SVGHrefAttributes & {
        crossorigin?: Maybe<"anonymous" | "use-credentials" | "">;
        type?: Maybe<string>;
      }
  >;
  /** The SVG `<set>` element: an animation that sets an attribute to a value for a duration. */
  set: VoidElementProps<SVGElementTagNameMap["set"], SVGCoreAttributes & SVGAnimationAttributes>;
  /** The SVG `<stop>` element: a color stop of a gradient. */
  stop: ElementProps<
    SVGElementTagNameMap["stop"],
    SVGCoreAttributes &
      SVGPresentationAttributes &
      SVGReactPresentationAttributes & { offset?: Maybe<number | string> }
  >;
  /** The SVG `<style>` element: a stylesheet inside SVG content. */
  style: TextElementProps<
    SVGElementTagNameMap["style"],
    SVGCoreAttributes & { media?: Maybe<string>; title?: Maybe<string>; type?: Maybe<string> }
  >;
  /** The SVG `<svg>` element: an SVG document fragment, the root of SVG content. */
  svg: WindowElementProps<
    SVGElementTagNameMap["svg"],
    SVGCoreAttributes &
      SVGPresentationAttributes &
      SVGReactPresentationAttributes &
      SVGRootAttributes
  >;
  /** The SVG `<switch>` element: a choice that renders its first child whose conditions match. */
  switch: ElementProps<
    SVGElementTagNameMap["switch"],
    SVGCoreAttributes &
      SVGPresentationAttributes &
      SVGReactPresentationAttributes &
      SVGGraphicsAttributes
  >;
  /** The SVG `<symbol>` element: a reusable graphic, rendered only through use. */
  symbol: ElementProps<
    SVGElementTagNameMap["symbol"],
    SVGCoreAttributes &
      SVGPresentationAttributes &
      SVGReactPresentationAttributes &
      SVGBoxAttributes &
      SVGViewportAttributes & { refX?: SvgValue; refY?: SvgValue }
  >;
  /** The SVG `<text>` element: a run of SVG text. */
  text: ElementProps<
    SVGElementTagNameMap["text"],
    SVGCoreAttributes &
      SVGPresentationAttributes &
      SVGReactPresentationAttributes &
      SVGGraphicsAttributes &
      SVGTextPositionAttributes
  >;
  /** The SVG `<textPath>` element: text laid out along a path. */
  textPath: ElementProps<
    SVGElementTagNameMap["textPath"],
    SVGCoreAttributes &
      SVGPresentationAttributes &
      SVGReactPresentationAttributes &
      SVGHrefAttributes & {
        lengthAdjust?: Maybe<"spacing" | "spacingAndGlyphs">;
        method?: Maybe<"align" | "stretch">;
        side?: Maybe<"left" | "right">;
        spacing?: Maybe<"auto" | "exact">;
        startOffset?: SvgValue;
        textLength?: SvgValue;
      }
  >;
  /** The SVG `<title>` element: an accessible name for its parent, often shown as a tooltip. */
  title: TextElementProps<
    SVGElementTagNameMap["title"],
    SVGCoreAttributes & SVGPresentationAttributes & SVGReactPresentationAttributes
  >;
  /** The SVG `<tspan>` element: a sub-run of text inside text. */
  tspan: ElementProps<
    SVGElementTagNameMap["tspan"],
    SVGCoreAttributes &
      SVGPresentationAttributes &
      SVGReactPresentationAttributes &
      SVGTextPositionAttributes
  >;
  /** The SVG `<use>` element: a copy of another SVG element, by reference. */
  use: ElementProps<
    SVGElementTagNameMap["use"],
    SVGCoreAttributes &
      SVGPresentationAttributes &
      SVGReactPresentationAttributes &
      SVGGraphicsAttributes &
      SVGHrefAttributes &
      SVGBoxAttributes
  >;
  /** The SVG `<view>` element: a named view of the SVG content, for linking. */
  view: ElementProps<
    SVGElementTagNameMap["view"],
    SVGCoreAttributes & SVGViewportAttributes & { zoomAndPan?: Maybe<"disable" | "magnify"> }
  >;
}

/**
 * Attributes of `feFuncA`/`feFuncB`/`feFuncG`/`feFuncR` (transfer functions).
 *
 * @since 1.0.0
 */
export interface SVGTransferFunctionAttributes {
  amplitude?: Maybe<number | string>;
  exponent?: Maybe<number | string>;
  intercept?: Maybe<number | string>;
  offset?: Maybe<number | string>;
  slope?: Maybe<number | string>;
  tableValues?: Maybe<string>;
  type?: Maybe<"identity" | "table" | "discrete" | "linear" | "gamma">;
}

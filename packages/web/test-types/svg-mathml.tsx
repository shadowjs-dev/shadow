// biome-ignore-all lint/a11y: fixtures check typing of attribute values; accessibility rules do not apply
/**
 * Type tests: SVG and MathML elements, their presentation attributes, and the shared names
 * (`a`, `script`, `style`, `title`) that exist in more than one namespace.
 *
 * @since 1.0.0
 */
import { sink } from "./support";

/** A child for void elements: any child is a type error there. */
declare const kid: string;

// ---- SVG root and structure ---------------------------------------------------------------------
sink(<svg viewBox="0 0 24 24" width="24" height="24" xmlns="http://www.w3.org/2000/svg" />);
sink(<svg xmlns:xlink="http://www.w3.org/1999/xlink" preserveAspectRatio="xMidYMid meet" />);
sink(<svg width={100} height="50%" version="1.1" onLoad={(e) => e.type} class="icon" />);
sink(
  <g transform="translate(10 20)" fill="none" stroke="#000">
    <title>group</title>
    <desc>d</desc>
  </g>,
);
sink(
  <defs>
    <linearGradient id="g" x1="0" x2="1">
      <stop offset="0" stop-color="red" />
    </linearGradient>
  </defs>,
);
sink(<metadata />);
sink(
  <symbol id="s" viewBox="0 0 10 10" refX={5} refY={5}>
    <circle cx={5} cy={5} r={4} />
  </symbol>,
);
sink(<view id="v" viewBox="0 0 1 1" />);
sink(
  <switch>
    <g systemLanguage="en" />
  </switch>,
);

// ---- Shapes ----------------------------------------------------------------------------------------
sink(
  <path
    d="M0 0 L10 10"
    fill="none"
    stroke="black"
    stroke-width={2}
    stroke-linecap="round"
    pathLength={100}
  />,
);
sink(<rect x={0} y="0" width="10" height="10" rx={2} ry={2} fill="url(#g)" opacity={0.5} />);
sink(<circle cx={5} cy={5} r={4} fill-opacity="0.5" />);
sink(<ellipse cx={5} cy={5} rx={4} ry={2} stroke-dasharray="4 2" />);
sink(<line x1={0} y1={0} x2={10} y2={10} stroke="red" marker-end="url(#arrow)" />);
sink(<polyline points="0,0 10,10 20,0" fill="none" />);
sink(<polygon points="0,0 10,0 5,10" />);
sink(
  <text
    x={10}
    y="20"
    dx={2}
    rotate="0 10"
    textLength={50}
    lengthAdjust="spacingAndGlyphs"
    font-size="12"
  >
    label
  </text>,
);
sink(
  <text>
    <tspan x={0} dy="1em">
      line
    </tspan>
    <textPath href="#p" startOffset="50%" method="align" side="left">
      arc
    </textPath>
  </text>,
);
sink(
  <image
    href="/a.png"
    x={0}
    y={0}
    width={10}
    height={10}
    preserveAspectRatio="none"
    crossorigin="anonymous"
  />,
);
sink(<use href="#shape" x={5} y={5} />);
sink(
  <foreignObject x={0} y={0} width={100} height={50}>
    <div class="html-inside">html</div>
  </foreignObject>,
);

// ---- Paint servers, clipping, masking, markers ---------------------------------------------------
sink(
  <radialGradient
    id="rg"
    cx="50%"
    cy="50%"
    r="50%"
    fx={0}
    fy={0}
    gradientUnits="objectBoundingBox"
    spreadMethod="reflect"
  >
    <stop offset="50%" stop-color="blue" stop-opacity={0.5} />
  </radialGradient>,
);
sink(
  <pattern id="p1" width={10} height={10} patternUnits="userSpaceOnUse" viewBox="0 0 10 10">
    <rect width={5} height={5} />
  </pattern>,
);
sink(
  <clipPath id="c" clipPathUnits="userSpaceOnUse">
    <rect width={10} height={10} />
  </clipPath>,
);
sink(
  <mask id="m" maskUnits="objectBoundingBox" x={0} y={0} width={1} height={1}>
    <rect fill="white" width={10} height={10} />
  </mask>,
);
sink(
  <marker
    id="arrow"
    markerWidth={6}
    markerHeight={6}
    refX={5}
    refY={3}
    orient="auto-start-reverse"
    markerUnits="strokeWidth"
  >
    <path d="M0 0 L6 3 L0 6 z" />
  </marker>,
);
sink(
  <filter id="f" x={0} y={0} width="120%" height="120%" filterUnits="objectBoundingBox">
    <feGaussianBlur in="SourceGraphic" stdDeviation="2" edgeMode="duplicate" />
  </filter>,
);

// ---- Filter primitives ---------------------------------------------------------------------------
sink(
  <filter id="fx">
    <feBlend in="SourceGraphic" in2="BackgroundImage" mode="multiply" />
  </filter>,
);
sink(
  <filter id="fx">
    <feColorMatrix type="saturate" values={0.5} />
  </filter>,
);
sink(
  <filter id="fx">
    <feComposite operator="arithmetic" k1={1} k2={0} k3={0} k4={0} />
  </filter>,
);
sink(
  <filter id="fx">
    <feConvolveMatrix order="3" kernelMatrix="1 0 0 0 1 0 0 0 1" preserveAlpha="true" />
  </filter>,
);
sink(
  <filter id="fx">
    <feDiffuseLighting surfaceScale={1} diffuseConstant={1}>
      <feDistantLight azimuth={45} elevation={30} />
    </feDiffuseLighting>
  </filter>,
);
sink(
  <filter id="fx">
    <feDisplacementMap in2="noise" scale={10} xChannelSelector="R" yChannelSelector="G" />
  </filter>,
);
sink(
  <filter id="fx">
    <feDropShadow dx={2} dy={2} stdDeviation={3} flood-color="black" />
  </filter>,
);
sink(
  <filter id="fx">
    <feFlood flood-color="red" flood-opacity={0.4} />
  </filter>,
);
sink(
  <filter id="fx">
    <feComponentTransfer>
      <feFuncA type="table" tableValues="0 1" />
      <feFuncR type="linear" slope={2} />
    </feComponentTransfer>
  </filter>,
);
sink(
  <filter id="fx">
    <feImage href="/img.png" preserveAspectRatio="xMidYMid" />
  </filter>,
);
sink(
  <filter id="fx">
    <feMerge>
      <feMergeNode in="blur" />
      <feMergeNode in="SourceGraphic" />
    </feMerge>
  </filter>,
);
sink(
  <filter id="fx">
    <feMorphology operator="dilate" radius="2" />
  </filter>,
);
sink(
  <filter id="fx">
    <feOffset dx={4} dy={4} in="SourceAlpha" />
  </filter>,
);
sink(
  <filter id="fx">
    <feSpecularLighting specularConstant={1} specularExponent={20}>
      <fePointLight x={1} y={2} z={3} />
    </feSpecularLighting>
  </filter>,
);
sink(
  <filter id="fx">
    <feSpotLight x={0} y={0} z={0} pointsAtX={1} pointsAtY={1} pointsAtZ={0} />
  </filter>,
);
sink(
  <filter id="fx">
    <feTile in="SourceGraphic" />
  </filter>,
);
sink(
  <filter id="fx">
    <feTurbulence
      type="fractalNoise"
      baseFrequency="0.05"
      numOctaves={2}
      seed={3}
      stitchTiles="stitch"
    />
  </filter>,
);

// ---- Animation -----------------------------------------------------------------------------------
sink(
  <rect>
    <animate attributeName="x" from="0" to="10" dur="1s" repeatCount="indefinite" fill="freeze" />
  </rect>,
);
sink(
  <circle>
    <set attributeName="visibility" to="hidden" begin="1s" />
  </circle>,
);
sink(
  <g>
    <animateTransform attributeName="transform" type="rotate" from="0 5 5" to="360 5 5" dur="2s" />
  </g>,
);
sink(
  <g>
    <animateMotion path="M0 0 L10 10" dur="2s" rotate="auto">
      <mpath href="#p" />
    </animateMotion>
  </g>,
);

// ---- Links, scripts, styles, titles (shared names) -----------------------------------------------
sink(
  <a href="/home" target="_blank" rel="noopener">
    link
  </a>,
);
sink(
  <svg>
    <a href="#x" fill="red">
      <text>svg link</text>
    </a>
  </svg>,
);
sink(
  <svg>
    <script type="text/ecmascript" href="/s.js" />
  </svg>,
);
sink(
  <svg>
    <style type="text/css" media="screen">
      {"circle { fill: red }"}
    </style>
  </svg>,
);
sink(
  <svg>
    <title>accessible name</title>
  </svg>,
);
sink(<title>document title</title>);
sink(<script type="module">{"export {}"}</script>);
sink(<style>{"p { margin: 0 }"}</style>);
sink(
  <svg>
    <a xlink:href="#y" />
  </svg>,
);

// ---- SVG ref and events ---------------------------------------------------------------------------
sink(
  <path
    d="M0 0"
    ref={(el) => el.getTotalLength()}
    onClick={(e) => e.currentTarget.getTotalLength()}
  />,
);
sink(<svg ref={(el) => el.createSVGNumber()} />);
sink(<circle ref={(el) => el.r.baseVal.value} />);

// ---- MathML --------------------------------------------------------------------------------------
sink(
  <math display="block">
    <mi mathvariant="bold">x</mi>
    <mo fence="true" stretchy="false" form="prefix">
      +
    </mo>
    <mn>2</mn>
  </math>,
);
sink(
  <math>
    <mfrac linethickness="2px" beveled>
      <mi>a</mi>
      <mi>b</mi>
    </mfrac>
  </math>,
);
sink(
  <math>
    <msup>
      <mi>x</mi>
      <mn>2</mn>
    </msup>
  </math>,
);
sink(
  <math>
    <msqrt>
      <mi>y</mi>
    </msqrt>
    <mroot>
      <mi>y</mi>
      <mn>3</mn>
    </mroot>
  </math>,
);
sink(
  <math>
    <mrow>
      <mi>z</mi>
    </mrow>
    <mspace width="1em" height="2ex" />
  </math>,
);
sink(
  <math>
    <mtable columnalign="center" rowspacing="2px">
      <mtr>
        <mtd columnspan={2} rowalign="top">
          <mtext>cell</mtext>
        </mtd>
      </mtr>
    </mtable>
  </math>,
);
sink(
  <math>
    <mstyle displaystyle="true" scriptlevel={1} mathcolor="red">
      <ms lquote="«" rquote="»">
        s
      </ms>
    </mstyle>
  </math>,
);
sink(
  <math>
    <mpadded width="2em" voffset="1ex">
      <mphantom>
        <mi>h</mi>
      </mphantom>
    </mpadded>
  </math>,
);
sink(
  <math>
    <semantics>
      <mi>q</mi>
      <annotation encoding="TeX">q</annotation>
    </semantics>
  </math>,
);
sink(
  <math>
    <munder>
      <mo>∑</mo>
      <mi>i</mi>
    </munder>
    <mover accent="true">
      <mi>x</mi>
      <mo>^</mo>
    </mover>
  </math>,
);
sink(
  <math>
    <munderover>
      <mo>∑</mo>
      <mi>i</mi>
      <mi>n</mi>
    </munderover>
    <msubsup>
      <mi>a</mi>
      <mi>i</mi>
      <mn>2</mn>
    </msubsup>
  </math>,
);
sink(
  <math>
    <maction actiontype="toggle" selection={2}>
      <mi>a</mi>
    </maction>
  </math>,
);
sink(
  <math>
    <a href="/math-link">
      <mi>link</mi>
    </a>
  </math>,
);
sink(
  <math>
    <mmultiscripts>
      <mi>x</mi>
      <mi>a</mi>
    </mmultiscripts>
  </math>,
);

// ---- Negatives: SVG ------------------------------------------------------------------------------
// @ts-expect-error path data is a string
sink(<path d={1} />);
// @ts-expect-error viewBox is a string
sink(<svg viewBox={1} />);

// @ts-expect-error gradientUnits is a closed set
sink(<linearGradient gradientUnits="page" />);
// @ts-expect-error feColorMatrix type is a closed set
sink(<feColorMatrix type="xyz" />);
// @ts-expect-error animation elements are empty
sink(<animate>{kid}</animate>);
// @ts-expect-error animateTransform type is a closed set
sink(<animateTransform type="spin" />);
// @ts-expect-error fill is an SVG attribute, not a div attribute
sink(<div fill="red" />);
// @ts-expect-error stroke-linecap is a closed set
sink(<path stroke-linecap="triangle" />);
// @ts-expect-error a text-anchor is a string, not an object
sink(<text text-anchor={{}} />);
// @ts-expect-error xml:space is default or preserve
sink(<text xml:space="collapse" />);
// @ts-expect-error a link rel is a string
sink(<a rel={{}} />);

// ---- Negatives: MathML ---------------------------------------------------------------------------
// @ts-expect-error display is block or inline
sink(<math display="flex" />);
// @ts-expect-error fence is a boolean-like value
sink(<mo fence={{}} />);
// @ts-expect-error form is prefix, infix or postfix
sink(<mo form="around" />);
// @ts-expect-error mathvariant is a closed set
sink(<mi mathvariant="fancy" />);
// @ts-expect-error mspace is void
sink(<mspace>{kid}</mspace>);
// @ts-expect-error frac has no 'align' in this map; use numalign
sink(<mfrac align="center" />);

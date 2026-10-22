/**
 * Per-element attribute maps for every MathML element the DOM library types
 * (`MathMLElementTagNameMap`). Presentation attributes (`mathcolor`, `mathvariant`, ...) are accepted
 * on every MathML element; the structural and layout attributes are per element.
 *
 * @since 1.0.0
 */
import type { ElementProps, VoidElementProps } from "./global";
import type { Booleanish, MathMLTagElement, Maybe } from "./types";

/** A MathML length or unitless number, e.g. `"2em"`, `"thin"`, `3`. @since 1.0.0 */
export type MathValue = Maybe<number | string>;

/** The `mathvariant` presentation values. @since 1.0.0 */
export type MathVariant =
  | "normal"
  | "bold"
  | "italic"
  | "bold-italic"
  | "double-struck"
  | "bold-fraktur"
  | "script"
  | "bold-script"
  | "fraktur"
  | "sans-serif"
  | "bold-sans-serif"
  | "sans-serif-italic"
  | "sans-serif-bold-italic"
  | "monospace"
  | "initial"
  | "tailed"
  | "looped"
  | "stretched";

/**
 * Attributes every MathML element accepts: the presentation attributes and `href`.
 *
 * @since 1.0.0
 */
export interface MathMLGlobalAttributes {
  href?: Maybe<string>;
  xref?: Maybe<string>;
  mathbackground?: Maybe<string>;
  mathcolor?: Maybe<string>;
  mathsize?: MathValue;
  mathvariant?: Maybe<MathVariant>;
  dir?: Maybe<"ltr" | "rtl">;
  displaystyle?: Maybe<Booleanish>;
  scriptlevel?: MathValue;
  scriptminsize?: MathValue;
  scriptsizemultiplier?: MathValue;
}

/** Attributes of `math`. @since 1.0.0 */
export interface MathRootAttributes {
  display?: Maybe<"block" | "inline">;
  alttext?: Maybe<string>;
  altimg?: Maybe<string>;
  overflow?: Maybe<"scroll" | "elide" | "truncate" | "scroll">;
}

/** Attributes of `mo` (operator). @since 1.0.0 */
export interface MathOperatorAttributes {
  accent?: Maybe<Booleanish>;
  fence?: Maybe<Booleanish>;
  form?: Maybe<"prefix" | "infix" | "postfix">;
  largeop?: Maybe<Booleanish>;
  lspace?: MathValue;
  maxsize?: MathValue;
  minsize?: MathValue;
  movablelimits?: Maybe<Booleanish>;
  rspace?: MathValue;
  separator?: Maybe<Booleanish>;
  stretchy?: Maybe<Booleanish>;
  symmetric?: Maybe<Booleanish>;
}

/** Attributes of `mspace`. @since 1.0.0 */
export interface MathSpaceAttributes {
  depth?: MathValue;
  height?: MathValue;
  linebreak?: Maybe<"auto" | "newline" | "nobreak" | "goodbreak" | "badbreak">;
  width?: MathValue;
}

/** Attributes of `mfrac`. @since 1.0.0 */
export interface MathFractionAttributes {
  beveled?: Maybe<Booleanish>;
  denomalign?: Maybe<"left" | "center" | "right">;
  linethickness?: MathValue;
  numalign?: Maybe<"left" | "center" | "right">;
}

/** Attributes of `mpadded`. @since 1.0.0 */
export interface MathPaddedAttributes {
  depth?: MathValue;
  height?: MathValue;
  lspace?: MathValue;
  voffset?: MathValue;
  width?: MathValue;
}

/** Attributes of the script and limit elements (`msub`, `msup`, `munder`, ...). @since 1.0.0 */
export interface MathScriptAttributes {
  accent?: Maybe<Booleanish>;
  accentunder?: Maybe<Booleanish>;
  align?: Maybe<"left" | "right">;
  subscriptshift?: MathValue;
  superscriptshift?: MathValue;
}

/** Attributes of `mtable`. @since 1.0.0 */
export interface MathTableAttributes {
  align?: Maybe<string>;
  columnalign?: Maybe<string>;
  columnspacing?: MathValue;
  equalcolumns?: Maybe<Booleanish>;
  equalrows?: Maybe<Booleanish>;
  frame?: Maybe<"none" | "solid" | "dashed">;
  framespacing?: MathValue;
  groupalign?: Maybe<string>;
  minlabelspacing?: MathValue;
  rowalign?: Maybe<string>;
  rowspacing?: MathValue;
  side?: Maybe<"left" | "right" | "leftoverlap" | "rightoverlap">;
  width?: MathValue;
}

/** Attributes of `mtd` and `mtr`. @since 1.0.0 */
export interface MathCellAttributes {
  columnalign?: Maybe<string>;
  columnspan?: Maybe<number | string>;
  groupalign?: Maybe<string>;
  rowalign?: Maybe<string>;
  rowspan?: Maybe<number | string>;
}

/** Attributes of `ms` (string literal). @since 1.0.0 */
export interface MathStringAttributes {
  lquote?: Maybe<string>;
  rquote?: Maybe<string>;
}

/** Attributes of `maction`. @since 1.0.0 */
export interface MathActionAttributes {
  actiontype?: Maybe<string>;
  selection?: Maybe<number | string>;
}

/** Attributes of `annotation`. @since 1.0.0 */
export interface MathAnnotationAttributes {
  encoding?: Maybe<string>;
  src?: Maybe<string>;
}

/**
 * Attribute maps for every MathML element, keyed by the MathML tag name.
 *
 * @since 1.0.0
 */
export interface MathMLIntrinsicElements {
  /** The MathML `<a>` element: a hyperlink in MathML content. */
  a: ElementProps<MathMLTagElement<"a">, MathMLGlobalAttributes>;
  /** The MathML `<annotation>` element: an annotation in a non-XML format, such as TeX. */
  annotation: ElementProps<
    MathMLElementTagNameMap["annotation"],
    MathMLGlobalAttributes & MathAnnotationAttributes
  >;
  "annotation-xml": ElementProps<
    MathMLElementTagNameMap["annotation-xml"],
    MathMLGlobalAttributes & MathAnnotationAttributes
  >;
  /** The MathML `<maction>` element: an action on its sub-expressions (legacy). */
  maction: ElementProps<
    MathMLElementTagNameMap["maction"],
    MathMLGlobalAttributes & MathActionAttributes
  >;
  /** The MathML `<math>` element: the root of MathML content. */
  math: ElementProps<MathMLElementTagNameMap["math"], MathMLGlobalAttributes & MathRootAttributes>;
  /** The MathML `<merror>` element: a message about a syntax error. */
  merror: ElementProps<MathMLElementTagNameMap["merror"], MathMLGlobalAttributes>;
  /** The MathML `<mfrac>` element: a fraction. */
  mfrac: ElementProps<
    MathMLElementTagNameMap["mfrac"],
    MathMLGlobalAttributes & MathFractionAttributes
  >;
  /** The MathML `<mi>` element: an identifier, such as a variable name. */
  mi: ElementProps<MathMLElementTagNameMap["mi"], MathMLGlobalAttributes>;
  /** The MathML `<mmultiscripts>` element: a base with prescripts and postscripts. */
  mmultiscripts: ElementProps<
    MathMLElementTagNameMap["mmultiscripts"],
    MathMLGlobalAttributes & MathScriptAttributes
  >;
  /** The MathML `<mn>` element: a numeric literal. */
  mn: ElementProps<MathMLElementTagNameMap["mn"], MathMLGlobalAttributes>;
  /** The MathML `<mo>` element: an operator, fence or separator. */
  mo: ElementProps<MathMLElementTagNameMap["mo"], MathMLGlobalAttributes & MathOperatorAttributes>;
  /** The MathML `<mover>` element: a base with an overscript. */
  mover: ElementProps<
    MathMLElementTagNameMap["mover"],
    MathMLGlobalAttributes & MathScriptAttributes
  >;
  /** The MathML `<mpadded>` element: content with adjusted space around it. */
  mpadded: ElementProps<
    MathMLElementTagNameMap["mpadded"],
    MathMLGlobalAttributes & MathPaddedAttributes
  >;
  /** The MathML `<mphantom>` element: content that takes space but is invisible. */
  mphantom: ElementProps<MathMLElementTagNameMap["mphantom"], MathMLGlobalAttributes>;
  /** The MathML `<mprescripts>` element: the separator between postscripts and prescripts in mmultiscripts. */
  mprescripts: VoidElementProps<
    MathMLElementTagNameMap["mprescripts"],
    MathMLGlobalAttributes & MathScriptAttributes
  >;
  /** The MathML `<mroot>` element: a radical with an index. */
  mroot: ElementProps<MathMLElementTagNameMap["mroot"], MathMLGlobalAttributes>;
  /** The MathML `<mrow>` element: a horizontal group of sub-expressions. */
  mrow: ElementProps<MathMLElementTagNameMap["mrow"], MathMLGlobalAttributes>;
  /** The MathML `<ms>` element: a string literal. */
  ms: ElementProps<MathMLElementTagNameMap["ms"], MathMLGlobalAttributes & MathStringAttributes>;
  /** The MathML `<mspace>` element: blank space of a given size. */
  mspace: VoidElementProps<
    MathMLElementTagNameMap["mspace"],
    MathMLGlobalAttributes & MathSpaceAttributes
  >;
  /** The MathML `<msqrt>` element: a square root. */
  msqrt: ElementProps<MathMLElementTagNameMap["msqrt"], MathMLGlobalAttributes>;
  /** The MathML `<mstyle>` element: a style change that applies to its children. */
  mstyle: ElementProps<MathMLElementTagNameMap["mstyle"], MathMLGlobalAttributes>;
  /** The MathML `<msub>` element: a base with a subscript. */
  msub: ElementProps<
    MathMLElementTagNameMap["msub"],
    MathMLGlobalAttributes & MathScriptAttributes
  >;
  /** The MathML `<msubsup>` element: a base with a subscript and a superscript. */
  msubsup: ElementProps<
    MathMLElementTagNameMap["msubsup"],
    MathMLGlobalAttributes & MathScriptAttributes
  >;
  /** The MathML `<msup>` element: a base with a superscript. */
  msup: ElementProps<
    MathMLElementTagNameMap["msup"],
    MathMLGlobalAttributes & MathScriptAttributes
  >;
  /** The MathML `<mtable>` element: a table or matrix. */
  mtable: ElementProps<
    MathMLElementTagNameMap["mtable"],
    MathMLGlobalAttributes & MathTableAttributes
  >;
  /** The MathML `<mtd>` element: a cell of a mtable. */
  mtd: ElementProps<MathMLElementTagNameMap["mtd"], MathMLGlobalAttributes & MathCellAttributes>;
  /** The MathML `<mtext>` element: text with no notational meaning. */
  mtext: ElementProps<MathMLElementTagNameMap["mtext"], MathMLGlobalAttributes>;
  /** The MathML `<mtr>` element: a row of a mtable. */
  mtr: ElementProps<MathMLElementTagNameMap["mtr"], MathMLGlobalAttributes & MathCellAttributes>;
  /** The MathML `<munder>` element: a base with an underscript. */
  munder: ElementProps<
    MathMLElementTagNameMap["munder"],
    MathMLGlobalAttributes & MathScriptAttributes
  >;
  /** The MathML `<munderover>` element: a base with an underscript and an overscript. */
  munderover: ElementProps<
    MathMLElementTagNameMap["munderover"],
    MathMLGlobalAttributes & MathScriptAttributes
  >;
  /** The MathML `<semantics>` element: an expression paired with its annotations. */
  semantics: ElementProps<MathMLElementTagNameMap["semantics"], MathMLGlobalAttributes>;
}

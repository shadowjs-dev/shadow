/**
 * Per-element attribute maps for every HTML element (living standard plus the deprecated names the
 * DOM library lists). Element types for `ref` come from `HTMLElementTagNameMap`, so they track the
 * platform.
 *
 * @since 1.0.0
 */
import type {
  Aliases,
  ElementProps,
  MediaElementProps,
  TextElementProps,
  VideoElementProps,
  VoidElementProps,
  WindowElementProps,
} from "./global";
import type { LooseString, Maybe } from "./types";

/** Targets of links and forms. Any other browsing-context name is also accepted. @since 1.0.0 */
export type LinkTarget = LooseString<"_self" | "_blank" | "_parent" | "_top">;

/** Referrer policies, as in the HTML standard. @since 1.0.0 */
export type ReferrerPolicy =
  | ""
  | "no-referrer"
  | "no-referrer-when-downgrade"
  | "origin"
  | "origin-when-cross-origin"
  | "same-origin"
  | "strict-origin"
  | "strict-origin-when-cross-origin"
  | "unsafe-url";

/** CORS modes for resources that are fetched. @since 1.0.0 */
export type CrossOrigin = "anonymous" | "use-credentials" | "";

/** Fetch priority hints. @since 1.0.0 */
export type FetchPriority = "high" | "low" | "auto";

/** Lazy-loading and decoding hints for images and iframes. @since 1.0.0 */
export type Loading = "eager" | "lazy";

/** Form submission encodings. @since 1.0.0 */
export type EncType = "application/x-www-form-urlencoded" | "multipart/form-data" | "text/plain";

/** Form submission methods. @since 1.0.0 */
export type FormMethod = "get" | "post" | "dialog";

/**
 * The `type` values of `input`. Unknown types are a type error: the browser falls back to `text`,
 * which is almost always a typo.
 *
 * @since 1.0.0
 */
export type InputType =
  | "button"
  | "checkbox"
  | "color"
  | "date"
  | "datetime-local"
  | "email"
  | "file"
  | "hidden"
  | "image"
  | "month"
  | "number"
  | "password"
  | "radio"
  | "range"
  | "reset"
  | "search"
  | "submit"
  | "tel"
  | "text"
  | "time"
  | "url"
  | "week";

/** Attributes of `a`. @since 1.0.0 */
export interface AnchorAttributes {
  download?: Maybe<string | boolean>;
  href?: Maybe<string>;
  hreflang?: Maybe<string>;
  ping?: Maybe<string>;
  referrerpolicy?: Maybe<ReferrerPolicy>;
  rel?: Maybe<string>;
  target?: Maybe<LinkTarget>;
  type?: Maybe<string>;
}

/** Attributes of `area`. @since 1.0.0 */
export interface AreaAttributes {
  alt?: Maybe<string>;
  coords?: Maybe<string>;
  download?: Maybe<string | boolean>;
  href?: Maybe<string>;
  hreflang?: Maybe<string>;
  ping?: Maybe<string>;
  referrerpolicy?: Maybe<ReferrerPolicy>;
  rel?: Maybe<string>;
  shape?: Maybe<"rect" | "circle" | "poly" | "default">;
  target?: Maybe<LinkTarget>;
}

/** Attributes shared by `audio` and `video`. @since 1.0.0 */
export interface MediaAttributes {
  autoplay?: Maybe<boolean>;
  controls?: Maybe<boolean>;
  crossorigin?: Maybe<CrossOrigin>;
  loop?: Maybe<boolean>;
  muted?: Maybe<boolean>;
  preload?: Maybe<"none" | "metadata" | "auto" | "">;
  src?: Maybe<string>;
}

/** Attributes of `audio`. @since 1.0.0 */
export interface AudioAttributes extends MediaAttributes {}

/** Attributes of `video`. @since 1.0.0 */
export interface VideoAttributes extends MediaAttributes {
  height?: Maybe<number | string>;
  playsinline?: Maybe<boolean>;
  poster?: Maybe<string>;
  width?: Maybe<number | string>;
}

/** Attributes of `base`. @since 1.0.0 */
export interface BaseAttributes {
  href?: Maybe<string>;
  target?: Maybe<LinkTarget>;
}

/** Attributes of `blockquote` and `q`. @since 1.0.0 */
export interface CiteAttributes {
  cite?: Maybe<string>;
}

/** Attributes of `button`. @since 1.0.0 */
export interface ButtonAttributes {
  disabled?: Maybe<boolean>;
  form?: Maybe<string>;
  formaction?: Maybe<string>;
  formenctype?: Maybe<EncType>;
  formmethod?: Maybe<FormMethod>;
  formnovalidate?: Maybe<boolean>;
  formtarget?: Maybe<LinkTarget>;
  name?: Maybe<string>;
  popovertarget?: Maybe<string>;
  popovertargetaction?: Maybe<"show" | "hide" | "toggle">;
  type?: Maybe<"submit" | "reset" | "button">;
  value?: Maybe<string>;
}

/** Attributes of `canvas`. @since 1.0.0 */
export interface CanvasAttributes {
  height?: Maybe<number | string>;
  width?: Maybe<number | string>;
}

/** Attributes of `col` and `colgroup`. @since 1.0.0 */
export interface ColAttributes {
  span?: Maybe<number | string>;
}

/** Attributes of `data`. @since 1.0.0 */
export interface DataAttributes {
  value?: Maybe<string>;
}

/** Attributes of `del` and `ins`. @since 1.0.0 */
export interface ModAttributes {
  cite?: Maybe<string>;
  datetime?: Maybe<string>;
}

/** Attributes of `details`. @since 1.0.0 */
export interface DetailsAttributes {
  name?: Maybe<string>;
  open?: Maybe<boolean>;
}

/** Attributes of `dialog`. @since 1.0.0 */
export interface DialogAttributes {
  closedby?: Maybe<"any" | "closerequest" | "none">;
  open?: Maybe<boolean>;
}

/** Attributes of `embed`. @since 1.0.0 */
export interface EmbedAttributes {
  height?: Maybe<number | string>;
  src?: Maybe<string>;
  type?: Maybe<string>;
  width?: Maybe<number | string>;
}

/** Attributes of `fieldset`. @since 1.0.0 */
export interface FieldsetAttributes {
  disabled?: Maybe<boolean>;
  form?: Maybe<string>;
  name?: Maybe<string>;
}

/** Attributes of `form`. @since 1.0.0 */
export interface FormAttributes {
  "accept-charset"?: Maybe<string>;
  action?: Maybe<string>;
  autocomplete?: Maybe<"on" | "off">;
  enctype?: Maybe<EncType>;
  method?: Maybe<FormMethod>;
  name?: Maybe<string>;
  novalidate?: Maybe<boolean>;
  rel?: Maybe<string>;
  target?: Maybe<LinkTarget>;
}

/** Attributes of `frameset` (deprecated, kept for legacy markup). @since 1.0.0 */
export interface FrameSetAttributes {
  cols?: Maybe<string>;
  rows?: Maybe<string>;
}

/** Attributes of `iframe`. @since 1.0.0 */
export interface IFrameAttributes {
  allow?: Maybe<string>;
  /** Legacy: `allow="fullscreen *"` is the current form. Accepted for existing markup. */
  allowfullscreen?: Maybe<boolean>;
  /** Legacy: `allow="payment *"` is the current form. Accepted for existing markup. */
  allowpaymentrequest?: Maybe<boolean>;
  /** Experimental (not in every browser): loads the frame without its cookies. */
  credentialless?: Maybe<boolean>;
  /** Experimental (not in every browser): a Content Security Policy for the frame. */
  csp?: Maybe<string>;
  height?: Maybe<number | string>;
  loading?: Maybe<Loading>;
  name?: Maybe<string>;
  referrerpolicy?: Maybe<ReferrerPolicy>;
  sandbox?: Maybe<string>;
  src?: Maybe<string>;
  srcdoc?: Maybe<string>;
  width?: Maybe<number | string>;
}

/** Attributes of `img`. @since 1.0.0 */
export interface ImgAttributes {
  alt?: Maybe<string>;
  crossorigin?: Maybe<CrossOrigin>;
  decoding?: Maybe<"sync" | "async" | "auto">;
  elementtiming?: Maybe<string>;
  fetchpriority?: Maybe<FetchPriority>;
  height?: Maybe<number | string>;
  ismap?: Maybe<boolean>;
  loading?: Maybe<Loading>;
  referrerpolicy?: Maybe<ReferrerPolicy>;
  sizes?: Maybe<string>;
  src?: Maybe<string>;
  srcset?: Maybe<string>;
  usemap?: Maybe<string>;
  width?: Maybe<number | string>;
}

/**
 * Attributes of `input`. `value` and `checked` are properties when the expression is dynamic, so
 * they use the DOM's value types: `value` is text, never a boolean.
 *
 * @since 1.0.0
 */
export interface InputAttributes {
  accept?: Maybe<string>;
  alt?: Maybe<string>;
  autocomplete?: Maybe<string>;
  capture?: Maybe<"user" | "environment" | boolean>;
  checked?: Maybe<boolean>;
  defaultChecked?: Maybe<boolean>;
  defaultValue?: Maybe<string | number>;
  dirname?: Maybe<string>;
  disabled?: Maybe<boolean>;
  form?: Maybe<string>;
  formaction?: Maybe<string>;
  formenctype?: Maybe<EncType>;
  formmethod?: Maybe<FormMethod>;
  formnovalidate?: Maybe<boolean>;
  formtarget?: Maybe<LinkTarget>;
  height?: Maybe<number | string>;
  indeterminate?: Maybe<boolean>;
  list?: Maybe<string>;
  max?: Maybe<number | string>;
  maxlength?: Maybe<number | string>;
  min?: Maybe<number | string>;
  minlength?: Maybe<number | string>;
  multiple?: Maybe<boolean>;
  name?: Maybe<string>;
  pattern?: Maybe<string>;
  placeholder?: Maybe<string>;
  popovertarget?: Maybe<string>;
  popovertargetaction?: Maybe<"show" | "hide" | "toggle">;
  readonly?: Maybe<boolean>;
  required?: Maybe<boolean>;
  size?: Maybe<number | string>;
  src?: Maybe<string>;
  step?: Maybe<number | string>;
  type?: Maybe<InputType>;
  value?: Maybe<string | number>;
  width?: Maybe<number | string>;
}

/** Attributes of `label`. @since 1.0.0 */
export interface LabelAttributes {
  for?: Maybe<string>;
  form?: Maybe<string>;
}

/** Attributes of `li`. @since 1.0.0 */
export interface LIAttributes {
  value?: Maybe<number | string>;
}

/** Attributes of `link`. @since 1.0.0 */
export interface LinkAttributes {
  as?: Maybe<string>;
  blocking?: Maybe<"render">;
  crossorigin?: Maybe<CrossOrigin>;
  disabled?: Maybe<boolean>;
  fetchpriority?: Maybe<FetchPriority>;
  href?: Maybe<string>;
  hreflang?: Maybe<string>;
  imagesizes?: Maybe<string>;
  imagesrcset?: Maybe<string>;
  integrity?: Maybe<string>;
  media?: Maybe<string>;
  referrerpolicy?: Maybe<ReferrerPolicy>;
  rel?: Maybe<string>;
  sizes?: Maybe<string>;
  type?: Maybe<string>;
}

/** Attributes of `map`. @since 1.0.0 */
export interface MapAttributes {
  name?: Maybe<string>;
}

/** Attributes of `meta`. @since 1.0.0 */
export interface MetaAttributes {
  charset?: Maybe<string>;
  content?: Maybe<string>;
  "http-equiv"?: Maybe<string>;
  media?: Maybe<string>;
  name?: Maybe<string>;
}

/** Attributes of `meter`. @since 1.0.0 */
export interface MeterAttributes {
  form?: Maybe<string>;
  high?: Maybe<number | string>;
  low?: Maybe<number | string>;
  max?: Maybe<number | string>;
  min?: Maybe<number | string>;
  optimum?: Maybe<number | string>;
  value?: Maybe<number | string>;
}

/** Attributes of `object`. @since 1.0.0 */
export interface ObjectAttributes {
  data?: Maybe<string>;
  form?: Maybe<string>;
  height?: Maybe<number | string>;
  name?: Maybe<string>;
  type?: Maybe<string>;
  typemustmatch?: Maybe<boolean>;
  usemap?: Maybe<string>;
  width?: Maybe<number | string>;
}

/** Attributes of `ol`. @since 1.0.0 */
export interface OListAttributes {
  reversed?: Maybe<boolean>;
  start?: Maybe<number | string>;
  type?: Maybe<"1" | "a" | "A" | "i" | "I">;
}

/** Attributes of `optgroup`. @since 1.0.0 */
export interface OptGroupAttributes {
  disabled?: Maybe<boolean>;
  label?: Maybe<string>;
}

/** Attributes of `option`. @since 1.0.0 */
export interface OptionAttributes {
  disabled?: Maybe<boolean>;
  label?: Maybe<string>;
  selected?: Maybe<boolean>;
  value?: Maybe<string | number>;
}

/** Attributes of `output`. @since 1.0.0 */
export interface OutputAttributes {
  for?: Maybe<string>;
  form?: Maybe<string>;
  name?: Maybe<string>;
}

/** Attributes of `progress`. @since 1.0.0 */
export interface ProgressAttributes {
  max?: Maybe<number | string>;
  value?: Maybe<number | string>;
}

/** Attributes of `script`. @since 1.0.0 */
export interface ScriptAttributes {
  async?: Maybe<boolean>;
  blocking?: Maybe<"render">;
  crossorigin?: Maybe<CrossOrigin>;
  defer?: Maybe<boolean>;
  fetchpriority?: Maybe<FetchPriority>;
  integrity?: Maybe<string>;
  nomodule?: Maybe<boolean>;
  referrerpolicy?: Maybe<ReferrerPolicy>;
  src?: Maybe<string>;
  type?: Maybe<string>;
}

/** Attributes of `select`. @since 1.0.0 */
export interface SelectAttributes {
  autocomplete?: Maybe<string>;
  defaultValue?: Maybe<string | number>;
  disabled?: Maybe<boolean>;
  form?: Maybe<string>;
  multiple?: Maybe<boolean>;
  name?: Maybe<string>;
  required?: Maybe<boolean>;
  size?: Maybe<number | string>;
  /** A string or number; an array of them selects several options of a `multiple` select. */
  value?: Maybe<string | number | readonly (string | number)[]>;
}

/** Attributes of `slot`. @since 1.0.0 */
export interface SlotAttributes {
  name?: Maybe<string>;
}

/** Attributes of `source`. @since 1.0.0 */
export interface SourceAttributes {
  height?: Maybe<number | string>;
  media?: Maybe<string>;
  sizes?: Maybe<string>;
  src?: Maybe<string>;
  srcset?: Maybe<string>;
  type?: Maybe<string>;
  width?: Maybe<number | string>;
}

/** Attributes of `style`. @since 1.0.0 */
export interface StyleElementAttributes {
  blocking?: Maybe<"render">;
  media?: Maybe<string>;
  type?: Maybe<string>;
}

/** Attributes of `td` and `th`. @since 1.0.0 */
export interface TableCellAttributes {
  colspan?: Maybe<number | string>;
  headers?: Maybe<string>;
  rowspan?: Maybe<number | string>;
}

/** Attributes of `th`. @since 1.0.0 */
export interface TableHeaderAttributes extends TableCellAttributes {
  abbr?: Maybe<string>;
  scope?: Maybe<"row" | "col" | "rowgroup" | "colgroup" | "auto">;
}

/**
 * Legacy table layout attributes (HTML 4). `cellpadding` and `cellspacing` are the HTML names; the
 * camelCase spellings are React's and are accepted for React compatibility.
 * @since 1.0.0
 */
export interface TableAttributes {
  cellpadding?: Maybe<number | string>;
  cellspacing?: Maybe<number | string>;
  /** React spelling of `cellpadding`. Accepted for React compatibility. */
  cellPadding?: Maybe<number | string>;
  /** React spelling of `cellspacing`. Accepted for React compatibility. */
  cellSpacing?: Maybe<number | string>;
}

/**
 * Deprecated `iframe` attributes (the HTML names are `frameborder`, `marginwidth`, `marginheight` and
 * `scrolling`): the browser may ignore them, and new markup should use CSS instead. React's camelCase
 * spellings are accepted for React compatibility.
 * @since 1.0.0
 */
export interface IFrameLegacyAttributes {
  frameborder?: Maybe<number | string>;
  marginwidth?: Maybe<number | string>;
  marginheight?: Maybe<number | string>;
  scrolling?: Maybe<"yes" | "no" | "auto">;
  /** React spelling of `frameborder`. Accepted for React compatibility. */
  frameBorder?: Maybe<number | string>;
  /** React spelling of `marginwidth`. Accepted for React compatibility. */
  marginWidth?: Maybe<number | string>;
  /** React spelling of `marginheight`. Accepted for React compatibility. */
  marginHeight?: Maybe<number | string>;
}

/** Attributes of `template`. @since 1.0.0 */
export interface TemplateAttributes {
  shadowrootclonable?: Maybe<boolean>;
  shadowrootdelegatesfocus?: Maybe<boolean>;
  shadowrootmode?: Maybe<"open" | "closed">;
  shadowrootserializable?: Maybe<boolean>;
}

/** Attributes of `textarea`. @since 1.0.0 */
export interface TextAreaAttributes {
  autocomplete?: Maybe<string>;
  cols?: Maybe<number | string>;
  defaultValue?: Maybe<string>;
  dirname?: Maybe<string>;
  disabled?: Maybe<boolean>;
  form?: Maybe<string>;
  maxlength?: Maybe<number | string>;
  minlength?: Maybe<number | string>;
  name?: Maybe<string>;
  placeholder?: Maybe<string>;
  readonly?: Maybe<boolean>;
  required?: Maybe<boolean>;
  rows?: Maybe<number | string>;
  value?: Maybe<string | number>;
  wrap?: Maybe<"hard" | "soft" | "off">;
}

/** Attributes of `time`. @since 1.0.0 */
export interface TimeAttributes {
  datetime?: Maybe<string>;
}

/** Attributes of `track`. @since 1.0.0 */
export interface TrackAttributes {
  default?: Maybe<boolean>;
  kind?: Maybe<"subtitles" | "captions" | "descriptions" | "chapters" | "metadata">;
  label?: Maybe<string>;
  src?: Maybe<string>;
  srclang?: Maybe<string>;
}

/** Attributes of the deprecated `font` and `basefont`. @since 1.0.0 */
export interface FontAttributes {
  color?: Maybe<string>;
  face?: Maybe<string>;
  size?: Maybe<number | string>;
}

/** Attributes of the deprecated `marquee`. @since 1.0.0 */
export interface MarqueeAttributes {
  behavior?: Maybe<"scroll" | "slide" | "alternate">;
  bgcolor?: Maybe<string>;
  direction?: Maybe<"left" | "right" | "up" | "down">;
  height?: Maybe<number | string>;
  hspace?: Maybe<number | string>;
  loop?: Maybe<number | string>;
  scrollamount?: Maybe<number | string>;
  scrolldelay?: Maybe<number | string>;
  truespeed?: Maybe<boolean>;
  vspace?: Maybe<number | string>;
  width?: Maybe<number | string>;
}

/** Attributes of the deprecated `frame`. @since 1.0.0 */
export interface FrameAttributes {
  name?: Maybe<string>;
  src?: Maybe<string>;
}

/** Attributes of the deprecated `param`, a void element. @since 1.0.0 */
export interface ParamAttributes {
  name?: Maybe<string>;
  value?: Maybe<string>;
}

/** Attributes of the deprecated `keygen`. @since 1.0.0 */
export interface KeygenAttributes {
  autofocus?: Maybe<boolean>;
  challenge?: Maybe<string>;
  disabled?: Maybe<boolean>;
  form?: Maybe<string>;
  keytype?: Maybe<string>;
  name?: Maybe<string>;
}

/** Attributes of the deprecated `dir` (directory list). @since 1.0.0 */
export interface DirAttributes {
  compact?: Maybe<boolean>;
}

/** Attributes of the deprecated `bgsound`. @since 1.0.0 */
export interface BgSoundAttributes {
  loop?: Maybe<number | string>;
  src?: Maybe<string>;
}

/**
 * Attribute maps for every HTML element the DOM library types, keyed by tag name. The compiler
 * decides the namespace from context, so this map covers the HTML meaning only. Shared names (`a`,
 * `script`, `style`, `title`) are merged with their SVG and MathML meanings in `intrinsic.ts`.
 *
 * @since 1.0.0
 */
export interface HTMLIntrinsicElements {
  /** The HTML `<a>` element: a hyperlink. */
  a: ElementProps<
    HTMLElementTagNameMap["a"],
    AnchorAttributes &
      Aliases<AnchorAttributes, { hrefLang: "hreflang"; referrerPolicy: "referrerpolicy" }>
  >;
  /** The HTML `<abbr>` element: an abbreviation or acronym. */
  abbr: ElementProps<HTMLElementTagNameMap["abbr"]>;
  /** The HTML `<address>` element: contact information for its nearest article or the page. */
  address: ElementProps<HTMLElementTagNameMap["address"]>;
  /** The HTML `<area>` element: a clickable region inside an image map. */
  area: VoidElementProps<
    HTMLElementTagNameMap["area"],
    AreaAttributes &
      Aliases<AreaAttributes, { hrefLang: "hreflang"; referrerPolicy: "referrerpolicy" }>
  >;
  /** The HTML `<article>` element: a self-contained composition, such as a post or a card. */
  article: ElementProps<HTMLElementTagNameMap["article"]>;
  /** The HTML `<aside>` element: content tangential to the content around it. */
  aside: ElementProps<HTMLElementTagNameMap["aside"]>;
  /** The HTML `<audio>` element: embedded sound content. */
  audio: MediaElementProps<
    HTMLElementTagNameMap["audio"],
    AudioAttributes & Aliases<AudioAttributes, { autoPlay: "autoplay"; crossOrigin: "crossorigin" }>
  >;
  /** The HTML `<b>` element: text set apart without extra importance, such as keywords. */
  b: ElementProps<HTMLElementTagNameMap["b"]>;
  /** The HTML `<base>` element: the base URL and default target for the document's relative URLs. */
  base: VoidElementProps<HTMLElementTagNameMap["base"], BaseAttributes>;
  /** The HTML `<bdi>` element: text isolated from the surrounding text direction. */
  bdi: ElementProps<HTMLElementTagNameMap["bdi"]>;
  /** The HTML `<bdo>` element: text with an explicit direction override. */
  bdo: ElementProps<HTMLElementTagNameMap["bdo"]>;
  /** The HTML `<blockquote>` element: an extended quotation. */
  blockquote: ElementProps<HTMLElementTagNameMap["blockquote"], CiteAttributes>;
  /** The HTML `<body>` element: the document's content. */
  body: WindowElementProps<HTMLElementTagNameMap["body"]>;
  /** The HTML `<br>` element: a line break. */
  br: VoidElementProps<HTMLElementTagNameMap["br"]>;
  /** The HTML `<button>` element: a clickable button. */
  button: ElementProps<
    HTMLElementTagNameMap["button"],
    ButtonAttributes &
      Aliases<
        ButtonAttributes,
        {
          formAction: "formaction";
          formEncType: "formenctype";
          formMethod: "formmethod";
          formNoValidate: "formnovalidate";
          formTarget: "formtarget";
          popoverTarget: "popovertarget";
          popoverTargetAction: "popovertargetaction";
        }
      >
  >;
  /** The HTML `<canvas>` element: a bitmap drawing surface for scripts. */
  canvas: ElementProps<HTMLElementTagNameMap["canvas"], CanvasAttributes>;
  /** The HTML `<caption>` element: the title of a table. */
  caption: ElementProps<HTMLElementTagNameMap["caption"]>;
  /** The HTML `<cite>` element: the title of a cited work. */
  cite: ElementProps<HTMLElementTagNameMap["cite"]>;
  /** The HTML `<code>` element: a fragment of computer code. */
  code: ElementProps<HTMLElementTagNameMap["code"]>;
  /** The HTML `<col>` element: one or more columns of a table, for shared attributes. */
  col: VoidElementProps<HTMLElementTagNameMap["col"], ColAttributes>;
  /** The HTML `<colgroup>` element: a group of table columns. */
  colgroup: ElementProps<HTMLElementTagNameMap["colgroup"], ColAttributes>;
  /** The HTML `<data>` element: content paired with a machine-readable value. */
  data: ElementProps<HTMLElementTagNameMap["data"], DataAttributes>;
  /** The HTML `<datalist>` element: the predefined options of an input. */
  datalist: ElementProps<HTMLElementTagNameMap["datalist"]>;
  /** The HTML `<dd>` element: the description of a term in a description list. */
  dd: ElementProps<HTMLElementTagNameMap["dd"]>;
  /** The HTML `<del>` element: text removed from the document. */
  del: ElementProps<
    HTMLElementTagNameMap["del"],
    ModAttributes & Aliases<ModAttributes, { dateTime: "datetime" }>
  >;
  /** The HTML `<details>` element: a disclosure widget whose content shows when it is open. */
  details: ElementProps<HTMLElementTagNameMap["details"], DetailsAttributes>;
  /** The HTML `<dfn>` element: the defining instance of a term. */
  dfn: ElementProps<HTMLElementTagNameMap["dfn"]>;
  /** The HTML `<dialog>` element: a dialog box or modal. */
  dialog: ElementProps<HTMLElementTagNameMap["dialog"], DialogAttributes>;
  /** The HTML `<div>` element: a generic block container. */
  div: ElementProps<HTMLElementTagNameMap["div"]>;
  /** The HTML `<dl>` element: a description list. */
  dl: ElementProps<HTMLElementTagNameMap["dl"]>;
  /** The HTML `<dt>` element: a term in a description list. */
  dt: ElementProps<HTMLElementTagNameMap["dt"]>;
  /** The HTML `<em>` element: text with stress emphasis. */
  em: ElementProps<HTMLElementTagNameMap["em"]>;
  /** The HTML `<embed>` element: external content from a plugin or another resource. */
  embed: VoidElementProps<HTMLElementTagNameMap["embed"], EmbedAttributes>;
  /** The HTML `<fieldset>` element: a group of form controls. */
  fieldset: ElementProps<HTMLElementTagNameMap["fieldset"], FieldsetAttributes>;
  /** The HTML `<figcaption>` element: the caption of a figure. */
  figcaption: ElementProps<HTMLElementTagNameMap["figcaption"]>;
  /** The HTML `<figure>` element: self-contained content, such as an illustration, with an optional caption. */
  figure: ElementProps<HTMLElementTagNameMap["figure"]>;
  /** The HTML `<footer>` element: the footer of its nearest section or the page. */
  footer: ElementProps<HTMLElementTagNameMap["footer"]>;
  /** The HTML `<form>` element: a form that submits user input. */
  form: ElementProps<
    HTMLElementTagNameMap["form"],
    FormAttributes &
      Aliases<
        FormAttributes,
        {
          acceptCharset: "accept-charset";
          encType: "enctype";
          autoComplete: "autocomplete";
          noValidate: "novalidate";
        }
      >
  >;
  /** The HTML `<h1>` element: a level-1 section heading. */
  h1: ElementProps<HTMLElementTagNameMap["h1"]>;
  /** The HTML `<h2>` element: a level-2 section heading. */
  h2: ElementProps<HTMLElementTagNameMap["h2"]>;
  /** The HTML `<h3>` element: a level-3 section heading. */
  h3: ElementProps<HTMLElementTagNameMap["h3"]>;
  /** The HTML `<h4>` element: a level-4 section heading. */
  h4: ElementProps<HTMLElementTagNameMap["h4"]>;
  /** The HTML `<h5>` element: a level-5 section heading. */
  h5: ElementProps<HTMLElementTagNameMap["h5"]>;
  /** The HTML `<h6>` element: a level-6 section heading. */
  h6: ElementProps<HTMLElementTagNameMap["h6"]>;
  /** The HTML `<head>` element: the document's metadata. */
  head: ElementProps<HTMLElementTagNameMap["head"]>;
  /** The HTML `<header>` element: introductory content of its nearest section or the page. */
  header: ElementProps<HTMLElementTagNameMap["header"]>;
  /** The HTML `<hgroup>` element: a heading grouped with related content such as a subtitle. */
  hgroup: ElementProps<HTMLElementTagNameMap["hgroup"]>;
  /** The HTML `<hr>` element: a thematic break between paragraphs. */
  hr: VoidElementProps<HTMLElementTagNameMap["hr"]>;
  /** The HTML `<html>` element: the root of an HTML document. */
  html: ElementProps<HTMLElementTagNameMap["html"]>;
  /** The HTML `<i>` element: text in an alternate voice, such as a technical term. */
  i: ElementProps<HTMLElementTagNameMap["i"]>;
  /** The HTML `<iframe>` element: a nested browsing context showing another page. */
  iframe: ElementProps<
    HTMLElementTagNameMap["iframe"],
    IFrameAttributes &
      IFrameLegacyAttributes &
      Aliases<
        IFrameAttributes,
        { allowFullScreen: "allowfullscreen"; referrerPolicy: "referrerpolicy" }
      >
  >;
  /** The HTML `<img>` element: an image. */
  img: VoidElementProps<
    HTMLElementTagNameMap["img"],
    ImgAttributes &
      Aliases<
        ImgAttributes,
        {
          crossOrigin: "crossorigin";
          fetchPriority: "fetchpriority";
          isMap: "ismap";
          referrerPolicy: "referrerpolicy";
          srcSet: "srcset";
          useMap: "usemap";
        }
      >
  >;
  /** The HTML `<input>` element: a form control for user input, typed by its `type`. */
  input: VoidElementProps<
    HTMLElementTagNameMap["input"],
    InputAttributes &
      Aliases<
        InputAttributes,
        {
          readOnly: "readonly";
          maxLength: "maxlength";
          minLength: "minlength";
          autoComplete: "autocomplete";
          formAction: "formaction";
          formEncType: "formenctype";
          formMethod: "formmethod";
          formNoValidate: "formnovalidate";
          formTarget: "formtarget";
          popoverTarget: "popovertarget";
          popoverTargetAction: "popovertargetaction";
        }
      >
  >;
  /** The HTML `<ins>` element: text added to the document. */
  ins: ElementProps<
    HTMLElementTagNameMap["ins"],
    ModAttributes & Aliases<ModAttributes, { dateTime: "datetime" }>
  >;
  /** The HTML `<kbd>` element: user input, such as keyboard keys. */
  kbd: ElementProps<HTMLElementTagNameMap["kbd"]>;
  /** The HTML `<label>` element: the caption of a form control. */
  label: ElementProps<
    HTMLElementTagNameMap["label"],
    LabelAttributes & Aliases<LabelAttributes, { htmlFor: "for" }>
  >;
  /** The HTML `<legend>` element: the caption of a fieldset. */
  legend: ElementProps<HTMLElementTagNameMap["legend"]>;
  /** The HTML `<li>` element: an item in a list. */
  li: ElementProps<HTMLElementTagNameMap["li"], LIAttributes>;
  /** The HTML `<link>` element: a relationship to an external resource, such as a stylesheet. */
  link: VoidElementProps<
    HTMLElementTagNameMap["link"],
    LinkAttributes &
      Aliases<
        LinkAttributes,
        {
          crossOrigin: "crossorigin";
          fetchPriority: "fetchpriority";
          hrefLang: "hreflang";
          imageSizes: "imagesizes";
          imageSrcSet: "imagesrcset";
          referrerPolicy: "referrerpolicy";
        }
      >
  >;
  /** The HTML `<main>` element: the dominant content of the page. */
  main: ElementProps<HTMLElementTagNameMap["main"]>;
  /** The HTML `<map>` element: an image map, with its areas. */
  map: ElementProps<HTMLElementTagNameMap["map"], MapAttributes>;
  /** The HTML `<mark>` element: text highlighted for reference. */
  mark: ElementProps<HTMLElementTagNameMap["mark"]>;
  /** The HTML `<menu>` element: a list of commands, semantically an unordered list. */
  menu: ElementProps<HTMLElementTagNameMap["menu"]>;
  /** The HTML `<meta>` element: metadata that other head elements cannot express. */
  meta: VoidElementProps<
    HTMLElementTagNameMap["meta"],
    MetaAttributes & Aliases<MetaAttributes, { httpEquiv: "http-equiv" }>
  >;
  /** The HTML `<meter>` element: a scalar value within a known range. */
  meter: ElementProps<HTMLElementTagNameMap["meter"], MeterAttributes>;
  /** The HTML `<nav>` element: a section of navigation links. */
  nav: ElementProps<HTMLElementTagNameMap["nav"]>;
  /** The HTML `<noscript>` element: content shown only when scripting is disabled. */
  noscript: ElementProps<HTMLElementTagNameMap["noscript"]>;
  /** The HTML `<object>` element: an external resource, such as a PDF or another page. */
  object: ElementProps<
    HTMLElementTagNameMap["object"],
    ObjectAttributes &
      Aliases<ObjectAttributes, { useMap: "usemap"; typeMustMatch: "typemustmatch" }>
  >;
  /** The HTML `<ol>` element: an ordered list. */
  ol: ElementProps<HTMLElementTagNameMap["ol"], OListAttributes>;
  /** The HTML `<optgroup>` element: a group of options in a select. */
  optgroup: ElementProps<HTMLElementTagNameMap["optgroup"], OptGroupAttributes>;
  /** The HTML `<option>` element: an option in a select or datalist. */
  option: TextElementProps<HTMLElementTagNameMap["option"], OptionAttributes>;
  /** The HTML `<output>` element: the result of a calculation or user action. */
  output: ElementProps<
    HTMLElementTagNameMap["output"],
    OutputAttributes & Aliases<OutputAttributes, { htmlFor: "for" }>
  >;
  /** The HTML `<p>` element: a paragraph. */
  p: ElementProps<HTMLElementTagNameMap["p"]>;
  /** The HTML `<picture>` element: alternative image sources for an img. */
  picture: ElementProps<HTMLElementTagNameMap["picture"]>;
  /** The HTML `<pre>` element: preformatted text, shown as written. */
  pre: ElementProps<HTMLElementTagNameMap["pre"]>;
  /** The HTML `<progress>` element: the progress of a task. */
  progress: ElementProps<HTMLElementTagNameMap["progress"], ProgressAttributes>;
  /** The HTML `<q>` element: a short inline quotation. */
  q: ElementProps<HTMLElementTagNameMap["q"], CiteAttributes>;
  /** The HTML `<rp>` element: fallback parentheses for browsers without ruby support. */
  rp: ElementProps<HTMLElementTagNameMap["rp"]>;
  /** The HTML `<rt>` element: the ruby text (pronunciation) of a ruby annotation. */
  rt: ElementProps<HTMLElementTagNameMap["rt"]>;
  /** The HTML `<ruby>` element: a ruby annotation, for East Asian pronunciation. */
  ruby: ElementProps<HTMLElementTagNameMap["ruby"]>;
  /** The HTML `<s>` element: text that is no longer accurate or relevant. */
  s: ElementProps<HTMLElementTagNameMap["s"]>;
  /** The HTML `<samp>` element: sample output from a program. */
  samp: ElementProps<HTMLElementTagNameMap["samp"]>;
  /** The HTML `<script>` element: an embedded or external script. */
  script: TextElementProps<
    HTMLElementTagNameMap["script"],
    ScriptAttributes &
      Aliases<
        ScriptAttributes,
        {
          crossOrigin: "crossorigin";
          fetchPriority: "fetchpriority";
          noModule: "nomodule";
          referrerPolicy: "referrerpolicy";
        }
      >
  >;
  /** The HTML `<search>` element: a search or filtering section. */
  search: ElementProps<HTMLElementTagNameMap["search"]>;
  /** The HTML `<section>` element: a generic standalone section of the document. */
  section: ElementProps<HTMLElementTagNameMap["section"]>;
  /** The HTML `<select>` element: a control to choose among options. */
  select: ElementProps<
    HTMLElementTagNameMap["select"],
    SelectAttributes & Aliases<SelectAttributes, { autoComplete: "autocomplete" }>
  >;
  /** The HTML `<slot>` element: a placeholder in a shadow tree, filled with light DOM content. */
  slot: ElementProps<HTMLElementTagNameMap["slot"], SlotAttributes>;
  /** The HTML `<small>` element: side comments and small print. */
  small: ElementProps<HTMLElementTagNameMap["small"]>;
  /** The HTML `<source>` element: a media source for picture, audio or video. */
  source: VoidElementProps<
    HTMLElementTagNameMap["source"],
    SourceAttributes & Aliases<SourceAttributes, { srcSet: "srcset" }>
  >;
  /** The HTML `<span>` element: a generic inline container. */
  span: ElementProps<HTMLElementTagNameMap["span"]>;
  /** The HTML `<strong>` element: text of strong importance. */
  strong: ElementProps<HTMLElementTagNameMap["strong"]>;
  /** The HTML `<style>` element: an embedded stylesheet. */
  style: TextElementProps<HTMLElementTagNameMap["style"], StyleElementAttributes>;
  /** The HTML `<sub>` element: subscript text. */
  sub: ElementProps<HTMLElementTagNameMap["sub"]>;
  /** The HTML `<summary>` element: the visible summary of a details element. */
  summary: ElementProps<HTMLElementTagNameMap["summary"]>;
  /** The HTML `<sup>` element: superscript text. */
  sup: ElementProps<HTMLElementTagNameMap["sup"]>;
  /** The HTML `<table>` element: a table of data. */
  table: ElementProps<HTMLElementTagNameMap["table"], TableAttributes>;
  /** The HTML `<tbody>` element: the body rows of a table. */
  tbody: ElementProps<HTMLElementTagNameMap["tbody"]>;
  /** The HTML `<td>` element: a data cell of a table. */
  td: ElementProps<
    HTMLElementTagNameMap["td"],
    TableCellAttributes & Aliases<TableCellAttributes, { colSpan: "colspan"; rowSpan: "rowspan" }>
  >;
  /** The HTML `<template>` element: inert content cloned by scripts. */
  template: ElementProps<HTMLElementTagNameMap["template"], TemplateAttributes>;
  /** The HTML `<textarea>` element: a multi-line text control. */
  textarea: TextElementProps<
    HTMLElementTagNameMap["textarea"],
    TextAreaAttributes &
      Aliases<
        TextAreaAttributes,
        {
          autoComplete: "autocomplete";
          maxLength: "maxlength";
          minLength: "minlength";
          readOnly: "readonly";
        }
      >
  >;
  /** The HTML `<tfoot>` element: the footer rows of a table. */
  tfoot: ElementProps<HTMLElementTagNameMap["tfoot"]>;
  /** The HTML `<th>` element: a header cell of a table. */
  th: ElementProps<
    HTMLElementTagNameMap["th"],
    TableHeaderAttributes &
      Aliases<TableHeaderAttributes, { colSpan: "colspan"; rowSpan: "rowspan" }>
  >;
  /** The HTML `<thead>` element: the header rows of a table. */
  thead: ElementProps<HTMLElementTagNameMap["thead"]>;
  /** The HTML `<time>` element: a date or time, with a machine-readable value. */
  time: ElementProps<
    HTMLElementTagNameMap["time"],
    TimeAttributes & Aliases<TimeAttributes, { dateTime: "datetime" }>
  >;
  /** The HTML `<title>` element: the document's title. */
  title: ElementProps<HTMLElementTagNameMap["title"]>;
  /** The HTML `<tr>` element: a row of a table. */
  tr: ElementProps<HTMLElementTagNameMap["tr"]>;
  /** The HTML `<track>` element: a timed text track, such as subtitles, for audio or video. */
  track: VoidElementProps<
    HTMLElementTagNameMap["track"],
    TrackAttributes & Aliases<TrackAttributes, { srcLang: "srclang" }>
  >;
  /** The HTML `<u>` element: text with an unarticulated annotation, such as a misspelling. */
  u: ElementProps<HTMLElementTagNameMap["u"]>;
  /** The HTML `<ul>` element: an unordered list. */
  ul: ElementProps<HTMLElementTagNameMap["ul"]>;
  /** The HTML `<var>` element: a variable in a mathematical or programming context. */
  var: ElementProps<HTMLElementTagNameMap["var"]>;
  /** The HTML `<video>` element: embedded video content. */
  video: VideoElementProps<
    HTMLElementTagNameMap["video"],
    VideoAttributes &
      Aliases<
        VideoAttributes,
        { autoPlay: "autoplay"; crossOrigin: "crossorigin"; playsInline: "playsinline" }
      >
  >;
  /** The HTML `<wbr>` element: a line break opportunity. */
  wbr: VoidElementProps<HTMLElementTagNameMap["wbr"]>;
  // Deprecated elements the DOM library still lists. Their legacy attributes are typed where they
  // are common; everything else is available through the global attributes.
  /** The HTML `<acronym>` element: an acronym (deprecated: use abbr). */
  acronym: ElementProps<HTMLElementDeprecatedTagNameMap["acronym"]>;
  /** The HTML `<applet>` element: an embedded Java applet (deprecated: use object). */
  applet: ElementProps<HTMLElementDeprecatedTagNameMap["applet"]>;
  /** The HTML `<basefont>` element: a default font (deprecated: use CSS). */
  basefont: VoidElementProps<HTMLElementDeprecatedTagNameMap["basefont"], FontAttributes>;
  /** The HTML `<bgsound>` element: a background sound (deprecated: use audio). */
  bgsound: VoidElementProps<HTMLElementDeprecatedTagNameMap["bgsound"], BgSoundAttributes>;
  /** The HTML `<big>` element: text one size larger (deprecated: use CSS). */
  big: ElementProps<HTMLElementDeprecatedTagNameMap["big"]>;
  /** The HTML `<blink>` element: blinking text (deprecated, never standard). */
  blink: ElementProps<HTMLElementDeprecatedTagNameMap["blink"]>;
  /** The HTML `<center>` element: centered content (deprecated: use CSS). */
  center: ElementProps<HTMLElementDeprecatedTagNameMap["center"]>;
  /** The HTML `<dir>` element: a directory list (deprecated: use ul). */
  dir: ElementProps<HTMLElementDeprecatedTagNameMap["dir"], DirAttributes>;
  /** The HTML `<font>` element: text with a font, size and color (deprecated: use CSS). */
  font: ElementProps<HTMLElementDeprecatedTagNameMap["font"], FontAttributes>;
  /** The HTML `<frame>` element: one frame of a frameset (deprecated). */
  frame: VoidElementProps<HTMLElementDeprecatedTagNameMap["frame"], FrameAttributes>;
  /** The HTML `<frameset>` element: a set of frames (deprecated). */
  frameset: WindowElementProps<HTMLElementDeprecatedTagNameMap["frameset"], FrameSetAttributes>;
  /** The HTML `<isindex>` element: a single-line search prompt (deprecated: use a form). */
  isindex: VoidElementProps<HTMLElementDeprecatedTagNameMap["isindex"]>;
  /** The HTML `<keygen>` element: a key-pair generator control (deprecated). */
  keygen: VoidElementProps<HTMLElementDeprecatedTagNameMap["keygen"], KeygenAttributes>;
  /** The HTML `<listing>` element: preformatted text (deprecated: use pre). */
  listing: ElementProps<HTMLElementDeprecatedTagNameMap["listing"]>;
  /** The HTML `<marquee>` element: scrolling text (deprecated: use CSS animations). */
  marquee: ElementProps<HTMLElementDeprecatedTagNameMap["marquee"], MarqueeAttributes>;
  /** The HTML `<menuitem>` element: a command in a menu (deprecated). */
  menuitem: ElementProps<HTMLElementDeprecatedTagNameMap["menuitem"]>;
  /** The HTML `<multicol>` element: multi-column layout (deprecated: use CSS). */
  multicol: ElementProps<HTMLElementDeprecatedTagNameMap["multicol"]>;
  /** The HTML `<nextid>` element: an identifier hint for editors (deprecated). */
  nextid: VoidElementProps<HTMLElementDeprecatedTagNameMap["nextid"], { n?: Maybe<string> }>;
  /** The HTML `<nobr>` element: text that does not wrap (deprecated: use CSS white-space). */
  nobr: ElementProps<HTMLElementDeprecatedTagNameMap["nobr"]>;
  /** The HTML `<noembed>` element: fallback content for embed (deprecated). */
  noembed: ElementProps<HTMLElementDeprecatedTagNameMap["noembed"]>;
  /** The HTML `<noframes>` element: content for browsers without frames (deprecated). */
  noframes: ElementProps<HTMLElementDeprecatedTagNameMap["noframes"]>;
  /** The HTML `<param>` element: a parameter of an object (deprecated). */
  param: VoidElementProps<HTMLElementDeprecatedTagNameMap["param"], ParamAttributes>;
  /** The HTML `<plaintext>` element: text shown as plain text to the end of the document (deprecated: use pre). */
  plaintext: ElementProps<HTMLElementDeprecatedTagNameMap["plaintext"]>;
  /** The HTML `<rb>` element: the base text of a ruby annotation (deprecated). */
  rb: ElementProps<HTMLElementDeprecatedTagNameMap["rb"]>;
  /** The HTML `<rtc>` element: a container of ruby text (deprecated). */
  rtc: ElementProps<HTMLElementDeprecatedTagNameMap["rtc"]>;
  /** The HTML `<spacer>` element: blank space (deprecated: use CSS). */
  spacer: VoidElementProps<HTMLElementDeprecatedTagNameMap["spacer"]>;
  /** The HTML `<strike>` element: struck-through text (deprecated: use s or del). */
  strike: ElementProps<HTMLElementDeprecatedTagNameMap["strike"]>;
  /** The HTML `<tt>` element: teletype text (deprecated: use code or CSS). */
  tt: ElementProps<HTMLElementDeprecatedTagNameMap["tt"]>;
  /** The HTML `<xmp>` element: example markup shown as written (deprecated: use pre). */
  xmp: ElementProps<HTMLElementDeprecatedTagNameMap["xmp"]>;
}

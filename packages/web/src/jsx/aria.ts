/**
 * ARIA attributes and the `role` union, typed from the WAI-ARIA 1.2 vocabulary. Unknown `aria-*`
 * names are errors: there is no index signature for them.
 *
 * @since 1.0.0
 */
import type { Booleanish, Maybe } from "./types";

/**
 * Every ARIA role of WAI-ARIA 1.2 (plus `generic` and `search`, which later ARIA versions use).
 *
 * @since 1.0.0
 */
export type AriaRole =
  | "alert"
  | "alertdialog"
  | "application"
  | "article"
  | "banner"
  | "blockquote"
  | "button"
  | "caption"
  | "cell"
  | "checkbox"
  | "code"
  | "columnheader"
  | "combobox"
  | "comment"
  | "complementary"
  | "contentinfo"
  | "definition"
  | "deletion"
  | "dialog"
  | "directory"
  | "document"
  | "emphasis"
  | "feed"
  | "figure"
  | "form"
  | "generic"
  | "grid"
  | "gridcell"
  | "group"
  | "heading"
  | "img"
  | "insertion"
  | "link"
  | "list"
  | "listbox"
  | "listitem"
  | "log"
  | "main"
  | "marquee"
  | "math"
  | "meter"
  | "menu"
  | "menubar"
  | "menuitem"
  | "menuitemcheckbox"
  | "menuitemradio"
  | "navigation"
  | "none"
  | "note"
  | "option"
  | "paragraph"
  | "presentation"
  | "progressbar"
  | "radio"
  | "radiogroup"
  | "region"
  | "row"
  | "rowgroup"
  | "rowheader"
  | "scrollbar"
  | "search"
  | "searchbox"
  | "separator"
  | "slider"
  | "spinbutton"
  | "status"
  | "strong"
  | "subscript"
  | "superscript"
  | "switch"
  | "tab"
  | "table"
  | "tablist"
  | "tabpanel"
  | "term"
  | "textbox"
  | "time"
  | "timer"
  | "toolbar"
  | "tooltip"
  | "tree"
  | "treegrid"
  | "treeitem";

/** The ARIA attributes. Every value accepts `null`/`undefined` (removes the attribute).
 * @since 1.0.0
 */
export interface AriaAttributes {
  "aria-activedescendant"?: Maybe<string>;
  "aria-atomic"?: Maybe<Booleanish>;
  "aria-autocomplete"?: Maybe<"none" | "inline" | "list" | "both">;
  "aria-braillelabel"?: Maybe<string>;
  "aria-brailleroledescription"?: Maybe<string>;
  "aria-busy"?: Maybe<Booleanish>;
  "aria-checked"?: Maybe<boolean | "false" | "mixed" | "true">;
  "aria-colcount"?: Maybe<number | string>;
  "aria-colindex"?: Maybe<number | string>;
  "aria-colspan"?: Maybe<number | string>;
  "aria-controls"?: Maybe<string>;
  "aria-current"?: Maybe<
    boolean | "false" | "true" | "page" | "step" | "location" | "date" | "time"
  >;
  "aria-describedby"?: Maybe<string>;
  "aria-description"?: Maybe<string>;
  "aria-details"?: Maybe<string>;
  "aria-disabled"?: Maybe<Booleanish>;
  "aria-dropeffect"?: Maybe<"none" | "copy" | "execute" | "link" | "move" | "popup">;
  "aria-errormessage"?: Maybe<string>;
  "aria-expanded"?: Maybe<Booleanish>;
  "aria-flowto"?: Maybe<string>;
  "aria-grabbed"?: Maybe<Booleanish>;
  "aria-haspopup"?: Maybe<
    boolean | "false" | "true" | "menu" | "listbox" | "tree" | "grid" | "dialog"
  >;
  "aria-hidden"?: Maybe<Booleanish>;
  "aria-invalid"?: Maybe<boolean | "false" | "true" | "grammar" | "spelling">;
  "aria-keyshortcuts"?: Maybe<string>;
  "aria-label"?: Maybe<string>;
  "aria-labelledby"?: Maybe<string>;
  "aria-level"?: Maybe<number | string>;
  "aria-live"?: Maybe<"off" | "assertive" | "polite">;
  "aria-modal"?: Maybe<Booleanish>;
  "aria-multiline"?: Maybe<Booleanish>;
  "aria-multiselectable"?: Maybe<Booleanish>;
  "aria-orientation"?: Maybe<"horizontal" | "vertical">;
  "aria-owns"?: Maybe<string>;
  "aria-placeholder"?: Maybe<string>;
  "aria-posinset"?: Maybe<number | string>;
  "aria-pressed"?: Maybe<boolean | "false" | "mixed" | "true">;
  "aria-readonly"?: Maybe<Booleanish>;
  "aria-relevant"?: Maybe<string>;
  "aria-required"?: Maybe<Booleanish>;
  "aria-roledescription"?: Maybe<string>;
  "aria-rowcount"?: Maybe<number | string>;
  "aria-rowindex"?: Maybe<number | string>;
  "aria-rowspan"?: Maybe<number | string>;
  "aria-selected"?: Maybe<Booleanish>;
  "aria-setsize"?: Maybe<number | string>;
  "aria-sort"?: Maybe<"none" | "ascending" | "descending" | "other">;
  "aria-valuemax"?: Maybe<number | string>;
  "aria-valuemin"?: Maybe<number | string>;
  "aria-valuenow"?: Maybe<number | string>;
  "aria-valuetext"?: Maybe<string>;
  /**
   * The element's ARIA role, which overrides its implicit role for assistive technology: one of the
   * roles of {@link AriaRole}.
   * @default undefined (the element keeps its implicit role)
   */
  role?: Maybe<AriaRole>;
}

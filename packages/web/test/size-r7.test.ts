import { describe, expect, it } from "vitest";
import { cssValueText } from "../src/internal/css-units";
import { IGNORED_KEYS, isFlagAttribute } from "../src/internal/react-names";

/** React's unitless properties, one by one: the pattern in css-units must accept exactly these. */
const UNITLESS = [
  "animation-iteration-count",
  "aspect-ratio",
  "border-image-outset",
  "border-image-slice",
  "border-image-width",
  "box-flex",
  "box-flex-group",
  "box-ordinal-group",
  "column-count",
  "columns",
  "flex",
  "flex-grow",
  "flex-positive",
  "flex-shrink",
  "flex-negative",
  "flex-order",
  "grid-area",
  "grid-row",
  "grid-row-end",
  "grid-row-span",
  "grid-row-start",
  "grid-column",
  "grid-column-end",
  "grid-column-span",
  "grid-column-start",
  "font-weight",
  "line-clamp",
  "line-height",
  "opacity",
  "order",
  "orphans",
  "scale",
  "tab-size",
  "widows",
  "z-index",
  "zoom",
  "fill-opacity",
  "flood-opacity",
  "stop-opacity",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-miterlimit",
  "stroke-opacity",
  "stroke-width",
];

describe("the unitless style properties", () => {
  it("[WEB-SZ-4] each listed property takes a bare number, with or without a vendor prefix", () => {
    for (const name of UNITLESS) {
      expect(cssValueText(name, 3), name).toBe("3");
      expect(cssValueText(`-webkit-${name}`, 3), name).toBe("3");
    }
  });

  it("[WEB-SZ-4] near misses get px, and zero and custom properties are never changed", () => {
    for (const name of [
      "width",
      "flex-basis",
      "grid",
      "grid-row-x",
      "grid-column-gap",
      "border-image",
      "box",
      "box-flex-x",
      "line",
      "stroke",
      "fill",
      "opacity-x",
      "x-opacity",
      "column",
      "font-size",
      "orders",
    ]) {
      expect(cssValueText(name, 3), name).toBe("3px");
    }
    expect(cssValueText("width", 0)).toBe("0");
    expect(cssValueText("--gap", 3)).toBe("3");
  });
});

/** The boolean attributes the server and the client write as presence flags. */
const FLAGS = [
  "async",
  "autofocus",
  "autoplay",
  "checked",
  "controls",
  "default",
  "defer",
  "disabled",
  "formnovalidate",
  "hidden",
  "inert",
  "ismap",
  "loop",
  "multiple",
  "muted",
  "nomodule",
  "novalidate",
  "open",
  "playsinline",
  "readonly",
  "required",
  "reversed",
  "selected",
];

describe("the shared attribute tables", () => {
  it("[WEB-SZ-5] exactly the listed names are flags, and hidden keeps until-found", () => {
    for (const name of FLAGS) {
      expect(isFlagAttribute(name, true), name).toBe(true);
      expect(isFlagAttribute(`${name}x`, true), name).toBe(false);
      expect(isFlagAttribute(`x${name}`, true), name).toBe(false);
    }
    expect(isFlagAttribute("hidden", "until-found")).toBe(false);
    expect(isFlagAttribute("disabled", "until-found")).toBe(true);
    for (const name of ["", "title", "draggable", "contenteditable", "Disabled", "readOnly"]) {
      expect(isFlagAttribute(name, true), name).toBe(false);
    }
  });

  it("[WEB-SZ-5] the ignored keys are key and the two suppress warnings, nothing else", () => {
    for (const name of ["key", "suppressHydrationWarning", "suppressContentEditableWarning"]) {
      expect(IGNORED_KEYS.test(name), name).toBe(true);
    }
    for (const name of ["", "keys", "Key", "suppress", "suppressWarning", "xkey", "ref"]) {
      expect(IGNORED_KEYS.test(name), name).toBe(false);
    }
  });
});

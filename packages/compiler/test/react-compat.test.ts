import { describe, expect, it } from "vitest";
import { compile } from "../src/javascript";

/** DOM output for one expression exported as `A` from a component that reads `p`. */
const dom = (jsx: string): string =>
  compile(`export const A = (p) => ${jsx};`, { filename: "a.tsx", generate: "dom" }).code;

/** SSR output for the same shape. */
const ssr = (jsx: string): string =>
  compile(`export const A = (p) => ${jsx};`, { filename: "a.tsx", generate: "ssr" }).code;

const XLINK = "http://www.w3.org/1999/xlink";

describe("React SVG presentation attributes (camelCase to the real attribute)", () => {
  it("[RC-SVG-01] a static camelCase presentation attribute is written hyphenated in the template", () => {
    const code = dom(
      '<svg><path strokeWidth="2" strokeLinecap="round" fillRule="evenodd" /></svg>',
    );
    expect(code).toContain('stroke-width=\\"2\\"');
    expect(code).toContain('stroke-linecap=\\"round\\"');
    expect(code).toContain('fill-rule=\\"evenodd\\"');
    expect(code).not.toMatch(/strokeWidth|strokeLinecap|fillRule/);
  });

  it("[RC-SVG-02] a dynamic presentation attribute is set under its hyphenated name", () => {
    const code = dom("<svg><stop stopColor={p.c} stopOpacity={p.o} /></svg>");
    expect(code).toMatch(/setAttribute\(_el\$\d*, "stop-color", p\.c\)/);
    expect(code).toMatch(/setAttribute\(_el\$\d*, "stop-opacity", p\.o\)/);
  });

  it("[RC-SVG-03] names that stay camelCase in SVG are untouched", () => {
    const code = dom(
      '<svg viewBox="0 0 1 1" preserveAspectRatio="none"><linearGradient gradientUnits="userSpaceOnUse" gradientTransform="rotate(1)"><stop offset="0" /></linearGradient></svg>',
    );
    expect(code).toContain('viewBox=\\"0 0 1 1\\"');
    expect(code).toContain('preserveAspectRatio=\\"none\\"');
    expect(code).toContain('gradientUnits=\\"userSpaceOnUse\\"');
    expect(code).toContain('gradientTransform=\\"rotate(1)\\"');
  });

  it("[RC-SVG-04] xlinkHref becomes the namespaced xlink:href (dynamic) and the same name in markup", () => {
    const dyn = dom("<svg><use xlinkHref={p.id} /></svg>");
    expect(dyn).toMatch(
      new RegExp(`setAttributeNS\\(_el\\$\\d*, "${XLINK}", "xlink:href", p\\.id\\)`),
    );
    const stat = dom('<svg><use xlinkHref="#a" /></svg>');
    expect(stat).toContain('xlink:href=\\"#a\\"');
    expect(ssr("<svg><use xlinkHref={p.id} /></svg>")).toContain(
      '_$ssrAttribute("xlink:href", p.id)',
    );
  });

  it("[RC-SVG-05] SSR writes the hyphenated presentation names (static and dynamic)", () => {
    const code = ssr('<svg><path strokeWidth="2" fillOpacity={p.f} /></svg>');
    expect(code).toContain('stroke-width=\\"2\\"');
    expect(code).toContain('_$ssrAttribute("fill-opacity", p.f)');
    expect(code).not.toMatch(/strokeWidth|fillOpacity/);
  });

  it("[RC-SVG-06] xmlLang becomes xml:lang", () => {
    expect(dom('<svg><text xmlLang="fr">a</text></svg>')).toContain('xml:lang=\\"fr\\"');
  });
});

describe("React HTML attribute names (lower-case canonical name in every target)", () => {
  it("[RC-HTML-01] colSpan, rowSpan and cellPadding are written lower-case", () => {
    const code = dom(
      '<table><tbody><tr><td colSpan={p.n} rowSpan="2" cellPadding="3" /></tr></tbody></table>',
    );
    expect(code).toMatch(/setAttribute\(_el\$\d*, "colspan", p\.n\)/);
    expect(code).toContain('rowspan=\\"2\\"');
    expect(code).toContain('cellpadding=\\"3\\"');
  });

  it("[RC-HTML-02] SSR writes the same lower-case names", () => {
    const code = ssr('<table><tbody><tr><td colSpan={p.n} cellPadding="3" /></tr></tbody></table>');
    expect(code).toContain('_$ssrAttribute("colspan", p.n)');
    expect(code).toContain('cellpadding=\\"3\\"');
  });

  it("[RC-HTML-03] httpEquiv and acceptCharset use their hyphenated HTML names", () => {
    const code = ssr('<div><meta httpEquiv="x" /><form acceptCharset="utf-8" /></div>');
    expect(code).toContain('http-equiv=\\"x\\"');
    expect(code).toContain('accept-charset=\\"utf-8\\"');
  });
});

describe("React event names", () => {
  it("[RC-EVT-01] onChange on a text input is the input event (per keystroke)", () => {
    const code = dom('<input type="text" onChange={p.h} />');
    expect(code).toContain("$$input = p.h");
    expect(code).not.toContain('"change"');
  });

  it("[RC-EVT-02] onChange on an input without a type is the input event", () => {
    expect(dom("<input onChange={p.h} />")).toContain("$$input = p.h");
  });

  it("[RC-EVT-03] onChange on checkbox, radio and file inputs and on select is the native change event", () => {
    for (const jsx of [
      '<input type="checkbox" onChange={p.h} />',
      '<input type="radio" onChange={p.h} />',
      '<input type="file" onChange={p.h} />',
      "<select onChange={p.h}><option>a</option></select>",
    ]) {
      const code = dom(jsx);
      expect(code, jsx).toMatch(/addEventListener\(_el\$\d*, "change", p\.h\)/);
    }
  });

  it("[RC-EVT-04] onChange on a textarea is the input event", () => {
    expect(dom("<textarea onChange={p.h} />")).toContain("$$input = p.h");
  });

  it("[RC-EVT-05] onChange on an input whose type is dynamic is the input event (both kinds fire it)", () => {
    expect(dom("<input type={p.t} onChange={p.h} />")).toContain("$$input = p.h");
  });

  it("[RC-EVT-06] lower-case onchange stays the native change event", () => {
    const code = dom('<input type="text" onchange={p.h} />');
    expect(code).toMatch(/addEventListener\(_el\$\d*, "change", p\.h\)/);
  });

  it("[RC-EVT-07] onFocus and onBlur have React's bubbling semantics (focusin and focusout)", () => {
    const code = dom("<div onFocus={p.f} onBlur={p.b} />");
    expect(code).toContain("$$focusin = p.f");
    expect(code).toContain("$$focusout = p.b");
    expect(code).not.toMatch(/"focus"|"blur"/);
  });

  it("[RC-EVT-08] lower-case onfocus stays the native focus event", () => {
    expect(dom("<div onfocus={p.f} />")).toMatch(/addEventListener\(_el\$\d*, "focus", p\.f\)/);
  });

  it("[RC-EVT-09] capture variants bind in the capture phase, never delegated", () => {
    const code = dom("<div onClickCapture={p.c} onFocusCapture={p.f} />");
    expect(code).toMatch(/addEventListener\(_el\$\d*, "click", p\.c, false, true\)/);
    expect(code).toMatch(/addEventListener\(_el\$\d*, "focusin", p\.f, false, true\)/);
    expect(code).not.toContain("clickcapture");
  });

  it("[RC-EVT-10] onDoubleClick is the dblclick event, delegated", () => {
    expect(dom("<button onDoubleClick={p.h} />")).toContain("$$dblclick = p.h");
  });

  it("[RC-EVT-11] onWheel is bound passive, as React binds it", () => {
    const code = dom("<div onWheel={p.w} />");
    expect(code).toMatch(/addEventListener\(_el\$\d*, "wheel", \{/);
    expect(code).toContain("passive: true");
  });

  it("[RC-EVT-12] event attributes write nothing on the server", () => {
    const code = ssr("<input onChange={p.h} onFocusCapture={p.f} onWheel={p.w} />");
    expect(code).not.toMatch(/onChange|onFocus|onWheel|passive/);
  });
});

describe("React props that have no DOM form", () => {
  it("[RC-PROP-01] key on an element is ignored, not written as an attribute", () => {
    expect(dom("<li key={p.id}>x</li>")).not.toContain('"key"');
    expect(ssr("<li key={p.id}>x</li>")).not.toContain("key");
  });

  it("[RC-PROP-02] key on a component is passed as its key prop (For and Style read it)", () => {
    expect(dom("<Row key={p.id} />")).toContain("get key()");
    expect(dom("<For each={p.items} key={(item) => item.id}>{(item) => item}</For>")).toContain(
      "key:",
    );
  });

  it("[RC-PROP-03] suppressHydrationWarning and suppressContentEditableWarning are no-ops", () => {
    const code = dom("<div suppressHydrationWarning suppressContentEditableWarning />");
    expect(code).not.toContain("suppress");
    expect(ssr("<div suppressHydrationWarning />")).not.toContain("suppress");
  });

  it("[RC-PROP-04] dangerouslySetInnerHTML={{ __html }} writes innerHTML as a property", () => {
    expect(dom("<div dangerouslySetInnerHTML={{ __html: p.h }} />")).toContain(
      "_el$.innerHTML = p.h",
    );
    expect(dom('<div dangerouslySetInnerHTML={{ __html: "<b>x</b>" }} />')).toContain(
      'innerHTML = "<b>x</b>"',
    );
    expect(dom("<div dangerouslySetInnerHTML={p.box} />")).toContain("(p.box)?.__html");
    expect(dom("<div dangerouslySetInnerHTML={{ __html: p.h }} />")).not.toContain(
      "dangerouslySetInnerHTML",
    );
  });

  it("[RC-PROP-05] SSR writes dangerouslySetInnerHTML as raw markup", () => {
    expect(ssr("<div dangerouslySetInnerHTML={{ __html: p.h }} />")).toContain("_$ssrRaw(p.h)");
  });

  it("[RC-PROP-06] a select's defaultValue selects the matching option", () => {
    expect(dom("<select defaultValue={p.v}><option>a</option></select>")).toContain(
      "setSelectValue(_el$, p.v)",
    );
  });
});

describe("React ref forms", () => {
  it("[RC-REF-01] a const ref object is filled through refTo, not dropped", () => {
    const code = compile("const r = { current: null }; export const A = () => <div ref={r} />;", {
      filename: "a.tsx",
      generate: "dom",
    }).code;
    expect(code).toContain("refTo(r, _el$)");
  });

  it("[RC-REF-02] a let ref is assigned the element, or filled when it is a ref object", () => {
    const code = compile("export function A(p) { let el; return <div ref={el} />; }", {
      filename: "a.tsx",
      generate: "dom",
    }).code;
    expect(code).toContain("refTo(el, _el$)");
    expect(code).toContain("el = _el$");
  });
});

describe("the compiler and the runtime agree on React names", () => {
  it("[RC-PARITY-01] the SVG presentation list and the event plans are the same in both packages", async () => {
    const runtime = await import("../../web/src/internal/react-names");
    const compiler = await import("../src/internal/react-names");
    // The runtime derives the hyphenated names by rule; each compiler entry must come out of that rule.
    const camelOf = (kebab: string): string =>
      kebab.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    for (const kebab of compiler.SVG_HYPHENATED) {
      expect(runtime.attributeName(camelOf(kebab), true), kebab).toBe(kebab);
    }
    const names = [
      "onChange",
      "onChangeCapture",
      "onFocus",
      "onBlur",
      "onDoubleClick",
      "onWheel",
      "onClick",
      "onMouseEnter",
      "onchange",
      "onfocus",
    ];
    const tags: Array<[string, string | null]> = [
      ["input", null],
      ["input", "checkbox"],
      ["textarea", null],
      ["select", null],
      ["div", null],
    ];
    for (const name of names) {
      for (const [tag, type] of tags) {
        expect(compiler.eventPlan(name, tag, type)).toEqual(runtime.eventPlan(name, tag, type));
      }
    }
  });

  it("[RC-PARITY-02] the attribute names agree for every spelling in both tables", async () => {
    const runtime = await import("../../web/src/internal/react-names");
    const compiler = await import("../src/internal/react-names");
    const spellings = [
      "className",
      "htmlFor",
      "httpEquiv",
      "acceptCharset",
      "colSpan",
      "tabIndex",
      "strokeWidth",
      "fillRule",
      "xlinkHref",
      "xmlLang",
      "viewBox",
      "gradientUnits",
      "data-fooBar",
    ];
    for (const name of spellings) {
      for (const svg of [true, false]) {
        expect(compiler.attributeName(name, svg), `${name} svg=${svg}`).toBe(
          runtime.attributeName(name, svg),
        );
      }
    }
  });

  it("[RC-PARITY-03] Object.prototype names are attribute names, never the prototype's members", async () => {
    const runtime = await import("../../web/src/internal/react-names");
    const compiler = await import("../src/internal/react-names");
    for (const name of ["constructor", "toString", "valueOf", "hasOwnProperty"]) {
      for (const svg of [true, false]) {
        expect(compiler.attributeName(name, svg), `${name} svg=${svg}`).toBe(
          runtime.attributeName(name, svg),
        );
        expect(typeof compiler.attributeName(name, svg), name).toBe("string");
      }
    }
  });
});

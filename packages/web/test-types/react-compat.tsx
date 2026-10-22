// biome-ignore-all lint/a11y: the fixtures check typing of React-spelled props; accessibility rules do not apply
/**
 * Type tests for React's spellings: each one compiles, and each `@ts-expect-error` must be a real error
 * (an unused directive fails the build). The canonical (lower-case or hyphenated) spelling is shown first
 * in the source; the React spelling is the one marked accepted-for-React-compatibility.
 *
 * @since 1.0.0
 */
import type { JSX } from "@shadow-js/web/jsx-runtime";
import { sink } from "./support";

// ---- CSS properties: every TypeScript version that ships the DOM lib (5.4-5.9 and 7.x) -------------
sink(<div style={{ width: "10px" }} />);
sink(<div style={{ "margin-top": 4, backgroundColor: "red", "--accent": "blue" }} />);
sink(
  <div style={{ WebkitTransition: "none", "-webkit-line-clamp": 2, zIndex: 1, opacity: 0.5 }} />,
);
sink(<div style="width: 1px" />);
// @ts-expect-error `widht` is not a CSS property
sink(<div style={{ widht: "10px" }} />);
// @ts-expect-error a custom property must start with `--`
sink(<div style={{ accent: "red" }} />);

// ---- SVG: hyphenated first, React's camelCase spelling accepted -----------------------------------
sink(<path stroke-width="2" stroke-linecap="round" />);
sink(<path strokeWidth={2} strokeLinecap="round" strokeLinejoin="miter" strokeDasharray="3 1" />);
sink(<path fillRule="evenodd" clipRule="nonzero" clipPath="url(#c)" fillOpacity={0.5} />);
sink(<stop stopColor="#fff" stopOpacity={1} offset="0" />);
sink(<text fontFamily="serif" fontSize={12} textAnchor="middle" dominantBaseline="middle" />);
sink(<use xlinkHref="#a" href="#b" />);
sink(
  <text xmlLang="fr" xmlSpace="preserve">
    t
  </text>,
);
sink(<linearGradient gradientUnits="userSpaceOnUse" gradientTransform="rotate(1)" />);
// @ts-expect-error `strokeWidht` is not an SVG attribute
sink(<path strokeWidht={2} />);

// ---- HTML camelCase spellings ----------------------------------------------------------------------
sink(<td colSpan={2} rowSpan={1} colspan={2} />);
sink(<table cellPadding="3" cellSpacing="0" cellpadding="3" />);
sink(<iframe frameBorder="0" marginWidth={0} marginHeight={0} scrolling="no" src="/x" />);
sink(<form acceptCharset="utf-8" encType="multipart/form-data" autoComplete="off" />);
sink(<input tabIndex={1} readOnly maxLength={8} minLength={1} autoFocus />);
sink(<div className="a" contentEditable="true" spellCheck={false} />);
sink(<div itemProp="name" itemScope itemType="https://schema.org/Person" itemID="x" itemRef="y" />);
sink(<label htmlFor="name">n</label>);

// ---- Events: React spellings with their React semantics ----------------------------------------------
sink(<input onChange={(event) => event.currentTarget.value} onInput={() => undefined} />);
sink(
  <select onChange={(event) => event.currentTarget.value}>
    <option>a</option>
  </select>,
);
sink(<div onFocus={() => undefined} onBlur={() => undefined} onFocusCapture={() => undefined} />);
sink(
  <button
    onClick={() => undefined}
    onClickCapture={() => undefined}
    onDoubleClick={() => undefined}
  />,
);
sink(
  <div
    onWheel={(event) => event.deltaY}
    onMouseEnter={() => undefined}
    onMouseLeave={() => undefined}
  />,
);
sink(<input onCompositionStart={() => undefined} onBeforeInput={() => undefined} />);
sink(
  <div
    onTouchStart={() => undefined}
    onPointerDown={() => undefined}
    onAnimationEnd={() => undefined}
  />,
);
sink(<div onScroll={() => undefined} onSubmit={() => undefined} />);

// ---- Props with no DOM form (accepted, ignored) ------------------------------------------------------
sink(
  <li key="a" suppressHydrationWarning>
    x
  </li>,
);
sink(
  <div
    suppressContentEditableWarning
    contentEditable
    dangerouslySetInnerHTML={{ __html: "<b>x</b>" }}
  />,
);
// @ts-expect-error `dangerouslySetInnerHTML` takes an object with __html
sink(<div dangerouslySetInnerHTML="<b>x</b>" />);
sink(
  <select defaultValue="b">
    <option value="b">b</option>
  </select>,
);
sink(<input defaultValue="x" defaultChecked />);
sink(<textarea defaultValue="x" />);

// ---- Refs: a variable, a callback, or a { current } object ------------------------------------------
let input: HTMLInputElement | undefined;
sink(<input ref={input} />);
sink(<input ref={(element) => element.focus()} />);
const box = { current: null as HTMLDivElement | null };
sink(<div ref={box} />);
// @ts-expect-error a ref object must have `current`
sink(<div ref={{ value: null }} />);

// ---- Components accept key ----------------------------------------------------------------------------
declare function Row(props: { id: string }): JSX.Element;
sink(<Row key="r" id="a" />);

type Unused = JSX.IntrinsicElements["div"];

export type { Unused };

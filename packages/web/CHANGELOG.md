# Changelog

## 1.0.3

### Fixed

- `ViewTransition` applies its name and class again when its content changes (a `Show` that opens, a fallback replaced by content), not only when `name` or `class` change.
- `insert` reads the children of a `DocumentFragment` once, so an array or accessor that holds the same fragment keeps its nodes when it runs again.
- `className`, `classList` and `style` call accessors (as array items, object values, style values and nested accessors) like the server does, so `["a", () => "b"]` is `a b` on both sides.
- `Portal` builds its children once and moves the same nodes and effects when a reactive `mount` changes, so an input keeps its text and a component is not disposed and rebuilt (`moveRegion` is added to `@shadow-js/web/extend`).
- `ssrElement` writes the extra line break after `<pre>` and `<listing>` (as it already did for `<textarea>`) when the content starts with one, so the parser does not drop it.
- Boolean attributes written from a props object (`spread`, `element`) follow the rule the server uses: `disabled: 0`, `hidden: ""` or `required: NaN` write no attribute, so hydration no longer gives a disabled button the server did not render (`hidden="until-found"` stays a keyword).
- A `<select>` driven by `spread` keeps its `value` when its `children` options change: the value is applied again after each commit of the options, as the compiled path does.
- `<Dynamic component="select" value={...}>` selects its value once its options exist and again whenever new options replace the old ones; it used to show the first option.
- Client bundles that use `Portal` no longer carry the server markup writer, and props spreads and `Dynamic` are smaller.

## 1.0.2

### Fixed

- Dynamic children of `<style>` and `<script>` are written as text on the server, not entity-escaped (`a > b` stays `a > b`), and a closing tag of the element in the text (`</style`, `</script`, and `<!--` in a script) is made harmless as `<\/style`. `<style>`, `<script>`, `<title>` and `<textarea>` get no `<!--[-->` markers inside them, from compiled code, `element()` and `Dynamic` alike, and hydration adopts their text. `@shadow-js/web/server` exports `ssrRawText` for the compiled output.
- `classList` switches on class names that `Object.prototype` also has (`constructor`, `toString`), which were skipped before.
- `element()` calls its `ref` untracked, so a signal read in the ref no longer re-runs the code that created the element.
- A delegated `[handler, undefined]` tuple receives `(undefined, event)`, as the native binding does.
- A `Portal` whose mount is missing while the page hydrates removes the server block it adopted instead of leaving it in the body.
- `setAttribute`, `setAttributeNS` and `spread` no longer write `on*` attributes from strings (a spread of untrusted keys could add `onclick="..."`); the server already dropped them.
- Server `hidden="until-found"` is written as the keyword instead of a bare `hidden`.
- A `<textarea>` given its text as children keeps a leading line break on the server.
- `timeoutMs` of `renderToStream` and `renderToStringAsync` is clamped to the timer range, so `Number.MAX_SAFE_INTEGER` no longer expires after one millisecond.
- `preinit` and `preinitModule` skip a script with the same `src` and `type` that is already anywhere in the document, not only in the head with the same attributes.
- The early event capture script keeps at most 100 events.
- `Dynamic` creates every SVG-only tag the compiler knows (`image`, `foreignObject`, `animate*`, the `fe*` filter primitives, `clipPath`, `mask`, `pattern`, `marker`, `symbol`, `use`, `textPath`, `tspan`, the gradients, `stop`, `filter`, `desc`, `metadata`, `view`, `switch`, ...) in the SVG namespace, in any letter case.
- The client `style()` accepts an array of strings and objects, written in order with a later declaration winning, as `ssrStyle` does; the `style` JSX prop type accepts it too.
- Replaying a click captured before hydration runs the page's handlers without the browser's default action, so a link is no longer followed a second time.
- Several `insert()` regions without an anchor on one parent keep the order of the calls: a reactive region created right where the previous one ends gives that one an empty Text node as its anchor (removed when that region is disposed), so a sibling that replaces its nodes no longer sends the content of an empty region after it to the end of the parent.
- `Dynamic` creates MathML names (`math`, `mi`, `mfrac`, `semantics`, `annotation-xml`, ...) in the MathML namespace, and any SVG-only name in the SVG namespace exactly as the caller wrote it: it no longer derives the canonical case of a name written in the wrong case (`clippath` makes an element named `clippath`, not a `clipPath`). The namespace comes from a name pattern that answers the same in every DOM and parses no HTML. Development builds warn once per name with the new code `DYNAMIC_SVG_CASE`, which names the canonical spelling; `warnOnce` takes an optional `key` for a warning that is once per key instead of once per code.
- `srcdoc` is no longer treated as a URL: it is an HTML document, an HTML sink with the trust of `innerHTML`, written as it is (client and server) with no scheme check. Development builds warn once with the new code `SRCDOC_DYNAMIC` (see the `sandbox` attribute) when a computed value is written to it.
- Hydrating a `Dynamic` `title` or `style` inside an `<svg>` adopts the server text instead of adding it a second time (`<title>HiHi</title>`): the server writes such a tag without region markers because `Dynamic` does not know its parent, so `takeRegion` adopts the content of a `title`, `style`, `script` or `textarea` in whichever namespace the page parsed it. `Dynamic` also creates the SVG 2 `discard` element in the SVG namespace.

## 1.0.1

### Changed

- Released at 1.0.1 with the other packages, which share one version. No change to this package.

## 1.0.0

### Added

- DOM rendering, event bindings, reactive properties and composable control-flow components.
- Server rendering, streaming, hydration, serialization and document head management.
- Hydration preserves spread child nodes and static NoHydration regions.
- Fresh client roots mounted during hydration preserve the enclosing root's server nodes and key sequence.
- Streaming SSR releases abort listeners and timers, prevents rendering after cancellation, respects pre-aborted signals and keeps callbacks untracked.
- Held shells stop at exactly ten passes; every pass is disposed even when another pass's cleanup throws.

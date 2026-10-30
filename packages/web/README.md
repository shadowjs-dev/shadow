# @shadow-js/web

The DOM renderer of ShadowJS: it mounts components, keeps text, attributes and child lists in sync
with signals, and provides control flow (`<Show>`, `<For>`, `<Suspense>` and more), document head
tags, server rendering and hydration. There is no virtual DOM: the compiler turns JSX into real DOM
operations (see [`@shadow-js/compiler`](../compiler/README.md)) and this package supplies the
runtime those operations call. The live DOM contains no comment nodes and no placeholder elements.

## Install

```sh
npm install @shadow-js/core @shadow-js/web
npm install -D @shadow-js/vite
```

`@shadow-js/core` is a peer dependency. JSX needs the compiler, which the Vite plugin runs for
you. In `tsconfig.json`, point JSX at this package:

```json
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "@shadow-js/web"
  }
}
```

To try a change that is not released yet, install from a local checkout of this repository.

## Example

A component is a function that runs once. `count()` inside JSX is a binding: when the signal
changes, only that text node is updated. `render` mounts a component into a container, flushes, and
returns a function that removes the output and disposes everything the component created.

```tsx title="counter.tsx" run mount="Counter" text="Count: 0"
import { useStore } from "@shadow-js/core";

export function Counter() {
  const [count, setCount] = useStore(0);

  return (
    <button type="button" onClick={() => setCount((n) => n + 1)}>
      Count: {count()}
    </button>
  );
}
```

Test it with [`@shadow-js/testing`](https://testing.shadowjs.net). `fireEvent` dispatches the click and
flushes, so the assertion sees the updated text.

```tsx title="counter.test.tsx" test
import { fireEvent, render } from "@shadow-js/testing/dom";
import { describe, expect, it } from "vitest";
import { Counter } from "./counter";

describe("Counter", () => {
  it("updates only its text when clicked", () => {
    const view = render(() => <Counter />);
    const button = view.getByRole("button");
    const text = button.lastChild;

    expect(button.textContent).toBe("Count: 0");
    fireEvent.click(button);

    expect(button.textContent).toBe("Count: 1");
    expect(button.lastChild).toBe(text);
  });
});
```

### Server rendering and hydration

`@shadow-js/web/server` renders the same component to a string. The compiler emits a server variant
of your JSX (`generate: "ssr"`, which the Vite plugin selects for SSR builds). Hydration keys
(`data-hk`) and `<!--[-->` region markers in the string let the browser claim the existing nodes
instead of rebuilding them; the markers are removed during hydration.

```tsx title="server.tsx" run target="ssr" output='<button data-hk="0-0-0" type="button">Count: <!--[-->0<!--]--></button>'
import { renderToString } from "@shadow-js/web/server";
import { Counter } from "./counter";

console.log(renderToString(() => <Counter />));
```

On the client, `hydrate` takes the same component call and the container that holds the server
markup. It returns a dispose function.

```tsx title="entry-client.tsx" typecheck
import { hydrate } from "@shadow-js/web";
import { Counter } from "./counter";

const container = document.getElementById("app");
if (container === null) throw new Error("Missing #app element");

hydrate(() => <Counter />, container);
```

Resources that loaded on the server are passed through `renderToStringAsync` (which returns
`{ html, data }`) and `hydrate(..., { data })`; `renderToStream` streams Suspense boundaries.
An already-aborted signal prevents the application from rendering. Completion, failure, timeout and
consumer cancellation release abort listeners, timers and render owners. Cancellation also stops a
held shell from rendering again when its data arrives. Shell callbacks and error reporters run
untracked. Held shells are limited to ten passes; invalid time budgets are refused synchronously.
If cleanup fails, every pass is still disposed before the error is surfaced; multiple cleanup
failures are combined in an `AggregateError`.

## API

Entry `@shadow-js/web`. The exports are:

### Mounting and hydration

| Export | Description |
| --- | --- |
| `render` | Mounts a component into a container, flushes, and returns a dispose function. |
| `hydrate` | Attaches the application to HTML the server rendered, claiming nodes by key. |

### Control flow

| Export | Description |
| --- | --- |
| `Show` | Shows `children` while `when` is truthy, `fallback` otherwise. |
| `Switch`, `Match` | Shows the first `Match` whose `when` is truthy, or the fallback. |
| `For` | One row per item, matched by reference or by `key`; rows keep their identity when the list moves. |
| `Index` | One row per position. |
| `Dynamic` | Renders a component or a tag chosen at runtime. |
| `Portal` | Renders children into another part of the document, without a wrapper. |
| `Suspense` | Shows `fallback` while resources read inside it load for the first time. |
| `ErrorBoundary` | Renders `children`; shows a fallback when they throw, with a `reset`. |
| `lazy` | A component whose code is loaded on first render. |
| `Fragment` | A no-op wrapper that returns its children. |

### Document head

| Export | Description |
| --- | --- |
| `Title`, `Meta`, `Link`, `Base`, `Style` | Components that register head tags for their lifetime. |
| `useHead` | Registers head tags for the lifetime of the current owner. |

### Compiler targets and custom renderers

| Export | Description |
| --- | --- |
| `template`, `insert`, `anchor` | Clone static DOM once, insert reactive children, create text anchors. |
| `spread`, `use` | Apply a props object reactively; run refs and directives untracked. |
| `setAttribute`, `setAttributeNS`, `setBoolAttribute`, `className`, `classList`, `style`, `setStyleProperty` | Attribute, class and style writers with URL and name safety. |
| `addEventListener`, `delegateEvents` | Bind handlers; delegate common events to the document. |
| `createComponent`, `effect`, `memo`, `derived`, `mergeProps` | Helpers the compiled code imports. |

`isDev`, `isServer` and `mergeProps` are re-exported from `@shadow-js/core`. The package also
exports the `JSX` namespace and the component types `Component`, `ParentComponent`, `VoidComponent`,
`FlowComponent`, `ParentProps`, `ComponentProps`, `Ref`, `ClassValue` and `CSSProperties`.

### Subpath entries

| Entry | Contents |
| --- | --- |
| `@shadow-js/web/server` | `renderToString`, `renderToStringAsync`, `renderToStream`, `serialize`, `deserialize`, and the helpers the compiler's server output calls (`ssr`, `escape`, `ssrAttribute`, `ssrClass`, `ssrStyle`, `ssrElement`, `ssrHydrationKey`, `ssrRaw`, `ssrSelectValue`, `ssrTextArea`). |
| `@shadow-js/web/jsx-runtime`, `@shadow-js/web/jsx-dev-runtime` | The `JSX` namespace for `jsxImportSource`; augment `CustomEvents` and `Directives` here. |
| `@shadow-js/web/extend` | The building blocks the built-ins use: `createRegion`, `bindRegion`, `reconcileNodes`, hydration scopes (`withScope`, `nextKey`, `claimElement`), `isUnsafeUrlAttribute`. |
| `@shadow-js/web/hmr` | The runtime of component-level hot updates, imported by code the compiler generates when its `hmr` option is on. Not called by application code. |

## Status

The DOM runtime, control flow, the server renderer and hydration are tested, including the
server-to-client round trip. `Dynamic`, `Portal`, head tags and the JSX types are exported; the
type tests are in `packages/web/test-types`.

## Links

- [`@shadow-js/core`](../core/README.md), [`@shadow-js/compiler`](../compiler/README.md), [`@shadow-js/vite`](../vite/README.md), [`@shadow-js/testing`](https://testing.shadowjs.net)

## Dependencies

- Runtime: none.
- Peers: `@shadow-js/core` `^1.0.3`: the reactive primitives the renderer is built on.

## Types

- Names from the root: `ComponentProps`, `Derived`, `derived`, `HydrateOptions`.
- Type tests in `test-types/` run with `npx tsc -p tsconfig.test-types.json`.

## Support

- Node.js `>=22.12.0`. ESM only: use `import`; `require` is not supported.
- Browsers: current evergreen releases.
- Versioning: every `@shadow-js/*` package releases together at one version. Upgrade them as one set.
- Documentation: [ShadowJS documentation](https://shadowjs.net).

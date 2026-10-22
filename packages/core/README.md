# @shadow-js/core

The reactive engine of ShadowJS: signals, a deep fine-grained store, memos, effects, owners,
context, resources and list primitives. It has no runtime dependencies, no virtual DOM and no DOM
access. The renderer lives in [`@shadow-js/web`](../web/README.md).

Reads inside an effect or a memo subscribe it to exactly the value or property that was read, and a
write notifies exactly those readers. Components are plain functions that run once; what changes
later is the effects and bindings inside them.

## Install

```sh
npm install @shadow-js/core
```

ShadowJS 1.0.0 is not on npm yet. Until it is published, install it from a local checkout of this
repository.
Requires Node 22.12 or newer for tooling; the package is ESM only.

## Example

`useStore` is the state hook. A single value gives a `[read, write]` pair; plain objects and
arrays give a deep store whose reads are tracked per property. `useMemo` caches a derivation and
`useEffect` runs a side effect after a flush. Effects need an owner, so this module creates one
with `createRoot`. Writes made outside an event handler flush in a microtask; `flushSync()` flushes
them at once.

```ts title="counter.ts" run output="count 0, doubled 0\ncount 1, doubled 2\ncount 5, doubled 10"
import { createRoot, flushSync, useEffect, useMemo, useStore } from "@shadow-js/core";

const [count, setCount] = useStore(0);

createRoot((dispose) => {
  const doubled = useMemo(() => count() * 2);

  useEffect(() => {
    console.log(`count ${count()}, doubled ${doubled()}`);
  });

  flushSync();
  setCount((n) => n + 1);
  flushSync();
  setCount(5);
  flushSync();
  dispose();
});
```

For nested data, a store notifies only the readers of what changed. `setStore` accepts a draft
function, a merge object, a path (`"todos", 1, "done", true`) or `reconcile(next)`. The effect
below reads one property of one item, so it does not run for the write to the other item.

```ts title="todos.ts" run output="first todo done: false\nfirst todo done: true"
import { createRoot, flushSync, useEffect, useStore } from "@shadow-js/core";

interface Todo {
  id: number;
  title: string;
  done: boolean;
}

const [todos, setTodos] = useStore<{ items: Todo[] }>({
  items: [
    { id: 1, title: "write docs", done: false },
    { id: 2, title: "ship", done: false },
  ],
});

createRoot((dispose) => {
  useEffect(() => {
    console.log(`first todo done: ${todos.items[0]?.done}`);
  });
  flushSync();

  setTodos("items", 1, "done", true); // the effect does not read item 1
  flushSync();

  setTodos((draft) => {
    const first = draft.items[0];
    if (first !== undefined) first.done = true;
  });
  flushSync();
  dispose();
});
```

The compiler also keeps `const double = count() * 2;` live inside components
(forgiving reactivity); that is a compile-time
feature of [`@shadow-js/compiler`](../compiler/README.md), not of this package.

## API

Entry `@shadow-js/core`. The exports are listed below by purpose.

### State

| Export | Description |
| --- | --- |
| `useStore` | The state hook: a cell for a single value, a deep fine-grained store for plain data. |
| `useSignal` | The low-level single-value primitive `useStore` is built on; for library authors and `equals` overrides. |
| `useMemo` | A cached derivation that recomputes only when a dependency changed. |
| `useSelector` | A selection set over a source: `isSelected(key)` subscribes only to that key's boolean. |
| `useOptimistic` | State that shows a reducer applied over the real value while actions are pending. |
| `useReducer` | A state cell whose writes go through a reducer: `dispatch(action)` stores `reducer(state, action)`. |
| `useAction` | A form-style action: `dispatch` runs it, tracks whether it is pending, and commits only the latest result. |
| `useExternalStore` | Reads a value that lives outside ShadowJS (a store, a browser API, an observable) as a reactive accessor. |
| `produce`, `reconcile` | Draft updater marker and a diffing update for `setStore`. |
| `snapshot`, `unwrap` | A deep plain copy of a store, and the raw data behind it. |

### Effects, batching and ownership

| Export | Description |
| --- | --- |
| `useEffect` | A side effect after rendering; `useEffect(fn)` or `useEffect(deps, fn, { defer })`. Never runs on the server. |
| `useRenderEffect` | Render-phase effect used for DOM bindings; runs synchronously when created. |
| `onMount`, `onCleanup`, `onError` | Lifecycle callbacks of the current owner. |
| `batch`, `flushSync` | Defer effects until the batch ends; flush every pending effect before returning. |
| `untrack` | Run a function without subscribing to what it reads. |
| `useEvent` | A stable callback that always runs its handler untracked. |
| `useReaction` | A tracker that reports the first change of what it reads, then stops observing until it tracks again. |
| `startTransition`, `useTransition`, `useDeferredValue` | Run updates in the transition lane, report whether one is pending, and follow a value in that lane. |
| `createRoot`, `getOwner`, `runWithOwner` | Create and use ownership scopes. |
| `catchError` | Run a function in a scope whose errors go to a handler. |
| `useId` | An id identical on server and client for the same position in the owner tree. |

### Context, props and resources

| Export | Description |
| --- | --- |
| `createContext`, `useContext` | Provide a value to a subtree and read the nearest one. |
| `mergeProps`, `splitProps`, `children` | Getter-preserving props helpers and a memoized `props.children`. |
| `createRef`, `useImperativeHandle` | A ref object that also works as a ref callback, and publishing an imperative handle to a ref. |
| `cache` | Memoizes a function per request: within one root the same arguments return the same result. |
| `useResource` | Load asynchronous data reactively. The handle has `state`, `loading`, `error`, `latest`, `refetch` and `mutate`; reading it while loading holds the nearest `<Suspense>`. |
| `ResourceCacheContext`, `SuspenseContext` | The bridges that renderers and `<Suspense>` provide. |

Error handlers registered with `onError` or `catchError` run untracked. Signals read while handling
an error do not become dependencies of the computation that encountered it. The caller's tracking
resumes after the handler returns or rethrows.

### Lists

| Export | Description |
| --- | --- |
| `mapArray` | Maps each item of a list to a row that lives as long as the item does. |
| `indexArray` | Maps each position of a list to a row. |

### Environment

| Export | Description |
| --- | --- |
| `isDev`, `isServer` | True in development builds; true in the server condition build. |

The package also exports the types `Accessor`, `Setter`, `Cleanup`, `Equals`, `ErrorHandler`,
`Owner`, `Context`, `Ref`, `Store`, `SetStore`, `StoreResult`, `Mutable`, `Reconciler`, `Resource`,
`ResourceInfo`, `ResourceState`, `ResourceCache`, `SuspenseTracker`, `MergeProps`, `MergeSource`,
`SplitProps`, `ResolvedChildren`, `ListSource` and the option types of each hook.

### Subpath entries

| Entry | Contents |
| --- | --- |
| `@shadow-js/core/store` | The store module on its own: `useStore`, `produce`, `reconcile`, `snapshot`, `unwrap` and the store types. |
| `@shadow-js/core/extend` | The extension API the built-ins are made from: signal nodes (`createSignalNode`, `readSignal`, `writeSignal`), computations (`createComputation`), owners (`createOwner`, `addCleanup`, `disposeOwner`, `runInScope`), scheduling (`flush`, `schedule`, `group`) and diagnostics (`warn`, `ShadowError`, `setWarningListener`). |

The `node`, `worker`, `deno` and `bun` conditions resolve to a server build in which effects never
run; the `development` condition selects the build with diagnostics.

## Links

- [`@shadow-js/web`](../web/README.md), [`@shadow-js/testing`](https://testing.shadowjs.net)

## Dependencies

- Runtime: none.
- Peers: none.

## Types

- Names from the root: `Accessor`, `Context`, `EffectOptions`, `Cleanup`, `ErrorHandler`, `MergeProps`, `Reconciler`.
- Type tests in `test-types/` are compile-time checks; `npm run typecheck:types` runs them.

## Support

- Node.js `>=22.12.0`. ESM only: use `import`; `require` is not supported.
- Browsers: current evergreen releases.
- Versioning: every `@shadow-js/*` package releases together at one version. Upgrade them as one set.
- Documentation: [ShadowJS documentation](https://shadowjs.net).

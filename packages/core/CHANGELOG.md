# Changelog

## 1.2.0

### Added

- `isPending(() => expression)`: true while a resource the expression reads, directly or through memos, loads for the first time or reloads. The expression is only evaluated to find what it reads: it holds no `<Suspense>` boundary and its errors are not thrown.
- `@shadow-js/core/extend`: `registerLoading(source, loading)` makes a data primitive of your own visible to `isPending`.
- `@shadow-js/core/extend`: `ownerPath(owner)` (where an owner sits: `<App> > <TodoList> > memo`), `nameOwner(owner, name)`, `diagnosticUrl(code)`, `subscribeDiagnostics(listener)` (every reported diagnostic as data: `code`, `message`, `ownerPath`, `url`), `reportDiagnostic(code, message, options?)` (a library's own warning through the same channel: `key`, the `url` of its own page, `every` for a diagnostic about one event) and the types `ReportedDiagnostic` and `ReportOptions`.
- `skills/diagnostics/` in the package: `SKILL.md`, the runtime sections of the diagnostics page for this version, and `diagnostics.json`, one entry per code (whether it warns or throws, what it means, the fix, the page address).
- The `ShadowError` constructor takes the owner the error belongs to as an optional second argument.

### Changed

- Development warnings and `ShadowError` messages continue on more lines: the owner path, when there is one, and the address of the code's section on the diagnostics page; the first report of a code also names the offline guide. The first line (`[shadow CODE] text`), `formatMessage`, the `code` property and the arguments a `setWarningListener` listener receives are unchanged. Production builds are unchanged.
- `warn` reports a code once per place (the owner path of the code that was running, at most sixteen places per code) instead of once for the whole program. A listener of `setWarningListener` is therefore called once per place too.
- `INFINITE_LOOP` names an effect of the loop in its owner path.
- The transition lane yields by time: a turn runs for 5 ms and always at least one effect, where it ran 64 effects whatever they cost.
- `mergeProps` skips `0`, `0n`, `NaN` and `""` as it skips `null`, `undefined` and `false`, for a source and for what a source function returns. `MergeSource` accepts them.

### Fixed

- `useResource`: a source that turns `null`, `undefined` or `false` after a failed load clears `error` with the state.
- `useResource`: a `<Suspense>` boundary is given back when the last reader that held it is disposed while the load is still running (one microtask later, so a reader that only runs again keeps it). The boundary showed its fallback until a load ended that nothing under it read any more.
- `useStore`: an update function that returns a promise throws a `TypeError` that names the mistake (production message `SHADOW_STORE_ASYNC_UPDATE`). What ran before the first `await` is written, as before; nothing after it can be.
- `useStore`: the descriptor of a non-configurable, writable property (an object passed through `Object.seal`) carries the store view of a nested object, as reading the property does.

## 1.1.2

### Changed

- The README starts with the ShadowJS banner, so the package page on npm shows it (the other packages already had it).

## 1.1.1

### Changed

- Released at 1.1.1 with the other packages. No change to this package.

## 1.1.0

### Changed

- Released at 1.1.0 with the other packages. No change to this package.

## 1.0.6

### Changed

- Released at 1.0.6 with the other packages. No change to this package.

## 1.0.5

### Fixed

- An effect, memo or root body that disposes its own owner and keeps running no longer leaks what it creates afterward: those cleanups run and those child effects stop with the run.
- `reconcile` removes an own `__proto__` key that parsed JSON put into a store instead of throwing partway through the diff.
- A store path step with a range or an index list of hundreds of thousands of items no longer overflows the call stack.

## 1.0.4

### Fixed

- Smaller bundles with the same behavior.

## 1.0.3

### Fixed

- A queued effect now brings its stale owners up to date first and is skipped when they dispose it, so a child effect never runs against state its parent was about to discard (also in the transition lane).
- A disposal nested in a cleanup no longer flushes effects while the outer tree is half torn down.
- When a cleanup throws as a memo or effect re-runs, the older cleanups still run, the node still re-runs, and the error is thrown once afterward (an `AggregateError` for several); cleanups run as a disposal, so a memo's own cleanup may write a signal in development too.
- `pauseOwner` pauses every node before running any cleanup, runs cleanups children first, and rethrows once at the end.
- `useAction` sends the error of a stale dispatch to the owner's error handler, and `dispatch` no longer throws synchronously when the owner has no handler (the error is reported with `reportError`).

## 1.0.2

### Fixed

- A computation that disposed its own owner while running no longer leaves graph edges for the signals it read afterward.
- `resource.refetch()` on a disposed resource starts no fetch, and a Suspense boundary is released even when the flush after a resource settles (or after `mutate()`) throws.
- The updater of `resource.mutate()`, the `equals` of `useSelector`, the function behind `cache()` and the `subscribe` function of `useExternalStore` run untracked.
- `useExternalStore` unsubscribes when its first `getSnapshot()` after subscribing throws, `useReaction`'s `track()` does nothing once its owner is disposed, and a throwing cleanup of a `createRoot` no longer replaces the error its body threw (both are thrown in an `AggregateError`).
- A store no longer keeps one tracking signal per key it ever read in a tracked context: once an object has collected a few hundred of them, the ones nothing observes are dropped, and a key read again gets a fresh one that reflects the current value (`store.byId[id]` with churning ids no longer grows without bound).
- Transitions started while a Suspense hold is engaged share one promise instead of adding a waiter each, and the list of suspended memos and effects lists a node once and drops the disposed ones.
- The `equals` of a memo and of a signal runs untracked, so what it reads is not a dependency of the reader that pulled the memo or of the computation that writes.
- `DUPLICATE_CORE` is raised now: in development builds `createRoot` lists its copy of core in a registry at `globalThis[Symbol.for("shadow-js.core.instances")]` (at most 8 copies, each with its number of live roots, removed with its last root) and warns once when a root is created while another copy of the same build (client or server) has live roots. Copies that never overlap, such as separate test files, do not warn.

## 1.0.1

### Changed

- Released at 1.0.1 with the other packages, which share one version. No change to this package.

## 1.0.0

### Added

- Fine-grained signals and deep stores, memos, effects, owner lifecycles and context.
- Batching and deterministic flushing, resources, selectors, optimistic state and concurrency helpers.
- Error handlers run untracked and restore caller tracking after success or rethrow, preventing accidental subscriptions during synchronous error recovery.
- Scope options are evaluated once, and a throwing getter restores the original scope.
- `@shadow-js/core/extend`: the edges of a node are stored as pairs in one array (`observers` of a source, `sources` of a computation: the node on the other side, then the index of this node's entry on that side) instead of two parallel arrays, so every edge costs half the memory and the engine is about 80 bytes smaller (gzip). `SourceNode` is now `{ kind, value, observers, stamp }`: the `observerSlots` and `sourceSlots` fields are gone. Read the edges with the new `observersOf(source)` and `sourcesOf(computation)`, which return the nodes alone. A keyed list row retains 9% fewer bytes (1,407 to 1,281) and a selector key 7% fewer (730 to 682).

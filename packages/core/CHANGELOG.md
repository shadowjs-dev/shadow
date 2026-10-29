# Changelog

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

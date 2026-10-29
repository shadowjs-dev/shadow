# Changelog

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

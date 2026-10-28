# Changelog

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

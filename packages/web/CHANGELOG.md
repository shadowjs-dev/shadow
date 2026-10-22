# Changelog

## 1.0.0

### Added

- DOM rendering, event bindings, reactive properties and composable control-flow components.
- Server rendering, streaming, hydration, serialization and document head management.
- Hydration preserves spread child nodes and static NoHydration regions.
- Fresh client roots mounted during hydration preserve the enclosing root's server nodes and key sequence.
- Streaming SSR releases abort listeners and timers, prevents rendering after cancellation, respects pre-aborted signals and keeps callbacks untracked.
- Held shells stop at exactly ten passes; every pass is disposed even when another pass's cleanup throws.

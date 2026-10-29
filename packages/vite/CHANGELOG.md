# Changelog

## 1.0.2

### Fixed

- `shadow()` and `shadowMdx()` leave `?raw` and `?url` requests alone: they are a file's text or address, not source to compile.
- `shadowMdx()` imports `Dynamic` from the `moduleName` it is given (the SSR entry `@shadow-js/web/server`, which has no `Dynamic`, still reads it from `@shadow-js/web`).

## 1.0.1

### Changed

- Released at 1.0.1 with the other packages, which share one version. No change to this package.

## 1.0.0

### Added

- Vite integration for the ShadowJS compiler, including DOM and server transforms.
- Development updates and hot module replacement for ShadowJS components.
- `include` and `exclude` patterns with a `g` or `y` flag match the same on every call: the plugin matches with a copy of the pattern without those flags.
- `plugins` option: compiler plugins (`CompilerPlugin` from `@shadow-js/compiler`) that run in the build on every compiled module, in the browser and server transforms. The list is validated when `shadow()` is called; plugin errors fail the build with the plugin's name, the file, the line and the column, and plugin warnings go to Vite's warning log.
- Vite 7.0 and newer are supported next to Vite 8 (peer range `^7.0.0 || ^8.0.0`).
- `@shadow-js/vite/mdx`: `shadowMdx()` compiles `.mdx` files into components through `@mdx-js/mdx` (optional peer) and the ShadowJS compiler in one step, with remark, rehype and recma plugins, replaceable Markdown elements (`components` prop, `wrapper`) or static ones (`elements: "static"`), and types for `*.mdx` modules in `@shadow-js/vite/mdx-env`.

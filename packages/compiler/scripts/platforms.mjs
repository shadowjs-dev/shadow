/**
 * The platforms the native compiler ships for: the Rust target triple of each, the key of its platform package
 * (`@shadow-js/compiler-<key>`), the library file cargo leaves and the npm fields (`os`, `cpu`, `libc`) that make npm
 * install only the matching package. The build, the release workflow and the publishing script all read this one table.
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * The folder cargo runs in: the package folder when the Rust workspace sits beside the manifest (the repository of this package), else
 * the root two folders up (a workspace layout).
 *
 * @param {string} packageDirectory The folder of this package.
 * @returns {string} The folder that holds `Cargo.toml`.
 */
export function cargoRoot(packageDirectory) {
  return existsSync(join(packageDirectory, "Cargo.toml"))
    ? packageDirectory
    : resolve(packageDirectory, "../..");
}

export const TARGETS = {
  "aarch64-apple-darwin": {
    key: "darwin-arm64",
    library: "libshadow_compiler_node.dylib",
    os: "darwin",
    cpu: "arm64",
  },
  "x86_64-apple-darwin": {
    key: "darwin-x64",
    library: "libshadow_compiler_node.dylib",
    os: "darwin",
    cpu: "x64",
  },
  "x86_64-unknown-linux-gnu": {
    key: "linux-x64-gnu",
    library: "libshadow_compiler_node.so",
    os: "linux",
    cpu: "x64",
    libc: "glibc",
  },
  "aarch64-unknown-linux-gnu": {
    key: "linux-arm64-gnu",
    library: "libshadow_compiler_node.so",
    os: "linux",
    cpu: "arm64",
    libc: "glibc",
  },
  "x86_64-unknown-linux-musl": {
    key: "linux-x64-musl",
    library: "libshadow_compiler_node.so",
    os: "linux",
    cpu: "x64",
    libc: "musl",
  },
  "aarch64-unknown-linux-musl": {
    key: "linux-arm64-musl",
    library: "libshadow_compiler_node.so",
    os: "linux",
    cpu: "arm64",
    libc: "musl",
  },
  "x86_64-pc-windows-msvc": {
    key: "win32-x64-msvc",
    library: "shadow_compiler_node.dll",
    os: "win32",
    cpu: "x64",
  },
  "aarch64-pc-windows-msvc": {
    key: "win32-arm64-msvc",
    library: "shadow_compiler_node.dll",
    os: "win32",
    cpu: "arm64",
  },
};

/** The keys of the platform packages, in table order. */
export const PLATFORM_KEYS = Object.values(TARGETS).map((spec) => spec.key);

/**
 * The `optionalDependencies` of the main package for one release: every platform package at the version of the main package.
 * They are written at release time (the platform packages do not exist on the registry before the release publishes them, so a
 * lockfile that listed them could not be installed from), never committed.
 * @param {string} version The version of the main package.
 * @returns {Record<string, string>} The dependencies, by package name.
 */
export function platformDependencies(version) {
  return Object.fromEntries(PLATFORM_KEYS.map((key) => [`@shadow-js/compiler-${key}`, version]));
}

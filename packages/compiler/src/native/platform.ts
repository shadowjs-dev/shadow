import { createRequire } from "node:module";

/**
 * The platforms a prebuilt addon exists for, as the suffix of the package that holds it
 * (`@shadow-js/compiler-<key>`).
 * @since 1.0.0
 */
export type PlatformKey =
  | "darwin-arm64"
  | "darwin-x64"
  | "linux-arm64-gnu"
  | "linux-arm64-musl"
  | "linux-x64-gnu"
  | "linux-x64-musl"
  | "win32-arm64-msvc"
  | "win32-x64-msvc";

/** True on Linux when the C library is musl (Alpine): the Node.js report names a glibc only on glibc systems. */
function isMusl(): boolean {
  const report = (
    process as unknown as {
      report?: { getReport?: () => { header?: { glibcVersionRuntime?: string } } };
    }
  ).report;
  const header = report?.getReport?.().header;
  return header !== undefined && header.glibcVersionRuntime === undefined;
}

/**
 * The platform key of the running process, or `null` when no prebuilt addon exists for it.
 *
 * @param platform The `process.platform` value.
 * @param arch The `process.arch` value.
 * @param musl Whether a Linux process runs on musl.
 * @returns The key, such as `darwin-arm64` or `linux-x64-gnu`.
 * @internal
 * @since 1.0.0
 */
export function platformKey(
  platform: string = process.platform,
  arch: string = process.arch,
  musl: boolean = platform === "linux" ? isMusl() : false,
): PlatformKey | null {
  if (platform === "darwin" && (arch === "arm64" || arch === "x64")) return `darwin-${arch}`;
  if (platform === "win32" && (arch === "arm64" || arch === "x64")) return `win32-${arch}-msvc`;
  if (platform === "linux" && (arch === "arm64" || arch === "x64")) {
    return `linux-${arch}-${musl ? "musl" : "gnu"}`;
  }
  return null;
}

/** A `require` for loading `.node` files from ESM. */
export const requireNode: NodeJS.Require = createRequire(import.meta.url);

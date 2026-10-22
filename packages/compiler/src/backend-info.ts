/**
 * Which implementation runs the compiler.
 *
 * @since 1.0.0
 */
export interface BackendInfo {
  /**
   * `"native"` is the Rust addon, `"wasm"` the same code as WebAssembly, `"javascript"` the TypeScript implementation (chosen when
   * `SHADOW_COMPILER_BACKEND=javascript` asks for it, when neither the addon nor the WebAssembly build can be loaded, and always where
   * there is no Node.js).
   */
  name: "native" | "wasm" | "javascript";
  /** The file or package the implementation was loaded from. */
  source: string;
  /** Why a faster implementation was not used; empty when the first choice loaded. */
  notes: readonly string[];
}

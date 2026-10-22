import { type Attempt, loadNative, loadWasm } from "../../../src/native/backend";

export const native: Attempt = loadNative();
export const wasm: Attempt = loadWasm();

/**
 * The backend of an attempt, or an error that says how to build it. The tests of the addon and of the WebAssembly build always run:
 * a checkout that has not built them (`npm run build:binaries`) fails here with the reason instead of passing without them.
 */
export function backendOf(
  attempt: Attempt,
  label: string,
): Extract<Attempt, { ok: true }>["backend"] {
  if (attempt.ok) return attempt.backend;
  throw new Error(`${label} is not built (run npm run build:binaries): ${attempt.reason}`);
}

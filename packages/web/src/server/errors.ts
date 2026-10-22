/** Diagnostic codes raised by the server renderer. @internal */
export type SsrErrorCode = "SSR_BOUNDARY_WATERFALL" | "SSR_PORTAL_LIMIT" | "SSR_TIMEOUT";

/**
 * Error thrown by the server renderer, carrying a stable code. Dev builds carry the full text;
 * production builds keep only the code (the same split as core's diagnostics).
 * @internal
 */
export class SsrError extends Error {
  readonly code: SsrErrorCode;
  constructor(code: SsrErrorCode, detail: string) {
    super(__DEV__ ? `[shadow ${code}] ${detail}` : `SHADOW_${code}`);
    this.name = "SsrError";
    this.code = code;
  }
}

/**
 * A TypeError for input the renderer refuses: a value that could become unsafe markup, or a
 * malformed argument. Dev builds carry the detail; production builds keep the code.
 * @internal
 */
export function invalid(code: string, detail: string): TypeError {
  return new TypeError(__DEV__ ? `[shadow ${code}] ${detail}` : `SHADOW_${code}`);
}

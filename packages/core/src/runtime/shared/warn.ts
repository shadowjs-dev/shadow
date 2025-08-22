const DEV =
  (typeof import.meta !== "undefined" &&
    (import.meta as { env?: { DEV?: boolean } }).env &&
    (import.meta as { env?: { DEV?: boolean } }).env?.DEV) ||
  (typeof process !== "undefined" &&
    process.env &&
    process.env.NODE_ENV !== "production");

export function warn(condition: boolean, message: string) {
  if (DEV && !condition) {
    console.warn(`[ShadowJS] ${message}`);
  }
}

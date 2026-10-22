/**
 * Markup that is already safe to insert: the only value `escape` writes without encoding.
 * A class instance, not a `{ t }` shape, so a plain object parsed from user input can never be
 * mistaken for trusted markup.
 * @internal
 */
export class SsrNode {
  readonly t: string;
  constructor(t: string) {
    this.t = t;
  }
}

/** True for values created by the server helpers. @internal */
export function isSsrNode(value: unknown): value is SsrNode {
  return value instanceof SsrNode;
}

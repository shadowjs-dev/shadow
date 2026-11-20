import { formatMessage, type MessageCode } from "./messages";
import type { Owner } from "./owner";
import { rt } from "./state";

/**
 * The error class of every diagnostic the runtime throws, carrying a stable code next to the
 * message. Match on `code` rather than the message: the message is the full text in development
 * builds and only `SHADOW_<CODE>` in production builds. Throw it from a custom primitive to report a
 * core diagnostic the same way the built-in hooks do.
 *
 * @example
 * import { ShadowError } from "@shadow-js/core/extend";
 *
 * function isCycle(error: unknown): boolean {
 *   return error instanceof ShadowError && error.code === "CYCLE_DETECTED";
 * }
 * @see MESSAGES
 * @since 1.0.0
 */
export class ShadowError extends Error {
  /** The diagnostic code, a key of {@link MESSAGES}; the same in development and production builds. */
  declare readonly code: MessageCode;
  /**
   * Creates the error with the name `"ShadowError"` and the text of {@link formatMessage} for `code`.
   * In development builds the text continues on two more lines: where it happened in the owner tree
   * (see {@link ownerPath}) and the page that explains the code (see {@link diagnosticUrl}).
   * @param code The diagnostic code.
   * @param owner The owner the error belongs to. Undefined uses the current owner.
   */
  constructor(code: MessageCode, owner?: Owner | null) {
    super(
      __DEV__
        ? formatMessage(code) + where(code, owner === undefined ? rt.owner : owner)
        : formatMessage(code),
    );
    this.name = "ShadowError";
    this.code = code;
  }
}

/**
 * The site that documents every diagnostic code. One address for all packages: the page has a section
 * per code, and a code is the anchor.
 */
const DIAGNOSTICS_PAGE = "https://shadowjs.net/faq/diagnostics/";

/** The most places one code is reported from; later places of the same code are dropped. */
const MAX_PLACES_PER_CODE = 16;

/**
 * The most keys one code is reported for, when the caller passes keys (one report per name it warns
 * about). Callers pass a bounded set of names; the limit holds when one does not.
 */
const MAX_KEYS_PER_CODE = 256;

/** The most owners named in a path: the innermost ones, which say where the mistake is. */
const MAX_PATH_SEGMENTS = 8;

/** The names renderers gave to owners (a component's owner carries the component's name). */
const ownerNames = /* @__PURE__ */ new WeakMap<Owner, string>();

/**
 * Names an owner for diagnostics: the name appears in the owner path of a warning or an error raised
 * below it. Renderers call it for the owner of each component (`@shadow-js/web` does, with the
 * component's name); a custom primitive may name the owner it creates. Does nothing in production
 * builds, where no path is built.
 *
 * @param owner The owner to name.
 * @param name The name to show, without brackets: a component name such as `"TodoList"`.
 * @example
 * import { createOwner, nameOwner, ownerPath } from "@shadow-js/core/extend";
 *
 * const owner = createOwner(null);
 * nameOwner(owner, "Sidebar");
 * console.log(ownerPath(owner)); // "<Sidebar>" in development builds
 * @see ownerPath
 * @since 1.2.0
 */
export function nameOwner(owner: Owner, name: string): void {
  if (__DEV__) ownerNames.set(owner, name);
}

/** The label of one owner in a path, or undefined for an owner with nothing to say (a plain scope). */
function labelOf(owner: Owner): string | undefined {
  const name = ownerNames.get(owner);
  if (name !== undefined) return `<${name}>`;
  // Read through an index: only computations have a kind, and this module must not import the graph.
  const node = owner as { kind?: number; name?: string | undefined };
  if (node.kind === undefined) return undefined;
  const kind = node.kind === 1 ? "memo" : "effect";
  return node.name === undefined ? kind : `${kind} "${node.name}"`;
}

/**
 * Where an owner sits in the owner tree, written from the outside in: the components above it by name
 * and the effect or memo it is, as in `<App> > <TodoList> > effect`. Diagnostics print it so a message
 * says which component to open. Owners with no name and no kind (plain scopes) are left out, and only
 * the innermost eight entries are kept (a longer path starts with `...`).
 *
 * @param owner The owner to locate. Null gives an empty string.
 * @returns The path, or an empty string when nothing above the owner has a name, and always in
 * production builds.
 * @example
 * import { currentOwner, ownerPath } from "@shadow-js/core/extend";
 *
 * export function describeHere(): string {
 *   return ownerPath(currentOwner()); // "<App> > <Row> > effect" in development builds
 * }
 * @see nameOwner
 * @since 1.2.0
 */
export function ownerPath(owner: Owner | null): string {
  if (!__DEV__) return "";
  const labels: string[] = [];
  let cut = false;
  // Iterative: the depth of the owner tree is the user's.
  for (let node = owner; node !== null; node = node.parent) {
    const label = labelOf(node);
    if (label === undefined) continue;
    if (labels.length === MAX_PATH_SEGMENTS) {
      cut = true;
      break;
    }
    labels.push(label);
  }
  labels.reverse();
  return (cut ? "... > " : "") + labels.join(" > ");
}

/**
 * The address of the page section that explains a diagnostic code: what it means, what triggers it
 * and how to fix it. Development messages end with it.
 *
 * @param code A diagnostic code of any ShadowJS package, such as `"WRITE_IN_MEMO"`.
 * @returns The address, with the code in lower case as the anchor.
 * @example
 * import { diagnosticUrl } from "@shadow-js/core/extend";
 *
 * console.log(diagnosticUrl("WRITE_IN_MEMO")); // https://shadowjs.net/faq/diagnostics/#write_in_memo
 * @since 1.2.0
 */
export function diagnosticUrl(code: string): string {
  return `${DIAGNOSTICS_PAGE}#${code.toLowerCase()}`;
}

/** The lines a development message adds after its text: the owner path, when there is one, and the page. */
function where(code: string, owner: Owner | null): string {
  const path = ownerPath(owner);
  return `${path === "" ? "" : `\n    in ${path}`}\n    ${diagnosticUrl(code)}`;
}

/**
 * One reported diagnostic, as {@link subscribeDiagnostics} delivers it.
 * @since 1.2.0
 */
export interface ReportedDiagnostic {
  /** The diagnostic code, such as `"EACH_KEY_DUPLICATE"` (core) or `"UNSAFE_URL_BLOCKED"` (the DOM runtime). */
  readonly code: string;
  /** The text: `[shadow CODE] ...`. */
  readonly message: string;
  /** Where it happened in the owner tree (see {@link ownerPath}); an empty string when unknown. */
  readonly ownerPath: string;
  /**
   * The page section that explains the code (see {@link diagnosticUrl}); an empty string when the
   * reporter named no page (a library's own code).
   */
  readonly url: string;
}

/**
 * A function that receives the warnings of {@link warn} instead of `console.warn`. Install one with
 * {@link setWarningListener}.
 * @param code The diagnostic code of the warning.
 * @param message The text of {@link formatMessage} for that code.
 * @since 1.0.0
 */
export type WarningListener = (code: MessageCode, message: string) => void;

/** The most codes remembered: a caller that makes codes up at run time cannot grow the record forever. */
const MAX_CODES = 256;

/** The file inside the installed package that explains every runtime code, for readers with no network. */
const OFFLINE_GUIDE = "node_modules/@shadow-js/core/skills/diagnostics/SKILL.md";

/** The places (an owner path, or a caller's key) each code was already reported from. */
const seen = /* @__PURE__ */ new Map<string, Set<string>>();
let listener: WarningListener | undefined;
const subscribers = /* @__PURE__ */ new Set<(diagnostic: ReportedDiagnostic) => void>();

/**
 * Records one diagnostic and tells the subscribers. Returns the text to print (the message, where it
 * happened, the page when the reporter named one, and on the first report of a code of the diagnostics
 * page the offline guide), or undefined when this code was already reported from this place, or from
 * as many places as are kept.
 */
function record(
  code: string,
  message: string,
  key: string | undefined,
  url: string,
  every: boolean,
): string | undefined {
  const path = ownerPath(rt.owner);
  let places = seen.get(code);
  if (places === undefined) {
    if (seen.size >= MAX_CODES) return undefined;
    places = new Set();
    seen.set(code, places);
  }
  const first = places.size === 0;
  const place = key === undefined ? path : key;
  const limit = key === undefined ? MAX_PLACES_PER_CODE : MAX_KEYS_PER_CODE;
  const known = places.has(place);
  if (!every && (known || places.size >= limit)) return undefined;
  if (!known && places.size < limit) places.add(place);
  for (const subscriber of subscribers) subscriber({ code, message, ownerPath: path, url });
  // The offline guide holds the codes of the diagnostics page only: a library's own page is not in it.
  const guide = first && url.startsWith(DIAGNOSTICS_PAGE) ? `\n    offline: ${OFFLINE_GUIDE}` : "";
  return `${message}${path === "" ? "" : `\n    in ${path}`}${url === "" ? "" : `\n    ${url}`}${guide}`;
}

/**
 * Sends every later warning to `next` instead of `console.warn`, for devtools and test helpers
 * (`@shadow-js/testing`) that collect warnings. Deduplication still applies: the listener receives a
 * code once for each place it is reported from (see {@link warn}). Warnings exist in development
 * builds only. To hear the diagnostics of every package, with where they happened, use
 * {@link subscribeDiagnostics}.
 *
 * @param next The listener to install. Undefined restores the default, `console.warn`.
 * @returns The listener that was installed before, or undefined when it was the default, so the
 * caller can restore it.
 * @example
 * import { type MessageCode, setWarningListener } from "@shadow-js/core/extend";
 *
 * const codes: MessageCode[] = [];
 * const previous = setWarningListener((code) => {
 *   codes.push(code);
 * });
 * // ... run the code under test, then:
 * setWarningListener(previous);
 * @see warn
 * @see resetWarningDedupe
 * @since 1.0.0
 */
export function setWarningListener(next: WarningListener | undefined): WarningListener | undefined {
  const previous = listener;
  listener = next;
  return previous;
}

/**
 * Calls `listener` with every diagnostic reported from now on, by core's {@link warn} and by the other
 * packages through {@link reportDiagnostic}: its code, its text, where it happened in the owner tree and
 * the page that explains it. For devtools, error reporters and agents that read diagnostics as data
 * instead of console text. The console output is unchanged. Development builds only: in production
 * builds nothing is reported, so the listener is never called.
 *
 * @param listener Receives each diagnostic once per code and place. It must not throw: a throw
 * reaches the code that made the mistake.
 * @returns A function that stops the subscription.
 * @example
 * import { type ReportedDiagnostic, subscribeDiagnostics } from "@shadow-js/core/extend";
 *
 * const found: ReportedDiagnostic[] = [];
 * const stop = subscribeDiagnostics((diagnostic) => {
 *   found.push(diagnostic);
 * });
 * // ... later: found[0] is { code, message, ownerPath: "<App> > <Row> > effect", url }
 * stop();
 * @see setWarningListener
 * @since 1.2.0
 */
export function subscribeDiagnostics(
  listener: (diagnostic: ReportedDiagnostic) => void,
): () => void {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}

/**
 * Forgets which codes and places {@link warn} and {@link reportDiagnostic} have already reported, so
 * the next one of each is reported again. Use it between test cases and after a hot reload.
 *
 * @example
 * import { resetWarningDedupe } from "@shadow-js/core/extend";
 *
 * function startTestCase(): void {
 *   resetWarningDedupe(); // each case sees its own first warnings
 * }
 * @see warn
 * @since 1.0.0
 */
export function resetWarningDedupe(): void {
  seen.clear();
}

/**
 * Reports a development-only diagnostic. A code is reported once for each place it comes from: the
 * owner path of the code that was running (two components that make the same mistake are two
 * reports; a thousand instances of one component are one), up to sixteen places per code, until
 * {@link resetWarningDedupe}. The report goes to the listener of {@link setWarningListener}, or to
 * `console.warn` as the text of {@link formatMessage} followed by where it happened (see
 * {@link ownerPath}) and the page that explains the code (see {@link diagnosticUrl}). Does nothing in
 * production builds. Use it for a mistake that should not stop the app; throw {@link ShadowError} for
 * one that must.
 *
 * @param code The diagnostic code to report.
 * @example
 * import { currentOwner, warn } from "@shadow-js/core/extend";
 *
 * export function useTicker(): void {
 *   if (currentOwner() === null) warn("NO_OWNER_CLEANUP");
 * }
 * @see setWarningListener
 * @see subscribeDiagnostics
 * @since 1.0.0
 */
export function warn(code: MessageCode): void {
  if (!__DEV__) return;
  const message = formatMessage(code);
  const text = record(code, message, undefined, diagnosticUrl(code), false);
  if (text === undefined) return;
  if (listener !== undefined) listener(code, message);
  else console.warn(text);
}

/**
 * How {@link reportDiagnostic} reports one diagnostic.
 * @since 1.2.0
 */
export interface ReportOptions {
  /**
   * With a key the report is once per code and key instead of once per code and owner path, for a
   * warning about a name where each name deserves one report (at most 256 names of one code).
   * @default undefined (once per code and owner path)
   */
  readonly key?: string | undefined;
  /**
   * The address of the page that explains the code, printed on the last line and given to
   * subscribers. A code of your own has no section on the ShadowJS diagnostics page, so only ShadowJS
   * packages pass {@link diagnosticUrl}.
   * @default undefined (no address)
   */
  readonly url?: string | undefined;
  /**
   * Reports every occurrence instead of once per place: for a diagnostic about one event (a hydration
   * mismatch names the element and the text it found), not about a line of code that repeats.
   * @default false
   */
  readonly every?: boolean | undefined;
}

/**
 * Reports a development-only diagnostic of another package, the way {@link warn} reports core's: once
 * per code and place, to the subscribers of {@link subscribeDiagnostics} and to `console.warn`, with
 * where it happened and, when you name one, the page that explains the code. The DOM runtime reports
 * its warnings through it; use it for the warnings of a custom renderer or a library, with a code of
 * your own. Does nothing in production builds.
 *
 * @param code The diagnostic code, in capitals: `"UNSAFE_URL_BLOCKED"`. Keep the set of codes fixed:
 * at most 256 are remembered, and a code past that is not reported.
 * @param message The text to print, usually `[shadow CODE] ...`.
 * @param options A key, the address of the page, or `every` (see {@link ReportOptions}).
 * @returns True when the diagnostic was reported, false when it was a repeat (and always in
 * production builds).
 * @example
 * import { reportDiagnostic } from "@shadow-js/core/extend";
 *
 * export function setVolume(level: number): void {
 *   if (level > 1) {
 *     reportDiagnostic("VOLUME_RANGE", "[player VOLUME_RANGE] The volume is between 0 and 1.", {
 *       url: "https://player.example/errors#volume_range",
 *     });
 *   }
 * }
 * @see warn
 * @since 1.2.0
 */
export function reportDiagnostic(code: string, message: string, options?: ReportOptions): boolean {
  if (!__DEV__) return false;
  const text = record(code, message, options?.key, options?.url ?? "", options?.every === true);
  if (text === undefined) return false;
  console.warn(text);
  return true;
}

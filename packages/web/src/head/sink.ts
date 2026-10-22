import type { HeadWinner } from "./registry";
import { HEAD_KEY, HEAD_MARKER, identityOfElement, type NormalizedTag } from "./validate";

/**
 * What the sink knows about one element it writes. `created` elements are removed on release;
 * adopted ones are removed too unless they are titles, where the original text comes back.
 */
interface Owned {
  readonly el: Element;
  readonly created: boolean;
  /** Text an adopted title had before the sink took it over. */
  readonly restoreText: string | undefined;
  /** Attributes last written, so the next write can remove the ones that disappeared. */
  attributes: ReadonlyArray<readonly [string, string]>;
}

/** Removes or restores one element the sink owned. Elements already gone are ignored. */
function release(head: HTMLHeadElement, record: Owned): void {
  const el = record.el;
  if (el.parentNode !== head) return;
  if (el.localName === "title" && !record.created) {
    if (record.restoreText !== undefined && el.textContent !== record.restoreText) {
      el.textContent = record.restoreText;
    }
    return;
  }
  el.remove();
}

/**
 * Finds an element to adopt for a slot, or returns undefined. Only identity-keyed slots adopt. A
 * server-rendered element carries the marker, and a page title or base is adopted even without it,
 * because the browser shows that one, so it must be the one that changes.
 */
function adoptable(
  head: HTMLHeadElement,
  slot: string,
  tag: NormalizedTag,
  claimed: Set<Element>,
): Element | undefined {
  if (tag.identity === undefined) return undefined;
  for (const candidate of Array.from(head.querySelectorAll(tag.tag))) {
    if (claimed.has(candidate)) continue;
    if (identityOfElement(candidate) !== slot) continue;
    if (candidate.hasAttribute(HEAD_MARKER) || tag.tag === "title") return candidate;
  }
  return undefined;
}

/** Takes over an existing element for a slot, or creates and marks a new one. */
function acquire(doc: Document, slot: string, tag: NormalizedTag, claimed: Set<Element>): Owned {
  const head = doc.head;
  const existing = adoptable(head, slot, tag, claimed);
  if (existing !== undefined) {
    const restoreText = tag.tag === "title" ? existing.textContent : undefined;
    return { el: existing, created: false, restoreText, attributes: [] };
  }
  const el = doc.createElement(tag.tag);
  el.setAttribute(HEAD_MARKER, "");
  if (tag.key !== undefined) el.setAttribute(HEAD_KEY, tag.key);
  if (tag.tag === "base") head.insertBefore(el, head.firstChild);
  else head.appendChild(el);
  return { el, created: true, restoreText: undefined, attributes: [] };
}

/** Writes the attributes and text of `tag` to its element, touching only what changed. */
function sync(record: Owned, tag: NormalizedTag): void {
  const el = record.el;
  const wanted = new Map<string, string>(tag.attributes);
  for (const [name] of record.attributes) {
    if (!wanted.has(name)) el.removeAttribute(name);
  }
  for (const [name, value] of tag.attributes) {
    if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  }
  record.attributes = tag.attributes;
  if (tag.tag === "title" || tag.tag === "style") {
    const text = tag.text ?? "";
    if (el.textContent !== text) el.textContent = text;
  }
}

/**
 * Creates the DOM sink for one document. The returned function makes `document.head` show the
 * given winners: it releases elements whose slot is gone, adopts or creates the rest and updates
 * them in place. It is called once per batch of registrations, so one call is one DOM pass.
 *
 * @param doc The document whose head is written.
 * @returns A function that applies a list of winners.
 * @internal
 * @since 1.0.0
 */
export function createDomHeadSink(doc: Document): (winners: readonly HeadWinner[]) => void {
  const owned = new Map<string, Owned>();
  return (winners: readonly HeadWinner[]): void => {
    const head = doc.head;
    const wanted = new Set(winners.map((winner) => winner.slot));
    for (const [slot, record] of owned) {
      if (wanted.has(slot) && record.el.parentNode === head) continue;
      owned.delete(slot);
      release(head, record);
    }
    const claimed = new Set<Element>();
    for (const record of owned.values()) claimed.add(record.el);
    for (const winner of winners) {
      let record = owned.get(winner.slot);
      if (record === undefined) {
        record = acquire(doc, winner.slot, winner.tag, claimed);
        owned.set(winner.slot, record);
        claimed.add(record.el);
      }
      sync(record, winner.tag);
    }
  };
}

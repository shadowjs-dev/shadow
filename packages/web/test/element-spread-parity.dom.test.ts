import { createRoot, flushSync, useSignal } from "@shadow-js/core";
import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import { element, spread } from "../src/index";
import { cleanupDom } from "./support/dom";

/**
 * `element()` binds the slim contract: attributes, `onX` handlers, `ref` and children. On that contract
 * it must write the same DOM as `spread()`, the generic prop runtime. The domain below is that contract.
 * Outside it the two differ on purpose: `element()` does not map React spellings (`className`, `htmlFor`)
 * or live properties (`value`, `checked` on inputs), so a caller that needs them uses `Dynamic`.
 */

afterEach(() => {
  cleanupDom();
});

/** Attributes the slim contract writes: plain names, `aria-*` and `data-*`, booleans and enumerated names. */
const NAMES = [
  "id",
  "title",
  "role",
  "lang",
  "hidden",
  "tabindex",
  "draggable",
  "aria-label",
  "aria-hidden",
  "aria-expanded",
  "data-x",
  "data-testid",
] as const;

/** Values the renderer writes: text, integers, booleans, and the values that remove an attribute. */
const valueArb = fc.oneof(
  fc.string({ unit: "grapheme-ascii", maxLength: 8 }),
  fc.integer({ min: -5, max: 500 }),
  fc.boolean(),
  fc.constant(null),
  fc.constant(undefined),
);

/** Props over the slim contract: each attribute name present or absent, with any value above. */
const attributesArb = fc.record(
  Object.fromEntries(NAMES.map((name) => [name, valueArb])) as Record<
    (typeof NAMES)[number],
    typeof valueArb
  >,
  { requiredKeys: [] },
);

/** The attributes of `el` as sorted `name=value` strings: the comparison of two renders. */
function attributesOf(el: Element): string[] {
  return [...el.attributes].map((attr) => `${attr.name}=${attr.value}`).sort();
}

/** A click counter and a ref log, one per side of the comparison. */
interface Hooks {
  clicks: number;
  readonly refs: Element[];
}

/** The props plus a click handler and a ref that record into `hooks`. */
function withHooks(props: Record<string, unknown>, hooks: Hooks): Record<string, unknown> {
  return {
    ...props,
    onClick: (): void => {
      hooks.clicks += 1;
    },
    ref: (node: Element): void => {
      hooks.refs.push(node);
    },
  };
}

describe("element() and spread() on the slim contract (fast-check, seed 11)", () => {
  it("[ELP-1] the same attributes, click handler and ref give the same DOM as spread()", () => {
    fc.assert(
      fc.property(attributesArb, (props) => {
        const host = document.createElement("div");
        document.body.append(host);
        const viaElement: Hooks = { clicks: 0, refs: [] };
        const viaSpread: Hooks = { clicks: 0, refs: [] };

        const elementNode = createRoot(
          () => element("div", withHooks(props, viaElement)) as Element,
        );
        const spreadNode = document.createElement("div");
        createRoot(() => {
          spread(spreadNode, withHooks(props, viaSpread), false, true);
        });
        host.append(elementNode, spreadNode);
        elementNode.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        spreadNode.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(attributesOf(elementNode)).toEqual(attributesOf(spreadNode));
        expect(viaElement.clicks).toBe(1);
        expect(viaSpread.clicks).toBe(1);
        expect(viaElement.refs).toEqual([elementNode]);
        expect(viaSpread.refs).toEqual([spreadNode]);
        host.remove();
      }),
      { seed: 11, numRuns: 60 },
    );
  });

  it("[ELP-2] an attribute that follows a signal ends with the same value under element() and spread()", () => {
    fc.assert(
      fc.property(valueArb, valueArb, (first, second) => {
        const host = document.createElement("div");
        document.body.append(host);
        let setElementTitle: (value: unknown) => void = () => undefined;
        let setSpreadTitle: (value: unknown) => void = () => undefined;
        const elementNode = createRoot(() => {
          const [title, set] = useSignal<unknown>(first);
          setElementTitle = set;
          return element("div", {
            get title(): unknown {
              return title();
            },
          }) as Element;
        });
        const spreadNode = document.createElement("div");
        createRoot(() => {
          const [title, set] = useSignal<unknown>(first);
          setSpreadTitle = set;
          spread(
            spreadNode,
            {
              get title(): unknown {
                return title();
              },
            },
            false,
            true,
          );
        });
        host.append(elementNode, spreadNode);
        setElementTitle(second);
        setSpreadTitle(second);
        flushSync();
        expect(attributesOf(elementNode)).toEqual(attributesOf(spreadNode));
        host.remove();
      }),
      { seed: 11, numRuns: 40 },
    );
  });
});

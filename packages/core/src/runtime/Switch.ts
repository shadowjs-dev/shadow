import { untrack, useEffect } from "../reactivity/hooks/useEffect";
import { disposeBetween } from "./lifecycle";
import { ERRORS } from "../errors";
import { isComponentThunk } from "./shared/isComponentThunk";

/**
 * Match component - represents a conditional case within a Switch.
 * This component doesn't render anything itself, but serves as a marker
 * for the Switch component to evaluate conditions and render content.
 *
 * @example
 * ```tsx
 * <Switch>
 *   <Match when={count() === 0}>
 *     <div>No items</div>
 *   </Match>
 *   <Match when={count() === 1}>
 *     <div>One item</div>
 *   </Match>
 *   <Match when={count() > 1}>
 *     <div>{count()} items</div>
 *   </Match>
 * </Switch>
 * ```
 */
export function Match(): null {
  return null;
}

/**
 * Props for the Switch component.
 * Switch renders the first matching Match child or the fallback.
 */
type SwitchProps = {
  /** Content to render if no Match conditions are true. */
  fallback?: unknown;
  /** Child components, typically Match components. */
  children: unknown;
};

/**
 * Switch component - renders the first matching Match child or fallback.
 *
 * This component evaluates Match children in order and renders the content
 * of the first Match whose condition evaluates to true. If no Match conditions
 * are true, it renders the fallback content if provided.
 *
 * Unlike traditional switch statements, Switch components are reactive and
 * will re-evaluate conditions when their dependencies change.
 *
 * @param props Switch component props
 * @returns DocumentFragment containing the rendered content
 *
 * @example
 * ```tsx
 * const [status, setStatus] = useStore<"idle" | "loading" | "success" | "error">("idle");
 *
 * return (
 *   <Switch fallback={<div>Unknown status</div>}>
 *     <Match when={status() === "idle"}>
 *       <div>Ready to start</div>
 *     </Match>
 *     <Match when={status() === "loading"}>
 *       <div>Loading...</div>
 *     </Match>
 *     <Match when={status() === "success"}>
 *       <div>Operation completed successfully!</div>
 *     </Match>
 *     <Match when={status() === "error"}>
 *       <div>Something went wrong</div>
 *     </Match>
 *   </Switch>
 * );
 * ```
 */
export function Switch(props: SwitchProps) {
  const fragment = document.createDocumentFragment();
  const start = document.createComment("switch-s");
  const end = document.createComment("switch-e");
  fragment.appendChild(start);
  fragment.appendChild(end);

  const getParent = () => start.parentNode as ParentNode | null;

  const toNode = (value: unknown): Node => {
    if (typeof value === "function") {
      try {
        if (isComponentThunk(value)) {
          return (value as () => Node)();
        }
        return toNode((value as () => unknown)());
      } catch {
        return document.createComment("error");
      }
    }
    if (value === null || value === undefined || typeof value === "boolean") {
      return document.createComment("");
    }
    if (typeof value === "object" && value !== null && "nodeType" in value)
      return value as Node;
    if (Array.isArray(value)) {
      const df = document.createDocumentFragment();
      value.forEach((v) => df.appendChild(toNode(v)));
      return df;
    }
    return document.createTextNode(String(value));
  };

  const flatten = (children: unknown): unknown[] => {
    if (children === null || children === undefined) return [];
    return Array.isArray(children)
      ? children.flatMap((c) => flatten(c))
      : [children];
  };

  const isMatchMarker = (child: unknown): boolean =>
    child !== null &&
    typeof child === "object" &&
    (("__isMatch" in child && child.__isMatch === true) ||
      ("type" in child && child.type === Match) ||
      ("$$typeof" in child && "type" in child && child.type === Match));

  const update = () => {
    const parent = getParent();
    if (!parent) return;

    disposeBetween(start, end);

    const all = flatten(props.children);

    const hasMatch = all.some((c) => isMatchMarker(c));
    if (!hasMatch && props.fallback === undefined) {
      throw ERRORS.SWITCH_NO_CHILDREN_OR_FALLBACK();
    }

    for (const child of all) {
      if (isMatchMarker(child)) {
        let cond = false;
        try {
          const whenProp = (
            child as { props?: { when?: boolean | (() => boolean) } }
          )?.props?.when;
          cond =
            typeof whenProp === "function" ? whenProp() : Boolean(whenProp);
        } catch {
          cond = false;
        }
        if (cond) {
          const node = untrack(() =>
            toNode(
              (child as { props?: { children?: unknown } })?.props?.children
            )
          );
          parent.insertBefore(node, end);
          return;
        }
      }
    }

    if (props.fallback !== undefined) {
      const node = untrack(() => toNode(props.fallback));
      parent.insertBefore(node, end);
    }
  };

  update();
  useEffect(update);

  return fragment;
}

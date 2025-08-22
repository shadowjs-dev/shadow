import { useEffect } from "../reactivity/hooks/useEffect";
import { disposeBetween } from "./lifecycle";
import { ERRORS } from "../errors";
import { warn } from "./shared/warn";
import { isComponentThunk } from "./shared/isComponentThunk";

/**
 * For component (each-only).
 *
 * Usage:
 * <For each={items()}>
 *   {(item, i) => <li>{item.name}</li>}
 * </For>
 *
 * For automatically handles efficient updates by default, so no key property is needed.
 * Parameter names are flexible - you can use any names you want:
 * <For each={count()}>
 *   {(num: string, idx: number) => <p>Item {idx}: {num}</p>}
 * </For>
 *
 * Or even simpler:
 * <For each={users()}>
 *   {(u: User, i: number) => <div>{u.name}</div>}
 * </For>
 */

type ForProps<T> = {
  each: T[] | readonly T[];
  children: (item: T, index: number, ...rest: unknown[]) => unknown;
};

export function For<T>(props: ForProps<T>) {
  // Anchor a region we can update
  const fragment = document.createDocumentFragment();
  const start = document.createComment("for-s");
  const end = document.createComment("for-e");
  fragment.appendChild(start);
  fragment.appendChild(end);

  if (typeof props.children !== "function") {
    throw ERRORS.FOR_CHILDREN_MUST_BE_FUNCTION();
  }

  // Mapping: key -> DOM block {start, end}
  const keyToBlock = new Map<string, { start: Comment; end: Comment }>();

  // For object identity keys
  const objectIdentityToKey = new WeakMap<object, string>();
  let objectIdentityCounter = 0;

  const getParent = () => start.parentNode as ParentNode | null;

  // Normalize any value to a Node for insertion
  const toNode = (value: unknown): Node => {
    if (value === null || value === undefined || typeof value === "boolean") {
      return document.createComment("");
    }

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

    if (typeof value === "object" && value !== null && "nodeType" in value)
      return value as Node;

    if (Array.isArray(value)) {
      const df = document.createDocumentFragment();
      value.forEach((v) => {
        const n = toNode(v);
        if (n) df.appendChild(n);
      });
      return df;
    }

    return document.createTextNode(String(value));
  };

  // Insert content before a reference node
  const appendChild = (
    parent: ParentNode,
    child: unknown,
    before: ChildNode | null
  ) => {
    if (Array.isArray(child)) {
      child.forEach((n) => appendChild(parent, n, before));
      return;
    }

    if (child === null || child === undefined || typeof child === "boolean")
      return;

    if (typeof child === "function") {
      try {
        if (isComponentThunk(child)) {
          parent.insertBefore((child as () => Node)(), before);
        } else {
          appendChild(parent, (child as () => unknown)(), before);
        }
      } catch {
        // Silently handle component render errors in For loops
        parent.insertBefore(document.createComment("error"), before);
      }
      return;
    }

    if (typeof child === "object" && child !== null && "nodeType" in child) {
      parent.insertBefore(child as Node, before);
      return;
    }

    parent.insertBefore(document.createTextNode(String(child)), before);
  };

  const createBlockAt = (before: ChildNode | null, content: unknown) => {
    const s = document.createComment("for-item-s");
    const e = document.createComment("for-item-e");
    const parent = getParent();
    if (!parent) return { start: s, end: e };
    parent.insertBefore(s, before);
    appendChild(parent, content, before);
    parent.insertBefore(e, before);
    return { start: s, end: e };
  };

  const removeBlock = (block: { start: Comment; end: Comment }) => {
    const parent = getParent();
    if (!parent) return;
    disposeBetween(block.start, block.end);
    parent.removeChild(block.start);
    parent.removeChild(block.end);
  };

  const moveBlockBefore = (
    block: { start: Comment; end: Comment },
    before: ChildNode | null
  ) => {
    const parent = getParent();
    if (!parent) return;
    if (block.start === before) return;
    const afterEnd = block.end.nextSibling;
    let node: ChildNode | null = block.start;
    while (node && node !== afterEnd) {
      const next: ChildNode | null = node.nextSibling;
      parent.insertBefore(node, before);
      node = next;
    }
  };

  const defaultKey = (item: unknown, index: number) => {
    if (item && typeof item === "object") {
      let k = objectIdentityToKey.get(item);
      if (!k) {
        k = `o:${++objectIdentityCounter}`;
        objectIdentityToKey.set(item, k);
      }
      return k;
    }
    return `v:${String(item)}@${index}`;
  };

  // Primary update routine computing diff and DOM ops
  const update = () => {
    const parent = getParent();
    if (!parent) return;

    const source =
      typeof props.each === "function"
        ? (props.each as () => unknown[])()
        : props.each;

    if (!Array.isArray(source)) {
      throw ERRORS.FOR_EACH_REQUIRES_ARRAY();
    }

    // Build expected keys
    const expectedKeys: string[] = [];
    for (let i = 0; i < source.length; i++) {
      expectedKeys.push(defaultKey(source[i] as T, i));
    }

    // Remove blocks not in the new set
    const expectedSet = new Set(expectedKeys);
    for (const [k, block] of keyToBlock.entries()) {
      if (!expectedSet.has(k)) {
        removeBlock(block);
        keyToBlock.delete(k);
      }
    }

    // Warn on duplicate keys
    const s = new Set(expectedKeys);
    warn(
      s.size === expectedKeys.length,
      "<For> detected duplicate keys. This can cause incorrect reordering."
    );

    // Walk through desired order
    let cursor: ChildNode | null = start.nextSibling;
    for (let i = 0; i < source.length; i++) {
      const item = source[i]! as T;
      const key = expectedKeys[i]!;
      const existing = keyToBlock.get(key);

      if (existing) {
        if (existing.start !== cursor) moveBlockBefore(existing, cursor);
        cursor = existing.end.nextSibling;
      } else {
        const content = (
          props.children as (
            item: T,
            index: number,
            ...rest: unknown[]
          ) => unknown
        )(item, i);
        const block = createBlockAt(cursor, toNode(content));
        keyToBlock.set(key, block);
        cursor = block.end.nextSibling;
      }
    }
  };

  update();
  useEffect(update);

  return fragment;
}

import { useEffect } from "../reactivity/hooks/useEffect";
import { onCleanup } from "../reactivity/hooks/onCleanup";
import { warn } from "./shared/warn";
import { isComponentThunk } from "./shared/isComponentThunk";

type TitleProps = {
  children?: unknown;
};

/**
 * <Title> updates document.title reactively based on its children.
 *
 * Examples:
 *   <Title>My App</Title>
 *   <Title>Count: {count()}</Title>
 *
 * Notes:
 * - Avoid passing component children; Title expects text-like content.
 * - On unmount, restores the previous title only if it was the last setter.
 */
export function Title(props: TitleProps) {
  const prevTitle = document.title;
  let lastSet: string | null = null;

  const toText = (v: unknown): string => {
    if (v == null || typeof v === "boolean") return "";
    if (typeof v === "string" || typeof v === "number") return String(v);

    if (typeof v === "function") {
      if (isComponentThunk(v)) {
        warn(
          false,
          "<Title> children should be text; component children are ignored."
        );
        return "";
      }
      try {
        return toText(v());
      } catch {
        return "";
      }
    }

    if (Array.isArray(v)) {
      return v.map((x) => toText(x)).join("");
    }

    if (typeof v === "object" && v !== null && "nodeType" in v) {
      try {
        return ((v as Node).textContent ?? "") as string;
      } catch {
        return "";
      }
    }

    return String(v);
  };

  useEffect(() => {
    const next = toText(props.children);
    document.title = next;
    lastSet = next;
  });

  onCleanup(() => {
    // Restore only if we were the last to set it (avoid clobbering newer Title)
    if (lastSet !== null && document.title === lastSet) {
      document.title = prevTitle;
    }
  });

  // Nothing to mount in the DOM
  return document.createDocumentFragment();
}

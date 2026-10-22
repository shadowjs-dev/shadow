import { type Accessor, onMount, useSignal } from "@shadow-js/core";
import type { JsxChild } from "../jsx/types";
import { Show } from "./show";

/**
 * Props of {@link ClientOnly}.
 * @since 1.0.0
 */
export interface ClientOnlyProps {
  /**
   * Rendered on the server and while the page hydrates, until the browser has mounted.
   * @default undefined (nothing is rendered until mount)
   */
  readonly fallback?: JsxChild;
  /**
   * Rendered in the browser only, after mount.
   * @default undefined (nothing is rendered after mount either)
   */
  readonly children?: JsxChild | (() => unknown);
}

/**
 * Renders `children` in the browser only. The server (and the first client pass, which must match
 * the server's markup) renders `fallback`; once mounted, the children replace it. Use it for
 * content that depends on browser state: `window`, `localStorage`, media queries, charts.
 *
 * @param props See {@link ClientOnlyProps}.
 * @returns An accessor of the current content: the fallback until mount, then the children.
 * @example
 * import { useSignal } from "@shadow-js/core";
 * import { ClientOnly } from "@shadow-js/web";
 *
 * function Chart(props: { data: number[] }) {
 *   return <canvas data-points={props.data.length} />;
 * }
 *
 * function Report() {
 *   const [rows] = useSignal([1, 2, 3]);
 *   return (
 *     <ClientOnly fallback={<p>Loading chart...</p>}>
 *       <Chart data={rows()} />
 *     </ClientOnly>
 *   );
 * }
 * @see Show
 * @since 1.0.0
 */
export function ClientOnly(props: ClientOnlyProps): Accessor<unknown> {
  const [mounted, setMounted] = useSignal(false);
  // Never runs on the server, so the server always renders the fallback.
  onMount(() => {
    setMounted(true);
  });
  return Show({
    get when() {
      return mounted();
    },
    get fallback() {
      return props.fallback;
    },
    get children() {
      return props.children;
    },
  });
}

/**
 * Shadow Core Library (public API)
 *
 * This module re-exports the public primitives for consumers:
 * - Reactivity hooks
 * - Control-flow/runtime components
 * - Render function
 * - JSX factory/runtime functions
 *
 * Import from "@shadow-js/core" in your application code.
 *
 * Example:
 *   import { useStore, Show, render } from "@shadow-js/core";
 *
 *   const [count, setCount] = useStore(0);
 *   function App() {
 *     return (
 *       <div>
 *         <button onClick={() => setCount(count() + 1)}>+</button>
 *         <Show when={count() > 0} fallback={<div>No count</div>}>
 *           <div>Count: {count()}</div>
 *         </Show>
 *       </div>
 *     );
 *   }
 *   render(App, document.getElementById("root")!);
 */

// --- Reactivity hooks ---
export { useData } from "./reactivity/hooks/useData";
export { useEffect } from "./reactivity/hooks/useEffect";
export { useId } from "./reactivity/hooks/useId";
export { useMemo } from "./reactivity/hooks/useMemo";
export { useOptimistic } from "./reactivity/hooks/useOptimistic";
export { type Store, useStore } from "./reactivity/hooks/useStore";
export { onMount } from "./reactivity/hooks/onMount";
export { onCleanup } from "./reactivity/hooks/onCleanup";

// --- Runtime components ---
export { Fragment } from "./runtime/Fragment";
export { For } from "./runtime/For";
export { Show } from "./runtime/Show";
export { Switch, Match } from "./runtime/Switch";
export { Title } from "./runtime/Title";
export { lazy } from "./runtime/lazy";
export { Portal } from "./runtime/Portal";
export { Suspense } from "./runtime/Suspense";
export { ErrorBoundary } from "./runtime/ErrorBoundary";
export { render } from "./runtime/render";

// --- JSX runtime functions ---
export { jsx, jsxs, jsxDEV } from "./runtime/jsx";
export { createElement } from "./runtime/createElement";

import { describe, expect, it } from "vitest";
import * as core from "../src/index";

describe("public surface", () => {
  it("[B-5] exports exactly the documented runtime API", () => {
    expect(Object.keys(core).sort()).toEqual(
      [
        "batch",
        "children",
        "catchError",
        "createContext",
        "createRoot",
        "flushSync",
        "getOwner",
        "indexArray",
        "isDev",
        "isServer",
        "mapArray",
        "mergeProps",
        "onCleanup",
        "onError",
        "onMount",
        "runWithOwner",
        "splitProps",
        "untrack",
        "useContext",
        "useEffect",
        "useId",
        "useMemo",
        "useRenderEffect",
        "useSelector",
        "useSignal",
        "produce",
        "useStore",
        "unwrap",
        "snapshot",
        "reconcile",
        "SuspenseContext",
        "ResourceCacheContext",
        "useOptimistic",
        "useResource",
        // Parity additions.
        "useAction",
        "useEvent",
        "useExternalStore",
        "useReaction",
        "useReducer",
        "useImperativeHandle",
        "createRef",
        "cache",
        // Transitions (DEC-TRANSITIONS).
        "startTransition",
        "useTransition",
        "useDeferredValue",
      ].sort(),
    );
  });
});

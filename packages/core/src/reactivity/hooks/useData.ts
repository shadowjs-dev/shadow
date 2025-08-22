import { useEffect } from "./useEffect";
import { useStore } from "./useStore";
import { ERRORS } from "../../errors";

/**
 * Return type of `useData`.
 * A reactive accessor function with extra properties.
 */
export type UseDataReturn<T> = {
  (): T | undefined;
  loading: () => boolean;
  error: () => unknown;
  mutate: (value: T | ((prev: T | undefined) => T)) => void;
  refetch: () => Promise<void>;
};

/**
 * A fetcher function that takes a source and returns a Promise of data.
 */
export type Fetcher<S, T> = (source: S) => Promise<T>;

/**
 * Reactive data-fetching hook.
 *
 * @param source A static value or reactive getter providing the fetch key.
 * @param fetcher Async function to fetch data for the given source.
 * @param deps Optional reactive dependencies controlling refetching.
 * @returns A reactive accessor with `.loading`, `.error`, `.mutate`, `.refetch`.
 */
export function useData<S, T>(
  source: (() => S) | S,
  fetcher?: Fetcher<S, T>,
  deps?: (() => unknown)[]
): UseDataReturn<T> {
  // Validate optional args
  if (fetcher !== undefined && typeof fetcher !== "function") {
    throw ERRORS.HOOK_INVALID_ARGUMENT("useData", "fetcher", "function");
  }
  if (deps !== undefined) {
    if (!Array.isArray(deps) || deps.some((d) => typeof d !== "function")) {
      throw ERRORS.HOOK_INVALID_DEPS("useData");
    }
  }

  const getSource =
    typeof source === "function" ? (source as () => S) : () => source as S;

  const [state, setState] = useStore<{
    data: T | undefined;
    loading: boolean;
    error: unknown;
    lastSource: S;
    initialized: boolean;
  }>({
    data: undefined,
    loading: !!fetcher,
    error: null,
    lastSource: getSource(),
    initialized: false,
  });

  let currentFetchId = 0;

  async function runFetch() {
    if (!fetcher) return;

    const fetchId = ++currentFetchId;
    const currentSource = getSource();

    setState({
      ...state(),
      loading: true,
      error: null,
    });

    try {
      const result = await fetcher(currentSource);

      if (fetchId === currentFetchId) {
        setState({
          data: result,
          loading: false,
          error: null,
          lastSource: currentSource,
          initialized: true,
        });
      }
    } catch (err) {
      if (fetchId === currentFetchId) {
        setState({
          ...state(),
          error: err,
          loading: false,
          lastSource: currentSource,
          initialized: true,
        });
      }
    }
  }

  // Run fetch on mount and when deps change
  useEffect(
    () => {
      runFetch();
    },
    deps || [() => getSource()]
  );

  // Create accessor with extra properties
  const data = (() => state().data) as UseDataReturn<T>;
  data.loading = () => state().loading;
  data.error = () => state().error;

  data.mutate = (value: T | ((prev: T | undefined) => T)) => {
    const newValue =
      typeof value === "function"
        ? (value as (prev: T | undefined) => T)(state().data)
        : value;

    setState({
      ...state(),
      data: newValue,
      loading: false,
      error: null,
      initialized: true,
    });
  };

  data.refetch = async () => {
    await runFetch();
  };

  return data;
}

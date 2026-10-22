/**
 * Compile-time checks for the public core API that the runtime suites do not type-check.
 * Props (`mergeProps`, `splitProps`) and `useStore` setters are covered by `test/*.test-d.ts`.
 * Every positive case asserts an inferred type with `Expect<Equal<...>>`; every negative case
 * marks a call that must not compile with `@ts-expect-error`. Scenarios are wrapped in functions
 * so they type-check without running.
 */
import type {
  Accessor,
  Context,
  Mutable,
  Owner,
  Reconciler,
  Ref,
  Resource,
  Setter,
  Store,
} from "../src/index";
import {
  catchError,
  createContext,
  createRef,
  createRoot,
  getOwner,
  mapArray,
  produce,
  reconcile,
  snapshot,
  unwrap,
  useContext,
  useMemo,
  useReducer,
  useResource,
  useSelector,
  useSignal,
  useStore,
} from "../src/index";
import type { Equal, Expect } from "./support";

interface Todo {
  readonly id: number;
  readonly title: string;
}

interface Profile {
  name: string;
  tags: string[];
}

/* useSignal */

function signalInference(): void {
  const [text, setText] = useSignal<string>("");
  type _Text = Expect<Equal<typeof text, Accessor<string>>>;
  type _Setter = Expect<Equal<typeof setText, Setter<string>>>;
  setText("next");
  setText((previous) => `${previous}!`);
}

function signalNegative(): void {
  const [, setCount] = useSignal<number>(0);
  // @ts-expect-error a string is not assignable to a number signal
  setCount("one");
}

/* useMemo */

function memoInference(): void {
  const [count] = useSignal<number>(1);
  const doubled = useMemo(() => count() * 2);
  type _Doubled = Expect<Equal<typeof doubled, Accessor<number>>>;
  const seen = useMemo<string[]>((previous) => (previous ?? []).concat("x"));
  type _Seen = Expect<Equal<typeof seen, Accessor<string[]>>>;
}

function memoNegative(): void {
  const [count] = useSignal<number>(1);
  const doubled = useMemo(() => count() * 2);
  // @ts-expect-error the memo is an accessor; reading it gives a number, not the accessor
  const sum: number = doubled + 1;
  void sum;
}

/* createContext / useContext */

function contextInference(): void {
  const theme = createContext<string>("light");
  type _Theme = Expect<Equal<typeof theme, Context<string>>>;
  const current = useContext(theme);
  type _Current = Expect<Equal<typeof current, string>>;
}

function contextNegative(): void {
  const theme = createContext<string>("light");
  // @ts-expect-error the context carries string, so a number binding must not compile
  const wrong: number = useContext(theme);
  void wrong;
}

/* useResource */

function resourceInference(): void {
  const user = useResource(async () => ({ id: 1, name: "Ada" }));
  type _User = Expect<Equal<typeof user, Resource<{ id: number; name: string }>>>;
  type _Value = Expect<Equal<ReturnType<typeof user>, { id: number; name: string } | undefined>>;
  type _Latest = Expect<Equal<(typeof user)["latest"], { id: number; name: string } | undefined>>;
}

function resourceSourceInference(): void {
  const [id] = useSignal<number>(7);
  const profile = useResource(id, async (value: number) => ({
    name: `user ${value}`,
    tags: [] as string[],
  }));
  type _Profile = Expect<Equal<typeof profile, Resource<Profile>>>;
}

function resourceNegative(): void {
  const user = useResource(async () => ({ id: 1, name: "Ada" }));
  // @ts-expect-error mutate takes a value of the resource type, not a string
  user.mutate("Ada");
}

/* useReducer */

function reducerInference(): void {
  const [count, dispatch] = useReducer(
    (state: number, action: "inc" | "dec") => (action === "inc" ? state + 1 : state - 1),
    0,
  );
  type _Count = Expect<Equal<typeof count, Accessor<number>>>;
  type _Dispatch = Expect<Equal<typeof dispatch, (action: "inc" | "dec") => void>>;
}

function reducerNegative(): void {
  const [, dispatch] = useReducer(
    (state: number, action: "inc" | "dec") => (action === "inc" ? state + 1 : state - 1),
    0,
  );
  // @ts-expect-error "reset" is not an action the reducer accepts
  dispatch("reset");
}

/* createRef */

function refInference(): void {
  const input = createRef<HTMLInputElement>();
  type _Ref = Expect<Equal<typeof input, Ref<HTMLInputElement>>>;
  type _Current = Expect<Equal<(typeof input)["current"], HTMLInputElement | undefined>>;
}

function refNegative(): void {
  const input = createRef<HTMLInputElement>();
  // @ts-expect-error a ref of an input element cannot hold a plain string
  input("not an element");
  // @ts-expect-error current is readonly on a ref
  input.current = undefined;
}

/* useSelector */

function selectorNegative(): void {
  const [selected] = useSignal<number>(1);
  const isSelected = useSelector(() => selected());
  // @ts-expect-error the selector keys are numbers, not strings
  isSelected("1");
}

/* mapArray */

function mapArrayInference(): void {
  const [todos] = useSignal<Todo[]>([]);
  const titles = mapArray(todos, (todo) => todo().title, { key: (todo) => todo.id });
  type _Titles = Expect<Equal<typeof titles, Accessor<string[]>>>;
  const plain = mapArray(todos, (todo) => todo.title);
  type _Plain = Expect<Equal<typeof plain, Accessor<string[]>>>;
}

function mapArrayNegative(): void {
  const [todos] = useSignal<Todo[]>([]);
  // @ts-expect-error the keyed row callback receives an accessor, not the plain item
  mapArray(todos, (todo: Todo) => todo.title, { key: (item) => item.id });
}

/* catchError / createRoot / getOwner */

function ownershipInference(): void {
  const guarded = catchError(
    () => 1,
    () => undefined,
  );
  type _Guarded = Expect<Equal<typeof guarded, number | undefined>>;
  const disposed = createRoot((dispose) => {
    void dispose;
    return "done";
  });
  type _Disposed = Expect<Equal<typeof disposed, string>>;
  const owner = getOwner();
  type _Owner = Expect<Equal<typeof owner, Owner | null>>;
}

/* Store helpers */

function storeInference(): void {
  const [state, setState] = useStore<Profile>({ name: "Ada", tags: [] });
  type _Name = Expect<Equal<typeof state.name, string>>;
  type _Tags = Expect<Equal<typeof state.tags, readonly string[]>>;
  setState("name", "Grace");
  const raw = unwrap(state);
  type _Raw = Expect<Equal<typeof raw, Mutable<Store<Profile>>>>;
  const copy = snapshot(state);
  type _Copy = Expect<Equal<typeof copy, Mutable<Store<Profile>>>>;
}

function reconcileInference(): void {
  const next = reconcile<Profile>({ name: "Ada", tags: [] }, { key: "name" });
  type _Next = Expect<Equal<typeof next, Reconciler<Profile>>>;
  const apply = produce<Profile>((draft) => {
    draft.name = "Grace";
  });
  type _Apply = Expect<Equal<typeof apply, (draft: Profile) => void>>;
}

function storeNegative(): void {
  const [state] = useStore<Profile>({ name: "Ada", tags: [] });
  // @ts-expect-error a store read by a path is readonly at the type level
  state.name = "Grace";
}

function reconcileNegative(): void {
  // @ts-expect-error the reconciled value must match the store shape
  reconcile<Profile>({ name: 1, tags: [] });
}

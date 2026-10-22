/**
 * Type tests: control-flow components and context providers, which return accessors, are valid JSX tags.
 *
 * @since 1.0.0
 */
import type { Context } from "@shadow-js/core";
import { For, Index, Show, Switch } from "@shadow-js/web";

declare const Ctx: Context<number>;

export const View = (): unknown => (
  <Show when={true} fallback={<i>no</i>}>
    <For each={[1, 2]}>{(n) => <b>{n}</b>}</For>
    <Index each={[1]}>{(n) => <b>{n()}</b>}</Index>
    <Switch>{null}</Switch>
    <Ctx.Provider value={1}>x</Ctx.Provider>
  </Show>
);

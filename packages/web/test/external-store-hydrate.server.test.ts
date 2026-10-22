import { describe, expect, it } from "vitest";
import { renderToString } from "../src/server";
import { load } from "./support/compile";

const APP = `
import { useExternalStore } from "@shadow-js/core";
export const store = { value: "client", listeners: [] };
export function App(props) {
  const label = useExternalStore(
    (notify) => { store.listeners.push(notify); return () => {}; },
    () => store.value,
    props.withServer ? { getServerSnapshot: () => "server" } : {},
  );
  return <main><p class="label">{label()}</p></main>;
}
`;

describe("useExternalStore on the server (golden markup for the hydration test)", () => {
  it("[EXT-S1] the server renders getServerSnapshot(), never the client snapshot", async () => {
    const ssr = await load<{ App: (props: { withServer: boolean }) => unknown }>(APP, "ssr");
    expect(renderToString(() => ssr.App({ withServer: true }))).toBe(
      '<main data-hk="0-0"><p class="label"><!--[-->server<!--]--></p></main>',
    );
  });
});

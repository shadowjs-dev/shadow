import { flushSync } from "@shadow-js/core";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "../src/index";
import { load } from "./support/compile";
import { cleanupDom } from "./support/dom";

/*
 * A select's `value` binding is applied again whenever the options inside it change: the options of a `<For>` (or a
 * `<Show>`, an optgroup's `<For>`) arrive or are replaced after the binding ran, and the browser has then picked the first
 * option on its own.
 */

afterEach(cleanupDom);

const SOURCE = `
import { useSignal } from "@shadow-js/core";
import { For, Show } from "@shadow-js/web";
export const state = {};
export function Devices() {
  const [cameras, setCameras] = useSignal([]);
  const [camera, setCamera] = useSignal(undefined);
  state.setCameras = setCameras;
  state.setCamera = setCamera;
  state.picked = [];
  return (
    <select value={camera() ?? ""} onChange={(e) => { state.picked.push(e.currentTarget.value); setCamera(e.currentTarget.value); }}>
      <option value="">No camera</option>
      <For each={cameras()}>{(d) => <option value={d.id}>{d.label}</option>}</For>
    </select>
  );
}
export function Fixed() {
  const [cameras, setCameras] = useSignal([]);
  state.setCameras = setCameras;
  return (
    <select value="b">
      <For each={cameras()}>{(d) => <option value={d.id}>{d.label}</option>}</For>
    </select>
  );
}
export function Many() {
  const [items, setItems] = useSignal([]);
  const [chosen, setChosen] = useSignal(["a", "c"]);
  state.setItems = setItems;
  state.setChosen = setChosen;
  return (
    <select multiple value={chosen()}>
      <For each={items()}>{(d) => <option value={d.id}>{d.label}</option>}</For>
    </select>
  );
}
export function Grouped() {
  const [items, setItems] = useSignal([]);
  state.setItems = setItems;
  return (
    <select value="b">
      <option value="">none</option>
      <optgroup label="g"><For each={items()}>{(d) => <option value={d.id}>{d.label}</option>}</For></optgroup>
    </select>
  );
}
export function Shown() {
  const [on, setOn] = useSignal(false);
  state.setOn = setOn;
  return (
    <select value="b">
      <option value="">none</option>
      <Show when={on()}><option value="a">A</option><option value="b">B</option></Show>
    </select>
  );
}
`;

interface Mod {
  Devices: () => unknown;
  Fixed: () => unknown;
  Many: () => unknown;
  Grouped: () => unknown;
  Shown: () => unknown;
  state: Record<string, (value: never) => void> & { picked: string[] };
}

const items = (...ids: string[]) => ids.map((id) => ({ id, label: id.toUpperCase() }));

async function mount(
  name: keyof Omit<Mod, "state">,
): Promise<{ select: HTMLSelectElement; mod: Mod }> {
  const mod = await load<Mod>(SOURCE);
  const host = document.createElement("div");
  document.body.append(host);
  render(() => mod[name](), host);
  return { select: host.querySelector("select") as HTMLSelectElement, mod };
}

const set = (mod: Mod, name: string, value: unknown): void => {
  (mod.state[name] as (value: unknown) => void)(value);
  flushSync();
};

const chosen = (select: HTMLSelectElement): string[] =>
  Array.from(select.options)
    .filter((option) => option.selected)
    .map((option) => option.value);

describe("a select's value after its options change", () => {
  it("[SEL-F-1] options that arrive after the value select the bound option, not the first one", async () => {
    const { select, mod } = await mount("Devices");
    expect(select.selectedIndex).toBe(0);
    set(mod, "setCamera", "b");
    set(mod, "setCameras", items("a", "b", "c"));
    expect(select.value).toBe("b");
    expect(select.selectedIndex).toBe(2);
  });

  it("[SEL-F-2] options that arrive at the same time as the value select it too", async () => {
    const { select, mod } = await mount("Devices");
    set(mod, "setCameras", items("a", "b"));
    set(mod, "setCamera", "b");
    expect(select.value).toBe("b");
  });

  it("[SEL-F-3] options replaced by new nodes keep the selection", async () => {
    const { select, mod } = await mount("Devices");
    set(mod, "setCamera", "b");
    set(mod, "setCameras", items("a", "b", "c"));
    // The first option is the static "No camera"; the others come from the list.
    const before = Array.from(select.options).slice(1);
    set(mod, "setCameras", items("a", "b", "c"));
    const after = Array.from(select.options).slice(1);
    expect(after.some((option, index) => option === before[index])).toBe(false);
    expect(select.value).toBe("b");
    set(mod, "setCameras", items("x", "b"));
    expect(select.value).toBe("b");
  });

  it("[SEL-F-4] a value that changes before any option exists is the one applied when they arrive", async () => {
    const { select, mod } = await mount("Devices");
    set(mod, "setCamera", "x");
    set(mod, "setCamera", "y");
    set(mod, "setCameras", items("x", "y"));
    expect(select.value).toBe("y");
  });

  it("[SEL-F-5] a value with no option leaves nothing selected until its option arrives", async () => {
    const { select, mod } = await mount("Devices");
    set(mod, "setCamera", "late");
    expect(select.selectedIndex).toBe(-1);
    set(mod, "setCameras", items("late"));
    expect(select.value).toBe("late");
  });

  it("[SEL-F-6] a static value is applied when the options arrive", async () => {
    const { select, mod } = await mount("Fixed");
    expect(select.selectedIndex).toBe(-1);
    set(mod, "setCameras", items("a", "b"));
    expect(select.value).toBe("b");
  });

  it("[SEL-F-7] a multiple select selects the listed options as they arrive, and when they are replaced", async () => {
    const { select, mod } = await mount("Many");
    set(mod, "setItems", items("a", "b", "c"));
    expect(chosen(select)).toEqual(["a", "c"]);
    set(mod, "setItems", items("a", "b", "c", "d"));
    expect(chosen(select)).toEqual(["a", "c"]);
    set(mod, "setChosen", ["b", "d"]);
    expect(chosen(select)).toEqual(["b", "d"]);
    set(mod, "setItems", items("d", "b"));
    expect(chosen(select)).toEqual(["d", "b"]);
  });

  it("[SEL-F-8] options in an optgroup, or behind a Show, count as the select's options", async () => {
    const grouped = await mount("Grouped");
    set(grouped.mod, "setItems", items("a", "b"));
    expect(grouped.select.value).toBe("b");
    const shown = await mount("Shown");
    expect(shown.select.value).toBe("");
    set(shown.mod, "setOn", true);
    expect(shown.select.value).toBe("b");
  });

  it("[SEL-F-9] the visitor's pick is the bound value once onChange stores it: later option changes keep it", async () => {
    const { select, mod } = await mount("Devices");
    set(mod, "setCameras", items("a", "b", "c"));
    select.value = "c";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    flushSync();
    expect(mod.state.picked).toEqual(["c"]);
    set(mod, "setCameras", items("a", "b", "c", "d"));
    expect(select.value).toBe("c");
  });

  it("[SEL-F-10] a select that is gone stops being followed, and two selects do not share a value", async () => {
    const first = await mount("Devices");
    set(first.mod, "setCamera", "b");
    set(first.mod, "setCameras", items("a", "b"));
    const second = await mount("Devices");
    set(second.mod, "setCamera", "a");
    set(second.mod, "setCameras", items("a", "b"));
    expect(first.select.value).toBe("b");
    expect(second.select.value).toBe("a");
  });
});

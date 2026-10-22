import { flushSync, useSignal } from "@shadow-js/core";
import { createComponent, hydrate, render } from "@shadow-js/web";
import { renderToString } from "@shadow-js/web/server";
import { afterEach, describe, expect, it } from "vitest";
import { load } from "./support/compile";

/** One controlled control, written once as an attribute and once through a spread. */
interface Control {
  name: string;
  initial: unknown;
  next: unknown;
  /** The control's JSX with the signal read as `props.v()`. */
  direct: string;
  spread: string;
  /** What the server markup must contain. */
  markup: (html: string) => void;
  /** The state the DOM shows, in a form comparable with {@link Control.show}. */
  read: (root: Element) => unknown;
  /**
   * The state the server markup carries, before any script runs. It is `read` except for selects:
   * happy-dom's HTML parser drops `selected` on options past the second, so the attributes are read.
   */
  served?: (root: Element) => unknown;
  /** The DOM state a signal value stands for. */
  show: (value: unknown) => unknown;
}

const OPTIONS =
  '<option value="a">A</option><option value="b">B</option><option>Plain text</option>';
const GROUPED =
  '<optgroup label="One"><option value="a">A</option><option value="b">B</option></optgroup><optgroup label="Two"><option value="c">C</option><option value="d">D</option></optgroup>';

/** Values of the options of the first select, by the `selected` attribute the markup carries. */
const servedOptions = (root: Element): string[] =>
  Array.from(root.querySelectorAll("option"))
    .filter((option) => option.hasAttribute("selected"))
    .map((option) => (option as HTMLOptionElement).value);

const first = <T extends Element>(root: Element, selector: string): T => {
  const found = root.querySelector<T>(selector);
  if (found === null) throw new Error(`missing ${selector}`);
  return found;
};

const CONTROLS: Control[] = [
  {
    name: "text input",
    initial: `He said "hi" <b> & 'x'`,
    next: "plain",
    direct: '<input type="text" name="t" value={props.v()} />',
    spread: '<input type="text" name="t" {...{ value: props.v() }} />',
    markup: (html) => {
      expect(html).toContain('value="He said &quot;hi&quot; &lt;b&gt; &amp; &#39;x&#39;"');
    },
    read: (root) => first<HTMLInputElement>(root, "input").value,
    show: (value) => value,
  },
  {
    name: "number input",
    initial: 3,
    next: 0,
    direct: '<input type="number" name="n" value={props.v()} />',
    spread: '<input type="number" name="n" {...{ value: props.v() }} />',
    markup: (html) => {
      expect(html).toContain('type="number"');
      expect(html).toContain('value="3"');
    },
    read: (root) => first<HTMLInputElement>(root, "input").value,
    show: (value) => String(value),
  },
  {
    name: "checkbox",
    initial: true,
    next: false,
    direct: '<input type="checkbox" name="c" checked={props.v()} />',
    spread: '<input type="checkbox" name="c" {...{ checked: props.v() }} />',
    markup: (html) => {
      expect(html).toMatch(/<input[^>]* checked/);
    },
    read: (root) => first<HTMLInputElement>(root, "input").checked,
    show: (value) => Boolean(value),
  },
  {
    name: "radio group",
    initial: "b",
    next: "a",
    direct:
      '<input type="radio" name="r" value="a" checked={props.v() === "a"} /><input type="radio" name="r" value="b" checked={props.v() === "b"} />',
    spread:
      '<input type="radio" name="r" value="a" {...{ checked: props.v() === "a" }} /><input type="radio" name="r" value="b" {...{ checked: props.v() === "b" }} />',
    markup: (html) => {
      expect(html).toContain('value="b" checked');
      expect(html).not.toContain('value="a" checked');
    },
    read: (root) =>
      Array.from(root.querySelectorAll<HTMLInputElement>("input"))
        .filter((input) => input.checked)
        .map((input) => input.value),
    show: (value) => [value],
  },
  {
    name: "select",
    initial: "b",
    next: "Plain text",
    direct: `<select name="s" value={props.v()}>${OPTIONS}</select>`,
    spread: `<select name="s" {...{ value: props.v() }}>${OPTIONS}</select>`,
    markup: (html) => {
      expect(html).toContain('<option value="b" selected>');
      expect(html).not.toMatch(/<select[^>]* value=/);
      expect(html.match(/ selected/g)).toHaveLength(1);
    },
    read: (root) => first<HTMLSelectElement>(root, "select").value,
    served: (root) => servedOptions(root)[0],
    show: (value) => value,
  },
  {
    name: "select naming an option by its text",
    initial: "Plain text",
    next: "a",
    direct: `<select name="s" value={props.v()}>${OPTIONS}</select>`,
    spread: `<select name="s" {...{ value: props.v() }}>${OPTIONS}</select>`,
    markup: (html) => {
      expect(html).toContain("<option selected>Plain text</option>");
    },
    read: (root) => first<HTMLSelectElement>(root, "select").value,
    served: (root) => servedOptions(root)[0],
    show: (value) => value,
  },
  {
    name: "select multiple with optgroups",
    initial: ["a", "c"],
    next: ["b"],
    direct: `<select multiple name="m" value={props.v()}>${GROUPED}</select>`,
    spread: `<select name="m" {...{ multiple: true, value: props.v() }}>${GROUPED}</select>`,
    markup: (html) => {
      expect(html).toContain('<option value="a" selected>');
      expect(html).toContain('<option value="c" selected>');
      expect(html.match(/ selected/g)).toHaveLength(2);
    },
    read: (root) =>
      Array.from(first<HTMLSelectElement>(root, "select").options)
        .filter((option) => option.selected)
        .map((option) => option.value),
    served: servedOptions,
    show: (value) => value,
  },
  {
    name: "textarea",
    initial: 'line one\nline <two> &amp; "three"',
    next: "",
    direct: '<textarea name="x" value={props.v()} />',
    spread: '<textarea name="x" {...{ value: props.v() }} />',
    markup: (html) => {
      expect(html).toContain("line one\nline &lt;two&gt; &amp;amp; &quot;three&quot;</textarea>");
      expect(html).not.toContain("value=");
    },
    read: (root) => first<HTMLTextAreaElement>(root, "textarea").value,
    show: (value) => value,
  },
  {
    name: "textarea with a dynamic child",
    initial: 'line one\nline <two> &amp; "three"',
    next: "after",
    direct: '<textarea name="x">{props.v()}</textarea>',
    spread: '<textarea name="x" {...{ children: props.v() }} />',
    markup: (html) => {
      expect(html).toContain("line one\nline &lt;two&gt; &amp;amp; &quot;three&quot;</textarea>");
      // No hydration markers inside the text a browser shows.
      expect(html).not.toContain("<!--");
    },
    read: (root) => first<HTMLTextAreaElement>(root, "textarea").value,
    show: (value) => value,
  },
];

const hosts: HTMLElement[] = [];
function host(html = ""): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  document.body.append(el);
  hosts.push(el);
  return el;
}
afterEach(() => {
  for (const h of hosts.splice(0)) h.remove();
});
function comments(root: Node): number {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  let n = 0;
  while (walker.nextNode()) n += 1;
  return n;
}

type App = { App: (props: { v: () => unknown }) => unknown };

describe("controlled form controls: server markup, hydration, updates", () => {
  const id = (index: number, mode: "direct" | "spread"): string =>
    `[SSH-${String(5 + index * 2 + (mode === "direct" ? 0 : 1)).padStart(2, "0")}]`;
  for (const [index, control] of CONTROLS.entries()) {
    for (const mode of ["direct", "spread"] as const) {
      it(`${id(index, mode)} ${control.name} (${mode}): the server shows the state, hydrate adopts the nodes, updates follow`, async () => {
        const source = `export const App = (props) => <form>${control[mode]}</form>;`;
        const ssr = await load<App>(source, "ssr");
        const dom = await load<App>(source, "dom");
        const [v, setV] = useSignal<unknown>(control.initial);

        const html = renderToString(() => createComponent(ssr.App, { v }));
        control.markup(html);
        const el = host(html);
        // Before any script runs, the markup alone shows the signal's state.
        expect((control.served ?? control.read)(el)).toEqual(control.show(control.initial));
        const nodes = Array.from(el.querySelectorAll("*"));

        hydrate(() => createComponent(dom.App, { v }), el);
        expect(Array.from(el.querySelectorAll("*"))).toEqual(nodes);
        for (const [position, node] of nodes.entries()) {
          expect(el.querySelectorAll("*")[position]).toBe(node);
        }
        expect(comments(el)).toBe(0);
        expect(control.read(el)).toEqual(control.show(control.initial));

        flushSync(() => setV(control.next));
        expect(control.read(el)).toEqual(control.show(control.next));
        flushSync(() => setV(control.initial));
        expect(control.read(el)).toEqual(control.show(control.initial));

        // A client render of the same source ends in the same state.
        const client = host();
        render(() => createComponent(dom.App, { v }), client);
        expect(control.read(client)).toEqual(control.show(control.initial));
        flushSync(() => setV(control.next));
        expect(control.read(client)).toEqual(control.show(control.next));
        expect(control.read(el)).toEqual(control.show(control.next));
      });
    }
  }

  it("[SSH-19] a select built from a list with optgroups hydrates with the same selection", async () => {
    const source = `
      import { For } from "@shadow-js/web";
      export const App = (props) => (
        <select value={props.v()}>
          <For each={props.groups}>
            {(group) => (
              <optgroup label={group.label}>
                <For each={group.items}>{(item) => <option value={item.id}>{item.name}</option>}</For>
              </optgroup>
            )}
          </For>
        </select>
      );`;
    const ssr = await load<{ App: (props: Record<string, unknown>) => unknown }>(source, "ssr");
    const dom = await load<{ App: (props: Record<string, unknown>) => unknown }>(source, "dom");
    const groups = [
      {
        label: "Fruit",
        items: [
          { id: "a", name: "Apple <b>" },
          { id: "b", name: "Banana" },
        ],
      },
      {
        label: "Veg",
        items: [
          { id: 'c"d', name: "Carrot" },
          { id: "e", name: "Eggplant" },
        ],
      },
    ];
    const [v, setV] = useSignal('c"d');
    const html = renderToString(() => createComponent(ssr.App, { groups, v }));
    expect(html).toContain("Apple &lt;b&gt;");
    expect(html).toMatch(/<option data-hk="[^"]*" value="c&quot;d" selected>/);
    expect(html.match(/ selected/g)).toHaveLength(1);
    const el = host(html);
    const select = first<HTMLSelectElement>(el, "select");
    hydrate(() => createComponent(dom.App, { groups, v }), el);
    expect(first<HTMLSelectElement>(el, "select")).toBe(select);
    expect(select.value).toBe('c"d');
    expect(comments(el)).toBe(0);
    flushSync(() => setV("a"));
    expect(select.value).toBe("a");
  });

  it("[SSH-20] a null value selects the option with an empty value and stays hydratable", async () => {
    const source = `export const App = (props) => <select value={props.v()}><option value="">none</option><option value="a">A</option></select>;`;
    const ssr = await load<App>(source, "ssr");
    const dom = await load<App>(source, "dom");
    const [v, setV] = useSignal<unknown>(null);
    const html = renderToString(() => createComponent(ssr.App, { v }));
    expect(html).toContain('<option value="" selected>');
    const el = host(html);
    hydrate(() => createComponent(dom.App, { v }), el);
    expect(first<HTMLSelectElement>(el, "select").value).toBe("");
    flushSync(() => setV("a"));
    expect(first<HTMLSelectElement>(el, "select").value).toBe("a");
  });

  it("[SSH-21] a hostile value is only compared: it never reaches the markup", async () => {
    const source = `export const App = (props) => <select value={props.v()}><option value="a">A</option></select>;`;
    const ssr = await load<App>(source, "ssr");
    const hostile = `a"><img src=x onerror=alert(1)>`;
    const html = renderToString(() => createComponent(ssr.App, { v: () => hostile }));
    expect(html).not.toContain("<img");
    expect(html).not.toContain(" selected");
  });
});

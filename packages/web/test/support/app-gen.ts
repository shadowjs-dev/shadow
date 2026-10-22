import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compile } from "../../../compiler/src/javascript";

/**
 * Generates large multi-file ShadowJS apps from a random SPEC and renders the same spec with an
 * independent reference interpreter. The test then drives random signal updates and compares the
 * real DOM (real compiler + real runtime) with the oracle after every flush.
 */

export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type PropVal = { k: "lit"; v: number } | { k: "sig"; id: number };

export type Node =
  | { k: "text"; v: string }
  | { k: "el"; tag: string; cls: string; children: Node[] }
  | { k: "sig"; id: number }
  | { k: "show"; id: number; mod: number; yes: Node[]; other: Node[] }
  | { k: "switch"; id: number; cases: Node[][]; other: Node[] }
  | { k: "for"; id: number; item: Node[] }
  | { k: "item" }
  | { k: "idx" }
  | { k: "comp"; ref: number; a: PropVal; children: Node[] }
  | { k: "prop" }
  | { k: "children" }
  | { k: "provide"; v: number; children: Node[] }
  | { k: "consume" };

export interface Spec {
  signals: number;
  lists: number;
  components: Node[][];
  root: Node[];
}

const TAGS = ["div", "span", "section", "article", "aside", "main"];

export interface GenConfig {
  components: number;
  signals: number;
  lists: number;
  /** Maximum nesting depth of a single body (components add more depth through calls). */
  depth: number;
  width: number;
}

export function generateSpec(seed: number, config: GenConfig): Spec {
  const rnd = prng(seed);
  const int = (n: number): number => Math.floor(rnd() * n);
  const pick = <T>(list: readonly T[]): T => list[int(list.length)] as T;

  function nodes(depth: number, limit: number, inComponent: number, inFor: boolean): Node[] {
    const out: Node[] = [];
    const count = 1 + int(config.width);
    for (let i = 0; i < count; i += 1) out.push(node(depth, limit, inComponent, inFor));
    return out;
  }

  function node(depth: number, limit: number, inComponent: number, inFor: boolean): Node {
    const leaf = depth >= limit;
    const roll = rnd();
    if (leaf || roll < 0.18) {
      const r = rnd();
      if (inFor && r < 0.3) return { k: "item" };
      if (inFor && r < 0.4) return { k: "idx" };
      if (r < 0.7) return { k: "sig", id: int(config.signals) };
      if (inComponent >= 0 && r < 0.78) return { k: "prop" };
      return { k: "text", v: pick(["a", "b", "x y", "<&>", "é", "0"]) };
    }
    if (roll < 0.4) {
      return {
        k: "el",
        tag: pick(TAGS),
        cls: pick(["k1", "k2", "k3"]),
        children: nodes(depth + 1, limit, inComponent, inFor),
      };
    }
    if (roll < 0.52) {
      return {
        k: "show",
        id: int(config.signals),
        mod: 2 + int(3),
        yes: nodes(depth + 1, limit, inComponent, inFor),
        other: rnd() < 0.5 ? nodes(depth + 1, limit, inComponent, inFor) : [],
      };
    }
    if (roll < 0.6) {
      return {
        k: "switch",
        id: int(config.signals),
        cases: [0, 1, 2].map(() => nodes(depth + 1, limit, inComponent, inFor)),
        other: nodes(depth + 1, limit, inComponent, inFor),
      };
    }
    if (roll < 0.7 && !inFor) {
      return { k: "for", id: int(config.lists), item: nodes(depth + 1, limit, inComponent, true) };
    }
    if (roll < 0.76) {
      return {
        k: "provide",
        v: int(5),
        children: nodes(depth + 1, limit, inComponent, inFor),
      };
    }
    if (roll < 0.8) return { k: "consume" };
    if (inComponent >= 0 && rnd() < 0.15) return { k: "children" };
    return { k: "text", v: "t" };
  }

  // Bodies first, then calls from the last component to the first so every callee's expanded
  // size is known; extra calls are only added while the expansion stays bounded.
  const components: Node[][] = [];
  for (let c = 0; c < config.components; c += 1) components.push(nodes(0, config.depth, c, false));
  const sizes: number[] = Array.from({ length: config.components }, () => 0);
  const count = (list: Node[]): number => {
    let total = 0;
    for (const n of list) {
      total += 1;
      if (n.k === "el" || n.k === "provide") total += count(n.children);
      else if (n.k === "show") total += count(n.yes) + count(n.other);
      else if (n.k === "switch")
        total += n.cases.reduce((x, c) => x + count(c), 0) + count(n.other);
      else if (n.k === "for") total += 6 * count(n.item);
      else if (n.k === "comp") total += count(n.children) + (sizes[n.ref] ?? 0);
    }
    return total;
  };
  const CAP = 400;
  for (let c = config.components - 1; c >= 0; c -= 1) {
    const body = components[c] as Node[];
    if (c + 1 < config.components) {
      const wanted = 1 + int(3);
      for (let k = 0; k < wanted; k += 1) {
        const ref = c + 1 + int(Math.min(config.components - c - 1, 6));
        // The first call always happens (deep chains); extra calls only while size stays small.
        if (k > 0 && count(body) + (sizes[ref] ?? 0) > CAP) continue;
        const a: PropVal =
          rnd() < 0.5 ? { k: "lit", v: int(6) } : { k: "sig", id: int(config.signals) };
        body.splice(int(body.length + 1), 0, {
          k: "comp",
          ref,
          a,
          children: rnd() < 0.5 ? nodes(1, Math.min(config.depth, 3), -1, false) : [],
        });
      }
    }
    sizes[c] = count(body);
  }
  const root: Node[] = [];
  for (let i = 0; i < 3; i += 1) {
    root.push({
      k: "comp",
      ref: int(Math.min(4, config.components)),
      a: { k: "lit", v: i },
      children: nodes(1, 2, -1, false),
    });
  }
  return { signals: config.signals, lists: config.lists, components, root };
}

// ---------- oracle ----------

interface Env {
  s: number[];
  l: number[][];
  prop: number | undefined;
  children: (ctx: number) => string;
  item: number | undefined;
  idx: number | undefined;
  ctx: number;
}

const escapeText = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function oracle(
  spec: Spec,
  env: Omit<Env, "prop" | "children" | "item" | "idx" | "ctx">,
): string {
  const render = (list: Node[], e: Env): string => list.map((n) => one(n, e)).join("");
  const one = (n: Node, e: Env): string => {
    switch (n.k) {
      case "text":
        return escapeText(n.v);
      case "el":
        return `<${n.tag} class="${n.cls}">${render(n.children, e)}</${n.tag}>`;
      case "sig":
        return String(e.s[n.id]);
      case "show":
        return render((e.s[n.id] as number) % n.mod === 0 ? n.yes : n.other, e);
      case "switch": {
        const v = e.s[n.id] as number;
        const chosen = v >= 0 && v <= 2 ? (n.cases[v] as Node[]) : n.other;
        return render(chosen, e);
      }
      case "for":
        return (e.l[n.id] as number[])
          .map((x, i) => `<li data-x="${x}">${render(n.item, { ...e, item: x, idx: i })}</li>`)
          .join("");
      case "item":
        return String(e.item);
      case "idx":
        return String(e.idx);
      case "comp": {
        const value = n.a.k === "lit" ? n.a.v : (e.s[n.a.id] as number);
        // Children are evaluated where the callee reads them, so they see that position's context.
        const callSite = e;
        const children = (ctx: number): string => render(n.children, { ...callSite, ctx });
        const body = spec.components[n.ref] as Node[];
        return `<div class="c${n.ref}">${render(body, { ...e, prop: value, children, item: undefined, idx: undefined })}</div>`;
      }
      case "prop":
        return String(e.prop);
      case "children":
        return e.children(e.ctx);
      case "provide":
        return render(n.children, { ...e, ctx: n.v });
      case "consume":
        return `<i>${e.ctx}</i>`;
    }
  };
  const base: Env = {
    ...env,
    prop: undefined,
    children: () => "",
    item: undefined,
    idx: undefined,
    ctx: 0,
  };
  return render(spec.root, base);
}

// ---------- emit ----------

const header = (
  imports: string,
): string => `import { Show, For, Switch, Match } from "@shadow-js/web";
import { S, Ctx, useCtxValue } from "./state";
${imports}
`;

function emitNodes(list: Node[], inFor: boolean): string {
  return list.map((n) => emitNode(n, inFor)).join("");
}

function emitNode(n: Node, inFor: boolean): string {
  switch (n.k) {
    case "text":
      return `{${JSON.stringify(n.v)}}`;
    case "el":
      return `<${n.tag} class="${n.cls}">${emitNodes(n.children, inFor)}</${n.tag}>`;
    case "sig":
      return `{S.s[${n.id}]()}`;
    case "show": {
      const fallback = n.other.length > 0 ? ` fallback={<>${emitNodes(n.other, inFor)}</>}` : "";
      return `<Show when={S.s[${n.id}]() % ${n.mod} === 0}${fallback}>${emitNodes(n.yes, inFor)}</Show>`;
    }
    case "switch": {
      const cases = n.cases
        .map((c, i) => `<Match when={S.s[${n.id}]() === ${i}}>${emitNodes(c, inFor)}</Match>`)
        .join("");
      return `<Switch fallback={<>${emitNodes(n.other, inFor)}</>}>${cases}</Switch>`;
    }
    case "for":
      return `<For each={S.l[${n.id}]()}>{(x, i) => <li data-x={x}>${emitNodes(n.item, true)}</li>}</For>`;
    case "item":
      return "{x}";
    case "idx":
      return "{i()}";
    case "comp": {
      const a = n.a.k === "lit" ? `{${n.a.v}}` : `{S.s[${n.a.id}]()}`;
      return `<C${n.ref} a=${a}>${emitNodes(n.children, inFor)}</C${n.ref}>`;
    }
    case "prop":
      return "{props.a}";
    case "children":
      return "{props.children}";
    case "provide":
      return `<Ctx value={${n.v}}>${emitNodes(n.children, inFor)}</Ctx>`;
    case "consume":
      return "<i>{useCtxValue()}</i>";
  }
}

const STATE = (
  signals: number,
  lists: number,
): string => `import { createContext, useContext, useSignal } from "@shadow-js/core";
const signals = Array.from({ length: ${signals} }, () => useSignal(0));
const lists = Array.from({ length: ${lists} }, () => useSignal<number[]>([]));
export const S = {
  s: signals.map(([get]) => get),
  l: lists.map(([get]) => get),
  setS: signals.map(([, set]) => set),
  setL: lists.map(([, set]) => set),
};
export const Ctx = createContext(0);
export const useCtxValue = () => useContext(Ctx);
`;

function referencedComponents(list: Node[], out: Set<number>): void {
  for (const n of list) {
    if (n.k === "comp") {
      out.add(n.ref);
      referencedComponents(n.children, out);
    } else if (n.k === "el" || n.k === "provide") referencedComponents(n.children, out);
    else if (n.k === "show") {
      referencedComponents(n.yes, out);
      referencedComponents(n.other, out);
    } else if (n.k === "switch") {
      for (const c of n.cases) referencedComponents(c, out);
      referencedComponents(n.other, out);
    } else if (n.k === "for") referencedComponents(n.item, out);
  }
}

export interface Emitted {
  directory: string;
  rootFile: string;
  stateFile: string;
  files: number;
}

/** Writes the compiled app to `directory` (one module per component) and returns its entry paths. */
export function emitApp(spec: Spec, directory: string): Emitted {
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  const write = (name: string, source: string): void => {
    const result = compile(source, { filename: `${name}.tsx`, generate: "dom" });
    writeFileSync(join(directory, `${name}.ts`), result.code);
  };
  writeFileSync(join(directory, "state.ts"), STATE(spec.signals, spec.lists));
  spec.components.forEach((body, index) => {
    const refs = new Set<number>();
    referencedComponents(body, refs);
    const imports = [...refs].map((r) => `import { C${r} } from "./c${r}";`).join("\n");
    write(
      `c${index}`,
      `${header(imports)}export const C${index} = (props: { a: number; children?: unknown }) => (<div class="c${index}">${emitNodes(body, false)}</div>);\n`,
    );
  });
  const refs = new Set<number>();
  referencedComponents(spec.root, refs);
  const imports = [...refs].map((r) => `import { C${r} } from "./c${r}";`).join("\n");
  write(
    "root",
    `${header(imports)}export const Root = () => (<>${emitNodes(spec.root, false)}</>);\n`,
  );
  return {
    directory,
    rootFile: join(directory, "root.ts"),
    stateFile: join(directory, "state.ts"),
    files: spec.components.length + 2,
  };
}

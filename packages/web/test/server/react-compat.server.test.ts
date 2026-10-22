import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compile } from "../../../compiler/src/javascript";
import { createComponent, renderToString } from "../../src/server/index";

type Component = (props: Record<string, unknown>) => unknown;

const dir = join(import.meta.dirname, ".generated");

/** Compiles React-spelled JSX with the SSR generator and imports the module, as user code runs. */
async function load(source: string): Promise<Record<string, Component>> {
  mkdirSync(dir, { recursive: true });
  const { code } = compile(source, { filename: "case.tsx", generate: "ssr" });
  const name = `react-${createHash("sha1").update(source).digest("hex").slice(0, 12)}.ts`;
  writeFileSync(join(dir, name), code);
  return (await import(/* @vite-ignore */ join(dir, name))) as Record<string, Component>;
}

/** Renders a named export with its props, as a page root. */
function page(mod: Record<string, Component>, name: string, props: Record<string, unknown> = {}) {
  const component = mod[name];
  if (component === undefined) throw new Error(`no export ${name}`);
  return renderToString(() => createComponent(component, props));
}

describe("React-spelled attributes on the server", () => {
  it("[RCW-SSR-01] SVG presentation names are hyphenated, static and dynamic", async () => {
    const mod = await load(
      'export const App = (p) => <svg><path strokeWidth="2" fillOpacity={p.f} /></svg>;',
    );
    const out = page(mod, "App", { f: 0.5 });
    expect(out).toContain('stroke-width="2"');
    expect(out).toContain('fill-opacity="0.5"');
    expect(out).not.toMatch(/strokeWidth|fillOpacity/);
  });

  it("[RCW-SSR-02] xlinkHref and HTML names (colSpan, cellPadding, httpEquiv) are written as the markup names", async () => {
    const mod = await load(
      'export const App = (p) => <div><svg><use xlinkHref={p.id} /></svg><table><tbody><tr><td colSpan={2} cellPadding="1" /></tr></tbody></table></div>;',
    );
    const out = page(mod, "App", { id: "#a" });
    expect(out).toContain('xlink:href="#a"');
    expect(out).toContain('colspan="2"');
    expect(out).toContain('cellpadding="1"');
  });

  it("[RCW-SSR-03] a spread on an SVG element uses the SVG names (presentation hyphenated, viewBox kept)", async () => {
    const mod = await load(
      'export const App = (p) => <svg viewBox="0 0 1 1"><path {...p.props} /></svg>;',
    );
    const out = page(mod, "App", { props: { strokeWidth: 3, fillRule: "evenodd" } });
    expect(out).toContain('stroke-width="3"');
    expect(out).toContain('fill-rule="evenodd"');
    expect(out).toContain('viewBox="0 0 1 1"');
  });

  it("[RCW-SSR-04] a spread on an HTML element lower-cases its React names", async () => {
    const mod = await load("export const App = (p) => <label {...p.props}>x</label>;");
    const out = page(mod, "App", { props: { className: "a", htmlFor: "f", tabIndex: 1 } });
    expect(out).toContain('class="a"');
    expect(out).toContain('for="f"');
    expect(out).toContain('tabindex="1"');
  });

  it("[RCW-SSR-05] key, suppressHydrationWarning and event props write nothing", async () => {
    const mod = await load(
      "export const App = (p) => <input key={p.id} suppressHydrationWarning onChange={p.h} onFocusCapture={p.h} />;",
    );
    const out = page(mod, "App", { id: "a", h: () => undefined });
    expect(out).not.toMatch(/key|suppress|onChange|onFocus/);
    expect(out).not.toMatch(/passive/);
  });

  it("[RCW-SSR-09] dangerouslySetInnerHTML in a spread writes its markup raw, and key is dropped", async () => {
    const mod = await load('export const App = (p) => <div key="x" {...p.props} />;');
    const out = page(mod, "App", {
      props: { dangerouslySetInnerHTML: { __html: "<em>y</em>" }, key: "z" },
    });
    expect(out).toContain("><em>y</em></div>");
    expect(out).not.toMatch(/key|z"/);
  });

  it("[RCW-SSR-06] dangerouslySetInnerHTML writes its markup raw", async () => {
    const mod = await load(
      "export const App = (p) => <div dangerouslySetInnerHTML={{ __html: p.html }} />;",
    );
    expect(page(mod, "App", { html: "<b>x</b>" })).toContain("><b>x</b></div>");
  });
});

describe("style numbers on the server", () => {
  it("[RCW-SSR-07] a number gets px unless it is unitless, zero or a custom property", async () => {
    const mod = await load(
      'export const App = (p) => <div style={{ minWidth: p.w, opacity: 0.5, zIndex: 2, paddingTop: 0, "--gap": 4, WebkitLineClamp: 3, marginTop: "3em" }} />;',
    );
    const out = page(mod, "App", { w: 3 });
    expect(out).toContain(
      'style="min-width:3px;opacity:0.5;z-index:2;padding-top:0;--gap:4;-webkit-line-clamp:3;margin-top:3em"',
    );
  });

  it("[RCW-SSR-08] a style spread follows the same rule", async () => {
    const mod = await load("export const App = (p) => <div {...p.props} />;");
    const out = page(mod, "App", { props: { style: { width: 2, flexGrow: 1 } } });
    expect(out).toContain('style="width:2px;flex-grow:1"');
  });
});

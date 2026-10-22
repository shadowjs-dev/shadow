/** Collision-free import aliases and hoisted templates for one compiled module. */
export class Registry {
  private readonly imports = new Map<string, string>();
  private readonly templates = new Map<string, string>();
  private readonly locals = new Map<string, string>();
  private readonly templateDecls: string[] = [];
  readonly delegated: Set<string> = new Set<string>();
  private readonly taken: Set<string>;
  private templateCount = 0;
  private partsCount = 0;
  readonly moduleName: string;

  constructor(taken: Set<string>, moduleName: string) {
    this.taken = taken;
    this.moduleName = moduleName;
  }

  /** Local alias for a runtime helper; records the import (`from` overrides the module). */
  helper(name: string, from?: string): string {
    const key = from === undefined ? name : `${from}\u0000${name}`;
    const existing = this.imports.get(key);
    if (existing !== undefined) return existing;
    let alias = `_$${name}`;
    let n = 1;
    while (this.taken.has(alias)) {
      n += 1;
      alias = `_$${name}${n}`;
    }
    this.taken.add(alias);
    this.imports.set(key, alias);
    return alias;
  }

  /** A unique module-level variable name (no import). Stable per base name. */
  local(base: string): string {
    const existing = this.locals.get(base);
    if (existing !== undefined) return existing;
    let name = base;
    while (this.taken.has(name)) name = `${name}_`;
    this.taken.add(name);
    this.locals.set(base, name);
    return name;
  }

  /** Hoisted template variable for an HTML string; identical strings share one template. */
  template(html: string, flags: number): string {
    const key = `${flags}|${html}`;
    const existing = this.templates.get(key);
    if (existing !== undefined) return existing;
    this.templateCount += 1;
    let name = this.templateCount === 1 ? "_tmpl$" : `_tmpl$${this.templateCount}`;
    while (this.taken.has(name)) name = `${name}_`;
    this.taken.add(name);
    this.templates.set(key, name);
    const make = this.helper("template");
    const args = flags === 0 ? JSON.stringify(html) : `${JSON.stringify(html)}, ${flags}`;
    this.templateDecls.push(`const ${name} = /*#__PURE__*/ ${make}(${args});`);
    return name;
  }

  /** Hoisted static string array for an SSR template; returns its variable name. */
  hoistParts(statics: string[]): string {
    const key = `ssr|${JSON.stringify(statics)}`;
    const existing = this.templates.get(key);
    if (existing !== undefined) return existing;
    this.partsCount += 1;
    let name = `_ssr$${this.partsCount === 1 ? "" : this.partsCount}`;
    while (this.taken.has(name)) name = `${name}_`;
    this.taken.add(name);
    this.templates.set(key, name);
    this.templateDecls.push(`const ${name} = ${JSON.stringify(statics)};`);
    return name;
  }

  /** Import statement plus hoisted template declarations; empty when nothing was generated. */
  prelude(): string {
    if (this.imports.size === 0) return "";
    const byModule = new Map<string, string[]>();
    for (const [key, alias] of this.imports) {
      const split = key.indexOf("\u0000");
      const module = split === -1 ? this.moduleName : key.slice(0, split);
      const name = split === -1 ? key : key.slice(split + 1);
      const list = byModule.get(module);
      if (list === undefined) byModule.set(module, [`${name} as ${alias}`]);
      else list.push(`${name} as ${alias}`);
    }
    const lines = [...byModule].map(
      ([module, specifiers]) =>
        `import { ${specifiers.join(", ")} } from ${JSON.stringify(module)};`,
    );
    lines.push(...this.templateDecls);
    return `${lines.join("\n")}\n`;
  }

  /** Statement registering delegated events, appended to the module end. */
  epilogue(): string {
    if (this.delegated.size === 0) return "";
    const names = [...this.delegated].sort().map((n) => JSON.stringify(n));
    return `\n${this.helper("delegateEvents")}([${names.join(", ")}]);\n`;
  }
}

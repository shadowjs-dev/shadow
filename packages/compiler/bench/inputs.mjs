/**
 * The modules the compiler benchmark compiles: one component, fifty, and a thousand (about a
 * hundred thousand lines). They are written in plain JSX so that every contender accepts them, and
 * built from twelve component shapes (counter, form, table, card, navigation, dialog, chart,
 * tabs, pricing grid, footer, list, dashboard) with a pseudo-random but fixed choice of text,
 * attributes and number of rows, so the same module is generated on every run.
 */

/** A small deterministic PRNG (mulberry32). */
function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = [
  "alpha",
  "bravo",
  "delta",
  "echo",
  "foxtrot",
  "gamma",
  "hotel",
  "india",
  "juliet",
  "kilo",
  "lima",
  "metro",
  "nova",
  "orbit",
  "pixel",
  "quartz",
  "radar",
  "sierra",
  "tango",
  "umbra",
  "vector",
  "wave",
];

/** Components are about a hundred lines long on average: the row counts are scaled up. */
const SCALE = 4;

function build(name, random) {
  const pick = (list) => list[Math.floor(random() * list.length)];
  const word = () => pick(WORDS);
  const rows = (min, max) => SCALE * (min + Math.floor(random() * (max - min + 1)));
  const lines = [];
  const add = (text) => lines.push(text);

  const shapes = [
    function counter() {
      add(`export function ${name}(props) {`);
      add("  const [count, setCount] = useStore(0);");
      add("  const double = count() * 2;");
      add(`  const label = props.label ?? "${word()}";`);
      add("  return (");
      add(`    <div class="counter ${word()}" data-id="${name}">`);
      add(`      <h2 class={props.active ? "title active" : "title"}>{label} counter</h2>`);
      add("      <p>");
      add("        Count is {count()} and twice that is {double}");
      add("      </p>");
      add('      <div class="buttons">');
      add(
        '        <button type="button" onClick={() => setCount((n) => n + 1)}>Increment</button>',
      );
      add(
        '        <button type="button" onClick={() => setCount((n) => n - 1)} disabled={count() <= 0}>Decrement</button>',
      );
      add('        <button type="button" onClick={() => setCount(0)}>Reset</button>');
      add("      </div>");
      add(`      {count() > 10 ? <strong class="warn">${word()} limit reached</strong> : null}`);
      add("    </div>");
      add("  );");
      add("}");
    },
    function list() {
      add(`export function ${name}(props) {`);
      add("  const [items, setItems] = useStore([]);");
      add('  const [filter, setFilter] = useStore("");');
      add("  const visible = items().filter((item) => item.title.includes(filter()));");
      add("  return (");
      add(`    <section class="list ${word()}">`);
      add("      <header>");
      add(`        <h3>${word()} items ({visible.length})</h3>`);
      add(
        '        <input type="search" value={filter()} onInput={(event) => setFilter(event.currentTarget.value)} placeholder="Filter" />',
      );
      add("      </header>");
      add("      <ul>");
      add("        <For each={visible}>");
      add("          {(item) => (");
      add(
        '            <li class={item.done ? "done" : "open"} onClick={() => props.onSelect(item)}>',
      );
      add(
        '              <input type="checkbox" checked={item.done} onChange={() => props.onToggle(item)} />',
      );
      add('              <span class="title">{item.title}</span>');
      add("              <small>{item.when}</small>");
      add(
        '              <button type="button" aria-label="Remove" onClick={() => props.onRemove(item)}>x</button>',
      );
      add("            </li>");
      add("          )}");
      add("        </For>");
      add("      </ul>");
      add('      {visible.length === 0 && <p class="empty">Nothing here yet.</p>}');
      add("    </section>");
      add("  );");
      add("}");
    },
    function form() {
      const fields = rows(4, 9);
      add(`export function ${name}(props) {`);
      add("  const [values, setValues] = useStore({});");
      add("  const [errors, setErrors] = useStore({});");
      add("  const submit = (event) => {");
      add("    event.preventDefault();");
      add("    props.onSubmit(values());");
      add("  };");
      add("  return (");
      add(`    <form class="form ${word()}" onSubmit={submit} novalidate>`);
      for (let i = 0; i < fields; i += 1) {
        const field = `${word()}${i}`;
        add(`      <label class="field" for="${field}">`);
        add(`        <span>${field} label</span>`);
        add(
          `        <input id="${field}" name="${field}" type="${pick(["text", "email", "number", "tel"])}" value={values().${field} ?? ""} onInput={(event) => setValues({ ...values(), ${field}: event.currentTarget.value })} required />`,
        );
        add(`        {errors().${field} ? <em class="error">{errors().${field}}</em> : null}`);
        add("      </label>");
      }
      add('      <label class="field">');
      add("        <span>Choice</span>");
      add(
        "        <select value={values().choice} onChange={(event) => setValues({ ...values(), choice: event.currentTarget.value })}>",
      );
      add('          <option value="a">First</option>');
      add('          <option value="b">Second</option>');
      add('          <option value="c">Third</option>');
      add("        </select>");
      add("      </label>");
      add(
        '      <textarea rows="3" value={values().note ?? ""} onInput={(event) => setValues({ ...values(), note: event.currentTarget.value })} />',
      );
      add('      <button type="submit" class="primary">Save</button>');
      add("    </form>");
      add("  );");
      add("}");
    },
    function table() {
      const columns = rows(3, 7);
      add(`export function ${name}(props) {`);
      add('  const [sort, setSort] = useStore({ key: "id", direction: 1 });');
      add(
        "  const sorted = props.rows.slice().sort((a, b) => (a[sort().key] > b[sort().key] ? 1 : -1) * sort().direction);",
      );
      add("  return (");
      add(`    <table class="table ${word()}">`);
      add("      <thead>");
      add("        <tr>");
      for (let i = 0; i < columns; i += 1) {
        add(
          `          <th onClick={() => setSort({ key: "${word()}${i}", direction: -sort().direction })}>${word()} ${i}</th>`,
        );
      }
      add("        </tr>");
      add("      </thead>");
      add("      <tbody>");
      add("        <For each={sorted}>");
      add("          {(row) => (");
      add('            <tr class={row.selected ? "selected" : ""}>');
      for (let i = 0; i < columns; i += 1) {
        add(`              <td>{row.${word()}${i}}</td>`);
      }
      add("            </tr>");
      add("          )}");
      add("        </For>");
      add("      </tbody>");
      add("      <tfoot>");
      add(`        <tr><td colspan="${columns}">{props.rows.length} rows</td></tr>`);
      add("      </tfoot>");
      add("    </table>");
      add("  );");
      add("}");
    },
    function card() {
      add(
        `export function ${name}({ title, subtitle = "${word()}", children, tone = "plain", ...rest }) {`,
      );
      add("  return (");
      add(`    <article class={\`card card-\${tone}\`} {...rest}>`);
      add('      <svg class="icon" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">');
      add(
        `        <path d="M12 2 L22 22 L2 22 Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />`,
      );
      add(`        <circle cx="12" cy="14" r="${rows(2, 6)}" fill="currentColor" />`);
      add("      </svg>");
      add('      <h3 class="card-title">{title}</h3>');
      add('      <p class="card-subtitle">{subtitle}</p>');
      add('      <div class="card-body">{children}</div>');
      add("      <footer>");
      add(`        <a href="/${word()}/more" class="link">Read more &rarr;</a>`);
      add(`        <small>&copy; 2026 ${word()}</small>`);
      add("      </footer>");
      add("    </article>");
      add("  );");
      add("}");
    },
    function nav() {
      const links = rows(4, 8);
      add(`export function ${name}(props) {`);
      add("  const current = () => props.location.pathname;");
      add("  return (");
      add(`    <nav class="nav ${word()}" aria-label="Main">`);
      add('      <a href="/" class="brand">Home</a>');
      add("      <ul>");
      for (let i = 0; i < links; i += 1) {
        add(
          `        <li><a href="/${word()}${i}" class={current() === "/${word()}${i}" ? "active" : ""}>${word()} ${i}</a></li>`,
        );
      }
      add("      </ul>");
      add("      {props.user ? (");
      add(
        '        <button type="button" onClick={props.onSignOut}>Sign out {props.user.name}</button>',
      );
      add("      ) : (");
      add('        <a href="/login">Sign in</a>');
      add("      )}");
      add("    </nav>");
      add("  );");
      add("}");
    },
    function dialog() {
      add(`export function ${name}(props) {`);
      add("  const [open, setOpen] = useStore(false);");
      add("  return (");
      add("    <>");
      add(`      <button type="button" onClick={() => setOpen(true)}>${word()}</button>`);
      add("      <Show when={open()}>");
      add('        <div class="backdrop" onClick={() => setOpen(false)}>');
      add(
        '          <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="title" onClick={(event) => event.stopPropagation()}>',
      );
      add('            <h2 id="title">{props.title}</h2>');
      add('            <div class="content">{props.children}</div>');
      add('            <div class="actions">');
      add('              <button type="button" onClick={() => setOpen(false)}>Cancel</button>');
      add(
        '              <button type="button" class="primary" onClick={() => { props.onConfirm(); setOpen(false); }}>OK</button>',
      );
      add("            </div>");
      add("          </div>");
      add("        </div>");
      add("      </Show>");
      add("    </>");
      add("  );");
      add("}");
    },
    function chart() {
      const bars = rows(5, 14);
      add(`export function ${name}(props) {`);
      add("  const max = () => Math.max(...props.values);");
      add("  return (");
      add(`    <svg class="chart" viewBox="0 0 ${bars * 20} 100" role="img">`);
      add("      <title>{props.title}</title>");
      add('      <g transform="translate(0 0)">');
      for (let i = 0; i < bars; i += 1) {
        add(
          `        <rect x="${i * 20 + 2}" y={100 - (props.values[${i}] / max()) * 90} width="16" height={(props.values[${i}] / max()) * 90} fill="steelblue" />`,
        );
        add(
          `        <text x="${i * 20 + 10}" y="98" fontSize="6" textAnchor="middle">${word()}</text>`,
        );
      }
      add("      </g>");
      add("    </svg>");
      add("  );");
      add("}");
    },
    function tabs() {
      const tabs = rows(3, 6);
      add(`export function ${name}(props) {`);
      add("  const [active, setActive] = useStore(0);");
      add("  return (");
      add(`    <div class="tabs ${word()}">`);
      add('      <div role="tablist">');
      for (let i = 0; i < tabs; i += 1) {
        add(
          `        <button role="tab" type="button" aria-selected={active() === ${i}} class={active() === ${i} ? "tab on" : "tab"} onClick={() => setActive(${i})}>${word()} ${i}</button>`,
        );
      }
      add("      </div>");
      for (let i = 0; i < tabs; i += 1) {
        add(`      <Show when={active() === ${i}}>`);
        add(`        <div role="tabpanel"><p>${word()} panel ${i}: {props.texts[${i}]}</p></div>`);
        add("      </Show>");
      }
      add("    </div>");
      add("  );");
      add("}");
    },
    function pricing() {
      const plans = rows(3, 5);
      add(`export function ${name}() {`);
      add("  return (");
      add(`    <section class="pricing ${word()}">`);
      add("      <h2>Plans and pricing</h2>");
      add('      <div class="grid">');
      for (let i = 0; i < plans; i += 1) {
        add(`        <div class="plan plan-${i}">`);
        add(`          <h3>${word()} ${i}</h3>`);
        add(`          <p class="price">$${rows(5, 99)} <span>/ month</span></p>`);
        add("          <ul>");
        for (let j = 0; j < rows(3, 6); j += 1) {
          add(`            <li>${word()} ${word()} feature number ${j}</li>`);
        }
        add("          </ul>");
        add(`          <a class="button" href="/buy/${i}">Choose plan</a>`);
        add("        </div>");
      }
      add("      </div>");
      add("    </section>");
      add("  );");
      add("}");
    },
    function footer() {
      const columns = rows(3, 5);
      add(`export function ${name}() {`);
      add("  return (");
      add(`    <footer class="footer ${word()}">`);
      for (let i = 0; i < columns; i += 1) {
        add('      <div class="column">');
        add(`        <h4>${word()}</h4>`);
        add("        <ul>");
        for (let j = 0; j < rows(3, 7); j += 1) {
          add(`          <li><a href="/${word()}/${j}">${word()} ${word()}</a></li>`);
        }
        add("        </ul>");
        add("      </div>");
      }
      add(
        '      <p class="legal">Copyright 2026 &mdash; all rights reserved. Terms &amp; privacy.</p>',
      );
      add("    </footer>");
      add("  );");
      add("}");
    },
    function dashboard() {
      add(`export function ${name}(props) {`);
      add('  const [range, setRange] = useStore("week");');
      add("  const total = props.series.reduce((sum, value) => sum + value, 0);");
      add("  return (");
      add(`    <main class="dashboard ${word()}">`);
      add('      <Header title="Dashboard" user={props.user} onSignOut={props.onSignOut} />');
      add('      <Card title="Total" tone="strong" data-total={total}>');
      add('        <p class="big">{total}</p>');
      add("      </Card>");
      add('      <Card title="Range">');
      add(
        "        <select value={range()} onChange={(event) => setRange(event.currentTarget.value)}>",
      );
      add('          <option value="day">Day</option>');
      add('          <option value="week">Week</option>');
      add('          <option value="month">Month</option>');
      add("        </select>");
      add("      </Card>");
      add('      <Chart title="Series" values={props.series} />');
      add("      <DataTable rows={props.rows} {...props.tableProps} />");
      add("      <Footer />");
      add("    </main>");
      add("  );");
      add("}");
    },
  ];
  shapes[Math.floor(random() * shapes.length)]();
  return lines.join("\n");
}

/** A module of `count` components. */
export function makeModule(count, seed) {
  const random = createRandom(seed);
  const parts = [
    'import { useStore } from "@shadow-js/core";',
    'import { For, Show } from "@shadow-js/web";',
    'import { Header, Chart, DataTable, Footer } from "./shared";',
    "",
  ];
  for (let i = 0; i < count; i += 1) {
    parts.push(build(`Component${i}`, random));
    parts.push("");
  }
  return parts.join("\n");
}

/** The three benchmark inputs. */
export function makeInputs() {
  const specs = [
    { name: "small", components: 1, seed: 5 },
    { name: "medium", components: 50, seed: 11 },
    { name: "large", components: 1000, seed: 13 },
  ];
  return specs.map((spec) => {
    const source = makeModule(spec.components, spec.seed);
    return {
      name: spec.name,
      components: spec.components,
      filename: `${spec.name}.jsx`,
      source,
      lines: source.split("\n").length,
      bytes: Buffer.byteLength(source),
    };
  });
}

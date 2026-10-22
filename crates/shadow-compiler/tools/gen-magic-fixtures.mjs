// Generates crates/shadow-compiler/tests/fixtures/magic.jsonl with the REAL
// magic-string package. Each line is one case:
//   { original, source, includeContent, ops: [...], result: {ok, text, map, decoded} | {ok:false, error} }
//
// Ops carry both UTF-16 indexes (what JS uses) and UTF-8 byte offsets (what the
// Rust port uses), so the Rust test needs no conversion:
//   { op: "overwrite", start16, end16, start8, end8, content, swallow? }
//   { op: "appendLeft" | "appendRight", index16, index8, content, swallow? }
//   { op: "prepend" | "append", content }
// An op with `swallow: true` has its error ignored and the replay continues
// (this pins down the state left behind by a failed call, e.g. a split that
// happened before the failure). Any other error ends the case with
// { ok: false, error }.
//
// Run: node crates/shadow-compiler/tools/gen-magic-fixtures.mjs
// Deterministic: a seeded PRNG, so reruns produce a byte-identical file.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import MagicString from "../../../node_modules/magic-string/dist/index.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const outFile = resolve(here, "../tests/fixtures/magic.jsonl.gz");

// ---------------------------------------------------------------- PRNG ----
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(0x5eed1234);
const int = (n) => Math.floor(rand() * n);
const chance = (p) => rand() < p;
const pick = (arr) => arr[int(arr.length)];

// ------------------------------------------------------------ originals ---
const WORDS = [
  "foo",
  "bar",
  "baz",
  "const",
  "let",
  "return",
  "<div>",
  "</div>",
  "{x}",
  "a.b",
  "_id",
  "x1",
  "=",
  "=>",
  "(",
  ")",
  "{",
  "}",
  "[",
  "]",
  ";",
  ",",
  ".",
  '"s"',
  "'t'",
  "`u`",
  "//c",
  "/* c */",
  "<A b={c} />",
  "$1",
  "\\n",
  "Z9",
];
const WS_PLAIN = [" ", " ", " ", "  ", "\t", "\n", "\n", "\n\n", "\n  ", "\t\n"];
const WS_CRLF = [" ", "\r\n", "\r\n", "\r\n\r\n", "\r\n  ", "\t", "\r"];
const UNI = [
  "\u{1F600}",
  "\u00e9",
  "e\u0301",
  "\u65e5\u672c",
  "\u00f1",
  "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}",
  "\u00a0",
  "\u2028",
  "\u{1D4B3}",
  "\u05d0",
  "a\u030a",
  "\u{1F1E6}\u{1F1FA}",
  "\u0000",
];

function makeOriginal() {
  const kind = int(100);
  if (kind < 4) return "";
  if (kind < 8) return pick(["a", "\n", " ", "\u{1F600}", "e\u0301", "ab", "\r\n", "\t"]);
  const count = chance(0.1) ? 20 + int(60) : 1 + int(24);
  let s = "";
  const mode = int(6);
  for (let i = 0; i < count; i++) {
    if (mode === 0) {
      // plain ASCII, multi-line
      s += chance(0.55) ? pick(WORDS) : pick(WS_PLAIN);
    } else if (mode === 1) {
      // CRLF
      s += chance(0.55) ? pick(WORDS) : pick(WS_CRLF);
    } else if (mode === 2) {
      // unicode heavy
      s += chance(0.4) ? pick(UNI) : chance(0.5) ? pick(WORDS) : pick(WS_PLAIN);
    } else if (mode === 3) {
      // tabs and indentation (JSX-like)
      s += chance(0.5) ? pick(WORDS) : pick(["\t", "\n\t", "\n\t\t", " ", "\n"]);
    } else if (mode === 4) {
      // very short words, many boundaries
      s += pick(["a", "b", "1", "_", " ", "\n", "-", "+", ".", "\u{1F600}", "z9"]);
    } else {
      // everything
      const r = int(3);
      s += r === 0 ? pick(WORDS) : r === 1 ? pick(WS_PLAIN.concat(WS_CRLF)) : pick(UNI);
    }
  }
  return s;
}

// Boundary tables: every code point boundary as {p16, p8}.
function boundaries(str) {
  const out = [{ p16: 0, p8: 0 }];
  let p16 = 0;
  let p8 = 0;
  for (const ch of str) {
    p16 += ch.length;
    p8 += Buffer.byteLength(ch, "utf8");
    out.push({ p16, p8 });
  }
  return out;
}

const CONTENTS = [
  "",
  "",
  "x",
  "Y",
  "\n",
  "\n\n",
  "foo",
  "foo\n",
  "a\nb",
  "a\nb\n",
  "\nlead",
  "line1\nline2\nline3",
  "\u{1F600}",
  "caf\u00e9",
  "e\u0301\n",
  "$&",
  "\r\n",
  "tab\there",
  "(",
  "/*i*/",
  "_w",
  "word word",
  "\u{1F600}\n\u{1F600}",
  "end\n\n",
  "  ",
  "\u2028x",
  "a\u{1F600}b\nc",
];
const randContent = () => pick(CONTENTS);

// ----------------------------------------------------------------- ops ----
function applyOp(ms, op) {
  switch (op.op) {
    case "overwrite":
      ms.overwrite(op.start16, op.end16, op.content);
      break;
    case "appendLeft":
      ms.appendLeft(op.index16, op.content);
      break;
    case "appendRight":
      ms.appendRight(op.index16, op.content);
      break;
    case "prepend":
      ms.prepend(op.content);
      break;
    case "append":
      ms.append(op.content);
      break;
    default:
      throw new Error(`unknown op ${op.op}`);
  }
}

// Replays `ops`; returns null on success or the error message of the first
// non-swallowed failure.
function replay(original, ops) {
  const ms = new MagicString(original);
  for (const op of ops) {
    try {
      applyOp(ms, op);
    } catch (e) {
      if (op.swallow) continue;
      return { ms: null, error: e.message };
    }
  }
  return { ms, error: null };
}

const SOURCES = [
  "a.tsx",
  "dir/b.tsx",
  "C:\\x\\y.tsx",
  "",
  null,
  "src/deep/er/c.jsx",
  "/abs/d.tsx",
  "e",
];

function makeCase(builder) {
  const original = makeOriginal();
  const b = boundaries(original);
  const len16 = b[b.length - 1].p16;
  const len8 = b[b.length - 1].p8;
  const ctx = { original, b, len16, len8, used: [0, b.length - 1] };
  const ops = builder(ctx);
  const source = pick(SOURCES);
  const includeContent = !chance(0.1);
  return { original, source, includeContent, ops, len16, len8 };
}

// Index helpers over a context.
function randIdx(ctx) {
  // 30%: re-use an interesting earlier index so edits share boundaries.
  if (chance(0.3) && ctx.used.length) return pick(ctx.used);
  return int(ctx.b.length);
}
function mkOverwrite(ctx, lo, hi) {
  const s = ctx.b[lo];
  const e = ctx.b[hi];
  ctx.used.push(lo, hi);
  return {
    op: "overwrite",
    start16: s.p16,
    end16: e.p16,
    start8: s.p8,
    end8: e.p8,
    content: randContent(),
  };
}
function mkAppend(ctx, name, idx) {
  const p = ctx.b[idx];
  ctx.used.push(idx);
  return { op: name, index16: p.p16, index8: p.p8, content: randContent() };
}
function candidate(ctx) {
  const r = int(100);
  if (r < 42) {
    let a = randIdx(ctx);
    let c = randIdx(ctx);
    if (a === c) {
      if (c + 1 < ctx.b.length) c++;
      else if (a > 0) a--;
    }
    if (a > c) [a, c] = [c, a];
    return mkOverwrite(ctx, a, c);
  }
  if (r < 62) return mkAppend(ctx, "appendLeft", randIdx(ctx));
  if (r < 82) return mkAppend(ctx, "appendRight", randIdx(ctx));
  if (r < 91) return { op: "prepend", content: randContent() };
  return { op: "append", content: randContent() };
}

// Builders -----------------------------------------------------------------
// careful: only ops that succeed, built incrementally by trial replay.
function careful(ctx) {
  const n = 1 + int(10);
  const ops = [];
  for (let i = 0; i < n; i++) {
    for (let tries = 0; tries < 25; tries++) {
      const c = candidate(ctx);
      if (replay(ctx.original, ops.concat([c])).error === null) {
        ops.push(c);
        break;
      }
    }
  }
  return ops;
}

// chaos: arbitrary ops; some errors are swallowed so replay continues.
function chaos(ctx) {
  const n = 1 + int(10);
  const ops = [];
  for (let i = 0; i < n; i++) {
    const c = candidate(ctx);
    if (chance(0.4)) c.swallow = true;
    ops.push(c);
  }
  return ops;
}

// storm: many appendLeft/appendRight at one or two indexes, in many orders,
// optionally around an overwrite of a range that starts or ends there.
function storm(ctx) {
  const idxs = [pick([0, ctx.b.length - 1, int(ctx.b.length)]), int(ctx.b.length)];
  const ops = [];
  const n = 2 + int(8);
  for (let i = 0; i < n; i++) {
    const r = int(100);
    const idx = chance(0.7) ? idxs[0] : idxs[1];
    if (r < 40) ops.push(mkAppend(ctx, "appendLeft", idx));
    else if (r < 80) ops.push(mkAppend(ctx, "appendRight", idx));
    else if (r < 88) ops.push({ op: "prepend", content: randContent() });
    else if (r < 96) ops.push({ op: "append", content: randContent() });
    else {
      let a = idxs[0];
      const c = Math.min(ctx.b.length - 1, a + 1 + int(3));
      if (a === c && a > 0) a--;
      if (a !== c) {
        const o = mkOverwrite(ctx, Math.min(a, c), Math.max(a, c));
        if (replay(ctx.original, ops.concat([o])).error === null) ops.push(o);
      }
    }
  }
  return ops;
}

// partition: consecutive pieces, each overwritten (some deleted), with inserts
// at the shared boundaries, in forward / reverse / shuffled order.
function partition(ctx) {
  const last = ctx.b.length - 1;
  if (last < 1) return careful(ctx);
  const cuts = new Set([0, last]);
  const k = 1 + int(Math.min(6, last));
  for (let i = 0; i < k; i++) cuts.add(int(ctx.b.length));
  const sorted = [...cuts].sort((x, y) => x - y);
  const ops = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    if (chance(0.8)) ops.push(mkOverwrite(ctx, sorted[i], sorted[i + 1]));
    if (chance(0.5)) ops.push(mkAppend(ctx, pick(["appendLeft", "appendRight"]), sorted[i]));
    if (chance(0.3)) ops.push(mkAppend(ctx, pick(["appendLeft", "appendRight"]), sorted[i + 1]));
  }
  const order = int(3);
  if (order === 1) ops.reverse();
  else if (order === 2) {
    for (let i = ops.length - 1; i > 0; i--) {
      const j = int(i + 1);
      [ops[i], ops[j]] = [ops[j], ops[i]];
    }
  }
  if (chance(0.3)) ops.push({ op: "prepend", content: randContent() });
  if (chance(0.3)) ops.push({ op: "append", content: randContent() });
  // keep only the ops that succeed, preserving order
  const kept = [];
  for (const o of ops) if (replay(ctx.original, kept.concat([o])).error === null) kept.push(o);
  return kept;
}

// nested: overwrite inner ranges and inserts first, then an outer range that
// contains them (the overwrite clears everything inside it).
function nested(ctx) {
  const last = ctx.b.length - 1;
  if (last < 2) return careful(ctx);
  const lo = int(last - 1);
  const hi = lo + 2 + int(last - lo - 1);
  const ops = [];
  const n = 1 + int(5);
  for (let i = 0; i < n; i++) {
    const idx = lo + int(hi - lo + 1);
    const r = int(3);
    let c;
    if (r === 0) c = mkAppend(ctx, "appendLeft", idx);
    else if (r === 1) c = mkAppend(ctx, "appendRight", idx);
    else {
      const a = lo + int(hi - lo);
      const e = a + 1 + int(hi - a);
      c = mkOverwrite(ctx, a, e);
    }
    if (replay(ctx.original, ops.concat([c])).error === null) ops.push(c);
  }
  const outer = mkOverwrite(ctx, lo, hi);
  if (replay(ctx.original, ops.concat([outer])).error === null) ops.push(outer);
  // inserts at the edges of the overwritten range afterward
  for (const edge of [lo, hi]) {
    if (chance(0.7)) {
      const c = mkAppend(ctx, pick(["appendLeft", "appendRight"]), edge);
      if (replay(ctx.original, ops.concat([c])).error === null) ops.push(c);
    }
  }
  return ops;
}

// errors: a valid prefix followed by one failing op.
function errors(ctx) {
  const prefix = careful(ctx);
  const kind = int(7);
  const last = ctx.b.length - 1;
  let bad = null;
  if (kind === 0) {
    // zero-length overwrite
    const i = int(ctx.b.length);
    const p = ctx.b[i];
    bad = {
      op: "overwrite",
      start16: p.p16,
      end16: p.p16,
      start8: p.p8,
      end8: p.p8,
      content: randContent(),
    };
  } else if (kind === 1) {
    // start > end
    if (last >= 1) {
      const a = 1 + int(last);
      const c = int(a);
      const s = ctx.b[a];
      const e = ctx.b[c];
      bad = {
        op: "overwrite",
        start16: s.p16,
        end16: e.p16,
        start8: s.p8,
        end8: e.p8,
        content: randContent(),
      };
    }
  } else if (kind === 2) {
    // end out of bounds
    const k = 1 + int(5);
    const s = ctx.b[int(ctx.b.length)];
    bad = {
      op: "overwrite",
      start16: s.p16,
      end16: ctx.len16 + k,
      start8: s.p8,
      end8: ctx.len8 + k,
      content: randContent(),
    };
  } else if (kind === 3) {
    // start and end both beyond the end
    const k = 1 + int(5);
    bad = {
      op: "overwrite",
      start16: ctx.len16 + k,
      end16: ctx.len16 + k + 1,
      start8: ctx.len8 + k,
      end8: ctx.len8 + k + 1,
      content: randContent(),
    };
  } else {
    // overwrite or insert that lands inside an already edited chunk with
    // content: find one by trial.
    for (let tries = 0; tries < 60 && !bad; tries++) {
      const c = candidate(ctx);
      if (c.op === "overwrite" || c.op === "appendLeft" || c.op === "appendRight") {
        if (replay(ctx.original, prefix.concat([c])).error !== null) bad = c;
      }
    }
  }
  if (!bad) return prefix;
  return prefix.concat([bad]);
}

// oob inserts: appendLeft/appendRight beyond the end never throws in JS.
function oobInsert(ctx) {
  const ops = careful(ctx);
  const k = 1 + int(4);
  const name = pick(["appendLeft", "appendRight"]);
  ops.splice(int(ops.length + 1), 0, {
    op: name,
    index16: ctx.len16 + k,
    index8: ctx.len8 + k,
    content: randContent(),
  });
  return ops;
}

// ------------------------------------------------------------- run cases --
const BUILDERS = [
  [careful, 2300],
  [chaos, 900],
  [storm, 800],
  [partition, 700],
  [nested, 600],
  [errors, 700],
  [oobInsert, 120],
];

function finalize(c) {
  const { ms, error } = replay(c.original, c.ops);
  let result;
  if (error !== null) {
    result = { ok: false, error };
  } else {
    const options = { hires: "boundary", includeContent: c.includeContent };
    if (c.source !== null) options.source = c.source;
    result = {
      ok: true,
      text: ms.toString(),
      map: JSON.parse(JSON.stringify(ms.generateMap(options))),
      decoded: JSON.parse(JSON.stringify(ms.generateDecodedMap(options))),
    };
  }
  return {
    original: c.original,
    source: c.source,
    includeContent: c.includeContent,
    ops: c.ops,
    result,
  };
}

const lines = [];
// A few hand-written anchors first.
const manual = [
  { original: "", ops: [] },
  {
    original: "",
    ops: [
      { op: "appendRight", index16: 0, index8: 0, content: "R" },
      { op: "appendLeft", index16: 0, index8: 0, content: "L" },
    ],
  },
  {
    original: "",
    ops: [
      { op: "prepend", content: "p\n" },
      { op: "append", content: "\nq" },
    ],
  },
  { original: "abc", ops: [] },
  { original: "a\r\nb\u{1F600}c\te\u0301\n", ops: [] },
  {
    original: "const a = 1;\nconst b = 2;\n",
    ops: [
      { op: "overwrite", start16: 6, end16: 7, start8: 6, end8: 7, content: "x" },
      { op: "overwrite", start16: 19, end16: 20, start8: 19, end8: 20, content: "" },
      { op: "appendLeft", index16: 0, index8: 0, content: "// head\n" },
      { op: "appendRight", index16: 26, index8: 26, content: "// tail\n" },
    ],
  },
];
for (const m of manual) {
  lines.push(finalize({ original: m.original, source: "a.tsx", includeContent: true, ops: m.ops }));
}
for (const [builder, count] of BUILDERS) {
  for (let i = 0; i < count; i++) lines.push(finalize(makeCase(builder)));
}

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(
  outFile,
  gzipSync(`${lines.map((l) => JSON.stringify(l)).join("\n")}\n`, { level: 9 }),
);

const errs = lines.filter((l) => !l.result.ok).length;
const swallowed = lines.filter((l) => l.ops.some((o) => o.swallow)).length;
console.log(
  `wrote ${lines.length} cases (${errs} errors, ${swallowed} with swallowed ops) to ${outFile}`,
);

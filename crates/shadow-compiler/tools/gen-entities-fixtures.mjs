// Generates `crates/shadow-compiler/tests/fixtures/entities.jsonl` for the differential test of
// the Rust port of `decodeHTMLStrict`.
//
// Every line is `{"input": ..., "output": ...}` where `output` is computed by the REAL
// `decodeHTMLStrict` of the installed `entities` package (8.1.0). Inputs that are not
// well-formed UTF-16 (lone surrogates) cannot be represented in Rust and are skipped.
//
// Coverage: every entity name in many shapes (with and without semicolon, inside text, followed
// by alphanumerics or `=`, every proper prefix), numeric edge cases (0, the 0x80-0x9F window,
// surrogates, 0x10FFFF, 0x110000, huge numbers, missing digits, leading zeros, `X`, no
// semicolon), unicode text around entities, and deterministic pseudo-random strings built from
// entity-like fragments (seeded PRNG, so the file is reproducible).
//
// Usage: node crates/shadow-compiler/tools/gen-entities-fixtures.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { collectEntities, loadEntities } from "./gen-entities.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const outFile = path.resolve(here, "../tests/fixtures/entities.jsonl.gz");

const { decodeHTMLStrict } = await loadEntities();
const entities = await collectEntities();
const names = entities.map((e) => e.name);

/** Mulberry32: tiny deterministic PRNG. */
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(0x5eed_0801);
const pick = (items) => items[Math.floor(random() * items.length)];

const seen = new Set();
const lines = [];
function add(input) {
  if (typeof input !== "string" || !input.isWellFormed() || seen.has(input)) return;
  seen.add(input);
  const output = decodeHTMLStrict(input);
  lines.push(JSON.stringify({ input, output }));
}

// 1. Degenerate inputs.
for (const s of [
  "",
  "&",
  "&&",
  "&&&",
  "#",
  ";",
  "&;",
  "&#",
  "&#;",
  "&#x",
  "&#x;",
  "&#X;",
  "&#xZ;",
  "&#a;",
  "&x;",
]) {
  add(s);
}
add("plain text without ampersand");
add("héllo wörld \u{1F600} no entity");

// 2. Every entity name in many shapes.
const trailers = [
  "",
  " ",
  "a",
  "Z",
  "0",
  "9",
  "=",
  "-",
  ";",
  "&",
  "é",
  "\u{1F600}",
  "&amp;",
  "&amp",
];
for (const name of names) {
  add(`&${name};`);
  add(`&${name}`);
  add(`x &${name}; y`);
  add(`x &${name} y`);
  add(`&${name};&${name};`);
  add(`&${name}x;`);
  add(`&${name}1;`);
  add(`&${name}=`);
  add(`&${name}=1`);
  add(`&&${name};`);
  add(`&${name};;`);
  add(`é&${name};\u{1F600}`);
  add(`&${name.toUpperCase()};`);
  add(`&${name.toLowerCase()};`);
  add(`&${name.slice(0, -1)};`);
  add(`&${name}${pick(trailers)}${pick(trailers)}`);
  for (let i = 1; i < name.length; i++) {
    add(`&${name.slice(0, i)};`);
    add(`&${name.slice(0, i)}`);
  }
}

// Named prefix/legacy cases called out explicitly.
for (const s of [
  "&notit;",
  "&notin;",
  "&notit",
  "&noti",
  "&not",
  "&not;",
  "&ampfoo",
  "&amp;foo",
  "&ampfoo;",
  "&amp",
  "&amp;",
  "&AMP;",
  "&AMP",
  "&Amp;",
  "&lt",
  "&lt;",
  "&gt",
  "&gt;",
  "&copy",
  "&copy;",
  "&copy2;",
  "&copy=",
  "&nbsp",
  "&nbsp;",
  "&quot",
  "&quot;",
  "&apos;",
  "&apos",
  "&fjlig;",
  "&NotEqualTilde;",
  "&nvlt;",
  "&Afr;",
  "&frac12;",
  "&frac12",
  "&sup1;",
  "&sup1",
  "&sup2;",
  "&amp;amp;",
  "&amp;&amp;",
  "&amp;lt;",
  "&&amp;",
  "&am;",
  "&a;",
  "&aa;",
  "&amp ;",
  "&amp ;amp;",
  "&AElig;",
  "&AElig",
  "&aelig",
  "&CounterClockwiseContourIntegral;",
  "&CounterClockwiseContourIntegral",
  "&CounterClockwiseContourIntegralx;",
  "&Counter;",
  "&ThickSpace;",
  "&NotNestedGreaterGreater;",
]) {
  add(s);
}

// 3. Numeric references.
const numbers = new Set([
  0,
  1,
  2,
  8,
  9,
  10,
  13,
  31,
  32,
  33,
  38,
  39,
  60,
  62,
  64,
  65,
  126,
  127,
  128,
  129,
  130,
  131,
  132,
  141,
  143,
  144,
  145,
  157,
  158,
  159,
  160,
  161,
  255,
  256,
  0x2fff,
  0xd7ff,
  0xd800,
  0xd801,
  0xdbff,
  0xdc00,
  0xdfff,
  0xe000,
  0xfdd0,
  0xfffd,
  0xfffe,
  0xffff,
  0x10000,
  0x1f600,
  0x10fffe,
  0x10ffff,
  0x110000,
  0x110001,
  0x1fffff,
  0x200000,
  0x7fffffff,
  0x80000000,
  0xffffffff,
  0x100000000,
  0x1_0000_0001,
  2 ** 53,
  2 ** 53 + 1,
  2 ** 64,
  2 ** 100,
]);
for (let n = 0; n <= 0x2a0; n++) numbers.add(n);
for (let n = 0xd7f0; n <= 0xe010; n += 7) numbers.add(n);
for (let n = 0; n < 200; n++) numbers.add(Math.floor(random() * 0x120000));
for (const n of numbers) {
  const dec = n.toString();
  const hex = n.toString(16);
  const forms = [
    `&#${dec};`,
    `&#${dec}`,
    `&#x${hex};`,
    `&#X${hex.toUpperCase()};`,
    `&#x${hex}`,
    `&#X${hex}`,
    `&#${"0".repeat(5)}${dec};`,
    `&#x${"0".repeat(8)}${hex};`,
    `&#${dec}a;`,
    `&#x${hex}g;`,
    `&#${dec} ;`,
    `a&#${dec};b`,
    `&#${dec};&#x${hex};`,
    `&#${dec};;`,
    `&#${dec}\u{1F600}`,
    `&&#${dec};`,
    `&#${dec}x;`,
    `&#${dec}&amp;`,
    `&#x${hex.toUpperCase()};`,
    `&#x${hex}${hex};`,
    `&#${dec}${dec};`,
  ];
  for (const form of forms) add(form);
}
for (const s of [
  "&#;",
  "&#x;",
  "&#X;",
  "&#xZ;",
  "&#xg;",
  "&#-1;",
  "&#+1;",
  "&# 1;",
  "&#x 1;",
  "&#1 ;",
  "&#0;",
  "&#00;",
  "&#x0;",
  "&#x00;",
  "&#X0;",
  "&#128;",
  "&#x80;",
  "&#x9f;",
  "&#x9F;",
  "&#X9F;",
  "&#129;",
  "&#141;",
  "&#143;",
  "&#144;",
  "&#157;",
  "&#xD800;",
  "&#xdfff;",
  "&#55296;",
  "&#57343;",
  "&#1114111;",
  "&#x10FFFF;",
  "&#1114112;",
  "&#x110000;",
  "&#99999999999999999999999999;",
  "&#x99999999999999999999999999999999;",
  "&#xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF;",
  "&#0000000000000000000000000065;",
  "&#x0000000000000000000000000041;",
  "&#65",
  "&#65;",
  "&#x41",
  "&#x41;",
  "&#X41;",
  "&#65 ",
  "&#65&#66;",
  "&#65;&#66;&#67",
  "&#",
  "&#x",
  "&#1",
  "&#1;&#",
  "&#x1;&#x",
]) {
  add(s);
}
// Very long numeric references around the packed-length overflow in the JS implementation (2047).
for (const digits of [2040, 2044, 2045, 2046, 2047, 2048, 2049, 2050, 4096, 5000]) {
  add(`&#${"0".repeat(digits - 2)}65;`);
  add(`&#${"0".repeat(digits - 2)}65`);
  add(`&#x${"0".repeat(digits - 3)}41;`);
  add(`&#x${"0".repeat(digits - 3)}41`);
  add(`&#${"9".repeat(digits - 2)};`);
  add(`&#${"1".repeat(digits - 2)};x`);
  add(`x&#${"0".repeat(digits - 2)}38;&amp;`);
}
for (let digits = 2040; digits <= 2056; digits++) {
  add(`&#${"0".repeat(digits - 3)}65;`);
  add(`&#x${"0".repeat(digits - 4)}41;`);
}

// 4. Text around entities.
for (const s of [
  "a &amp; b",
  "a&amp;b",
  "&lt;div&gt;",
  "&lt;&gt;&amp;&quot;&apos;",
  "caf&eacute; &mdash; olé &#x1F600; \u{1F600}",
  "\u{1F600}&amp;\u{1F600}",
  "\u{1F600}&",
  "&\u{1F600};",
  "&é;",
  "&é",
  "é&amp",
  "é&amp;",
  "&#é;",
  "&#xé;",
  "&#1é;",
  "line1\n&amp;\nline2\t&lt;",
  "\u0000&amp;\u0000",
  "&amp\u0000;",
  "&&&&amp;&&&&",
  "&amp;&amp;&amp;&amp;",
  "&amp;&#65;&Aacute;&#x41;",
  "&amp;amp;amp;",
  "&#38;amp;",
  "&#x26;#x26;",
  " &amp; ",
  "�&amp;﻿",
  "a&b&c&d;&e;&f",
  "AT&T",
  "AT&amp;T",
  "?a=1&b=2&c=3",
  "?a=1&copy=2",
  "?a=1&copy;=2",
  "x&nbsp;y&nbsp z&nbsp",
]) {
  add(s);
}

// 5. Pseudo-random strings assembled from entity-like fragments.
const simple = [
  "&",
  "&",
  "&",
  "#",
  "x",
  "X",
  ";",
  ";",
  "0",
  "1",
  "9",
  "a",
  "A",
  "f",
  "F",
  "g",
  "z",
  "=",
  " ",
  "-",
  "\n",
];
const unicode = ["é", "\u{1F600}", "中", "\u0000", "�"];
const fixed = [
  "&amp;",
  "&amp",
  "&lt;",
  "&gt",
  "&#38;",
  "&#x26;",
  "&#65",
  "&#0;",
  "&#x80;",
  "&#xD800;",
  "&#128512;",
];
function fragment() {
  const roll = random();
  if (roll < 0.4) return pick(simple);
  if (roll < 0.55) return `&${pick(names)};`;
  if (roll < 0.65) return `&${pick(names)}`;
  if (roll < 0.72) return pick(names);
  if (roll < 0.78) {
    const n = pick(names);
    return `&${n.slice(0, 1 + Math.floor(random() * n.length))}${pick(["", ";", "x", "1"])}`;
  }
  if (roll < 0.84) return `&#${Math.floor(random() * 0x120000)}${pick(["", ";", ";", "a"])}`;
  if (roll < 0.9)
    return `&#${pick(["x", "X"])}${Math.floor(random() * 0x120000).toString(16)}${pick(["", ";", ";", "g"])}`;
  if (roll < 0.95) return pick(fixed);
  return pick(unicode);
}
let guard = 0;
const target = lines.length + 30000;
while (lines.length < target && guard++ < 400000) {
  const count = 1 + Math.floor(random() * 9);
  let text = "";
  for (let i = 0; i < count; i++) text += fragment();
  add(text);
}

fs.writeFileSync(outFile, zlib.gzipSync(`${lines.join("\n")}\n`, { level: 9 }));
console.log(
  `wrote ${lines.length} fixtures to ${path.relative(path.resolve(here, "../../.."), outFile)}`,
);

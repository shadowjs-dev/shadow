// Generates `crates/shadow-compiler/src/entities_table.rs` from the installed `entities` package.
//
// How the table is produced (and why it is complete):
//
// The `entities` package (8.1.0) stores every HTML5 named character reference in one packed
// binary trie, `htmlDecodeTree` (a `Uint16Array`), exported by `entities/decode`. Its layout is
// documented in `entities/src/internal/bin-trie-flags.ts`. This script walks that trie
// depth-first from the root and visits EVERY node reachable through any of the four branch
// shapes (single branch, jump table, packed dictionary, compact run). Each node that carries a
// value yields one `(name, value)` pair. Because the walk is an exhaustive traversal of the very
// data structure `decodeHTMLStrict` consults, the result is complete by construction: no
// candidate list or guessing is involved.
//
// Verification steps performed on every run (the script exits non-zero on any failure):
//   1. Every extracted name `n` satisfies `decodeHTMLStrict("&" + n + ";") === value`, using the
//      real package.
//   2. Every name is ASCII alphanumeric and starts with a letter (the decoder relies on this).
//   3. Every value is valid Unicode (no lone surrogates) and at most two code points.
//   4. Cross-check against the independent `character-entities` package (when it is installed
//      next to the repo root): the name sets must be identical, and the values must match.
//   5. Names are unique and sorted by bytes for binary search.
//
// "Strict" mode only decodes semicolon-terminated references, so the table stores the plain
// name (without `;`) and its replacement text. The legacy "semicolon optional" flag of the trie
// is intentionally not stored because it never affects `decodeHTMLStrict`.
//
// Usage: node crates/shadow-compiler/tools/gen-entities.mjs
// The output is deterministic and committed.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const entitiesDist = path.join(repoRoot, "packages/compiler/node_modules/entities/dist");
const outFile = path.resolve(here, "../src/entities_table.rs");

const VALUE_LENGTH = 0b1100_0000_0000_0000;
const FLAG13 = 0b0010_0000_0000_0000;
const BRANCH_LENGTH = 0b0001_1111_1000_0000;
const JUMP_TABLE = 0b0000_0000_0111_1111;
const VALUE_MASK = 0b0001_1111_1111_1111;

export async function loadEntities() {
  return import(pathToFileURL(path.join(entitiesDist, "decode.js")).href);
}

/**
 * Walks the whole decode trie and returns a `Map<name, valueString>`.
 * @param {Uint16Array} tree
 */
export function extractNames(tree) {
  const found = new Map();
  const onPath = new Set();

  /** Visits the node at `index`, reached via the text `prefix`. */
  function visit(index, prefix) {
    // A cycle would mean a corrupt trie; the structure is a DAG.
    if (onPath.has(index * 4096 + prefix.length)) throw new Error("cycle in trie");
    const header = tree[index];
    const valueLength = header >>> 14;
    const isRun = (header & (VALUE_LENGTH | FLAG13)) === FLAG13;

    if (isRun) {
      const runLength = (header & BRANCH_LENGTH) >> 7;
      let text = String.fromCharCode(header & JUMP_TABLE);
      const remaining = runLength - 1;
      for (let i = 0; i < remaining; i++) {
        const word = tree[index + 1 + (i >> 1)];
        text += String.fromCharCode(i % 2 === 0 ? word & 0xff : (word >> 8) & 0xff);
      }
      visit(index + 1 + (runLength >> 1), prefix + text);
      return;
    }

    if (valueLength !== 0) {
      let value;
      if (valueLength === 1) value = String.fromCharCode(header & VALUE_MASK);
      else if (valueLength === 2) value = String.fromCharCode(tree[index + 1]);
      else value = String.fromCharCode(tree[index + 1], tree[index + 2]);
      if (found.has(prefix)) throw new Error(`duplicate name ${prefix}`);
      found.set(prefix, value);
    }
    if (valueLength === 1) return; // Inline values are leaves; their low bits are the value.

    const branchStart = index + (valueLength || 1);
    const branchCount = (header & BRANCH_LENGTH) >> 7;
    const jump = header & JUMP_TABLE;
    if (jump !== 0) {
      if (branchCount === 0) {
        visit(branchStart, prefix + String.fromCharCode(jump));
        return;
      }
      for (let slot = 0; slot < branchCount; slot++) {
        const stored = tree[branchStart + slot];
        if (stored === 0) continue;
        visit(
          (branchStart + branchCount + stored - 1) & 0xffff,
          prefix + String.fromCharCode(jump + slot),
        );
      }
      return;
    }
    if (branchCount === 0) return;
    const keySlots = (branchCount + 1) >> 1;
    const branchEnd = branchStart + keySlots + branchCount;
    for (let i = 0; i < branchCount; i++) {
      const packed = tree[branchStart + (i >> 1)];
      const key = (packed >> ((i & 1) << 3)) & 0xff;
      const pointer = tree[branchStart + keySlots + i];
      visit((branchEnd + pointer) & 0xffff, prefix + String.fromCharCode(key));
    }
  }

  // The root is a jump table over letters; visiting it with an empty prefix covers every name.
  visit(0, "");
  return found;
}

/** Converts a UTF-16 string to code points, failing on lone surrogates. */
function toCodePoints(name, value) {
  const points = [];
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error(`lone surrogate in ${name}`);
      points.push(0x10000 + ((unit - 0xd800) << 10) + (next - 0xdc00));
      i++;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new Error(`lone surrogate in ${name}`);
    } else {
      points.push(unit);
    }
  }
  return points;
}

/** Returns every entity as a sorted array of `{ name, value }` after running all checks. */
export async function collectEntities() {
  const entities = await loadEntities();
  const found = extractNames(entities.htmlDecodeTree);
  const list = [...found.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  for (const { name, value } of list) {
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name)) throw new Error(`unexpected name ${name}`);
    const points = toCodePoints(name, value);
    if (points.length < 1 || points.length > 2)
      throw new Error(`unexpected value length for ${name}`);
    const decoded = entities.decodeHTMLStrict(`&${name};`);
    if (decoded !== value) throw new Error(`decodeHTMLStrict disagrees for ${name}`);
  }

  try {
    const { characterEntities } = await import(
      pathToFileURL(path.join(repoRoot, "node_modules/character-entities/index.js")).href
    );
    const independent = new Set(Object.keys(characterEntities));
    const ours = new Set(found.keys());
    const missing = [...independent].filter((n) => !ours.has(n));
    const extra = [...ours].filter((n) => !independent.has(n));
    if (missing.length > 0 || extra.length > 0) {
      throw new Error(
        `name set differs from character-entities: missing=${missing.join(",")} extra=${extra.join(",")}`,
      );
    }
    for (const [name, value] of Object.entries(characterEntities)) {
      if (found.get(name) !== value)
        throw new Error(`value differs from character-entities for ${name}`);
    }
    console.log(`cross-check against character-entities passed (${independent.size} names)`);
  } catch (error) {
    if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
    console.warn("character-entities not installed; skipped independent cross-check");
  }
  return list;
}

function rustString(points) {
  return points.map((cp) => `\\u{${cp.toString(16).toUpperCase()}}`).join("");
}

async function main() {
  const list = await collectEntities();
  const longest = list.reduce((max, { name }) => Math.max(max, name.length), 0);
  const shortest = list.reduce((min, { name }) => Math.min(min, name.length), Infinity);
  let out = "";
  out +=
    "//! Generated by `tools/gen-entities.mjs` from the `entities` npm package (8.1.0). Do not edit.\n";
  out += "//!\n";
  out +=
    "//! Every HTML5 named character reference, sorted by name (byte order) for binary search.\n";
  out += "//! Names are stored without the trailing semicolon.\n\n";
  out += `/// Number of entries in [\`ENTITIES\`].\npub(crate) const ENTITY_COUNT: usize = ${list.length};\n\n`;
  out += `/// Length in bytes of the longest entity name.\npub(crate) const MAX_NAME_LEN: usize = ${longest};\n\n`;
  out += `/// Length in bytes of the shortest entity name.\npub(crate) const MIN_NAME_LEN: usize = ${shortest};\n\n`;
  out += "/// Entity names and their replacement text, sorted by name.\n";
  out += "pub(crate) static ENTITIES: [(&str, &str); ENTITY_COUNT] = [\n";
  for (const { name, value } of list) {
    out += `    ("${name}", "${rustString(toCodePoints(name, value))}"),\n`;
  }
  out += "];\n";
  fs.writeFileSync(outFile, out);
  console.log(`wrote ${list.length} entities to ${path.relative(repoRoot, outFile)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

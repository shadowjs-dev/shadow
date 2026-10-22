#!/usr/bin/env node
/**
 * Fails when the native compiler is not fast enough against the TypeScript compiler on the large input.
 *
 *   node bench/check-speedup.mjs results/ci-result.json [--min 8]
 *
 * The nightly workflow runs it after the benchmark: the measured speedup of the median compile time (`js` over `native`) on the
 * largest size must stay at or above the minimum (the shipped result is about ten), so a change that slows the Rust path down is
 * seen the same night.
 */
import { readFileSync } from "node:fs";

/**
 * The speedup of `native` over `js` in a benchmark result for one input size.
 * @param {{ results: { contender: string, size: string, medianMs: number }[] }} result The parsed result file.
 * @param {string} size The input size (`small`, `medium` or `large`).
 * @returns {number} The median time of `js` divided by that of `native`.
 * @throws {Error} When either contender has no measurement for the size.
 */
export function speedup(result, size) {
  const median = (contender) => {
    const row = result.results.find(
      (entry) => entry.contender === contender && entry.size === size,
    );
    if (row === undefined)
      throw new Error(`the result has no "${contender}" row for the ${size} input`);
    return row.medianMs;
  };
  return median("js") / median("native");
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  const file = process.argv[2];
  const minAt = process.argv.indexOf("--min");
  const minimum = minAt === -1 ? 8 : Number(process.argv[minAt + 1]);
  if (file === undefined || !Number.isFinite(minimum)) {
    console.error("usage: node bench/check-speedup.mjs <result.json> [--min 8]");
    process.exit(2);
  }
  const ratio = speedup(JSON.parse(readFileSync(file, "utf8")), "large");
  console.log(
    `native compiler speedup on the large input: ${ratio.toFixed(1)}x (minimum ${minimum}x)`,
  );
  if (ratio < minimum) process.exit(1);
}

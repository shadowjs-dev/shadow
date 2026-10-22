#!/usr/bin/env node
/**
 * Compiler benchmark. For each input size (one component, fifty, a thousand: about a hundred thousand
 * lines) and each contender it starts a fresh Node.js process, warms the compiler up, compiles the
 * module many times and reports the median and 95th percentile of the wall time of one compile, the
 * CPU time, the throughput and the peak memory of the process. A second scenario compiles 200
 * different modules and reports the wall time of the whole batch, with the native compiler run
 * serially and concurrently.
 *
 *   node bench/run.mjs [--contenders js,native,...] [--sizes small,medium,large] [--quick] [--out file.json]
 *
 * The compilers must be built first: `npm run build -w @shadow-js/compiler -w @shadow-js/compiler`
 * and `npm run build:binaries -w @shadow-js/compiler`; the competitors are installed with
 * `npm install` inside this folder (its own package.json, outside the root workspaces).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { arch, cpus, loadavg, platform, release, totalmem } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : args[at + 1];
};
const quick = args.includes("--quick");
const contenders = flag("--contenders", "js,native,addon,wasm,solid,oxc").split(",");
const sizes = flag("--sizes", "small,medium,large").split(",");

/** Warm-up and measured runs per size; the product of the run count and the cost stays under a minute. */
const PLAN = quick
  ? { small: [100, 400], medium: [3, 12], large: [1, 4] }
  : { small: [500, 3000], medium: [15, 60], large: [4, 21] };

/** The competitor on the largest input takes a minute per run: fewer runs. */
const SLOW = { solid: { large: quick ? [0, 2] : [1, 5] } };

function runChild(contender, size) {
  const [warmup, runs] = SLOW[contender]?.[size] ?? PLAN[size];
  const line = execFileSync(
    process.execPath,
    ["--expose-gc", join(here, "child.mjs"), contender, size, String(warmup), String(runs)],
    { encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "inherit"] },
  );
  return JSON.parse(line.trim().split("\n").pop());
}

execFileSync(process.execPath, [join(here, "verify.mjs"), contenders.join(",")], {
  stdio: ["ignore", "inherit", "inherit"],
});

const results = [];
for (const size of sizes) {
  for (const contender of contenders) {
    process.stderr.write(`${size} / ${contender}\n`);
    try {
      results.push(runChild(contender, size));
    } catch (error) {
      results.push({ contender, size, error: String(error.message).split("\n")[0] });
    }
  }
}

// Whole-batch scenario: 200 different modules (the "medium" generator with different seeds).
const batch = {};
if (sizes.includes("medium")) {
  process.stderr.write("batch\n");
  const line = execFileSync(
    process.execPath,
    ["--expose-gc", join(here, "batch.mjs"), contenders.join(",")],
    {
      encoding: "utf8",
      maxBuffer: 1 << 26,
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  Object.assign(batch, JSON.parse(line.trim().split("\n").pop()));
}

const machine = {
  platform: `${platform()} ${release()} ${arch()}`,
  cpu: cpus()[0]?.model,
  cores: cpus().length,
  memoryGiB: Math.round(totalmem() / 2 ** 30),
  loadAverage: loadavg().map((value) => Number(value.toFixed(2))),
  node: process.version,
  date: new Date().toISOString(),
};
const require = createRequire(join(here, "package.json"));
const versions = {
  "@babel/core": require("@babel/core/package.json").version,
  "babel-preset-solid": require("babel-preset-solid/package.json").version,
  "oxc-transform": require("oxc-transform/package.json").version,
};

const report = { machine, versions, plan: PLAN, results, batch };
const out = flag("--out", join(here, "results", `${machine.date.slice(0, 10)}.json`));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);

const fmt = (value) =>
  value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2);
console.log(
  `\n${machine.cpu}, ${machine.cores} cores, load ${machine.loadAverage.join("/")}, Node ${machine.node}\n`,
);
for (const size of sizes) {
  const rows = results.filter((row) => row.size === size && row.error === undefined);
  const base = rows.find((row) => row.contender === "js");
  if (rows.length === 0) continue;
  console.log(
    `| ${size}: ${rows[0].inputLines} lines, ${(rows[0].inputBytes / 1024).toFixed(0)} KiB | median ms | p95 ms | CPU ms | MB/s | peak RSS MiB | vs js |`,
  );
  console.log("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const row of rows) {
    const speed = base === undefined ? "" : `${(base.medianMs / row.medianMs).toFixed(1)}x`;
    console.log(
      `| ${row.contender} | ${fmt(row.medianMs)} | ${fmt(row.p95Ms)} | ${fmt(row.cpuMsPerRun)} | ${(row.inputBytes / 1048576 / (row.medianMs / 1000)).toFixed(0)} | ${row.peakRssMiB.toFixed(0)} | ${speed} |`,
    );
  }
  console.log("");
}
for (const row of results.filter((entry) => entry.error !== undefined))
  console.log(`${row.size}/${row.contender}: ${row.error}`);
if (Object.keys(batch).length > 0) {
  console.log("| batch of 200 modules | wall ms | vs js |");
  console.log("| --- | ---: | ---: |");
  for (const [name, row] of Object.entries(batch)) {
    console.log(
      `| ${name} | ${fmt(row.wallMs)} | ${batch.js === undefined ? "" : `${(batch.js.wallMs / row.wallMs).toFixed(1)}x`} |`,
    );
  }
}
console.log(`\nwritten ${out}`);

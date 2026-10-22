/**
 * One measurement in its own process, so that memory and JIT state of one contender never touch
 * another: `node --expose-gc child.mjs <contender> <size> <warmup> <runs>` prints a JSON line.
 */
import { CONTENDERS } from "./contenders.mjs";
import { makeInputs } from "./inputs.mjs";

const [name, size, warmupText, runsText] = process.argv.slice(2);
const warmup = Number(warmupText);
const runs = Number(runsText);
const input = makeInputs().find((candidate) => candidate.name === size);
const contender = CONTENDERS[name];
if (input === undefined || contender === undefined) {
  console.error(`unknown contender or size: ${name} ${size}`);
  process.exit(2);
}

const compile = await contender.prepare();
globalThis.gc?.();
const before = process.memoryUsage();
const baselineRss = before.rss;

let output = "";
for (let i = 0; i < warmup; i += 1) output = compile(input.filename, input.source);

const times = [];
const cpuBefore = process.cpuUsage();
for (let i = 0; i < runs; i += 1) {
  const started = performance.now();
  output = compile(input.filename, input.source);
  times.push(performance.now() - started);
}
const cpu = process.cpuUsage(cpuBefore);
const usage = process.resourceUsage();
times.sort((a, b) => a - b);
const percentile = (p) => times[Math.min(times.length - 1, Math.floor((p / 100) * times.length))];
const after = process.memoryUsage();

console.log(
  JSON.stringify({
    contender: name,
    size,
    runs,
    warmup,
    medianMs: percentile(50),
    p95Ms: percentile(95),
    minMs: times[0],
    maxMs: times[times.length - 1],
    cpuMsPerRun: (cpu.user + cpu.system) / 1000 / runs,
    peakRssMiB: usage.maxRSS / 1024,
    startRssMiB: baselineRss / 1048576,
    heapUsedMiB: after.heapUsed / 1048576,
    outputBytes: Buffer.byteLength(output),
    inputBytes: input.bytes,
    inputLines: input.lines,
  }),
);

/**
 * The batch scenario in one process per contender: 200 different modules compiled one after the
 * other (and, for the native compiler, also all at once with the async API).
 */

import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CONTENDERS } from "./contenders.mjs";
import { makeModule } from "./inputs.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const wanted = process.argv[2].split(",");
const modules = Array.from({ length: 200 }, (_, index) => ({
  filename: `module${index}.jsx`,
  source: makeModule(10, 1000 + index),
}));
const out = {};

for (const name of wanted) {
  if (name === "addon") continue;
  const compile = await CONTENDERS[name].prepare();
  for (let i = 0; i < 5; i += 1) compile(modules[i].filename, modules[i].source);
  const started = performance.now();
  for (const module of modules) compile(module.filename, module.source);
  out[name] = { wallMs: performance.now() - started };
}

if (wanted.includes("native")) {
  process.env.SHADOW_COMPILER_BACKEND = "native";
  const { compileAsync } = await import(pathToFileURL(join(here, "../dist/prod/index.js")).href);
  await compileAsync(modules[0].source, { filename: modules[0].filename });
  const started = performance.now();
  await Promise.all(
    modules.map((module) => compileAsync(module.source, { filename: module.filename })),
  );
  out["native (async, all cores)"] = { wallMs: performance.now() - started };
}
console.log(JSON.stringify(out));

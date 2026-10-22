/**
 * Before anything is timed: the ShadowJS contenders must produce identical code for every input
 * (the published build of the JavaScript compiler included, so a stale `dist` is caught).
 */
import { CONTENDERS } from "./contenders.mjs";
import { makeInputs } from "./inputs.mjs";

const names = process.argv[2]
  .split(",")
  .filter((name) => ["js", "native", "addon", "wasm"].includes(name));
const compilers = new Map();
for (const name of names) compilers.set(name, await CONTENDERS[name].prepare());
let bad = 0;
for (const input of makeInputs()) {
  const outputs = new Map();
  for (const [name, compile] of compilers) outputs.set(name, compile(input.filename, input.source));
  const [firstName, first] = [...outputs][0];
  for (const [name, code] of outputs) {
    if (code !== first) {
      console.error(`${input.name}: ${name} differs from ${firstName}`);
      bad += 1;
    }
  }
}
if (bad > 0) process.exit(1);
console.log("verified");

// Runs under Bun, Deno or Node: compiles a small component with the built package and prints one JSON line.
// The backend is asked for through SHADOW_COMPILER_BACKEND, as a user would; the answer says which one ran.

const { compile, compileAsync, getBackend, CompileError } = await import("@shadow-js/compiler");

const runtime = typeof Bun !== "undefined" ? "bun" : typeof Deno !== "undefined" ? "deno" : "node";
const source = `import { useStore } from "@shadow-js/core";
export function Counter() {
  const [count, setCount] = useStore(0);
  return <button type="button" onClick={() => setCount((n) => n + 1)}>{count()} &amp; more</button>;
}
`;
const dom = compile(source, { filename: "counter.tsx" });
const ssr = compile(source, { filename: "counter.tsx", generate: "ssr" });
const asynchronous = await compileAsync(source, { filename: "counter.tsx" });
let error = null;
try {
  compile("const view = <div>;", { filename: "broken.tsx" });
} catch (thrown) {
  error = {
    isCompileError: thrown instanceof CompileError,
    code: thrown.diagnostic?.code,
    position: `${thrown.diagnostic?.line}:${thrown.diagnostic?.column}`,
  };
}
console.log(
  JSON.stringify({
    runtime,
    backend: getBackend().name,
    dom: dom.code,
    ssr: ssr.code,
    asyncSame: asynchronous.code === dom.code,
    transformed: dom.transformed,
    mapped: dom.map !== null && typeof dom.map.mappings === "string",
    error,
  }),
);

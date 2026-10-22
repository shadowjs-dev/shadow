// Puts the ambient declarations of `*.mdx` modules next to the build output: they are a plain `.d.ts` file that tsdown has no
// entry for, and the package ships `dist` only.
import { copyFileSync } from "node:fs";

copyFileSync(
  new URL("../src/mdx-env.d.ts", import.meta.url),
  new URL("../dist/mdx-env.d.ts", import.meta.url),
);

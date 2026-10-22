import { createConfig } from "../../tools/build/tsdown-preset.mjs";

// `./mdx` is its own entry: an app that does not use MDX never loads the plugin.
export default createConfig({
  packageDir: import.meta.dirname,
  entries: { index: "src/index.ts", mdx: "src/mdx.ts" },
});

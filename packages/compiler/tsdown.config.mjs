import { createConfig } from "../../tools/build/tsdown-preset.mjs";

// Two entries: `index` chooses between the Rust addon, WebAssembly and TypeScript (it reads files with Node.js, so it targets Node.js),
// and `javascript` is the TypeScript implementation alone, free of any Node.js API. Output keeps the `.js` extension of the other
// packages (the manifest is `"type": "module"`), and one file per source module so that a bundler importing `javascript` includes
// nothing of the loader.
export default createConfig({
  packageDir: import.meta.dirname,
  entries: { index: "src/index.ts", javascript: "src/javascript.ts" },
}).map((config) => ({ ...config, platform: "node", fixedExtension: false }));

import { createConfig } from "../../tools/build/tsdown-preset.mjs";

export default createConfig({
  packageDir: import.meta.dirname,
  entries: {
    index: "src/index.ts",
    "store/index": "src/store/index.ts",
    "extend/index": "src/extend.ts",
  },
  serverEntries: {
    index: "src/index.ts",
    "store/index": "src/store/index.ts",
    "extend/index": "src/extend.ts",
  },
});

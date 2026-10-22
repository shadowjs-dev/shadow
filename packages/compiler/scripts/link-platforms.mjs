#!/usr/bin/env node
/**
 * Writes the platform packages into `optionalDependencies` of this package, for a release or a rehearsal. They are not committed:
 * the platform packages do not exist on the registry before the release publishes them, and a lockfile that listed them could not
 * be installed from.
 *
 *   node scripts/link-platforms.mjs            writes them
 *   node scripts/link-platforms.mjs --remove   takes them out again (a local pack leaves the working tree as it was)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { platformDependencies } from "./platforms.mjs";

const manifestFile = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "package.json");
const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
if (process.argv.includes("--remove")) delete manifest.optionalDependencies;
else manifest.optionalDependencies = platformDependencies(manifest.version);
writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  process.argv.includes("--remove")
    ? "removed optionalDependencies"
    : `linked ${Object.keys(manifest.optionalDependencies).length} platform packages at ${manifest.version}`,
);

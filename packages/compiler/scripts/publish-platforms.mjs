#!/usr/bin/env node
/**
 * Publishes the platform packages of the compiler (`npm/<platform>`), which `build:native` generates and which are not workspace
 * members, so a workspace publish does not see them. They must be on the registry before the main package, whose optional
 * dependencies name them.
 *
 *   node scripts/publish-platforms.mjs            publishes those not yet on the registry (with provenance)
 *   node scripts/publish-platforms.mjs --dry-run  prints what would be published
 *
 * Run it from the release workflow before the main package is published; it needs the same npm token and provenance setup.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PLATFORM_KEYS } from "./platforms.mjs";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dry = process.argv.includes("--dry-run");
const platforms = join(packageDirectory, "npm");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

/** Runs npm without a shell; `.cmd` shims on Windows need one. */
function runNpm(args, options = {}) {
  return spawnSync(npm, args, { ...options, shell: process.platform === "win32" });
}

let names = [];
try {
  names = readdirSync(platforms).sort();
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
const packages = [];
for (const name of names) {
  const dir = join(platforms, name);
  const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  packages.push({ dir, name: manifest.name, version: manifest.version });
}
const main = JSON.parse(readFileSync(join(packageDirectory, "package.json"), "utf8"));
const expected = PLATFORM_KEYS.map((key) => `@shadow-js/compiler-${key}`).sort();
const found = packages.map((entry) => entry.name).sort();
if (JSON.stringify(expected) !== JSON.stringify(found)) {
  console.error(
    `The platform packages built (${found.join(", ") || "none"}) are not the platforms the compiler ships for (${expected.join(", ")}).`,
  );
  process.exit(1);
}
for (const entry of packages) {
  if (entry.version !== main.version) {
    console.error(`${entry.name}@${entry.version} does not match ${main.version}.`);
    process.exit(1);
  }
}
for (const entry of packages) {
  const view = runNpm(["view", `${entry.name}@${entry.version}`, "version"], {
    encoding: "utf8",
  });
  if (view.status === 0 && view.stdout.trim() === entry.version) {
    console.log(`= ${entry.name}@${entry.version} is already on the registry`);
    continue;
  }
  if (dry) {
    console.log(`+ would publish ${entry.name}@${entry.version}`);
    continue;
  }
  // A registry on this machine has no CI provider to attest the build, so the release rehearsal turns provenance off.
  const provenance =
    process.env.RELEASE_PROVENANCE === "false" ? "--provenance=false" : "--provenance";
  const published = runNpm(["publish", entry.dir, "--access", "public", provenance], {
    stdio: "inherit",
  });
  if (published.status !== 0) {
    console.error(`npm publish failed for ${entry.name}.`);
    process.exit(published.status ?? 1);
  }
  console.log(`+ ${entry.name}@${entry.version}`);
}

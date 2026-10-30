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
 * A run that stopped half way can simply run again: what the registry has is left alone, a registry that fails for a moment is asked
 * again, a conflict while the registry still processes the previous package is tried again, and a version npm already holds counts as
 * published. The script ends only when every platform package is listed by the registry, so the main package is never published
 * (and the release never tagged) ahead of a package it lists as an optional dependency.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PLATFORM_KEYS } from "./platforms.mjs";

/** What npm says when the version is already held (published, or staged and not listed yet). */
const ALREADY_PUBLISHED = /cannot publish over (?:the )?previously (?:published|staged)/i;
/** A failure another attempt can cure: E409 (the registry still processes the previous package), E429, E5xx, a broken connection. */
const TRANSIENT_FAILURE =
  /\bE(?:409|429|5\d\d)\b|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ECONNREFUSED|socket hang up/i;
/** A prerelease version (`1.0.0-rc.1`); a hyphen in the build metadata after a plus sign does not make one. */
const PRERELEASE = /^\d+\.\d+\.\d+-/;

/**
 * Whether this file is the script node was started with, after resolving links (a symbolic link to it must still run it).
 * @param {string} moduleUrl `import.meta.url`.
 * @param {string | undefined} [entry] `process.argv[1]`.
 * @returns {boolean} True when this module is the entry script.
 */
export function isEntryScript(moduleUrl, entry = process.argv[1]) {
  if (entry === undefined) return false;
  try {
    return realpathSync.native(fileURLToPath(moduleUrl)) === realpathSync.native(entry);
  } catch (error) {
    // A path that does not exist (`node -`) cannot be this file.
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
}

/** Runs npm without a shell; `.cmd` shims on Windows need one. */
function runNpm(args, options = {}) {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  return spawnSync(npm, args, {
    encoding: "utf8",
    ...options,
    shell: process.platform === "win32",
  });
}

const defaultSleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * Whether the registry lists a version. A package or version it does not have is "no"; any other failure is tried again a few times and
 * then an error, never a "no": it must not look like an unpublished package.
 * @param {string} name The package.
 * @param {string} version The version.
 * @param {{ registry?: string, sleep?: (ms: number) => Promise<void>, attempts?: number }} [options] Replaced in tests.
 * @returns {Promise<boolean>} True when that version is listed.
 * @throws {Error} When the registry cannot be asked.
 */
export async function isListed(
  name,
  version,
  { registry, sleep = defaultSleep, attempts = 4 } = {},
) {
  const extra = registry === undefined ? [] : ["--registry", registry];
  let delay = 2_000;
  for (let attempt = 1; ; attempt += 1) {
    // A timeout: npm waits for a registry that accepted the connection and never answers.
    const view = runNpm(["view", `${name}@${version}`, "version", ...extra], { timeout: 120_000 });
    if (view.status === 0) return view.stdout.trim() === version;
    const said = `${view.stderr ?? ""}${view.error?.message ?? ""}`;
    if (/\bE404\b/.test(said)) return false;
    if (attempt >= attempts)
      throw new Error(
        `could not ask whether ${name}@${version} is listed: ${said.trim().split("\n")[0]}`,
      );
    await sleep(delay);
    delay *= 2;
  }
}

/**
 * Reads the platform packages and checks that they are the ones the compiler ships for and carry the compiler's version.
 * @param {string} packageDirectory The compiler package folder.
 * @returns {{ dir: string, name: string, version: string }[]} The packages.
 * @throws {Error} When the set or a version is wrong.
 */
export function readPlatformPackages(packageDirectory) {
  const platforms = join(packageDirectory, "npm");
  let names = [];
  try {
    names = readdirSync(platforms).sort();
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const packages = names.map((name) => {
    const dir = join(platforms, name);
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    return { dir, name: manifest.name, version: manifest.version };
  });
  const main = JSON.parse(readFileSync(join(packageDirectory, "package.json"), "utf8"));
  const expected = PLATFORM_KEYS.map((key) => `@shadow-js/compiler-${key}`).sort();
  const found = packages.map((entry) => entry.name).sort();
  if (JSON.stringify(expected) !== JSON.stringify(found))
    throw new Error(
      `The platform packages built (${found.join(", ") || "none"}) are not the platforms the compiler ships for (${expected.join(", ")}).`,
    );
  for (const entry of packages) {
    if (entry.version !== main.version)
      throw new Error(`${entry.name}@${entry.version} does not match ${main.version}.`);
  }
  return packages;
}

/**
 * Publishes the platform packages the registry does not list, then waits until it lists all of them.
 * @param {object} input
 * @param {string} input.packageDirectory The compiler package folder.
 * @param {boolean} [input.dry] Prints and publishes nothing.
 * @param {string} [input.registry] The registry (npm's own configuration when omitted).
 * @param {(ms: number) => Promise<void>} [input.sleep] Waits between attempts (replaced in tests).
 * @param {number} [input.publishAttempts] How many times one package is published when the failure is one another attempt can cure.
 * @param {number} [input.listingMinutes] How long to wait for the registry to list what was published.
 * @returns {Promise<string[]>} `name@version` of what was published (or would be).
 * @throws {Error} When a publish fails or a version is not listed in time.
 */
export async function publishPlatforms({
  packageDirectory,
  dry = false,
  registry,
  sleep = defaultSleep,
  publishAttempts = 3,
  listingMinutes = 20,
}) {
  const packages = readPlatformPackages(packageDirectory);
  const extra = registry === undefined ? [] : ["--registry", registry];
  const listing = { registry, sleep };
  const published = [];
  for (const entry of packages) {
    if (await isListed(entry.name, entry.version, listing)) {
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
    // A prerelease must not become `latest`: the first install of the package would get it.
    const tag = PRERELEASE.test(entry.version) ? ["--tag", "next"] : [];
    const args = ["publish", entry.dir, "--access", "public", ...tag, provenance, ...extra];
    let delay = 5_000;
    for (let attempt = 1; ; attempt += 1) {
      const result = runNpm(args, { stdio: ["inherit", "inherit", "pipe"] });
      const said = result.stderr ?? "";
      process.stderr.write(said);
      if (result.status === 0) break;
      if (ALREADY_PUBLISHED.test(said)) {
        console.log(
          `${entry.name}@${entry.version} is already published; waiting for the registry to list it`,
        );
        break;
      }
      if (attempt >= publishAttempts || !TRANSIENT_FAILURE.test(said))
        throw new Error(`npm publish failed for ${entry.name}.`);
      // A lost answer or a 5xx can come after the registry stored the version: look before publishing again.
      if (await isListed(entry.name, entry.version, listing).catch(() => false)) break;
      console.log(
        `npm publish failed for ${entry.name} (attempt ${attempt} of ${publishAttempts}); trying again in ${delay / 1000} s`,
      );
      await sleep(delay);
      delay *= 2;
    }
    published.push(`${entry.name}@${entry.version}`);
    console.log(`+ ${entry.name}@${entry.version}`);
  }
  // The main package lists these as optional dependencies, and the tag and the release follow it: all of them must be installable first.
  // npm can take minutes to list the first version of a package it has not seen before.
  const pollMs = 10_000;
  for (const entry of packages) {
    if (dry || !published.includes(`${entry.name}@${entry.version}`)) continue;
    let visible = false;
    for (let poll = 0; poll < (listingMinutes * 60_000) / pollMs && !visible; poll += 1) {
      visible = await isListed(entry.name, entry.version, listing);
      if (!visible) await sleep(pollMs);
    }
    if (!visible)
      throw new Error(
        `${entry.name}@${entry.version} was published but is not listed after ${listingMinutes} minutes`,
      );
  }
  return published;
}

if (isEntryScript(import.meta.url)) {
  const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  publishPlatforms({ packageDirectory, dry: process.argv.includes("--dry-run") }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

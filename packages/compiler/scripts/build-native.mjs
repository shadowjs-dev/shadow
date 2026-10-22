#!/usr/bin/env node
/**
 * Builds the Node.js addon with cargo and lays it out as the platform package that
 * `@shadow-js/compiler` loads: `npm/<platform>/shadow-compiler.node` and a `package.json`
 * whose `os`, `cpu` and `libc` fields make npm install only the matching package.
 *
 *   node scripts/build-native.mjs [--target <rust target triple>] [--profile release|dev]
 *
 * Without `--target` the host platform is built. The version of the platform package is the version
 * of this package, so the set releases in lockstep.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cargoRoot, TARGETS } from "./platforms.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const packageDirectory = resolve(here, "..");
const repository = cargoRoot(packageDirectory);

function argument(name) {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}

const hostTriple = /^host: (.+)$/m.exec(
  execFileSync("rustc", ["-vV"], { encoding: "utf8", cwd: repository }),
)?.[1];
const target = argument("--target") ?? hostTriple;
const profile = argument("--profile") ?? "release";
const spec = target === undefined ? undefined : TARGETS[target];
if (spec === undefined) {
  console.error(
    `No platform package for the target "${target}". Known: ${Object.keys(TARGETS).join(", ")}`,
  );
  process.exit(1);
}

// `--zig` cross-compiles with cargo-zigbuild (the Linux targets of the release): glibc builds name the oldest glibc they run on,
// so the addon loads on current distributions, not only on the one that built it.
const zig = process.argv.includes("--zig");
const cargoArguments = [zig ? "zigbuild" : "build", "-p", "shadow-compiler-node", "--locked"];
if (profile === "release") cargoArguments.push("--release");
if (argument("--target") !== undefined)
  cargoArguments.push("--target", zig && spec.libc === "glibc" ? `${target}.2.17` : target);
// The linker strips ELF and PE files safely; only the Mach-O build is stripped afterward (see below).
if (profile === "release" && spec.os !== "darwin")
  cargoArguments.push("--config", "profile.release.strip=true");
// musl targets link the C runtime statically by default, and a static runtime cannot make a shared library (the addon): ask for the
// dynamic one, which is what Node.js on Alpine and similar systems loads anyway.
const environment =
  spec.libc === "musl"
    ? {
        ...process.env,
        RUSTFLAGS: `${process.env["RUSTFLAGS"] ?? ""} -C target-feature=-crt-static`.trim(),
      }
    : process.env;
execFileSync("cargo", cargoArguments, { cwd: repository, stdio: "inherit", env: environment });

const outputDirectory = join(
  repository,
  "target",
  argument("--target") === undefined ? "" : target,
  profile === "release" ? "release" : "debug",
);
const built = join(outputDirectory, spec.library);
const platformDirectory = join(packageDirectory, "npm", spec.key);
mkdirSync(platformDirectory, { recursive: true });
const installed = join(platformDirectory, "shadow-compiler.node");
copyFileSync(built, installed);
// Symbols are stripped here, not by cargo: the linker's own strip step breaks the Mach-O file once the
// allocator is linked in, while `strip -x` (local symbols only) leaves a file Node.js loads.
if (hostTriple === target && spec.os === "darwin") {
  execFileSync("strip", ["-x", installed], { stdio: "inherit" });
} else if (hostTriple === target && spec.os === "linux") {
  execFileSync("strip", ["--strip-unneeded", installed], { stdio: "inherit" });
}

const main = JSON.parse(readFileSync(join(packageDirectory, "package.json"), "utf8"));
const manifest = {
  name: `@shadow-js/compiler-${spec.key}`,
  version: main.version,
  description: `The ${spec.key} build of the ShadowJS compiler addon. Install @shadow-js/compiler, not this package.`,
  license: main.license,
  type: "module",
  keywords: ["shadowjs", "compiler", "native", spec.key],
  os: [spec.os],
  cpu: [spec.cpu],
  ...(spec.libc === undefined ? {} : { libc: [spec.libc] }),
  main: "shadow-compiler.node",
  files: ["shadow-compiler.node", "README.md", "LICENSE"],
  engines: main.engines,
  publishConfig: main.publishConfig,
  repository: main.repository,
  homepage: main.homepage,
  bugs: main.bugs,
};
copyFileSync(join(repository, "LICENSE"), join(platformDirectory, "LICENSE"));
writeFileSync(join(platformDirectory, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(
  join(platformDirectory, "README.md"),
  `# ${manifest.name}\n\nThe ${spec.key} build of the Rust compiler addon of [@shadow-js/compiler](https://www.npmjs.com/package/@shadow-js/compiler). Install that package: it brings this one when the platform matches.\n`,
);
console.log(`built ${platformDirectory}/shadow-compiler.node (${target}, ${profile})`);

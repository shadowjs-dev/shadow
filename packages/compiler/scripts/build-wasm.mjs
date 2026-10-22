#!/usr/bin/env node
/**
 * Builds the WebAssembly fallback with cargo and copies it to `wasm/shadow-compiler.wasm`, the file
 * `@shadow-js/compiler` loads when no prebuilt addon matches the platform.
 *
 *   node scripts/build-wasm.mjs
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cargoRoot } from "./platforms.mjs";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repository = cargoRoot(packageDirectory);
execFileSync(
  "cargo",
  [
    "build",
    "-p",
    "shadow-compiler-wasm",
    "--locked",
    "--release",
    "--target",
    "wasm32-unknown-unknown",
    "--config",
    "profile.release.strip=true",
  ],
  { cwd: repository, stdio: "inherit" },
);
mkdirSync(join(packageDirectory, "wasm"), { recursive: true });
copyFileSync(
  join(repository, "target/wasm32-unknown-unknown/release/shadow_compiler_wasm.wasm"),
  join(packageDirectory, "wasm/shadow-compiler.wasm"),
);
console.log("built wasm/shadow-compiler.wasm");

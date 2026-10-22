import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import type { CompileOptions } from "../../../src/javascript";

const directory = join(dirname(fileURLToPath(import.meta.url)), "..", "corpus");

export interface CorpusMap {
  version: number;
  file?: string;
  sources: string[];
  sourcesContent: string[];
  names: string[];
  mappings: string;
}

export type Expectation =
  | {
      kind: "ok";
      code: string;
      transformed: boolean;
      map: CorpusMap | null;
      diagnostics: unknown[];
    }
  | {
      kind: "error";
      message: string;
      frame: string;
      id: string;
      diagnostic: Record<string, unknown>;
    }
  | { kind: "throws"; message: string };

export interface Case {
  id: string;
  origin: string;
  source: string;
  options: CompileOptions;
  expect: Expectation;
}

/** The cases of one corpus file (`tests`, `real`, `options-matrix` or `errors`). */
export function readCorpus(name: string): Case[] {
  const text = gunzipSync(readFileSync(join(directory, `${name}.jsonl.gz`))).toString("utf8");
  return text
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Case);
}

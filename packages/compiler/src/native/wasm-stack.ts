import {
  MessageChannel,
  type MessagePort,
  receiveMessageOnPort,
  Worker,
} from "node:worker_threads";
import type { RawOptions, RawOutput } from "./backend";

/**
 * The size of the stack of the thread that compiles deep input, in MiB. The addon compiles on a 1 GiB stack (the memory is reserved,
 * not committed); this is what the WebAssembly build needs for the same limits: 150,000 nested brackets cost the parser a few
 * hundred bytes each on the stack of the engine.
 */
const STACK_MB = 1024;

/** How long the calling thread waits for one answer, in milliseconds. Deep input takes well under a second; this only ends a lost worker. */
const ANSWER_TIMEOUT_MS = 120_000;

/**
 * What the worker thread runs: it owns an instance of the module, compiles what the port sends and answers on the port, then wakes the
 * thread that waits on the flag. It is plain JavaScript in a string because a worker started from a string needs no file next to
 * this one (the package is compiled to one file per module, and the tests run the TypeScript source).
 */
const WORKER_SOURCE = `
const { workerData } = require("node:worker_threads");
const { module, port, flag } = workerData;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
let exports = new WebAssembly.Instance(module, {}).exports;
function run(source, options) {
  const sourceBytes = encoder.encode(source);
  const optionBytes = encoder.encode(JSON.stringify(options));
  const sourcePointer = exports.alloc(sourceBytes.length);
  const optionsPointer = exports.alloc(optionBytes.length);
  new Uint8Array(exports.memory.buffer, sourcePointer, sourceBytes.length).set(sourceBytes);
  new Uint8Array(exports.memory.buffer, optionsPointer, optionBytes.length).set(optionBytes);
  const resultPointer = exports.compile(sourcePointer, sourceBytes.length, optionsPointer, optionBytes.length);
  const length = new DataView(exports.memory.buffer).getUint32(resultPointer, true);
  const json = decoder.decode(new Uint8Array(exports.memory.buffer, resultPointer + 4, length));
  exports.dealloc(sourcePointer, sourceBytes.length);
  exports.dealloc(optionsPointer, optionBytes.length);
  exports.dealloc(resultPointer, length + 4);
  return JSON.parse(json);
}
port.on("message", (request) => {
  let reply;
  try {
    reply = { ok: true, output: run(request.source, request.options) };
  } catch (error) {
    exports = new WebAssembly.Instance(module, {}).exports;
    reply = { ok: false, name: error instanceof Error ? error.name : "Error", message: error instanceof Error ? error.message : String(error) };
  }
  port.postMessage(reply);
  Atomics.store(flag, 0, 1);
  Atomics.notify(flag, 0);
});
`;

type Reply = { ok: true; output: RawOutput } | { ok: false; name: string; message: string };

function isReply(value: unknown): value is Reply {
  return typeof value === "object" && value !== null && "ok" in value;
}

/**
 * Runs the compiler on a thread with a large stack, for input the stack of the calling thread is too small for.
 * @internal
 * @since 1.0.0
 */
export interface BigStack {
  /**
   * Compiles on the large stack and waits for the answer.
   * @throws Error When the module traps there too, or the thread cannot be started or does not answer.
   */
  run(source: string, options: RawOptions): RawOutput;
}

/**
 * Makes the runner for `module`. The thread starts on the first call and is kept for the next ones; it does not keep the process
 * alive. The calling thread blocks while it works, as it does when it runs the module itself.
 *
 * @param module The compiled WebAssembly module (each thread makes its own instance).
 * @returns The runner.
 * @internal
 * @since 1.0.0
 */
export function createBigStack(module: WebAssembly.Module): BigStack {
  let started: { worker: Worker; port: MessagePort; flag: Int32Array } | undefined;
  const start = (): NonNullable<typeof started> => {
    const channel = new MessageChannel();
    const flag = new Int32Array(new SharedArrayBuffer(4));
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      // Not the flags of this process: with `node -e` they would run the program again inside the worker.
      execArgv: [],
      workerData: { module, port: channel.port2, flag },
      transferList: [channel.port2],
      resourceLimits: { stackSizeMb: STACK_MB },
    });
    // The thread must not keep the process alive, and a failure to start it must not be an unhandled event.
    worker.unref();
    worker.on("error", () => {
      started = undefined;
    });
    channel.port1.unref();
    return { worker, port: channel.port1, flag };
  };
  return {
    run(source, options) {
      started ??= start();
      const { worker, port, flag } = started;
      Atomics.store(flag, 0, 0);
      port.postMessage({ source, options });
      const waited = Atomics.wait(flag, 0, 0, ANSWER_TIMEOUT_MS);
      if (waited === "timed-out") {
        started = undefined;
        void worker.terminate();
        throw new Error("@shadow-js/compiler: the WebAssembly worker did not answer.");
      }
      const message = receiveMessageOnPort(port);
      const reply: unknown = message?.message;
      if (!isReply(reply)) {
        throw new Error("@shadow-js/compiler: the WebAssembly worker sent no answer.");
      }
      if (reply.ok) return reply.output;
      const error = new Error(reply.message);
      error.name = reply.name;
      throw error;
    },
  };
}

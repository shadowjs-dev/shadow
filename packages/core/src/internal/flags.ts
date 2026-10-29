/** Node states: how stale a node is. Monotonic CLEAN < CHECK < DIRTY between two refreshes. */
export const CLEAN = 0;
/** A transitive source changed; verify sources before recomputing. */
export const CHECK = 1;
/** A direct source changed; recompute. */
export const DIRTY = 2;

/** Node kinds. */
export const KIND_SIGNAL = 0;
export const KIND_MEMO = 1;
export const KIND_EFFECT = 2;

/** Bit flags on computations. */
export const FLAG_RUNNING = 1;
export const FLAG_QUEUED = 2;
export const FLAG_DISPOSED = 4;
export const FLAG_HAS_ERROR = 8;
/** Effect belongs to the render phase (runs before user effects, synchronously at creation). */
export const FLAG_RENDER = 16;
/** Memo has not produced its first value yet. */
export const FLAG_UNINIT = 32;
/** Explicit-dependency effect whose first apply is skipped. */
export const FLAG_DEFER = 64;
/** Node is on the pull stack of updateIfNecessary (guards re-entrant ancestor refreshes). */
export const FLAG_REFRESHING = 128;
/** Memo that builds components: its body may write signals (component setup does). */
export const FLAG_ALLOW_WRITES = 256;
/** Effect always runs in the transition lane (the watcher behind useDeferredValue). */
export const FLAG_LANE = 512;
/** Effect is queued in (or parked from) the transition lane, not the urgent queues. */
export const FLAG_TRANSITION = 1024;
/** Effect was due while its owner was paused: it waits, unqueued, until the owner resumes. */
export const FLAG_PARKED = 2048;

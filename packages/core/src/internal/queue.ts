import { CLEAN, FLAG_LANE, FLAG_PARKED, FLAG_QUEUED, FLAG_RENDER, FLAG_TRANSITION } from "./flags";
import type { Computation } from "./graph";
import { rt } from "./state";

/** Urgent effects waiting for the next flush, split by phase (render effects run first). */
export const renderQueue: Computation[] = [];
export const userQueue: Computation[] = [];

/**
 * Puts an effect where it belongs. `lane` says the write that marked it was a transition write;
 * effects with FLAG_LANE always go to the lane. Lane and paused effects are handed to the transition
 * hooks (their queues live there); everything else is queued here, with no hook involved.
 */
export function place(effect: Computation, lane: boolean): void {
  if ((effect.flags & FLAG_QUEUED) !== 0) return;
  const inLane = lane || (effect.flags & FLAG_LANE) !== 0;
  const hooks = rt.hooks;
  if (hooks !== null && (inLane || effect.pauses > 0)) {
    hooks.place(effect, inLane);
    return;
  }
  effect.flags = (effect.flags & ~(FLAG_PARKED | FLAG_TRANSITION)) | FLAG_QUEUED;
  if ((effect.flags & FLAG_RENDER) !== 0) renderQueue.push(effect);
  else userQueue.push(effect);
}

/** Queues an effect for the current write: a transition write joins the lane. */
export function enqueue(effect: Computation): void {
  place(effect, rt.inTransition);
}

/** True when an urgent effect is waiting. */
export function hasPending(): boolean {
  return renderQueue.length > 0 || userQueue.length > 0;
}

/** Drops everything queued (used when a flush is aborted by the loop guard). */
export function clearQueues(): void {
  for (const queue of [renderQueue, userQueue]) {
    for (const effect of queue) {
      effect.flags &= ~(FLAG_QUEUED | FLAG_TRANSITION);
      // Back to CLEAN so the next write can notify (and re-queue) this effect again.
      effect.state = CLEAN;
    }
    queue.length = 0;
  }
  rt.hooks?.clear();
}

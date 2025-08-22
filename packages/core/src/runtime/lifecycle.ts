/**
 * Lifecycle scope management for ShadowJS components.
 *
 * Each component invocation pushes a "scope" onto a stack and marks the
 * DOM with anchors (start/end comment nodes). When a component unmounts,
 * we run all registered cleanups for that scope.
 */

type Cleanup = () => void; // A function to run on unmount.

/**
 * A scope holds a LIFO stack of cleanup callbacks for one component instance.
 */
type Scope = {
  cleanups: Cleanup[];
};

/**
 * Stack of active scopes. The current component's scope is the top of this
 * stack while its function is executing.
 */
const scopeStack: Scope[] = [];

/**
 * Mapping from a component start anchor to its end anchor and scope.
 * Used to find and dispose a component subtree later.
 */
const compStartMap = new WeakMap<Comment, { end: Comment; scope: Scope }>();

/**
 * Push a new component scope on the stack.
 *
 * @returns The newly created scope.
 */
export function pushComponentScope(): Scope {
  const s: Scope = { cleanups: [] };
  scopeStack.push(s);
  return s;
}

/**
 * Pop the current scope from the stack.
 *
 * @returns The popped scope or null if none.
 */
export function popComponentScope(): Scope | null {
  return scopeStack.pop() || null;
}

/**
 * Get the current (top) scope.
 *
 * @returns The current scope or null.
 */
export function getCurrentScope(): Scope | null {
  return scopeStack.length ? scopeStack[scopeStack.length - 1] : null;
}

/**
 * Register a cleanup to run when the current component unmounts.
 *
 * @param fn Cleanup callback.
 */
export function registerCleanup(fn: Cleanup) {
  const s = getCurrentScope();
  if (s) s.cleanups.push(fn);
}

/**
 * Run all cleanups in a scope (last-in-first-out), then clear them.
 *
 * @param scope The scope to clean up.
 */
export function runCleanups(scope: Scope) {
  for (let i = scope.cleanups.length - 1; i >= 0; i--) {
    try {
      scope.cleanups[i]!();
    } catch {
      // Intentionally ignore cleanup errors to avoid cascading failures.
    }
  }
  scope.cleanups.length = 0;
}

/**
 * Associate the component's start/end anchors and its scope.
 *
 * @param start Start anchor comment node.
 * @param end End anchor comment node.
 * @param scope Component scope.
 */
export function markComponentBoundary(
  start: Comment,
  end: Comment,
  scope: Scope
) {
  compStartMap.set(start, { end, scope });
}

/**
 * If the provided node is a component start anchor, run and remove its scope.
 *
 * @param node Potential component start anchor.
 */
function disposeIfComponentStart(node: Node | null) {
  if (!node || node.nodeType !== Node.COMMENT_NODE) return;
  const start = node as Comment;
  const entry = compStartMap.get(start);
  if (!entry) return;

  // Clean up and remove mapping so it can be GC'd
  runCleanups(entry.scope);
  compStartMap.delete(start);
}

function deepDisposeNode(node: Node) {
  // If this node is a component start anchor, clean it
  if (node.nodeType === Node.COMMENT_NODE) {
    disposeIfComponentStart(node);
  }

  // Recurse into children (elements, fragments, etc.)
  // Note: we do this BEFORE removal so we can walk the subtree.
  // Safe even for text/comment nodes that have no children.
  let child: ChildNode | null = (node as Node).firstChild || null;
  while (child) {
    const next = child.nextSibling;
    deepDisposeNode(child);
    child = next;
  }
}

/**
 * Remove all child nodes between two anchor comments and run any
 * component cleanups encountered.
 *
 * @param start Start anchor.
 * @param end End anchor.
 */
export function disposeBetween(start: Comment, end: Comment) {
  const parent = start.parentNode as ParentNode | null;
  if (!parent) return;

  let cur = start.nextSibling;
  while (cur && cur !== end) {
    const next = cur.nextSibling;
    deepDisposeNode(cur);
    parent.removeChild(cur);
    cur = next;
  }
}

// Update disposeAllChildren to use deepDisposeNode
export function disposeAllChildren(parent: ParentNode) {
  let cur = parent.firstChild;
  while (cur) {
    const next = cur.nextSibling;
    deepDisposeNode(cur);
    parent.removeChild(cur);
    cur = next;
  }
}

/**
 * Temporarily set the given scope as current while running a function.
 *
 * @param scope Scope to use while running fn.
 * @param fn Function to run.
 * @returns The result of fn().
 */
export function runInScope<T>(scope: Scope, fn: () => T): T {
  scopeStack.push(scope);
  try {
    return fn();
  } finally {
    scopeStack.pop();
  }
}

/**
 * Per-key serial write queue.
 *
 * Why: with autosave on a debounce, two writes to the same file can race
 * — the older payload finishes after the newer one and silently clobbers
 * it. Worse, an FSA `createWritable()` opens an exclusive file lock, so
 * concurrent writes can throw `NoModificationAllowedError`.
 *
 * Each call to `enqueueWrite(key, task)` chains `task` onto the previous
 * task for the same key. Tasks for different keys run in parallel.
 *
 * Use the docId for whole-document writes (the .tex bundle), and a
 * `${docId}/${filename}` key for individual sidecar files.
 */

const queues = new Map<string, Promise<unknown>>();

export function enqueueWrite<T>(
  key: string,
  task: () => Promise<T>,
): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve();
  // Chain regardless of whether `prev` resolves or rejects, so a single
  // failed write doesn't poison the queue for the rest of the session.
  const next = prev.then(task, task);
  // The stored promise is BOOKKEEPING only — chaining ignores its
  // settlement value (`prev.then(task, task)`) and flushWrites swallows —
  // so it must not re-propagate the task's rejection: when a failed write
  // is the LAST one on its key, nothing else ever consumes the stored
  // copy and it surfaces as an unhandled rejection beside the one the
  // caller already handled on `next`.
  const tracked = next.then(
    () => undefined,
    () => undefined,
  ).finally(() => {
    if (queues.get(key) === tracked) queues.delete(key);
  });
  queues.set(key, tracked);
  return next;
}

/** Wait for all in-flight writes for a key to drain. */
export async function flushWrites(key: string): Promise<void> {
  const pending = queues.get(key);
  if (pending) {
    try {
      await pending;
    } catch {
      // swallow — caller already saw the error from their own enqueueWrite
    }
  }
}

/**
 * Wait for every queue whose key is `prefix` or starts with `prefix + "/"`
 * to drain. Used by the doc-switch barrier to make sure a doc's pending
 * .tex / .bib / sidecar / pdf writes finish before the React tree tears
 * down the pipeline that authored them.
 */
export async function flushPrefix(prefix: string): Promise<void> {
  const matching: Promise<unknown>[] = [];
  for (const [key, p] of queues.entries()) {
    if (key === prefix || key.startsWith(prefix + "/")) matching.push(p);
  }
  if (matching.length === 0) return;
  await Promise.allSettled(matching);
}

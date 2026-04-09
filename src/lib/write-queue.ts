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
  const tracked = next.finally(() => {
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

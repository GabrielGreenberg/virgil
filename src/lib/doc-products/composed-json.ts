/**
 * Which JSON objects were COMPOSED from per-child cache entries (task 1631).
 *
 * `block-caches.ts` decides, once and schema-derived (`composesFromChildren`:
 * `isBlock && !isTextblock`), where a container's JSON is assembled from its
 * children's cached JSON instead of `node.toJSON()`. Every product that rides
 * on that JSON and is a pure per-child sum — the word tally today — must
 * recurse at exactly those objects and nowhere else: there the children keep
 * their identity across a keystroke, so a per-child cache hits; anywhere else
 * (a textblock, a fresh `toJSON()`, a selection slice) the children are new
 * objects and per-child entries would be pure overhead.
 *
 * So the predicate is not restated here — this set simply RECORDS its
 * outcome, and a reader asks the set. A leaf module so a pure consumer
 * (`word-count-core`) can read it without importing the serializer.
 */
import type { JSONContent } from "@tiptap/react";

const composed = new WeakSet<JSONContent>();

/** block-caches only: record that `json`'s content is cached child entries. */
export function markComposedJson(json: JSONContent): void {
  composed.add(json);
}

/** True iff `json` is a container whose children are shared cache entries. */
export function isComposedJson(json: JSONContent): boolean {
  return composed.has(json);
}

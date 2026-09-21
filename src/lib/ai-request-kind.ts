/**
 * The `ai-requests.json` KIND vocabulary — the Python-facing wire tokens, stated
 * once for every runtime reader (task 2026-09-20-682).
 *
 * The sibling of `ai-request-open.ts` (the STATUS vocabulary) and shaped the
 * same way: a frozen tuple, a compile-time exhaustiveness pin against the type
 * union, and one predicate every reader asks instead of re-inlining the set.
 *
 * ## Why a runtime list exists at all
 *
 * `AiRequestKind` is a TYPE, and a type is a promise about what the APP writes.
 * `ai-requests.json` is the one sidecar with THREE writers, two of them outside
 * the type system — the `/editor/*` Python skills read-modify-write it on disk
 * while the paper is open, and the file is hand-editable besides. So the `kind`
 * field of a row read back is a `string`, and the union is a claim about its
 * provenance, not about its contents:
 *
 *   - a newer build's kind, read by an older one;
 *   - a caller typo through `apply_response.py --synthesize`;
 *   - a hand edit, or a half-written file caught mid-save.
 *
 * Before this module the inbound direction had no gate at all, and the AI
 * window keyed two `Record`s straight off the value: an off-union kind resolved
 * `undefined` and the next dereference threw, taking down the whole window —
 * every OTHER request in the paper with it. One malformed byte on disk, total
 * failure. The outbound direction was already pinned (the routing contract,
 * `linkedCardKindFrom`'s registry-built Map); this is the inbound twin.
 *
 * The Python mirror is `_common.AI_REQUEST_KINDS` / `is_ai_request_kind`, and
 * the parity is pinned across the language line by `ai-request-open-parity.test.ts`.
 */

import type { AiRequestKind, AiRequestKindOnDisk } from "@/lib/types";

/**
 * Every member of `AiRequestKind`, as a compile-time-exhaustive tuple.
 *
 * The `satisfies` clause forbids a member that is not in the union; the
 * `_KindExhaustive` pin below forbids a union member that is not in this list.
 * Between them the list cannot drift from the type in either direction without
 * failing to compile — which is a stronger guarantee than deriving it from
 * `CARD_REGISTRY` would be, since `style-merge` is filed by the Style dropdown
 * and owns no card kind to be derived from. That the seven CARD-routed members
 * do agree with the registry is asserted separately, in
 * `ai-request-kind.test.ts`.
 */
export const AI_REQUEST_KINDS = [
  "footnote",
  "note",
  "highlight",
  "citation",
  "todo",
  "suggestion",
  "report",
  "style-merge",
] as const satisfies readonly AiRequestKind[];

// If `AiRequestKind` grows a member, this line fails to compile until it is
// added above — and thus enters `isAiRequestKind`, the AI window's display map
// and the Python parity pin at once.
type _KindExhaustive = Exclude<
  AiRequestKind,
  (typeof AI_REQUEST_KINDS)[number]
> extends never
  ? true
  : ["AiRequestKind grew a member — add it to AI_REQUEST_KINDS"];
const _kindExhaustive: _KindExhaustive = true;
void _kindExhaustive;

const KIND_SET: ReadonlySet<string> = new Set<string>(AI_REQUEST_KINDS);

/**
 * Is this on-disk `kind` one the app actually knows?
 *
 * THE one inbound gate. A consumer that keys a per-kind table off a row's kind
 * asks this first and states what an unrecognised kind renders as; it does not
 * index the table and hope.
 */
export function isAiRequestKind(kind: unknown): kind is AiRequestKind {
  return typeof kind === "string" && KIND_SET.has(kind);
}

/**
 * The kind a row gets when its `kind` field is absent or not a string.
 *
 * Distinct from an off-union STRING kind, which is preserved verbatim by the
 * read gate (`ai-requests-store.normalizeAiRequestRows`): that string is a real
 * value some writer meant, and the file is the user's only copy of it. This
 * marker stands in only where there was no value to preserve, so that every
 * consumer can treat `kind` as a string without a second `typeof` check.
 */
export const UNKNOWN_AI_REQUEST_KIND: AiRequestKindOnDisk = "unknown";

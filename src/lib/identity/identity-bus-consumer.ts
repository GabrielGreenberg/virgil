/**
 * IdentityBusConsumer — the ONE DocStructureBus consumer for the inline-atom
 * add/remove diff (PLAN D1.2 + D1.4 — "exactly ONE bus consumer for the
 * citation/footnote add/remove diff").
 *
 * Root diagnosis (T1 §2.2 / §7): an inline atom's id (`citationId`/`footnoteId`)
 * is durable only while a `\vcid`/`\vfid` marker survives. A legacy/externally-
 * edited/markerless `.tex` — or a code-view `setContent(parseLatex(text))` that
 * re-parses without remounting — hits the parser's `pendingCitationId ||
 * generateShortId()` fallback and MINTS FRESH ids. The mount-gated
 * `syncFromEditor` then can't reconcile, and anything keyed on the old id
 * (panel selection, the omni pos cache, the float store, an omni pin) strands —
 * OMNI-F3-02, CI-A3-01, and the CI-F1-02 id-survival class.
 *
 * The deep fix (PLAN D1.2): the markerless re-parse is itself observable on the
 * `DocStructureBus`. A re-parse that mints fresh ids drops every old atom and
 * adds a fresh one IN THE SAME TRANSACTION — the signature is
 * `addedCitations.length && removedCitations.length` (resp. footnotes) on ONE
 * diff, where each dropped atom maps to an added atom by its preserved
 * `command` string (resp. its preserved footnote body — for footnotes we match
 * positionally, since the diff carries no body). The consumer matches
 * dropped↔added and emits a `regenIds` remap (`oldId -> newId`) through the
 * `IdentityCascade` (the single identity writer); the cascade fans it out to
 * every registered `"inlineAtom"` migrator (selection / float / pin re-point)
 * so those surfaces survive the re-parse.
 *
 * WHY ONE CONSUMER (D1.4): both T1 (this regen-remap) and the Wave-2 themes
 * (T2 `useInlineAtomLifecycle` orphan/prune, T5 citation add-resync) want to
 * react to the SAME citation/footnote add/remove diff. If each added its own
 * bus subscription we'd grow the keystroke-sanctity permitted-consumer list by
 * +3 and re-introduce the multi-subscriber drift this whole sweep is fighting.
 * Instead there is ONE subscription here, fanning the typed diff to an ORDERED
 * list of registered policies. T1's `regenIds` is registered FIRST so the
 * downstream policies (T2/T5, Wave 2) see POST-REMAP ids. T2 and T5 own their
 * reconcile LOGIC; this module owns the SUBSCRIPTION.
 *
 * KEYSTROKE SANCTITY: the consumer subscribes to ONE channel — `onAnyChange` —
 * which is the only bus channel that delivers `addedCitations` AND
 * `removedCitations` TOGETHER in one diff (the same-transaction add+remove the
 * regen matcher keys on; the per-kind `onCitationsAdded`/`onCitationsRemoved`
 * channels fire as separate callbacks and can't be correlated). `onAnyChange`
 * is `emitCount`-gated — it fires ONLY on a structural emit, never on a plain
 * in-paragraph keystroke (which produces an empty diff). The consumer's first
 * act is an O(1) bail when no atom entered/left this transaction. Typing N
 * plain characters therefore leaves `__virgilBusStats().emitCount` flat and
 * does zero consumer work.
 *
 * This is a PURE-LOGIC module (no React, no editor import) plus a thin mount
 * hook at the bottom. The matcher + dispatcher are unit-testable in isolation.
 */

import type { CitationEntry, FootnoteEntry, StructureDiff } from "@/lib/tiptap/doc-structure";
import {
  type IdentityCascade,
  regenIdsChange,
} from "./identity-cascade";

// ---------------------------------------------------------------------------
// The regen-remap matcher (pure)
// ---------------------------------------------------------------------------

/**
 * Detect a markerless re-parse of CITATIONS and return the `oldId -> newId`
 * remap, or `null` when this diff is not a re-parse.
 *
 * A re-parse drops every existing citation atom and re-inserts a fresh one in
 * the SAME transaction, preserving each atom's `command` string (the `\cite{}`
 * source) but minting a new `citationId`. So we match the removed set against
 * the added set BY COMMAND. Duplicate commands (two `\cite{foo}`) are
 * disambiguated by DOCUMENT ORDER within the same-command group (both arrays
 * are observed in pos order), which is the order the re-parse preserves.
 *
 * Returns `null` (no remap) when either side is empty — a pure insert or a
 * pure delete is NOT a re-parse and must not be misread as one (that would
 * strand a real add/delete behind a phantom remap). Self-maps (oldId===newId)
 * are dropped from the remap so a no-op tx produces an empty remap.
 */
export function matchCitationRegen(
  removed: readonly CitationEntry[],
  added: readonly CitationEntry[],
): ReadonlyMap<string, string> | null {
  if (removed.length === 0 || added.length === 0) return null;
  return matchByKey(
    removed,
    added,
    (c) => c.command,
    (c) => c.id,
  );
}

/**
 * Detect a markerless re-parse of FOOTNOTES and return the `oldId -> newId`
 * remap, or `null` when this diff is not a re-parse.
 *
 * A `FootnoteEntry` carries no body text in the diff (footnote content is an
 * opaque `attrs.content` JSON the step-inspector does not flatten), so footnote
 * atoms can only be matched POSITIONALLY. That is sound for the whole-doc
 * re-parse — `setContent(parseLatex(text))` re-mints every footnote id but
 * rebuilds byte-identical content, so each footnote re-lands at the SAME
 * document position; the i-th removed footnote (document order) maps to the
 * i-th added footnote.
 *
 * But equal-count alone is NOT the re-parse signature: a genuine same-
 * transaction footnote swap — delete footnote X, insert a DIFFERENT footnote Y
 * in one tx — also produces 1 removed + 1 added, and a blind positional pair
 * would false-remap X→Y, stranding X's real card and mis-pointing it at Y. The
 * W2b lifecycle migrator (selection/float re-point) acts on this remap, so a
 * false remap is now actively corrupting, not merely cosmetic.
 *
 * TWO discriminators, both required (W1 review NIT — position alone is not
 * enough):
 *
 *  1. **Position-set guard** — a whole-doc re-parse re-lands every footnote at
 *     its old document position, so the i-th removed `pos` (pos-sorted) must
 *     equal the i-th added `pos`. A footnote that entered/left at a *new*
 *     position is a genuine structural edit, not a re-parse.
 *
 *  2. **Body-identity discriminator** — the same-POSITION swap (delete X at pos
 *     P, insert a different Y at the SAME pos P in one tx) defeats the position
 *     guard alone (`{P}` == `{P}`), so we ALSO require the paired footnotes to
 *     carry the SAME body. A markerless re-parse rebuilds byte-identical bodies
 *     (`setContent(parseLatex(text))` runs `richLatexToJson` on the same
 *     source), so the body text round-trips; a real swap changes the body. The
 *     caller supplies a `bodyOf(entry) => string | null` resolver (the diff's
 *     `FootnoteEntry` carries no body — the consumer reads it from the dying
 *     node in oldState / the born node in newState). When `bodyOf` is omitted
 *     (legacy call sites / unit tests of the position guard alone), only the
 *     position guard applies — preserving the W1 behavior for those paths.
 *
 * We remap a pair ONLY when BOTH discriminators agree, and return `null`
 * otherwise (the whole diff is treated as a genuine add/delete, not a re-parse).
 */
export function matchFootnoteRegen(
  removed: readonly FootnoteEntry[],
  added: readonly FootnoteEntry[],
  bodyOf?: (entry: FootnoteEntry) => string | null,
): ReadonlyMap<string, string> | null {
  if (removed.length === 0 || added.length === 0) return null;
  if (removed.length !== added.length) return null;
  // Both arrays are in document (pos) order from the diff; pair index-wise.
  const sortByPos = <T extends { pos: number }>(xs: readonly T[]) =>
    [...xs].sort((a, b) => a.pos - b.pos);
  const r = sortByPos(removed);
  const a = sortByPos(added);
  for (let i = 0; i < r.length; i++) {
    // Position-set guard.
    if (r[i].pos !== a[i].pos) return null;
    // Body-identity discriminator (only when the caller supplies bodies). A
    // re-parse preserves the body across the regen; a same-position swap does
    // not. Normalize whitespace so trivial serializer reflow doesn't read as a
    // swap; a null/null pair (both unresolvable) is treated as agreement (we
    // fall back to the position guard for that pair rather than refusing the
    // whole re-parse on a transient resolution gap).
    if (bodyOf) {
      const rb = bodyOf(r[i]);
      const ab = bodyOf(a[i]);
      if (rb !== null && ab !== null && normalizeBody(rb) !== normalizeBody(ab)) {
        return null;
      }
    }
  }
  const remap = new Map<string, string>();
  for (let i = 0; i < r.length; i++) {
    if (r[i].id !== a[i].id) remap.set(r[i].id, a[i].id);
  }
  return remap.size > 0 ? remap : null;
}

/** Collapse runs of whitespace and trim, so a footnote body's identity compares
 *  on its visible text rather than serializer reflow. */
function normalizeBody(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Match a removed set against an added set by a stable `key` (the preserved
 * attribute), disambiguating duplicate keys by document order. Returns the
 * `oldId -> newId` remap (self-maps dropped), or `null` if it produces nothing.
 */
function matchByKey<T extends { pos: number }>(
  removed: readonly T[],
  added: readonly T[],
  keyOf: (x: T) => string,
  idOf: (x: T) => string,
): ReadonlyMap<string, string> | null {
  // Bucket the added entries by key, each bucket in document order, so a
  // duplicate-key group pairs old[i]↔new[i].
  const addedByKey = new Map<string, T[]>();
  for (const a of [...added].sort((x, y) => x.pos - y.pos)) {
    const k = keyOf(a);
    let bucket = addedByKey.get(k);
    if (!bucket) {
      bucket = [];
      addedByKey.set(k, bucket);
    }
    bucket.push(a);
  }
  const cursor = new Map<string, number>();
  const remap = new Map<string, string>();
  for (const rEntry of [...removed].sort((x, y) => x.pos - y.pos)) {
    const k = keyOf(rEntry);
    const bucket = addedByKey.get(k);
    if (!bucket) continue; // removed with no added counterpart — a real delete
    const i = cursor.get(k) ?? 0;
    if (i >= bucket.length) continue; // more removed than added for this key
    cursor.set(k, i + 1);
    const oldId = idOf(rEntry);
    const newId = idOf(bucket[i]);
    if (oldId !== newId) remap.set(oldId, newId);
  }
  return remap.size > 0 ? remap : null;
}

/**
 * Per-diff body resolvers the consumer threads into regen detection. The diff's
 * `FootnoteEntry` carries no body text (it's an opaque `attrs.content` JSON the
 * step-inspector never flattens), so the footnote body discriminator
 * (`matchFootnoteRegen`'s NIT fix) needs the body read from the editor — for a
 * REMOVED footnote that's the dying node in `oldState`, for an ADDED footnote
 * the born node in `newState`. The mount hook builds these from those two
 * states; when absent, footnote regen falls back to the position guard alone.
 */
export interface RegenBodyResolvers {
  /** Body text of a REMOVED footnote (looked up in the pre-tx doc). */
  removedFootnoteBody?: (entry: FootnoteEntry) => string | null;
  /** Body text of an ADDED footnote (looked up in the post-tx doc). */
  addedFootnoteBody?: (entry: FootnoteEntry) => string | null;
}

/**
 * The full regen detection for one diff. Combines the citation + footnote
 * remaps into one `oldId -> newId` map (atom ids are globally unique across the
 * two kinds, so the two sub-maps never key-collide). Returns `null` when the
 * diff carries no re-parse signature — the O(1) fast path the consumer bails on.
 *
 * Citations match BY COMMAND (carried in the diff, no editor read needed).
 * Footnotes match by position AND, when `resolvers` supplies them, body text —
 * the same-position-swap guard the W1 review flagged. The footnote pairing in
 * `matchFootnoteRegen` is index-wise over pos-sorted arrays, so the body
 * resolver is applied per-side (removed bodies from oldState, added from
 * newState) and the matcher only needs ONE `bodyOf` — we route each entry to
 * the correct side resolver by membership.
 */
export function detectRegenRemap(
  diff: StructureDiff,
  resolvers?: RegenBodyResolvers,
): ReadonlyMap<string, string> | null {
  const citeRemap = matchCitationRegen(diff.removedCitations, diff.addedCitations);
  // Build a single `bodyOf` that dispatches to the removed- vs added-side
  // resolver. `matchFootnoteRegen` only ever asks for the body of an entry that
  // came from one of the two arrays it was handed, so identity membership in the
  // removed set selects the removed resolver; otherwise it's an added entry.
  let bodyOf: ((entry: FootnoteEntry) => string | null) | undefined;
  if (resolvers?.removedFootnoteBody || resolvers?.addedFootnoteBody) {
    const removedSet = new Set<FootnoteEntry>(diff.removedFootnotes);
    bodyOf = (entry) =>
      removedSet.has(entry)
        ? (resolvers.removedFootnoteBody?.(entry) ?? null)
        : (resolvers.addedFootnoteBody?.(entry) ?? null);
  }
  const fnRemap = matchFootnoteRegen(diff.removedFootnotes, diff.addedFootnotes, bodyOf);
  if (!citeRemap && !fnRemap) return null;
  const merged = new Map<string, string>();
  if (citeRemap) for (const [k, v] of citeRemap) merged.set(k, v);
  if (fnRemap) for (const [k, v] of fnRemap) merged.set(k, v);
  return merged.size > 0 ? merged : null;
}

// ---------------------------------------------------------------------------
// The policy registry + dispatcher
// ---------------------------------------------------------------------------

/**
 * A policy reacts to the inline-atom add/remove diff. T1's regen policy runs
 * FIRST and re-points ids via the cascade; downstream policies (T2 orphan/prune,
 * T5 add-resync — Wave 2) receive the SAME diff and the (possibly empty) remap
 * that T1 just applied, so they operate on post-remap ids.
 *
 * A policy is a plain function — themes own their reconcile LOGIC and register
 * it here rather than opening a new bus subscription (D1.4).
 */
export type InlineAtomPolicy = (
  diff: StructureDiff,
  ctx: InlineAtomPolicyContext,
) => void | Promise<void>;

export interface InlineAtomPolicyContext {
  /** The `oldId -> newId` remap T1's regen policy produced for this diff
   *  (empty map when the diff was not a re-parse). Downstream policies read it
   *  to re-point their own state without re-running the matcher. */
  readonly remap: ReadonlyMap<string, string>;
}

/**
 * The dispatcher: holds an ORDERED list of policies and fans one diff to each
 * in registration order. T1's regen policy is registered first by the mount
 * hook; Wave-2 themes append theirs via `registerPolicy`.
 *
 * NOT a module singleton — one instance per pane (the bus is per-editor), so a
 * multi-doc session keeps independent policy lists. Mirrors `IdentityCascade`.
 */
export class IdentityBusConsumer {
  private policies: InlineAtomPolicy[] = [];
  private bodyResolverSource?: (diff: StructureDiff) => RegenBodyResolvers;

  /**
   * Append a policy to the ordered list. Returns an unregister function
   * (effect-cleanup friendly). Registering the same function twice appends it
   * twice — callers register once per mount and unregister on unmount, so this
   * matches the React effect lifecycle (unlike the cascade's Set, the ORDER is
   * load-bearing here, so we keep a list).
   */
  registerPolicy(policy: InlineAtomPolicy): () => void {
    this.policies.push(policy);
    return () => {
      const i = this.policies.indexOf(policy);
      if (i >= 0) this.policies.splice(i, 1);
    };
  }

  /**
   * Install the per-tx footnote body resolver source (the W2b mount hook
   * supplies one backed by its liveness cache, so the footnote regen matcher's
   * body discriminator — the W1 review NIT — can tell a same-position swap from
   * a re-parse without an oldState read). Idempotent; the last install wins.
   * Returns an uninstaller (effect-cleanup friendly). Optional — without it,
   * footnote regen falls back to the position guard alone.
   */
  setBodyResolverSource(source: (diff: StructureDiff) => RegenBodyResolvers): () => void {
    this.bodyResolverSource = source;
    return () => {
      if (this.bodyResolverSource === source) this.bodyResolverSource = undefined;
    };
  }

  /** Number of registered policies (diagnostics / tests). */
  policyCount(): number {
    return this.policies.length;
  }

  /**
   * Dispatch one structural diff to every policy in order. The remap is
   * computed ONCE here (T1's regen detection) and threaded to every policy so a
   * downstream policy never re-runs the matcher. Awaits async policies so a
   * caller (the bus handler) can sequence on completion if needed.
   *
   * O(diff): `detectRegenRemap` is O(addedAtoms + removedAtoms) — the edit
   * size, never the doc size. On a plain keystroke this is never called
   * (`onAnyChange` only fires on a structural emit, and the bus handler bails
   * before dispatch when no atom entered/left).
   */
  async dispatch(diff: StructureDiff): Promise<void> {
    if (this.policies.length === 0) return;
    const resolvers = this.bodyResolverSource?.(diff);
    const remap = detectRegenRemap(diff, resolvers) ?? EMPTY_REMAP;
    const ctx: InlineAtomPolicyContext = { remap };
    for (const policy of this.policies) {
      try {
        await policy(diff, ctx);
      } catch (err) {
        // One broken policy must not strand the rest (DATA-LOSS isolation,
        // mirrors IdentityCascade.runIdentityChange).
        console.error("IdentityBusConsumer policy threw:", err);
      }
    }
  }
}

const EMPTY_REMAP: ReadonlyMap<string, string> = new Map();

// ---------------------------------------------------------------------------
// The T1 regen policy — registered FIRST (D1.4 ordering)
// ---------------------------------------------------------------------------

/**
 * Build the T1 regen-remap policy. When the diff is a markerless re-parse it
 * routes the remap through the `IdentityCascade` (`regenIds` change), which
 * fans it out to every registered `"inlineAtom"` migrator (panel selection,
 * the float store, the omni pin/pos cache — registered in Wave 1/2). It ALSO
 * threads the remap into the shared `ctx.remap` (via the dispatcher) so the
 * downstream Wave-2 policies see post-remap ids without re-detecting.
 *
 * A non-re-parse diff (plain add or delete) produces no remap → the policy is a
 * no-op and the cascade is never invoked.
 */
export function makeRegenPolicy(cascade: IdentityCascade): InlineAtomPolicy {
  return async (_diff, ctx) => {
    if (ctx.remap.size === 0) return;
    await cascade.runIdentityChange(regenIdsChange(ctx.remap));
  };
}

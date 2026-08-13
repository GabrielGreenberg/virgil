/**
 * **Bib-completeness for the Stack — the ONE seam every payload family runs
 * through (task 235).**
 *
 * The Stack is deliberately cross-document scope (`./types.ts`), so pulling an
 * item into a DIFFERENT doc is a first-class flow. `references.bib` is per-doc
 * and bib annotations live in a per-doc `annotations.json` sidecar, so a
 * `\cite{smith2020}` that rides a snapshot into doc B is a dangling reference
 * (LaTeX `?` on compile) unless its `BibEntry` travels with it.
 *
 * The card family had this since task 069 — `snapshotCard`'s citation arm
 * resolved `bibEntries` + `bibAnnotations` onto the payload and `applyCardDrop`
 * upserted them. The CONTENT families (a text slice, a paragraph, a heading
 * section) never did, although the remint code's own comment names them as the
 * headline case for atoms riding a slice ("select text spanning a footnote →
 * add to Stack → pull"). Same gesture, same atoms, one family bib-complete and
 * three silently not.
 *
 * > **Any payload that can carry a citation atom carries its bibliography.**
 * > ONE collect pass at the single stack-ADD door, ONE upsert pass at the
 * > single PULL door, both blind to which payload kind they are looking at.
 *
 * Three properties are load-bearing rather than incidental:
 *
 * - **The keys are DERIVED from the content, not enumerated per payload kind.**
 *   {@link collectCiteKeys} walks the payload as plain JSON and reads every
 *   `citation` node it finds, at any depth, in any field — so a cite inside a
 *   footnote body (`attrs.content`, the one place `doc.descendants()` won't
 *   enter), inside an expex example, inside a note/archive CARD's body, or
 *   inside a card body's footnote is reached by the same pass, with nothing to
 *   add when a new payload shape ships. The per-kind switch that remains
 *   ({@link declaredCiteKeys}) covers only what a card DECLARES rather than
 *   contains — a `CitationRef`'s `keys`, a `BibEntry`'s own `key` — and is
 *   exhaustive, so a new card kind must state its answer.
 *
 * - **A key is read off the atom's `command`, the same derivation the
 *   DESTINATION will use.** `useCitations.syncFromEditor` rebuilds every
 *   `CitationRef` from the live atoms with `parseCiteCommand(command).keys`, so
 *   resolving through the source's citations sidecar instead could carry a set
 *   the destination will never ask about.
 *
 * - **The carry is attached at the stack-ADD door, not inside each snapshot
 *   helper.** `addStackItem` takes a {@link StackBibCtx} as a REQUIRED
 *   argument, so a producer cannot land an item without answering the bib
 *   question — including the hand-built payloads that never went through
 *   `lib/stack/snapshot.ts` at all (`StackIcon`'s HTML5 `MIME_TEXT_INSERT`
 *   drop). That is the half a per-helper `ctx` parameter would have missed:
 *   the original defect was not a wrong snapshot helper, it was a producer that
 *   never asked.
 */

import { parseCiteCommand } from "@/lib/bib-parser";
import { ATOM_REGISTRY } from "@/lib/tiptap/atom-registry";
import type { BibEntry } from "@/lib/types";
import type {
  StackBibCarry,
  StackCardSnapshot,
  StackItem,
  StackPayload,
} from "./types";

/**
 * What the ADD door needs to turn referenced citekeys into a carry. Both
 * members are REQUIRED: the two are answered by the same doc's hooks
 * (`useCitations.getBibEntry` / `useAnnotations.getAnnotation`), and an
 * optional resolver is a decision nobody made — it reads as "this doc has no
 * bibliography" while meaning "someone forgot to wire it", which is precisely
 * the silent half of the bug this module closes.
 */
export interface StackBibCtx {
  /** Resolve a citekey to its full `BibEntry` in the SOURCE doc. */
  getBibEntry: (key: string) => BibEntry | undefined;
  /** Resolve a citekey's user-authored annotation (the bib-review note).
   *  `""`/undefined ⇒ the entry has no note. */
  getAnnotation: (key: string) => string | undefined;
}

/**
 * What a pull needs to discharge a carry — the `StackPullApi` members it uses,
 * structurally, so this module stays a leaf.
 *
 * `getAnnotation` is here because **both halves of a carry must resolve a
 * conflict the SAME way**, and only one of them can answer that on its own:
 * `upsertBibEntry` is insert-if-absent (the destination's own `BibEntry` wins,
 * by its own contract), so a `setAnnotation` that overwrites would apply the
 * SOURCE's note to the entry the destination KEPT — the user's authored note
 * replaced, in a sidecar write with no undo, on a work that may not even be the
 * one the note describes (author-year citekeys collide across papers). Reading
 * first is what lets {@link applyBibCarry} state one rule for both.
 */
export interface BibCarrySink {
  upsertBibEntry: (entry: BibEntry) => void;
  /** The destination's current note for a citekey; `""`/undefined ⇒ none. */
  getAnnotation: (key: string) => string | undefined;
  setAnnotation: (key: string, html: string) => void;
}

const CITATION_NODE_NAME = ATOM_REGISTRY.citation.nodeName;

/** Depth cap for the JSON walk. A payload comes back from a shallowly-validated
 *  localStorage envelope, so a hostile/corrupt blob must not be able to blow the
 *  stack; no real payload nests anywhere near this (a footnote body inside an
 *  example item inside a list is ~10). */
const MAX_WALK_DEPTH = 64;

/**
 * Every citekey a JSON blob REFERENCES, at any depth and in any field.
 *
 * Deliberately a plain-JSON walk rather than a schema-aware traversal: the
 * things a Stack payload can be (a serialized PM `Slice`, a node, an array of
 * nodes, a card record whose body is `JSONContent`) have no common node type,
 * and the one hiding place a schema walk gets wrong — an atom's `attrs.content`
 * literal, where a footnote keeps its body — is reached here for free, because
 * `attrs` is just another object value. `inlineAtoms` (lib/inline-content.ts)
 * is the live-editor twin of this question; it takes a `Node | JSONContent`
 * root, which a card record is not.
 */
function walkForCiteKeys(value: unknown, out: Set<string>, depth: number): void {
  if (depth > MAX_WALK_DEPTH) return;
  if (Array.isArray(value)) {
    for (const v of value) walkForCiteKeys(v, out, depth + 1);
    return;
  }
  if (!value || typeof value !== "object") return;
  const obj = value as Record<string, unknown>;
  if (obj.type === CITATION_NODE_NAME) {
    // The atom carries no key list — it carries the `\cite{…}` command, and the
    // destination re-derives its own `CitationRef.keys` from exactly this
    // string on the next `syncFromEditor`. Read it the same way.
    const attrs = obj.attrs as Record<string, unknown> | undefined;
    const command = typeof attrs?.command === "string" ? attrs.command : "";
    for (const k of parseCiteCommand(command)?.keys ?? []) out.add(k);
  }
  for (const v of Object.values(obj)) walkForCiteKeys(v, out, depth + 1);
}

/**
 * The keys a CARD payload DECLARES (as opposed to contains) — a citation card's
 * own `keys`, a bibliography card's own `key`. Every other kind declares none;
 * whatever its BODY happens to cite is found by the walk above, which runs for
 * every payload including these.
 *
 * Exhaustive over the vocabulary: a new stackable card kind must state whether
 * it is bibliographic, at compile time, rather than defaulting to "no" — the
 * default-to-nothing arm is how the content families ended up bib-incomplete in
 * the first place.
 */
function declaredCiteKeys(card: StackCardSnapshot): string[] {
  switch (card.cardKind) {
    case "citation":
      return Array.isArray(card.data.keys) ? card.data.keys.filter(Boolean) : [];
    case "bibliography":
      return card.data.key ? [card.data.key] : [];
    case "note":
    case "highlight":
    case "footnote":
    case "todo":
    case "archive":
    case "revision-comment":
    case "revision-suggestion":
    case "cutter-comment":
    case "cutter-suggestion":
      return [];
    default: {
      // A card kind from another build (the envelope is only shallowly
      // validated) declares nothing; its body is still walked.
      const unhandled: never = card;
      void unhandled;
      return [];
    }
  }
}

/**
 * Every citekey a payload references — contained atoms plus, for the two
 * bibliographic card kinds, what the card itself declares. Order is
 * insertion order (walk first, declarations after), deduped.
 */
export function collectCiteKeys(payload: StackPayload): string[] {
  const keys = new Set<string>();
  walkForCiteKeys(payload, keys, 0);
  if (payload.kind === "card") {
    for (const k of declaredCiteKeys(payload.card)) keys.add(k);
  }
  return [...keys];
}

/**
 * Resolve a payload's referenced citekeys against the SOURCE doc. Returns
 * `undefined` when there is nothing to carry, so a payload with no citations
 * persists byte-identically to before this existed.
 *
 * An annotation is carried for a referenced key even when its `BibEntry`
 * doesn't resolve: the source was already dangling there, and dropping the
 * user's note on top of that would lose the one artifact the destination could
 * still use.
 */
export function buildBibCarry(
  payload: StackPayload,
  ctx: StackBibCtx,
): StackBibCarry | undefined {
  const keys = collectCiteKeys(payload);
  if (keys.length === 0) return undefined;
  const entries: BibEntry[] = [];
  const annotations: Record<string, string> = {};
  for (const key of keys) {
    const entry = ctx.getBibEntry(key);
    if (entry) entries.push(entry);
    const ann = ctx.getAnnotation(key);
    if (ann) annotations[key] = ann;
  }
  if (entries.length === 0 && Object.keys(annotations).length === 0) {
    return undefined;
  }
  return { entries, annotations };
}

/**
 * Attach the carry to an item on its way into the Stack. Pure — returns a new
 * item; the input is untouched.
 */
export function withBibCarry(item: StackItem, ctx: StackBibCtx): StackItem {
  const bib = buildBibCarry(item.payload, ctx);
  return bib ? { ...item, bib } : item;
}

/**
 * Discharge a carry into the DESTINATION doc: fill in every referenced entry,
 * then every annotation. Runs before the payload lands, so a cite is never
 * momentarily dangling.
 *
 * **ONE conflict rule for both halves: what the destination already has, it
 * keeps.** A carry exists to make a pulled `\cite` RESOLVABLE — to fill an
 * empty slot — never to restate doc A's bibliography over doc B's. So an entry
 * whose key is already known is left alone (`upsertBibEntry`'s own contract)
 * and an annotation is written only where the destination has none. The
 * asymmetric alternative is worse than it looks: since the upsert declines, the
 * destination keeps its OWN entry, and an overwriting note would land on a work
 * that merely shares the citekey — replacing authored prose in a sidecar write
 * with no undo and no warning.
 *
 * Idempotent in both halves, which is what makes a same-doc pull write nothing
 * at all: `usePersistentState.update` bails only on referential equality, so a
 * re-`setAnnotation` of a byte-identical note would still schedule a persist.
 */
export function applyBibCarry(
  carry: StackBibCarry | undefined,
  sink: BibCarrySink,
): void {
  if (!carry) return;
  for (const entry of carry.entries) sink.upsertBibEntry(entry);
  for (const [key, html] of Object.entries(carry.annotations)) {
    if (!html) continue;
    if (sink.getAnnotation(key)) continue;
    sink.setAnnotation(key, html);
  }
}

// ── Legacy envelope normalization ─────────────────────────────────────
/** The pre-235 per-card bib fields, as they sit in a persisted blob. */
interface LegacyCardBib {
  bibEntries?: unknown;
  bibAnnotations?: unknown;
  annotation?: unknown;
}

/**
 * Lift the pre-235 per-card bib sidecars onto the unified carrier.
 *
 * Called once per item by `readEnvelope`, the single read door for both the
 * hook and `readStackItem`, so nothing downstream ever sees the old shape. The
 * fields are read off an untyped blob because the TYPES no longer describe them
 * — that is the point of deleting them rather than merely leaving them
 * unwritten: a field that still exists on the type is a field a future writer
 * can populate, re-forking the carrier this module exists to unify.
 *
 * A blob written by this build passes through untouched (it already has `bib`).
 */
export function normalizeStackItemBib(item: StackItem): StackItem {
  if (item.bib || item.payload?.kind !== "card") return item;
  const legacy = item.payload.card as unknown as LegacyCardBib | null;
  if (!legacy) return item;
  const entries = Array.isArray(legacy.bibEntries)
    ? (legacy.bibEntries as BibEntry[]).filter(
        (e) => e && typeof e === "object" && typeof e.key === "string",
      )
    : [];
  const annotations: Record<string, string> = {};
  if (legacy.bibAnnotations && typeof legacy.bibAnnotations === "object") {
    for (const [k, v] of Object.entries(
      legacy.bibAnnotations as Record<string, unknown>,
    )) {
      if (typeof v === "string" && v) annotations[k] = v;
    }
  }
  // The `bibliography` variant's own note was a bare `annotation` string keyed
  // implicitly by its entry's key.
  if (typeof legacy.annotation === "string" && legacy.annotation) {
    const card = item.payload.card;
    if (card.cardKind === "bibliography" && card.data?.key) {
      annotations[card.data.key] = legacy.annotation;
    }
  }
  if (entries.length === 0 && Object.keys(annotations).length === 0) {
    return item;
  }
  return { ...item, bib: { entries, annotations } };
}

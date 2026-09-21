/**
 * Host writability — ONE derivation of "what may a READ-MOSTLY host persist?",
 * read by BOTH layers that used to answer it separately (task 556).
 *
 * The Library Reader mounts a paper as a `library-paper:<citekey>` doc under
 * `READER_CHROME`. Its main text is read-only (that is `editable: false` on
 * the editor and is not this module's business), but it deliberately lets the
 * user ANNOTATE while reading: `READER_CHROME.editableCardKinds` names the
 * card kinds whose cards stay editable, and the sidecar those kinds live in is
 * the ONE thing a Reader session may write to the paper folder. Everything
 * else about the paper — the `.tex`, the doc bundle, the bib, the PDF, the
 * figure rasters, every other card sidecar, and the Reader's own VIEW state
 * (session-only by design, `library/READER_INHERITANCE.md`) — belongs to the
 * library's indexing skills and is REFUSED.
 *
 * Before 556 that answer was given TWICE, and the two disagreed:
 *
 *   - `isSidecarWriteAllowed(chrome, filename)` — the UI-layer permit, asked by
 *     `usePersistentState` before every disk write — derived it from the
 *     chrome's `editableCardKinds`, and PERMITTED `notes.json`.
 *   - both storage backends' write funnels asked a strictly stronger, blind
 *     question — `docId.startsWith("library-paper:")` — and REFUSED every
 *     write for such a doc unconditionally, `notes.json` included.
 *
 * So a note written in the Reader looked saved and was never written; the
 * UI-layer permit was dead in production (every write it granted was refused
 * one layer down); `usePersistentState` stamped `hasMutatedRef` for a write
 * that never landed; and the prose on each side asserted its own answer. A
 * permit granted at one layer and revoked blind at another is not a policy —
 * it is two policies, and the user meets whichever one is lower.
 *
 * > **The set of sidecars a `library-paper:` doc may write is DERIVED — once,
 * > here — from the Reader chrome's `editableCardKinds` through the
 * > card-kind → sidecar map, and the storage funnels ask THIS module rather
 * > than the docId prefix. Change `READER_EDITABLE_CARD_KINDS` and the UI
 * > permit and the storage funnel move TOGETHER; neither can disagree with
 * > the other again.**
 *
 * Placement: an import-free leaf (the rule `latex-markers.ts` /
 * `node-attr-sets.ts` / `sidecar-value.ts` each earned) — the storage backends
 * cannot import the React-adjacent chrome config, and a facet the layer that
 * needs it cannot import will be re-copied. `chrome-config.ts` reads THIS
 * module for the Reader's kinds and for the derivation; it does not hold a
 * copy. The `library-paper:` docId vocabulary lives here too, so the prefix is
 * spelled ONCE rather than in each backend and each Reader component.
 *
 * NOT this module's business: whether the MAIN TEXT is editable (that is the
 * editor's `editable` prop), and whether a card kind's editor mounts live or
 * read-only (that is `chrome.editableCardKinds` read directly by the card
 * chrome). This module answers only what reaches DISK.
 */

import type { CardKind } from "@/panels/_shared/types";

// ---------------------------------------------------------------------------
// The `library-paper:` docId vocabulary (one speller)
// ---------------------------------------------------------------------------

/**
 * Library Reader docId convention: `library-paper:<citekey>` resolves to a
 * paper folder under `<library>/papers/<citekey>/`. Such ids are minted by the
 * Reader's mount layer, registered one-shot via `setDocHandle`, and are
 * deliberately NOT in either backend's doc index (so they never pollute the
 * main app's recents) — their metadata is synthesized on demand.
 */
export const LIBRARY_PAPER_PREFIX = "library-paper:";

/** Mint the docId the Reader mounts a library paper under. */
export function libraryPaperDocId(citekey: string): string {
  return `${LIBRARY_PAPER_PREFIX}${citekey}`;
}

/** Is this docId a Library Reader paper? */
export function isLibraryPaperDoc(docId: string): boolean {
  return docId.startsWith(LIBRARY_PAPER_PREFIX);
}

/** The citekey a `library-paper:` docId names. Caller has checked the prefix. */
export function libraryPaperCitekey(docId: string): string {
  return docId.slice(LIBRARY_PAPER_PREFIX.length);
}

// ---------------------------------------------------------------------------
// Card kind → sidecar, and the derivation both layers read
// ---------------------------------------------------------------------------

/**
 * Map from a `CardKind` → the per-doc sidecar a MUTATION of that kind lands in.
 * Total over the kind union by construction (`Record<CardKind, …>`, not a
 * `Partial`), so a new card kind cannot be added without answering the
 * question; `null` means the kind has no sidecar of its own to write.
 *
 * This is the *card-content* sidecar set ONLY — it intentionally omits non-card
 * state (focus-mode, document-settings, bib-settings, dictionary, view-ui),
 * which a read-mostly host never persists at all (its view state is
 * session-only, and a paper's settings belong to the library).
 *
 * `highlight` shares `notes.json` with `note`, and each twin suggestion kind
 * shares its panel's file with the comment kind beside it — one hook owns the
 * pair in every case. The two `null`s are the SYSTEM kinds (`bib` is derived
 * from the `.bib`, `error` from the linter), both of which declare
 * `lifecycle.delete: false`: they have nothing of their own to write.
 *
 * WIDENED (task 637). It used to stop at the eight kinds whose sidecar the
 * Reader's *editable* set could name, on the claim that footnote / citation /
 * example "have no standalone editable sidecar … a read-mostly host has no
 * editor for them and writes nothing for them." The first half was simply
 * false (`footnotes.json` / `citations.json` / `examples.json` are three of the
 * loudest content sidecars in the folder) and the second half described the
 * TEXT BODY only: the Reader mounts those panels and offered every one of their
 * cards a live trash button, whose press wrote nothing and said nothing. A map
 * that answers for only the kinds one caller happened to ask about is a map the
 * next caller reads a false `undefined` out of — so it is total now, and the
 * second caller ({@link cardMutationWritable}) is what this file gained it for.
 */
export const CARD_KIND_SIDECAR: Readonly<Record<CardKind, string | null>> =
  Object.freeze({
    note: "notes.json",
    highlight: "notes.json",
    footnote: "footnotes.json",
    citation: "citations.json",
    example: "examples.json",
    todo: "todos.json",
    report: "reports.json",
    "report-request": "reports.json",
    archive: "archive.json",
    "revision-comment": "revisions.json",
    "revision-suggestion": "revisions.json",
    "cutter-comment": "cutter.json",
    "cutter-suggestion": "cutter.json",
    bib: null,
    error: null,
  });

/**
 * The card kinds the Library Reader keeps editable — `READER_CHROME` reads
 * this constant (never a literal of its own) so the chrome's declaration and
 * the storage funnel's derivation are ONE value.
 *
 * Reader writes exist solely so a user can annotate while reading: today that
 * is the `note` kind (and, through the shared sidecar, `highlight`). Widening
 * it here widens BOTH the card chrome's live editors and what reaches the
 * paper folder — that is the point, and it is a product decision, not a
 * tidy-up.
 */
export const READER_EDITABLE_CARD_KINDS: readonly CardKind[] = Object.freeze([
  "note",
] as const);

/**
 * THE derivation. The sidecar filenames a host restricted to
 * `editableCardKinds` may persist; `null` means UNRESTRICTED (no whitelist —
 * the main app, `FULL_CHROME`, writes everything).
 *
 * A host that names an `editableCardKinds` whitelist is a READ-MOSTLY host:
 * it persists exactly the card sidecars it lets the user edit and NOTHING
 * ELSE. In particular a non-card sidecar (focus / document-settings /
 * dictionary / view state) is refused under such a host — pre-556 the UI
 * permit said "out of scope, allowed" for those while the storage funnel
 * refused them all, which was the same two-layer disagreement this module
 * closes, one file over. The effective behaviour (nothing but the editable
 * card sidecars reaches disk) is unchanged; what changed is that both layers
 * now SAY so.
 */
export function writableSidecarsFor(
  editableCardKinds: readonly CardKind[] | undefined,
): ReadonlySet<string> | null {
  if (!editableCardKinds) return null;
  const out = new Set<string>();
  for (const kind of editableCardKinds) {
    const file = CARD_KIND_SIDECAR[kind];
    if (file) out.add(file);
  }
  return out;
}

/**
 * The Reader's answer, derived ONCE from its declared kinds: the sidecars a
 * `library-paper:` doc may write. Today `{ "notes.json" }`.
 */
export const LIBRARY_PAPER_WRITABLE_SIDECARS: ReadonlySet<string> =
  writableSidecarsFor(READER_EDITABLE_CARD_KINDS) ?? new Set();

/**
 * **May a MUTATION of a card of this kind land on disk under a host restricted
 * to `editableCardKinds`?** The same question {@link writableSidecarsFor}
 * answers for a filename, asked in the vocabulary a CARD surface has in hand.
 *
 * This is the derivation task 637 was missing. The permit reached the storage
 * funnel but not the card's DELETE affordance: `cardEditable` in
 * `panel-primitives.tsx` was threaded into the inner rich-text field only, so a
 * Reader-mounted footnote or citation card rendered a live trash button whose
 * press updated React state, wrote nothing, said nothing, and was undone by the
 * next reload. One question had two answers at two layers — exactly the split
 * this module exists to close, one affordance over.
 *
 * Note what it is NOT: `kind ∈ editableCardKinds`. Those coincide for most
 * kinds and come apart on `highlight`, which is not editable in the Reader (it
 * has no body to edit) yet shares the writable `notes.json` with `note` — so a
 * Reader highlight's delete DOES land and must keep being offered. Whether a
 * kind's EDITOR mounts live and whether its mutations reach DISK are two
 * questions; this module owns only the second, and asking the first in its
 * place would silently retire a working control.
 *
 * `undefined` kinds (no whitelist — the main app) → always writable. Under a
 * whitelist a kind with no sidecar of its own fails CLOSED, matching
 * `isSidecarWriteAllowed`'s answer for a filename nobody declared.
 */
export function cardMutationWritable(
  editableCardKinds: readonly CardKind[] | undefined,
  kind: CardKind,
): boolean {
  const writable = writableSidecarsFor(editableCardKinds);
  if (writable === null) return true;
  const file = CARD_KIND_SIDECAR[kind];
  return file !== null && writable.has(file);
}

/**
 * May `filename` (a `virgil/` sidecar) be written for `docId`? A normal doc:
 * always. A `library-paper:` doc: only a sidecar in the derived set. This is
 * the question both backends' SIDECAR writers ask (`writeSidecar` /
 * `mutateSidecar`, disk AND local-store branches).
 */
export function libraryPaperSidecarWritable(
  docId: string,
  filename: string,
): boolean {
  if (!isLibraryPaperDoc(docId)) return true;
  return LIBRARY_PAPER_WRITABLE_SIDECARS.has(filename);
}

// ---------------------------------------------------------------------------
// The FSA funnel's question, over its subkey vocabulary
// ---------------------------------------------------------------------------

/**
 * Every FSA write enters `enqueueDocWrite(h, subkey, task)`, and a sidecar
 * write's subkey is `virgil/<filename>` — spelled through this door by both
 * backends so the funnel below can recognise a sidecar write WITHOUT parsing a
 * convention it does not own.
 */
export const SIDECAR_SUBKEY_PREFIX = "virgil/";

/**
 * The write-funnel subkey for the doc's bibliography — a CONSTANT, not
 * `bib/<filename>` (task 691).
 *
 * A subkey is the serial queue's key, and a queue only orders writes from the
 * moment they are ENQUEUED. While the key carried the `.bib` FILENAME, no bib
 * write could be enqueued in its caller's own tick: the name had to be
 * resolved first, and resolving it is three-plus IO round trips (the doc
 * handle out of IndexedDB, the doc index, a read of the `.tex` to find its
 * `\bibliography{}` declaration, sometimes a directory scan). Two bib writes
 * issued back-to-back therefore reached the queue in whatever order their
 * resolutions happened to finish — and a Save that changed an entry's fields
 * AND its citekey was exactly such a pair, so the field edit could be applied
 * to a list in which its target had already been renamed, match nothing, and
 * be silently declined.
 *
 * A doc has ONE bibliography, so the queue's key is a fact about the DOC, not
 * about a filename we must do IO to learn. With the name resolved INSIDE the
 * queued task instead, the enqueue is synchronous — bib writes are FIFO in
 * CALL order, for every writer — and the name is resolved fresh inside the
 * lock, so a `\bibliography{}` declaration that changed under the app can
 * never be served from a stale cache.
 */
export const BIB_WRITE_SUBKEY = "bib";

export function sidecarWriteSubkey(filename: string): string {
  return `${SIDECAR_SUBKEY_PREFIX}${filename}`;
}

/**
 * May a write with this funnel `subkey` land for `docId`? A normal doc:
 * always. A `library-paper:` doc: ONLY a sidecar write (`virgil/<filename>`,
 * no deeper path) whose filename is in the derived set. The `.tex`, the
 * bundle (`"bundle"`), the bib, the PDF (`"pdf"`), the figure writers
 * (`virgil/figures-cache/…`, a deeper path) and the sidecar cleanup
 * (`"virgil-cleanup"`) all answer `false` — those are the library's own
 * artifacts, managed by the indexing skills, and that refusal is UNCHANGED
 * from the pre-556 blanket guard.
 */
export function libraryPaperWriteAllowed(docId: string, subkey: string): boolean {
  if (!isLibraryPaperDoc(docId)) return true;
  if (!subkey.startsWith(SIDECAR_SUBKEY_PREFIX)) return false;
  const filename = subkey.slice(SIDECAR_SUBKEY_PREFIX.length);
  if (filename.includes("/")) return false; // a figure raster / index, not a sidecar
  return libraryPaperSidecarWritable(docId, filename);
}

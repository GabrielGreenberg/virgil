/**
 * **The write-side preservation gate** — task 357, the companion to 350-D.
 *
 * 350-D gated the LOAD-writeback: the automatic re-stamp `readDocBundle` fires
 * on open. It deliberately exempted the autosave, on the stated ground that
 * once the user has edited, the model IS their document and refusing to save
 * their typing would be a worse failure than the one being guarded.
 *
 * That rationale is sound and it does not cover `writeDocBundle`'s OTHER
 * caller. `flushNow` ([useDocument.ts](hooks/useDocument.ts)) writes the whole
 * bundle on an **anchor-UUID mint** — one card gesture (a grab-handle click, an
 * omni open, a card drag) on a uuid-less paragraph mints an id and persists
 * immediately, **with no typing at all**. So a lossy parse reached disk on a
 * gesture the user reasonably believes is read-only, and it replaced
 * `virgil.json` wholesale on the way, carrying sidecar damage no `.tex` gate
 * can see.
 *
 * > **A write that lands before the user has genuinely edited is still an
 * > AUTOMATIC write, whatever function issued it. It is measured against what
 * > was READ, and it refuses on a shrink.** After a real user edit the model is
 * > theirs and the gate steps aside — the 350-D rationale, applied at the
 * > boundary it actually names.
 *
 * ## Why RETAINED counts rather than a re-read
 *
 * The comparison needs the bytes as they were ON DISK AT LOAD, and by write
 * time the file may already have been re-stamped by the load-writeback (whose
 * own gate passed). Re-reading would compare the model against Virgil's own
 * output and measure nothing. So the counts are captured once, at the read, and
 * carried per doc.
 *
 * ## What counts as a REAL user edit
 *
 * NOT `docChanged` — that is precisely the trap, because an anchor mint IS a
 * docChanged transaction and a naive test re-opens the hole this closes. The
 * test is whether the transaction is UNDOABLE: a mint is dispatched with
 * `addToHistory: false` (see `anchor-mint-signal.ts`, which documents that
 * shape), as are the other system writes — backfills, normalizers, re-stamps.
 * A user's typing, paste and drop all go into history.
 *
 * That is a positive test rather than a denylist of system transactions, so a
 * NEW system write cannot silently count as a user edit merely by not being on
 * a list — it has to opt IN by being undoable. **Stated limit:** it is a
 * CONVENTION, not an enforced invariant. A system write that forgets
 * `addToHistory: false` would open the gate early. The failure direction was
 * chosen deliberately — see below.
 *
 * ## The fail direction
 *
 * Refusing a legitimate save is LOUD (the caller surfaces it) and the user's
 * work is still in the editor; allowing a lossy write is SILENT and permanent.
 * So every ambiguity resolves toward refusing: no retained baseline means the
 * gate cannot speak and the write proceeds (it has nothing to compare), but a
 * retained baseline plus an unproven user edit means the write is measured.
 *
 * ## A STANDING refusal suspends the step-aside (357 hole 4)
 *
 * The step-aside above rests on the model faithfully representing the file.
 * Once EITHER gate has refused — this one, or 350-D's load-writeback gate —
 * that premise is disproven for this document, so while the refusal stands
 * unanswered every write is measured, user edit or not. Otherwise the gates
 * only delay the loss by one gesture: the user types into the lossy model and
 * the very next autosave writes what was just refused.
 *
 * The refusal is published to [preservation-notice.ts](preservation-notice.ts),
 * which is also where the user's ACKNOWLEDGMENT lands — and an acknowledgment
 * outranks everything here, because refusing a user who has been told and has
 * decided is the worse failure.
 */
import {
  compareRegionBags,
  measureContentBag,
  type WordBag,
} from "@/lib/tex-preservation";
import { findDocumentBoundary } from "@/lib/latex-lexer";
import {
  clearPreservationNotice,
  isPreservationAcknowledged,
  isWriteProtected,
  type PreservationRefusalDetail,
} from "@/lib/preservation-notice";
import type { Transaction } from "@tiptap/pm/state";

/** Per-region word counts of the bytes a doc was LOADED from. */
export interface RetainedCounts {
  preamble: number;
  body: number;
}

/** Per-region word MULTISETS of the bytes a doc was loaded from — what the
 *  comparison actually needs since task 357's shortfall measure. `RetainedCounts`
 *  is the totals projected out of these, for the mount gate's one reader. */
interface RetainedBags {
  preamble: WordBag;
  body: WordBag;
}

interface Entry {
  bags: RetainedBags;
  /** Set once a real user edit lands; the gate steps aside from then on. */
  userEdited: boolean;
}

/** Keyed by docId — which IS the per-document key, so this is the registry
 *  shape AGENTS.md asks for rather than a single module slot. */
const byDoc = new Map<string, Entry>();

/** Split at the LIVE `\begin{document}` (task 375's one door), mirroring
 *  `tex-preservation`'s own regions so the two gates cannot disagree about what
 *  a region is — including about which occurrence of the token is real. */
function regionBags(tex: string): RetainedBags {
  const i = findDocumentBoundary(tex).beginDoc;
  const preamble = i === -1 ? "" : tex.slice(0, i);
  const body = i === -1 ? tex : tex.slice(i);
  return {
    preamble: measureContentBag(preamble),
    body: measureContentBag(body),
  };
}

/** Capture the baseline at `readDocBundle`. Idempotent per load: a re-read of
 *  the same doc RESETS the baseline and the edited flag, because a fresh load
 *  is a fresh document as far as this gate is concerned. */
export function retainLoadedCounts(docId: string, latex: string): void {
  byDoc.set(docId, { bags: regionBags(latex), userEdited: false });
  // A fresh load is a fresh document for BOTH halves of this gate, so the
  // standing refusal notice is dropped here rather than at each backend's read
  // — one door, so the baseline and the posture cannot disagree about what a
  // reload means. The load-writeback that follows re-arms it if the parse is
  // still lossy (task 357 hole 4).
  clearPreservationNotice(docId);
}

/**
 * Is this transaction a REAL user edit? See the module header: undoable and
 * doc-changing, never merely doc-changing.
 */
export function isRealUserEdit(tr: Transaction | null | undefined): boolean {
  if (!tr?.docChanged) return false;
  return tr.getMeta("addToHistory") !== false;
}

/** Record that the user has genuinely edited this doc; the gate steps aside. */
export function noteUserEdit(docId: string): void {
  const e = byDoc.get(docId);
  if (e) e.userEdited = true;
}

/**
 * The per-region word counts this doc was LOADED from, or `null` when this
 * process never loaded it (a `initialContent` prop, the Library Reader, a
 * hand-built fixture). Read by the MOUNT gate (task 357 hole 3), which needs
 * the same baseline this one measures against so the two cannot disagree about
 * how much a document had before Virgil touched it.
 */
export function getRetainedCounts(docId: string): RetainedCounts | null {
  const bags = byDoc.get(docId)?.bags;
  return bags ? { preamble: bags.preamble.total, body: bags.body.total } : null;
}

/** Test hook / doc-close cleanup. */
export function clearRetained(docId?: string): void {
  if (docId === undefined) byDoc.clear();
  else byDoc.delete(docId);
}

export interface WriteVerdict {
  ok: boolean;
  region: "preamble" | "body";
  before: number;
  after: number;
  lost: number;
  allowed: number;
}

/**
 * Would this write lose content the document was loaded with? `null` means the
 * gate has nothing to say — no retained baseline (a doc this process never
 * loaded), or the user has genuinely edited and the model is now theirs.
 *
 * The slack mirrors `tex-preservation`'s, deliberately: one rule, two callers.
 */
export function checkWriteAgainstRetained(
  docId: string,
  latex: string,
): WriteVerdict | null {
  // The user's informed choice outranks everything here (task 357 hole 4):
  // once they have answered a standing refusal, refusing their saves would be
  // the worse failure — and the intact bundle is already in `virgil/.history/`
  // from the snapshot the first refusal forced.
  if (isPreservationAcknowledged(docId)) return null;
  const entry = byDoc.get(docId);
  if (!entry) return null;
  // The 350-D step-aside — "after a real user edit the model is theirs" —
  // rests on the model faithfully representing the file. A STANDING REFUSAL is
  // precisely the evidence that it does not, so while one is unanswered the
  // step-aside is suspended and every write is measured. Without this the
  // gates only delay the loss by one gesture: the user types into the lossy
  // model and the next autosave writes exactly what was just refused.
  if (entry.userEdited && !isWriteProtected(docId)) return null;
  const now = regionBags(latex);
  for (const region of ["body", "preamble"] as const) {
    // ONE comparison, shared with the load gate (task 357): same slack, same
    // shortfall rule. A second copy here is exactly how the two gates would
    // come to disagree about what counts as a loss.
    const v = compareRegionBags(entry.bags[region], now[region]);
    if (!v.ok) {
      return {
        ok: false,
        region,
        before: v.before,
        after: v.after,
        lost: v.lost,
        allowed: v.allowed,
      };
    }
  }
  return null;
}

/** The measured shape of a write-gate refusal, in the refusal CHANNEL's
 *  vocabulary — the twin of `preservationRefusalDetail` on the load side. */
export function writeRefusalDetail(v: WriteVerdict): PreservationRefusalDetail {
  return {
    source: "write",
    region: v.region,
    before: v.before,
    after: v.after,
    lost: v.lost,
    allowed: v.allowed,
  };
}

/** One-line diagnostic, shared by both backends so they cannot drift. */
export function describeWriteRefusal(v: WriteVerdict, docId: string): string {
  return (
    `[virgil] REFUSED an automatic write for "${docId}": it would have ` +
    `dropped ${v.lost} of ${v.before} content words from the document ` +
    `${v.region} (${v.after} would remain; at most ${v.allowed} may be lost), ` +
    `and the user has not edited this document yet — so nothing here is their ` +
    `change. The .tex on disk is UNCHANGED. Virgil's write-side preservation ` +
    `gate (task 357).`
  );
}

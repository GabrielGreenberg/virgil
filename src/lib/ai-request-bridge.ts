/**
 * Bridges card-level `aiRequest: boolean` flags into the unified
 * `ai-requests.json` queue.
 *
 * The editor has two parallel signals for "the user wants Claude to act on
 * this":
 *
 *   1. Per-card sticky flags on notes / highlights / todos / cutter-comments /
 *      revision-comments / report-requests / footnotes (BUG #55). Each lives in
 *      its panel sidecar (footnotes in `footnotes.json` via FootnoteRef.aiRequest).
 *   2. The unified `ai-requests.json` queue (drafted, submitted, complete).
 *
 * Skills run from outside the app and need a single inbox they can drain.
 * This module collapses (1) into (2): when a card flag toggles on, we add
 * a corresponding entry with `linkedTo` set; when it toggles off, we drop
 * it. The fulfillment skill clears the card flag *and* flips the request
 * to `complete` when it finishes.
 */

import { generateEntityId } from "@/lib/uuid";
import { readSidecar, writeSidecar } from "@/lib/storage";
import type {
  AiRequest,
  AiRequestLink,
  AiRequestsState,
} from "@/lib/types";
import {
  getActiveHandle,
  isStalePipelineError,
} from "@/lib/multi-window/doc-pipeline";
import { publishAiRequests } from "@/lib/ai-request-events";
import { isRequestOpen, isTerminalStatus } from "@/lib/ai-request-open";
import { CARD_REGISTRY } from "@/cards/card-registry";
import type { CardKind } from "@/cards/types";

const EMPTY: AiRequestsState = { requests: [] };

/**
 * A request that `terminate` mode must close: it's linked to `link`'s card AND
 * not yet terminal. States the terminate-match rule ONCE (task 253) so every
 * matching row is closed, never just the first. The terminal half is the shared
 * `isTerminalStatus` SSOT — the same source `isRequestOpen` reads for its clause
 * 1, so a future terminal `AiRequestStatus` lands in both predicates at once
 * (task 221). A card can legitimately carry TWO non-terminal linked rows — a
 * closed-to-the-drain answered-L3 (`in-progress`+`resultId`) plus a fresh
 * re-toggled `pending` row (task 043) — and archive/delete means the card is
 * gone, so BOTH must close.
 */
function isLinkedNonTerminal(r: AiRequest, link: AiRequestLink): boolean {
  return (
    !!r.linkedTo &&
    r.linkedTo.panel === link.panel &&
    r.linkedTo.cardId === link.cardId &&
    !isTerminalStatus(r.status)
  );
}

export interface BridgeContext {
  /** Plain text excerpt of the card body — surfaces in the request as `text`. */
  text: string;
  /** Paragraph UUIDs the source card is anchored to. */
  paragraphIds?: string[];
  /** Mode B selectedText snapshot, if any. */
  selectedText?: string;
}

/**
 * How the bridge should reconcile a card's linked `ai-requests.json` row.
 *
 * - `"toggle"` — the reversible per-card flag semantics: `value=true`
 *   adds/refreshes an OPEN row, `value=false` drops it. Deliberately protects an
 *   answered-L3 row (`in-progress`+`resultId`) from a stray toggle-off (task 043).
 * - `"terminate"` — the card is **gone** (archived / deleted), or has left its
 *   aiRequest identity (a flag-dropping morph). A terminal transition: close
 *   EVERY linked NON-terminal row (each a plain open row OR an answered-L3 row)
 *   to `complete` regardless of current openness — a card can carry two at once
 *   (task 253). The UI twin of the Python `close_linked_request(force=True)` on
 *   `cmd_archive` (task 093).
 *
 * THERE IS NO DEFAULT, DELIBERATELY (task 313). `mode` used to default to
 * `"toggle"`, which read as a harmless convenience and was in fact the reason a
 * real bug stayed silent: the morph leg's unbridge callback was written
 * `(kind, cardId) => bridgeCardAiRequestFlag(docId, kind, cardId, false, ctx)`
 * — the terminal transition simply never mentioned a mode, inherited the
 * reversible one, and left answered-L3 rows live forever. An omitted mode is
 * never a safe guess here, because the two clients want opposite fail-safes: a
 * checkbox must PRESERVE an answered row, a card that is going away must CLOSE
 * it. So every writer states which it is, and forgetting is a compile error
 * rather than a silent vote for reversibility.
 */
export type AiRequestSyncMode = "toggle" | "terminate";

/**
 * Sync a card-level `aiRequest` flag toggle into `ai-requests.json`.
 *
 * - `value=true` and no existing linked request → add one (`status: "pending"`).
 * - `value=true` and an existing linked request → leave it (idempotent).
 * - `value=false` and an existing linked request → drop it.
 *
 * Routing is REGISTRY-DECLARED (R29): the request `kind` and the
 * `linkedTo.panel` wire token both come from `CARD_REGISTRY[kind].aiRequest`
 * — the per-call-site panel/kind literals (and the old local panel→kind
 * fan-out table) are gone. The emitted tokens are byte-identical to the
 * legacy literals (pinned by `ai-request-routing-contract.test.ts`), so the
 * idempotent open-request match keeps finding existing on-disk requests.
 *
 * Best-effort: errors are logged, not thrown. The card flag is the source
 * of truth for the panel UI; a stale `ai-requests.json` will self-heal on
 * the next toggle or skill drain.
 */
export async function bridgeCardAiRequestFlag(
  docId: string | null,
  cardKind: CardKind,
  cardId: string,
  value: boolean,
  ctx: BridgeContext,
  // REQUIRED — see `AiRequestSyncMode`. The former `= "toggle"` default is what
  // made task 313's stranded answered-L3 rows invisible.
  mode: AiRequestSyncMode,
): Promise<void> {
  if (!docId) return;
  const routing = CARD_REGISTRY[cardKind].aiRequest;
  if (!routing) {
    // A kind with no declared routing has no aiRequest flag to bridge —
    // reaching here is a caller bug; make it loud in dev, no-op in prod.
    if (process.env.NODE_ENV !== "production") {
      console.error(
        `[ai-request-bridge] card kind "${cardKind}" declares no aiRequest ` +
          `routing on CARD_REGISTRY; flag toggle ignored.`,
      );
    }
    return;
  }
  const link: AiRequestLink = { panel: routing.linkPanel, cardId };
  const handle = getActiveHandle(docId);
  if (!handle) return;

  let state: AiRequestsState | null;
  try {
    state = await readSidecar<AiRequestsState>(docId, "ai-requests.json", EMPTY);
  } catch {
    return;
  }
  // Best-effort contract (this module never throws): tolerate a storage backend
  // that returns null/undefined for a missing sidecar instead of the default —
  // treat it as an empty queue rather than dereferencing null.
  const requests = Array.isArray(state?.requests) ? state.requests : [];

  // Archive intent (task 093): the card is gone, so terminate EVERY linked
  // non-terminal row — a plain-open row OR a 043-protected answered-L3
  // (`in-progress`+`resultId`) — to `complete`, regardless of current openness.
  // NOT just the first (task 253): a single card can carry two non-terminal
  // linked rows at once (an answered-L3 row closed to the drain plus a fresh
  // re-toggled `pending` row, per task 043), and archive/delete means the card
  // is gone, so all of them must close or a stray row is re-served for a card
  // that no longer exists. This is the SINGLE ai-requests.json writer on archive
  // (callers reach it via `clearAiRequestForKind` → the panel setters with
  // `mode: "terminate"`), so it never races a second toggle-off write.
  // Byte-mirror of Python `close_linked_request(force=True)` on `cmd_archive`:
  // both stamp `status: complete` + `result: "auto-applied"`. Idempotent — an
  // unmatched or already-terminal card writes nothing (no spurious terminal row,
  // no needless write), and the `value` argument is irrelevant here (archive is
  // always a resolve).
  if (mode === "terminate") {
    let matched = false;
    const terminated = requests.map((r) => {
      if (!isLinkedNonTerminal(r, link)) return r;
      matched = true;
      return { ...r, status: "complete", result: "auto-applied" } as AiRequest;
    });
    if (!matched) return;
    try {
      await writeSidecar(handle, "ai-requests.json", { requests: terminated });
    } catch (err) {
      if (isStalePipelineError(err)) return;
      console.error("Failed to terminate linked AI request on archive:", err);
      return;
    }
    publishAiRequests(docId, terminated);
    return;
  }

  const existingIdx = requests.findIndex(
    (r) =>
      r.linkedTo &&
      r.linkedTo.panel === link.panel &&
      r.linkedTo.cardId === link.cardId &&
      // Match only requests the drain still considers OPEN. `isRequestOpen` is
      // the SSOT mirror of the Python drain rule (`list_requests.py`): a
      // terminal (`complete`/`failed`) row OR an answered L3 proposal
      // (`in-progress`+`resultId`) is closed, so a re-toggle files a FRESH
      // request instead of matching a row the drain will never re-serve — and a
      // value=false toggle can't delete an answered row out from under the
      // accept/reject flow that depends on its `resultId` (task 043).
      isRequestOpen(r),
  );

  let nextRequests: AiRequest[];
  if (value) {
    if (existingIdx >= 0) {
      // Refresh context fields on re-toggle so the skill sees current anchors.
      nextRequests = requests.map((r, i) =>
        i === existingIdx
          ? {
              ...r,
              text: ctx.text || r.text,
              paragraphIds: ctx.paragraphIds ?? r.paragraphIds,
              selectedText: ctx.selectedText ?? r.selectedText,
            }
          : r,
      );
    } else {
      const req: AiRequest = {
        id: generateEntityId(),
        kind: routing.kind,
        text: ctx.text,
        createdAt: new Date().toISOString(),
        status: "pending",
        linkedTo: link,
        paragraphIds: ctx.paragraphIds,
        selectedText: ctx.selectedText,
      };
      nextRequests = [...requests, req];
    }
  } else {
    if (existingIdx < 0) return;
    nextRequests = requests.filter((_, i) => i !== existingIdx);
  }

  try {
    await writeSidecar(handle, "ai-requests.json", { requests: nextRequests });
  } catch (err) {
    if (isStalePipelineError(err)) return;
    console.error("Failed to bridge card AI request flag:", err);
    return;
  }
  // Announce the authoritative post-write list so the live inbox
  // (`useAiRequests`) adopts it without a reload/remount (drop D3). Only after a
  // successful persist — a failed write leaves the on-disk queue unchanged, so
  // the in-memory inbox must not diverge from it.
  publishAiRequests(docId, nextRequests);
}

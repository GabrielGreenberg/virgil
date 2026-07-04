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
import { CARD_REGISTRY } from "@/cards/card-registry";
import type { CardKind } from "@/cards/types";

const EMPTY: AiRequestsState = { requests: [] };

export interface BridgeContext {
  /** Plain text excerpt of the card body — surfaces in the request as `text`. */
  text: string;
  /** Paragraph UUIDs the source card is anchored to. */
  paragraphIds?: string[];
  /** Mode B selectedText snapshot, if any. */
  selectedText?: string;
}

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

  let state: AiRequestsState;
  try {
    state = await readSidecar<AiRequestsState>(docId, "ai-requests.json", EMPTY);
  } catch {
    return;
  }
  const requests = Array.isArray(state.requests) ? state.requests : [];

  const existingIdx = requests.findIndex(
    (r) =>
      r.linkedTo &&
      r.linkedTo.panel === link.panel &&
      r.linkedTo.cardId === link.cardId &&
      // Open == not terminal. Both v1 terminal statuses count as "done" so a
      // re-toggle after completion/failure files a fresh request.
      r.status !== "complete" &&
      r.status !== "failed",
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

/**
 * Bridges card-level `aiRequest: boolean` flags into the unified
 * `ai-requests.json` queue.
 *
 * The editor has two parallel signals for "the user wants Claude to act on
 * this":
 *
 *   1. Per-card sticky flags on notes / todos / cutter-comments /
 *      revision-comments. Each lives in its panel sidecar.
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
  AiRequestKind,
  AiRequestLink,
  AiRequestsState,
} from "@/lib/types";
import {
  getActiveHandle,
  isStalePipelineError,
} from "@/lib/multi-window/doc-pipeline";

const EMPTY: AiRequestsState = { requests: [] };

/** Per-panel default kind for the bridged AiRequest entry. The `kind` on
 *  the request signals which subskill picks it up — for card-flag bridges,
 *  it's always one of `note` / `todo` / `suggestion`. */
const PANEL_TO_KIND: Record<AiRequestLink["panel"], AiRequestKind> = {
  notes: "note",
  todos: "todo",
  cutter: "suggestion",
  revisions: "suggestion",
};

export interface BridgeContext {
  /** Plain text excerpt of the card body — surfaces in the request as `text`. */
  text: string;
  /** Paragraph UUIDs the source card is anchored to. */
  paragraphIds?: string[];
  /** Mode B selectedText snapshot, if any. */
  selectedText?: string;
  /** Override for the default `PANEL_TO_KIND` mapping. Set when a panel
   *  hosts multiple AI-request kinds (e.g. the Notes panel hosts both
   *  `note` and `highlight`). */
  kind?: AiRequestKind;
}

/**
 * Sync a card-level `aiRequest` flag toggle into `ai-requests.json`.
 *
 * - `value=true` and no existing linked request → add one (`status: "submitted"`).
 * - `value=true` and an existing linked request → leave it (idempotent).
 * - `value=false` and an existing linked request → drop it.
 *
 * Best-effort: errors are logged, not thrown. The card flag is the source
 * of truth for the panel UI; a stale `ai-requests.json` will self-heal on
 * the next toggle or skill drain.
 */
export async function bridgeCardAiRequestFlag(
  docId: string | null,
  link: AiRequestLink,
  value: boolean,
  ctx: BridgeContext,
): Promise<void> {
  if (!docId) return;
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
      r.status !== "complete",
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
        kind: ctx.kind ?? PANEL_TO_KIND[link.panel],
        text: ctx.text,
        createdAt: new Date().toISOString(),
        status: "submitted",
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
  }
}

/**
 * One-time, idempotent migration: convert UNLINKED `note` / `todo`
 * `ai-requests.json` entries into real Note / Todo cards carrying the
 * per-card `aiRequest: true` flag, and re-bridge each request's `linkedTo`
 * at the freshly-minted card.
 *
 * Why this exists (BUG #55b part b — retire the legacy `"ai"` CardKind):
 * before #55, a user could compose a free-floating AI request from the
 * AIWindow composer ("Note request" / "Todo request"). Those entries have
 * NO `linkedTo` (no backing card) and used to render in their panel via the
 * legacy `AiRequestCard` (CardKind `"ai"`). Part (a) gave notes/todos a
 * per-card `aiRequest` checkbox bridged into the SAME queue. Retiring the
 * `"ai"` kind removes that per-panel display surface, so any pre-existing
 * UNLINKED note/todo request would lose its panel home. This migration
 * subsumes them into the per-card model: each becomes a real card (so it
 * shows in the Notes/Todo panel with its AI box checked) linked back to the
 * very request that spawned it — exactly the on-disk shape the card-flag
 * bridge (`ai-request-bridge.ts`) produces.
 *
 * Scope (deliberately narrow): ONLY `note` and `todo`. `footnote` needs a
 * `\footnote{}` atom in the `.tex` (an anchorless request can't become one)
 * and `citation` has no per-card flag by frozen contract (its request surface
 * is `/editor/find-citation` via the composer) — both stay surfaced in the
 * AIWindow. `suggestion` / `report` / `style-merge` / `highlight` are never
 * composer-created as unlinked requests.
 *
 * Idempotent: once converted, a request carries `linkedTo`, so it is skipped
 * on every subsequent run (the disk is already migrated). Terminal requests
 * (`complete` / `failed`) are left untouched — they are history, not an open
 * actionable surface.
 *
 * Pure + side-effect-free: callers inject an id generator and a clock so the
 * function is fully testable. The orchestrator hook
 * (`useAiRequestCardMigration`) applies the result through the live editor
 * hooks (cards via `useNotes`/`useTodos`, the re-link via `useAiRequests`).
 */

import type {
  AiRequest,
  AiRequestLink,
  AiRequestStatus,
  TodoItem,
  UserNote,
} from "@/lib/types";
import { isRequestOpen } from "@/lib/ai-request-open";

/** Only these two kinds convert (see module header). */
const CONVERTIBLE_KINDS = new Set(["note", "todo"]);

/** Wire `linkedTo.panel` token per kind — kept identical to the
 *  registry-declared routing (`CARD_REGISTRY[kind].aiRequest.linkPanel`,
 *  pinned by `ai-request-routing-contract.test.ts`) so a migrated request is
 *  byte-for-byte what the card-flag bridge would have written.
 *
 *  Deliberately a literal, NOT a live `CARD_REGISTRY` read: this module is
 *  pure (no React/JSX deps), and `card-registry.tsx` pulls render deps in. The
 *  literal is instead equality-PINNED to the registry by
 *  `migrate-ai-request-cards.test.ts` (task 221), so a registry linkPanel edit
 *  that leaves this copy behind trips CI — the same derive-or-pin discipline the
 *  bridge (which reads the registry directly) satisfies by derivation. */
export const LINK_PANEL = { note: "notes", todo: "todos" } as const;

export interface MigrationDeps {
  /** Fresh entity id for each created card (real: `generateEntityId`). */
  genId: () => string;
  /** ISO timestamp for `createdAt` (real: `() => new Date().toISOString()`). */
  now: () => string;
}

export interface MigrationResult {
  /** True iff at least one request was converted. */
  changed: boolean;
  /** New Note cards to append to `notes.json`. */
  addedNotes: UserNote[];
  /** New Todo items to append to `todos.json`. */
  addedTodos: TodoItem[];
  /** The converted requests, each updated with `linkedTo` (+ status
   *  normalized to `pending`). Merge these BACK over `ai-requests.json` by
   *  `id` — every other request is left exactly as-is. */
  relinkedRequests: AiRequest[];
}

/** A request is convertible iff it is an UNLINKED, still-open note/todo.
 *  "Open" is the shared `isRequestOpen` SSOT (the drain's rule) — for an
 *  unlinked note/todo it coincides with "non-terminal" (an unlinked request
 *  never carries an L3 `in-progress`+`resultId`), but routing through the
 *  helper keeps this from re-drifting from the bridge/drain predicate. */
function isConvertible(r: AiRequest): boolean {
  if (r.linkedTo) return false;
  if (!CONVERTIBLE_KINDS.has(r.kind)) return false;
  return isRequestOpen(r);
}

/** Legacy `draft`/`submitted` normalize to `pending` (the v1 open value the
 *  bridge writes for a linked request); `pending`/`in-progress` ride through. */
function openStatus(s: AiRequestStatus): AiRequestStatus {
  return s === "draft" || s === "submitted" ? "pending" : s;
}

/** Wrap the request's free text as a Tiptap JSONContent doc (the note body). */
function noteBody(text: string): UserNote["content"] {
  const trimmed = text.trim();
  return trimmed
    ? { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: trimmed }] }] }
    : { type: "doc", content: [{ type: "paragraph" }] };
}

export function migrateUnlinkedCardRequests(
  aiRequests: AiRequest[],
  deps: MigrationDeps,
): MigrationResult {
  const addedNotes: UserNote[] = [];
  const addedTodos: TodoItem[] = [];
  const relinkedRequests: AiRequest[] = [];

  for (const req of aiRequests) {
    if (!isConvertible(req)) continue;
    const cardId = deps.genId();
    const createdAt = deps.now();

    if (req.kind === "note") {
      addedNotes.push({
        kind: "note",
        id: cardId,
        title: "",
        titleAuto: true,
        content: noteBody(req.text),
        createdAt,
        aiRequest: true,
        links: [],
      });
      relinkedRequests.push({
        ...req,
        status: openStatus(req.status),
        linkedTo: { panel: LINK_PANEL.note, cardId },
      });
    } else {
      // todo
      addedTodos.push({
        id: cardId,
        text: req.text,
        // The request text IS user content (its instruction), so mark the
        // body user-owned — the on-load title heuristic must not strip it.
        titleAuto: false,
        notes: "",
        done: false,
        aiRequest: true,
        createdAt,
        links: [],
      });
      relinkedRequests.push({
        ...req,
        status: openStatus(req.status),
        linkedTo: { panel: LINK_PANEL.todo, cardId },
      });
    }
  }

  return {
    changed: relinkedRequests.length > 0,
    addedNotes,
    addedTodos,
    relinkedRequests,
  };
}

/**
 * One request the migration wants to CLAIM for a freshly-minted card: the
 * request's id and the link to set on it. A field patch, never a whole row
 * (task 1642).
 */
export interface RequestClaim {
  id: string;
  linkedTo: AiRequestLink;
}

/** The claims a migration result proposes, in the shape `relinkRequests` takes. */
export function claimsOf(result: MigrationResult): RequestClaim[] {
  return result.relinkedRequests.flatMap((r) =>
    r.linkedTo ? [{ id: r.id, linkedTo: r.linkedTo }] : [],
  );
}

/**
 * The relink as a pure MUTATOR over the inbox as it is ON DISK (task 1642).
 *
 * It used to REPLACE each matching disk row with the object the migration had
 * built from the hook's in-memory list — so the CAS re-read was defeated for
 * exactly the fields that mattered: a row a skill had completed meanwhile was
 * written back open, a row another window had already linked was re-pointed
 * at THIS window's card, and a normalised object (`kind: "unknown"`, a filled
 * `createdAt`) was written over the raw bytes.
 *
 * Now each claim is a FIELD PATCH with a precondition: a raw row with the
 * claimed id gets `linkedTo` (and the legacy open status normalised to
 * `pending`, the bridge's shape) ONLY IF it is still convertible — unlinked,
 * open, note/todo — judged on the RAW row by the same predicate that proposed
 * it. Every other field is the raw row's own. Returns `null` when no claim
 * lands (a declined write — nothing to persist).
 */
export function claimRequestRows(
  rows: AiRequest[],
  claims: readonly RequestClaim[],
): AiRequest[] | null {
  const byId = new Map(claims.map((c) => [c.id, c]));
  let changed = false;
  const next = rows.map((raw) => {
    if (typeof raw !== "object" || raw === null) return raw;
    const claim = typeof raw.id === "string" ? byId.get(raw.id) : undefined;
    if (!claim || !isConvertible(raw)) return raw;
    byId.delete(raw.id); // a duplicated id is claimed once, by its first row
    changed = true;
    return { ...raw, status: openStatus(raw.status), linkedTo: claim.linkedTo };
  });
  return changed ? next : null;
}

/**
 * Which claims LANDED, read off the authoritative post-write list: a row whose
 * `linkedTo` names the claim's card. Card ids are freshly minted per run, so a
 * match can only be this run's own write — a peer window's claim names its
 * own card and a completed row was never re-linked.
 */
export function claimedIds(
  written: readonly AiRequest[],
  claims: readonly RequestClaim[],
): Set<string> {
  const wanted = new Map(claims.map((c) => [c.id, c.linkedTo]));
  const out = new Set<string>();
  for (const r of written) {
    const link = wanted.get(r.id);
    if (
      link &&
      r.linkedTo?.panel === link.panel &&
      r.linkedTo?.cardId === link.cardId
    ) {
      out.add(r.id);
    }
  }
  return out;
}

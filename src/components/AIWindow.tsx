"use client";

/**
 * AIWindow — centralized dashboard for all AI-mediated requests in the
 * document. Opens from the sun-star button in the top tab bar.
 *
 * It unifies three independent request systems into one view:
 *   1. Bibliography field reviews   (useBibReview, type "fields")
 *   2. Bibliography note reviews    (useBibReview, type "notes")
 *   3. Bibliography entry creation  (useBibSettings.entryRequests)
 *   4. Free-floating comments / dialogue   (useRevisions.comments, no selectedText)
 *   5. Anchored text comments              (useRevisions.comments, selectedText set)
 *
 * Requests are bucketed into Open / Responded / Resolved. "Responded"
 * only really applies to revisions where Claude has added a turn but the
 * thread is not yet resolved — bib requests jump straight from Open to
 * Resolved when their backing JSON file flips status to "complete".
 *
 * Polling / freshness comes for free from the underlying hooks:
 *   - useBibReview polls every 10 s while any request is pending
 *   - useRevisions reloads on window focus
 *   - we also call refresh() on each hook when the window opens
 *
 * The new-request form supports the categories that can be created
 * without an editor selection: general dialogue, bibliography entry
 * creation, and field/notes reviews against any existing bib key.
 * Creating an anchored text revision still requires selecting text in
 * the editor itself, so that path is intentionally not exposed here.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  AiRequest,
  AiRequestKind as PanelAiRequestKind,
  BibEntry,
  BibEntryRequest,
  BibReviewRequest,
  RevisionCard,
} from "@/lib/types";
import { isRequestOpen } from "@/lib/ai-request-open";
import { bibFieldDisplay } from "@/lib/bib-parser";
import { linkedCardKindFrom } from "@/cards/predicates";
import { CARD_REGISTRY } from "@/cards/card-registry";
import type { CardKind } from "@/cards/types";
import type { PanelThemeKey } from "@/lib/panel-theme";
import { usePanelCardPalette } from "@/hooks/usePanelTheme";
import ConfirmDialog from "./ConfirmDialog";
import SystemDialog from "./system-dialog";
import { Button } from "./panel-primitives";
import { Input, Select, Textarea } from "./field-primitives";
import { useTabIndent } from "@/hooks/useTabIndent";
import { iconHint } from "@/components/Hint";
import type { StatusTone } from "./StatusDot";

export type AIRequestKind =
  | "bib-fields"
  | "bib-notes"
  | "bib-entry"
  | "revision-general"
  | "revision-text"
  | "panel-footnote"
  | "panel-note"
  | "panel-citation"
  | "panel-todo"
  | "panel-suggestion"
  | "panel-report";

type AIRequestStatus = "open" | "responded" | "resolved";

interface AIRequestVM {
  // Stable id used as React key. Bib reviews don't have ids of their own,
  // so we synthesize one from kind + bibKey + type.
  id: string;
  kind: AIRequestKind;
  status: AIRequestStatus;
  // Short label shown next to the kind chip — usually the bib key, the
  // user name, or "General".
  label: string;
  // Free-form preview text shown under the label.
  snippet: string;
  // Number of dialogue turns, when applicable. 0 hides the badge.
  turnCount: number;
  // ISO timestamp used for sorting (newest first within each bucket).
  createdAt: string;
  // Optional: when the kind has a destructive cancel/clear action.
  onCancel?: () => void;
  // True when the request contains user-written text (prompt confirmation
  // before discarding).
  hasUserText: boolean;
  // Optional: kind-specific resolved hint, e.g. resolved bibKey.
  resolvedHint?: string;
  // Optional per-row theme override: the panel theme of the CARD this request
  // is linked to, when one resolves. The display `kind` is coarser than the
  // link (both suggestion families share one chip), so a row that knows its
  // exact card kind states it here and the chip paints that card's accent.
  // Absent ⇒ the display kind's family default (`themeKeyForVM`).
  themeKey?: PanelThemeKey;
}

/* ── The chip vocabulary (task 178) ──────────────────────────────────
 *
 * `KIND_META` carries LABELS and DESCRIPTIONS only. A request chip's colour is
 * the panel theme of the card kind the request is about, derived live through
 * `usePanelCardPalette(themeKey)` → the SAME `badgeBg`/`badgeColor` pair the
 * panels paint their badges with.
 *
 * It used to be a private table of `chipBg`/`chipFg` hex literals — the second
 * per-kind colour vocabulary in the app, agreeing with no panel theme and
 * subscribing to no override. Beyond the drift that guarantees, it shipped a
 * straight INVERSION: `panel-todo` wore `#15803d`, byte-identical to the NOTE
 * accent, while `panel-note` wore a blue belonging to no kind at all. A user who
 * has learned the colour language of the margin read the inbox wrong.
 *
 * The themeKey is read OFF `CARD_REGISTRY` rather than restated, so a kind
 * re-themed in the registry re-tints its chip for free. And whether a user's
 * colour override may reach a chip is not decided here: it is decided by
 * `panel-theme`'s `SYSTEM_THEME_KEYS` for that key, exactly as it is for every
 * other surface painting that kind. Delegating the policy is the point — one
 * accent → one colour language, wherever it is rendered.
 *
 * The three `bib-*` and two `revision-*` display kinds have no per-card AI-flag
 * routing to resolve them (nothing in `CARD_REGISTRY.aiRequest` produces them),
 * so each names the FAMILY it belongs to. Their sub-kind is carried by the
 * label, not by a hue — "Bib fields" vs "Bib notes" is a distinction the label
 * makes better than three unrelated colours ever did. */
const KIND_META: Record<
  AIRequestKind,
  { label: string; description: string; themeKey: PanelThemeKey }
> = {
  "bib-fields": {
    label: "Bib fields",
    description: "Review the BibTeX fields of an existing entry",
    themeKey: CARD_REGISTRY.bib.themeKey,
  },
  "bib-notes": {
    label: "Bib notes",
    description: "Have Claude draft annotation notes for an entry",
    themeKey: CARD_REGISTRY.bib.themeKey,
  },
  "bib-entry": {
    label: "New entry",
    description: "Find or create a new bibliography entry from a description",
    themeKey: CARD_REGISTRY.bib.themeKey,
  },
  "revision-general": {
    label: "General",
    description: "Open a general revision / dialogue thread with Claude",
    themeKey: CARD_REGISTRY["revision-comment"].themeKey,
  },
  "revision-text": {
    label: "On selection",
    description: "Anchored to selected text — created from the editor",
    themeKey: CARD_REGISTRY["revision-comment"].themeKey,
  },
  "panel-footnote": {
    label: "Footnote",
    description: "AI request for a footnote",
    themeKey: CARD_REGISTRY.footnote.themeKey,
  },
  "panel-note": {
    label: "Note",
    description: "AI request for a margin note",
    themeKey: CARD_REGISTRY.note.themeKey,
  },
  "panel-citation": {
    label: "Citation",
    description: "AI request for a citation",
    themeKey: CARD_REGISTRY.citation.themeKey,
  },
  "panel-todo": {
    label: "Todo",
    description: "AI request for a task",
    themeKey: CARD_REGISTRY.todo.themeKey,
  },
  "panel-suggestion": {
    // The display kind AGGREGATES the cutter and revision suggestion families
    // (`PANEL_KIND_MAP` keys on the request kind alone, which cannot tell them
    // apart). This is the fallback for a row whose owning card can't be
    // resolved; a card-linked row overrides it per request with that card's own
    // theme (`themeKeyForVM`), so a cutter suggestion is never painted the
    // revision accent — the inversion class, one size down.
    label: "Suggestion",
    description: "Apply an accepted Cutter suggestion to the document",
    themeKey: CARD_REGISTRY["revision-suggestion"].themeKey,
  },
  "panel-report": {
    label: "Report",
    description: "AI request for a report",
    themeKey: CARD_REGISTRY["report-request"].themeKey,
  },
};

/** The theme a request row's chip paints with: the resolved owning card's own
 *  theme where the row is card-linked, else the display kind's family default.
 *  The chip answers "which kind of card is this request about?", so it must not
 *  be less precise than the data — `buildRequests` already resolves the exact
 *  `CardKind` for every linked row (`linkedCardKindFrom`). */
function themeKeyForVM(req: Pick<AIRequestVM, "kind" | "themeKey">): PanelThemeKey {
  return req.themeKey ?? KIND_META[req.kind].themeKey;
}

const STATUS_META: Record<
  AIRequestStatus,
  { label: string; dot: string; bg: string; fg: string }
> = {
  open:      { label: "Open",      dot: "#d97706", bg: "#fff7ed", fg: "#9a3412" },
  responded: { label: "Responded", dot: "#7c3aed", bg: "#f5f3ff", fg: "#5b21b6" },
  resolved:  { label: "Resolved",  dot: "#16a34a", bg: "#f0fdf4", fg: "#15803d" },
};

function truncate(s: string | undefined, max = 140): string {
  if (!s) return "";
  const trimmed = s.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max - 1) + "…";
}

function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  const sec = Math.floor(diff / 1000);
  if (sec < 45) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

/* ── Build view-models from raw hook state ─────────────────────────── */

export interface BuildArgs {
  bibReviewRequests: BibReviewRequest[];
  bibEntryRequests: BibEntryRequest[];
  comments: RevisionCard[];
  panelAiRequests: AiRequest[];
  cancelBibReview: (bibKey: string, type: "fields" | "notes") => void;
  removeEntryRequest: (id: string) => void;
  deletePanelAiRequest: (id: string) => void;
  // Cancel a CARD-LINKED panel request: drops the queue row AND lowers the
  // owning card's `aiRequest` flag together (the queue→card twin of archive's
  // both-faces clear). Kind is already resolved from the request's
  // `(kind, linkPanel)` pair; cardId is `linkedTo.cardId`. Unlinked
  // composer-created requests keep the raw `deletePanelAiRequest` path.
  clearLinkedAiRequest: (kind: CardKind, cardId: string) => void;
}

// Exported for the inbox-open-derivation test (task 093): the panel-request
// row's `status` must mirror the `isRequestOpen` SSOT, not a binary
// `status === "complete"` check.
export function buildRequests(args: BuildArgs): AIRequestVM[] {
  const out: AIRequestVM[] = [];

  for (const r of args.bibReviewRequests) {
    out.push({
      id: `bibrev:${r.type}:${r.bibKey}`,
      kind: r.type === "fields" ? "bib-fields" : "bib-notes",
      status: r.status === "complete" ? "resolved" : "open",
      label: r.bibKey,
      snippet:
        r.requestNotes?.trim() ||
        (r.type === "fields"
          ? "Review the BibTeX fields for accuracy and completeness."
          : "Draft annotation notes for this entry."),
      turnCount: 0,
      createdAt: r.requestedAt,
      onCancel:
        r.status === "pending"
          ? () => args.cancelBibReview(r.bibKey, r.type)
          : undefined,
      hasUserText: !!r.requestNotes?.trim(),
    });
  }

  for (const r of args.bibEntryRequests) {
    out.push({
      id: `bibent:${r.id}`,
      kind: "bib-entry",
      status: r.status === "complete" ? "resolved" : "open",
      label: r.resolvedKey || "—",
      snippet: r.description,
      turnCount: 0,
      createdAt: r.createdAt,
      resolvedHint: r.resolvedKey ? `→ ${r.resolvedKey}` : undefined,
      onCancel:
        r.status === "pending"
          ? () => args.removeEntryRequest(r.id)
          : undefined,
      hasUserText: !!r.description.trim(),
    });
  }

  for (const c of args.comments) {
    if (c.kind !== "comment") continue;
    if (!c.aiRequest) continue;
    const isAnchored = !!c.selectedText;
    out.push({
      id: `${isAnchored ? "txtrev" : "genrev"}:${c.id}`,
      kind: isAnchored ? "revision-text" : "revision-general",
      status: "open",
      label: "Me",
      snippet: isAnchored
        ? (c.selectedText ? `"${truncate(c.selectedText, 60)}" — ` : "") +
          c.text
        : c.text,
      turnCount: 0,
      createdAt: c.createdAt,
      hasUserText: !!c.text.trim(),
    });
  }

  const PANEL_KIND_MAP: Record<PanelAiRequestKind, AIRequestKind> = {
    footnote: "panel-footnote",
    note: "panel-note",
    // Highlight AI requests render as notes in the AI window — same
    // Notes-panel home, same composer affordances.
    highlight: "panel-note",
    citation: "panel-citation",
    report: "panel-report",
    todo: "panel-todo",
    suggestion: "panel-suggestion",
    // style-merge requests are filed by the Style dropdown, not panels,
    // and are filtered out below before reaching this map. The entry is
    // here only so the Record<…> type stays exhaustive.
    "style-merge": "panel-suggestion",
  };

  for (const r of args.panelAiRequests) {
    if (r.kind === "style-merge") continue;
    // Openness is the `isRequestOpen` SSOT, NOT a binary `status === "complete"`
    // check: an answered-L3 proposal (`in-progress`+`resultId`) is CLOSED — the
    // user owns accept/reject now — so it must render "resolved" (and expose no
    // cancel affordance), not "open" (task 093 GAP 1).
    const open = isRequestOpen(r);
    // Cancel routing (task 222): a CARD-LINKED row must clear BOTH faces — drop
    // the queue row AND lower the owning card's `aiRequest` flag — via the
    // card-flag-clearing path (the inverse of checking the card's AI box), NOT
    // the raw `deletePanelAiRequest` filter that would orphan the flag lit (the
    // queue→card twin of the delete-leg leak, task 219). The owning `CardKind`
    // resolves from the `(kind, linkPanel)` PAIR — `linkPanel` alone is
    // ambiguous (note/highlight, cutter/revision). An UNLINKED composer row (or
    // a corrupt link that can't resolve) keeps the raw delete.
    const linkedKind = r.linkedTo
      ? linkedCardKindFrom(r.kind, r.linkedTo.panel)
      : null;
    const linkedCardId = r.linkedTo?.cardId;
    out.push({
      id: `panel:${r.id}`,
      kind: PANEL_KIND_MAP[r.kind],
      // The chip follows the card, not the coarser display kind (task 178).
      themeKey: linkedKind ? CARD_REGISTRY[linkedKind].themeKey : undefined,
      status: open ? "open" : "resolved",
      label: r.kind,
      snippet: r.text || "(empty draft)",
      turnCount: 0,
      createdAt: r.createdAt,
      onCancel: open
        ? linkedKind && linkedCardId
          ? () => args.clearLinkedAiRequest(linkedKind, linkedCardId)
          : () => args.deletePanelAiRequest(r.id)
        : undefined,
      hasUserText: !!r.text?.trim(),
    });
  }

  return out;
}

/* ── Notification dot helper (used by toolbar button) ─────────────── */

/**
 * What the AI-requests toolbar icon's notification dot MEANS.
 *
 * A subset of the shared `StatusTone` vocabulary, so the Virgil bar renders it
 * with `<StatusDot tone={aiDot}>` and NOTHING maps a state to a colour on the
 * way (task 315). It was `"red" | "green" | "yellow"` until then — a
 * colour-named state union, which only moves the paint decision up a layer: the
 * producer names the pixel and every consumer re-derives the meaning.
 *
 * KNOWN, and deliberately not decided here: `aiRequestDotStatus` can only
 * return `"warn"` or `null` today — the two states `danger` and `ok` describe
 * are real and surfaced elsewhere in the AI window, but no producer lights the
 * dot for them, so both arms of the bar's render are unreachable. Retiring them
 * versus building them is a product call, not a rename's to make.
 */
export type AiDotTone = Extract<StatusTone, "danger" | "ok" | "warn">;

/**
 * Returns the notification dot tone for the AI requests toolbar icon.
 *   - "danger" → user has approved changes that the AI has not yet applied
 *   - "ok"     → AI has replied to one or more requests
 *   - "warn"   → user requests are pending an AI response
 *   - null     → nothing outstanding
 */
export function aiRequestDotStatus(args: {
  bibReviewRequests: BibReviewRequest[];
  bibEntryRequests: BibEntryRequest[];
  comments: RevisionCard[];
  panelAiRequests: AiRequest[];
}): AiDotTone | null {
  const { bibReviewRequests, bibEntryRequests, comments, panelAiRequests } = args;

  let hasOpen = false;

  for (const r of bibReviewRequests) {
    if (r.status === "pending") { hasOpen = true; break; }
  }
  if (!hasOpen) {
    for (const r of bibEntryRequests) {
      if (r.status === "pending") { hasOpen = true; break; }
    }
  }
  if (!hasOpen) {
    for (const r of panelAiRequests) {
      // Same SSOT as `buildRequests` above: an answered-L3 row is closed, so it
      // must not light the inbox dot (task 093 GAP 1).
      if (isRequestOpen(r)) { hasOpen = true; break; }
    }
  }
  if (!hasOpen) {
    for (const c of comments) {
      if (c.kind === "comment" && c.aiRequest) { hasOpen = true; break; }
    }
  }

  if (hasOpen) return "warn";
  return null;
}

/* ── Component ─────────────────────────────────────────────────────── */

export interface AIWindowProps {
  open: boolean;
  onClose: () => void;

  // Live state — flow straight from the hooks in EditorLayout.
  bibReviewRequests: BibReviewRequest[];
  bibEntryRequests: BibEntryRequest[];
  comments: RevisionCard[];
  bibEntries: BibEntry[];

  // Panel AI requests (useAiRequests unified store).
  panelAiRequests: AiRequest[];
  addPanelAiRequest: (kind: PanelAiRequestKind, text?: string) => AiRequest;
  deletePanelAiRequest: (id: string) => void;
  // Cancel a card-linked panel request — clears both the queue row and the
  // owning card's `aiRequest` flag (task 222). See BuildArgs.
  clearLinkedAiRequest: (kind: CardKind, cardId: string) => void;

  // Mutators
  requestBibReview: (
    bibKey: string,
    type: "fields" | "notes",
    requestNotes?: string,
  ) => void;
  cancelBibReview: (bibKey: string, type: "fields" | "notes") => void;
  addEntryRequest: (description: string) => void;
  removeEntryRequest: (id: string) => void;
  addComment: (opts: { text?: string }) => unknown;

  // Refresh on open
  refreshAll: () => void;
}

type AISection = "requests" | "connect" | "skills";

const SECTIONS: { id: AISection; label: string; description: string }[] = [
  { id: "requests", label: "Request status", description: "Open, responded, and resolved AI requests in this document" },
  { id: "connect", label: "Connect with Claude", description: "Manage your connection to Claude and related services" },
  { id: "skills", label: "Skills", description: "Skills Claude can use inside this document" },
];

export default function AIWindow({
  open,
  onClose,
  bibReviewRequests,
  bibEntryRequests,
  comments,
  bibEntries,
  panelAiRequests,
  addPanelAiRequest,
  deletePanelAiRequest,
  clearLinkedAiRequest,
  requestBibReview,
  cancelBibReview,
  addEntryRequest,
  removeEntryRequest,
  addComment,
  refreshAll,
}: AIWindowProps) {
  const [section, setSection] = useState<AISection>("requests");
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerKind, setComposerKind] = useState<AIRequestKind>("revision-general");
  const [composerText, setComposerText] = useState("");
  const [composerBibKey, setComposerBibKey] = useState("");

  // Refresh data once when the window is opened so users see the most
  // recent state without needing to wait for the next poll cycle.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) refreshAll();
    wasOpen.current = open;
  }, [open, refreshAll]);

  const requests = useMemo(
    () =>
      buildRequests({
        bibReviewRequests,
        bibEntryRequests,
        comments,
        panelAiRequests,
        cancelBibReview,
        removeEntryRequest,
        deletePanelAiRequest,
        clearLinkedAiRequest,
      }),
    [
      bibReviewRequests,
      bibEntryRequests,
      comments,
      panelAiRequests,
      cancelBibReview,
      removeEntryRequest,
      deletePanelAiRequest,
      clearLinkedAiRequest,
    ],
  );

  const buckets = useMemo(() => {
    const sortByDate = (a: AIRequestVM, b: AIRequestVM) =>
      b.createdAt.localeCompare(a.createdAt);
    return {
      open: requests.filter((r) => r.status === "open").sort(sortByDate),
      responded: requests.filter((r) => r.status === "responded").sort(sortByDate),
      resolved: requests.filter((r) => r.status === "resolved").sort(sortByDate),
    };
  }, [requests]);

  const PANEL_KIND_REVERSE: Record<string, PanelAiRequestKind> = {
    "panel-footnote": "footnote",
    "panel-note": "note",
    "panel-citation": "citation",
    "panel-todo": "todo",
  };

  const submitComposer = useCallback(() => {
    const text = composerText.trim();
    if (composerKind === "revision-general") {
      if (!text) return;
      addComment({ text });
    } else if (composerKind === "bib-entry") {
      if (!text) return;
      addEntryRequest(text);
    } else if (composerKind === "bib-fields" || composerKind === "bib-notes") {
      const key = composerBibKey.trim();
      if (!key) return;
      requestBibReview(
        key,
        composerKind === "bib-fields" ? "fields" : "notes",
        text || undefined,
      );
    } else if (composerKind in PANEL_KIND_REVERSE) {
      addPanelAiRequest(PANEL_KIND_REVERSE[composerKind], text);
    }
    setComposerText("");
    setComposerBibKey("");
    setComposerOpen(false);
  }, [
    composerKind,
    composerText,
    composerBibKey,
    addComment,
    addEntryRequest,
    requestBibReview,
    addPanelAiRequest,
  ]);

  const onComposerKeyDown = useTabIndent<HTMLTextAreaElement>((e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submitComposer();
    }
  });

  if (!open) return null;

  const composerNeedsBibKey =
    composerKind === "bib-fields" || composerKind === "bib-notes";

  return (
    <SystemDialog
      open
      onClose={onClose}
      size="full"
      /* No cued default: this window's actions live in its BODY, and its
         composer takes Cmd/Ctrl+Enter. Being MODAL it still swallows a plain
         Enter pressed outside its frame (nothing behind a scrim should act on
         one) — declared here so that swallow is a decision, not an omission. */
      noCuedDefault
      labelledBy="ai-window-title"
      frameClassName="max-h-[82vh] flex flex-col"
    >
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-[var(--border)]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <g transform="rotate(15 12 12)">
              <line x1="12" y1="2" x2="12" y2="22" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
              <line x1="19.07" y1="4.93" x2="4.93" y2="19.07" />
            </g>
          </svg>
          <h2
            id="ai-window-title"
            className="text-sm font-semibold text-ink-body"
          >
            AI
          </h2>
          <div className="flex-1" />
          {section === "requests" && (
            <button
              onClick={() => refreshAll()}
              className="iconbtn-md"
              {...iconHint({ label: "Refresh" })}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            </button>
          )}
          <button
            onClick={onClose}
            className="iconbtn-md"
            {...iconHint({ label: "Close" })}
          >
            <svg width="16" height="16" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 3l8 8M11 3l-8 8" />
            </svg>
          </button>
        </div>

        {/* Two-pane body */}
        <div className="flex-1 flex min-h-0">
          {/* Left nav */}
          <nav className="w-[200px] shrink-0 border-r border-[var(--border)] bg-surface-muted/60 py-3 px-2 overflow-y-auto">
            <div className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider px-2 mb-1.5">
              Browse
            </div>
            <ul className="flex flex-col gap-0.5">
              {SECTIONS.map((s) => {
                const active = s.id === section;
                return (
                  <li key={s.id}>
                    <button
                      onClick={() => setSection(s.id)}
                      className={
                        "w-full text-left px-2 py-1.5 rounded-md text-xs font-medium transition-colors " +
                        (active
                          ? "bg-surface border border-[var(--border)] text-ink-strong shadow-sm"
                          : "text-ink-body hover-on-dark hover:text-ink-strong border border-transparent")
                      }
                    >
                      {s.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* Right content */}
          <div className="flex-1 flex flex-col min-w-0">
            {section === "requests" && (
              <>
                <div className="px-5 pt-3 pb-2 border-b border-[var(--border)]">
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-sm font-semibold text-ink-body">Request status</h3>
                    <span className="text-[11px] text-ink-muted">
                      {buckets.open.length} open · {buckets.responded.length} responded · {buckets.resolved.length} resolved
                    </span>
                  </div>
                </div>

                {/* Composer */}
                <div className="border-b border-[var(--border)] bg-surface-muted/60 px-5 py-2.5">
                  {!composerOpen ? (
                    <button
                      onClick={() => setComposerOpen(true)}
                      className="flex items-center gap-1.5 text-xs font-medium text-ink-subtle hover:text-ink-body transition-colors"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                      New request
                    </button>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider">
                          New request
                        </span>
                        <Select
                          value={composerKind}
                          onChange={(e) => {
                            setComposerKind(e.target.value as AIRequestKind);
                            setComposerBibKey("");
                          }}
                          density="dense"
                          className="text-xs px-1.5 py-0.5"
                        >
                          <option value="revision-general">General dialogue</option>
                          <option value="bib-entry">New bibliography entry</option>
                          <option value="bib-fields">Bib field review</option>
                          <option value="bib-notes">Bib notes review</option>
                          {/* #55b: note/todo AI requests are now made via the
                              per-card AI checkbox (add a Note/Todo card, tick
                              its AI box), so they are no longer composable as
                              free-floating requests here. footnote/citation
                              stay — they have no per-card-flag path. */}
                          <optgroup label="Panel requests">
                            <option value="panel-footnote">Footnote request</option>
                            <option value="panel-citation">Citation request</option>
                          </optgroup>
                        </Select>
                        <span className="text-[11px] text-ink-muted truncate">
                          {KIND_META[composerKind].description}
                        </span>
                      </div>

                      {composerNeedsBibKey && (
                        <div className="flex items-center gap-2 mb-2">
                          <label className="text-[11px] text-ink-subtle">Entry key</label>
                          <Input
                            list="ai-window-bib-keys"
                            value={composerBibKey}
                            onChange={(e) => setComposerBibKey(e.target.value)}
                            placeholder="e.g. smith2020"
                            density="dense"
                            className="flex-1 text-xs px-2 py-1"
                          />
                          <datalist id="ai-window-bib-keys">
                            {bibEntries.map((b) => (
                              <option key={b.key} value={b.key}>
                                {/* DISPLAY — task 409. */}
                                {bibFieldDisplay(b, "title") || b.type}
                              </option>
                            ))}
                          </datalist>
                        </div>
                      )}

                      <div className="flex items-end gap-2">
                        <Textarea
                          value={composerText}
                          onChange={(e) => setComposerText(e.target.value)}
                          placeholder={
                            composerKind === "bib-entry"
                              ? "Describe the entry to find or create — title, authors, year, anything you remember…"
                              : composerKind === "revision-general"
                                ? "Ask Claude something, or describe what you'd like changed…"
                                : "Optional notes for Claude (what to focus on)…"
                          }
                          rows={3}
                          onKeyDown={onComposerKeyDown}
                          density="dense"
                          className="flex-1 text-xs px-2 py-1.5 resize-none"
                        />
                        <div className="flex flex-col gap-1.5">
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={submitComposer}
                            disabled={
                              (composerNeedsBibKey && !composerBibKey.trim()) ||
                              (!composerNeedsBibKey && !composerText.trim())
                            }
                            title="Submit (⌘↵)"
                            data-hint="Submit"
                          >
                            Submit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => { setComposerOpen(false); setComposerText(""); setComposerBibKey(""); }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* Request list */}
                <div className="flex-1 overflow-y-auto px-5 py-3">
                  <Bucket title="Open" status="open" items={buckets.open} />
                  <Bucket title="Responded" status="responded" items={buckets.responded} />
                  <Bucket title="Resolved" status="resolved" items={buckets.resolved} />
                  {requests.length === 0 && (
                    <div className="text-center text-xs text-ink-muted py-8">
                      No requests yet. Use the form above to start one.
                    </div>
                  )}
                </div>
              </>
            )}

            {section === "connect" && (
              <ConnectWithClaude />
            )}

            {section === "skills" && (
              <SkillsPanel />
            )}
          </div>
        </div>
      </div>
    </SystemDialog>
  );
}

/* ── Sub-components ────────────────────────────────────────────────── */


function Bucket({
  title,
  status,
  items,
}: {
  title: string;
  status: AIRequestStatus;
  items: AIRequestVM[];
}) {
  if (items.length === 0) return null;
  const meta = STATUS_META[status];
  return (
    <div className="mb-4 last:mb-0">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span
          className="inline-block w-1.5 h-1.5 rounded-full"
          style={{ background: meta.dot }}
        />
        <span className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider">
          {title}
        </span>
        <span className="text-[10px] text-ink-muted">{items.length}</span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {items.map((req) => (
          <RequestCard key={req.id} req={req} />
        ))}
      </ul>
    </div>
  );
}

function RequestCard({ req }: { req: AIRequestVM }) {
  const meta = KIND_META[req.kind];
  // Live-derived, override-subscribed: the SAME badge pair the owning panel
  // paints (`deriveCardPalette`), never a chip-local literal (task 178).
  const chip = usePanelCardPalette(themeKeyForVM(req));
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleCancel = useCallback(() => {
    if (req.hasUserText) {
      setConfirmOpen(true);
    } else {
      req.onCancel?.();
    }
  }, [req]);

  return (
    <li className="flex gap-2.5 items-start px-2.5 py-2 rounded-md border border-[var(--border)] bg-surface hover:border-edge-hover transition-colors">
      <span
        className="shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium"
        style={{ background: chip.badgeBg, color: chip.badgeColor }}
        data-hint={meta.description} aria-label={meta.description}
      >
        {meta.label}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-ink-body truncate">
            {req.label}
          </span>
          {req.resolvedHint && (
            <span className="text-[10px] text-ink-muted truncate">
              {req.resolvedHint}
            </span>
          )}
          {req.turnCount > 1 && (
            <span
              className="shrink-0 text-[9px] text-ink-subtle bg-surface-muted-strong px-1 rounded"
              data-hint={`${req.turnCount} turns in this thread`}
            >
              {req.turnCount} turns
            </span>
          )}
          <span className="text-[10px] text-ink-muted ml-auto shrink-0">
            {relTime(req.createdAt)}
          </span>
        </div>
        <p className="text-[11px] text-ink-subtle leading-snug mt-0.5 break-words">
          {truncate(req.snippet)}
        </p>
      </div>
      {req.onCancel && (
        <button
          onClick={handleCancel}
          className="shrink-0 text-[10px] text-ink-muted hover:text-danger-muted transition-colors px-1 focus-ring"
          {...iconHint({ label: "Cancel" })}
        >
          ×
        </button>
      )}
      <ConfirmDialog
        open={confirmOpen}
        message="This request has text. Discard it?"
        confirmLabel="Discard"
        tone="danger"
        onConfirm={() => { setConfirmOpen(false); req.onCancel?.(); }}
        onCancel={() => setConfirmOpen(false)}
      />
    </li>
  );
}

function ConnectWithClaude() {
  return (
    <div className="flex-1 overflow-y-auto px-5 py-4">
      <h3 className="text-sm font-semibold text-ink-body mb-1">Connect with Claude</h3>
      <p className="text-[11px] text-ink-subtle mb-4">
        Manage how this document talks to Claude. Authentication, models, and
        workspace defaults will appear here.
      </p>

      <div className="flex flex-col gap-3">
        <div className="rounded-md border border-[var(--border)] bg-surface px-3 py-2.5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-medium text-ink-body">Account</div>
              <div className="text-[11px] text-ink-subtle mt-0.5">
                Not yet connected. Sign in to use Claude for requests in this document.
              </div>
            </div>
            <button
              disabled
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-edge-subtle text-ink-muted bg-surface-muted cursor-not-allowed"
              data-hint="Coming soon"
            >
              Sign in
            </button>
          </div>
        </div>

        <div className="rounded-md border border-[var(--border)] bg-surface px-3 py-2.5">
          <div className="text-xs font-medium text-ink-body mb-1">Model</div>
          <div className="text-[11px] text-ink-subtle mb-2">
            Default model used for new requests.
          </div>
          <Select
            disabled
            ink="subtle"
            density="dense"
            className="text-xs px-2 py-1"
          >
            <option>Claude (workspace default)</option>
          </Select>
        </div>

        <div className="rounded-md border border-[var(--border)] bg-surface px-3 py-2.5">
          <div className="text-xs font-medium text-ink-body mb-1">Context sharing</div>
          <div className="text-[11px] text-ink-subtle">
            Configure which parts of the document Claude can read when responding
            to requests. Settings will live here.
          </div>
        </div>
      </div>
    </div>
  );
}

function SkillsPanel() {
  const skills = [
    {
      name: "Bibliography assistant",
      description: "Find, create, and review BibTeX entries.",
      enabled: true,
    },
    {
      name: "Prose revision",
      description: "Suggest edits to selected text or whole sections.",
      enabled: true,
    },
    {
      name: "Footnotes & annotations",
      description: "Draft footnotes, margin notes, and todos.",
      enabled: true,
    },
    {
      name: "Citation formatter",
      description: "Normalize citations against your style guide.",
      enabled: false,
    },
  ];
  return (
    <div className="flex-1 overflow-y-auto px-5 py-4">
      <h3 className="text-sm font-semibold text-ink-body mb-1">Skills</h3>
      <p className="text-[11px] text-ink-subtle mb-4">
        Skills are the tools Claude can use inside this document. Toggle them on
        or off to shape what Claude can do on your behalf.
      </p>

      <ul className="flex flex-col gap-2">
        {skills.map((s) => (
          <li
            key={s.name}
            className="rounded-md border border-[var(--border)] bg-surface px-3 py-2.5 flex items-start gap-3"
          >
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-ink-body">{s.name}</div>
              <div className="text-[11px] text-ink-subtle mt-0.5">{s.description}</div>
            </div>
            <span
              className={
                "shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium " +
                (s.enabled
                  ? "bg-[#f0fdf4] text-[#15803d]"
                  : "bg-surface-muted-strong text-ink-subtle")
              }
            >
              {s.enabled ? "On" : "Off"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Re-export status type for callers that need it.
export type { AIRequestStatus };

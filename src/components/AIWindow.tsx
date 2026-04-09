"use client";

/**
 * AIWindow — centralized dashboard for all AI-mediated requests in the
 * document. Opens from the sun-star button in the top tab bar.
 *
 * It unifies three independent request systems into one view:
 *   1. Bibliography field reviews   (useBibReview, type "fields")
 *   2. Bibliography note reviews    (useBibReview, type "notes")
 *   3. Bibliography entry creation  (useBibSettings.entryRequests)
 *   4. General revisions / dialogue (useRevisions.generalRevisions)
 *   5. Anchored text revisions      (useRevisions.textRevisions)
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
  GeneralRevision,
  RevisionUser,
  TextRevision,
} from "@/lib/types";

export type AIRequestKind =
  | "bib-fields"
  | "bib-notes"
  | "bib-entry"
  | "revision-general"
  | "revision-text"
  | "panel-footnote"
  | "panel-note"
  | "panel-citation"
  | "panel-quotation"
  | "panel-todo";

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
  // Optional: kind-specific resolved hint, e.g. resolved bibKey.
  resolvedHint?: string;
}

const KIND_META: Record<
  AIRequestKind,
  { label: string; chipBg: string; chipFg: string; description: string }
> = {
  "bib-fields": {
    label: "Bib fields",
    chipBg: "#eef3fb",
    chipFg: "#3b6ea8",
    description: "Review the BibTeX fields of an existing entry",
  },
  "bib-notes": {
    label: "Bib notes",
    chipBg: "#f0f5ea",
    chipFg: "#5a7a3b",
    description: "Have Claude draft annotation notes for an entry",
  },
  "bib-entry": {
    label: "New entry",
    chipBg: "#fef4e6",
    chipFg: "#a16207",
    description: "Find or create a new bibliography entry from a description",
  },
  "revision-general": {
    label: "General",
    chipBg: "#f3edfb",
    chipFg: "#7c3aed",
    description: "Open a general revision / dialogue thread with Claude",
  },
  "revision-text": {
    label: "On selection",
    chipBg: "#eaf6f4",
    chipFg: "#0f766e",
    description: "Anchored to selected text — created from the editor",
  },
  "panel-footnote": {
    label: "Footnote",
    chipBg: "#fef2f2",
    chipFg: "#b45757",
    description: "AI request for a footnote",
  },
  "panel-note": {
    label: "Note",
    chipBg: "#f0f9ff",
    chipFg: "#0369a1",
    description: "AI request for a margin note",
  },
  "panel-citation": {
    label: "Citation",
    chipBg: "#fefce8",
    chipFg: "#a16207",
    description: "AI request for a citation",
  },
  "panel-quotation": {
    label: "Quotation",
    chipBg: "#faf5ff",
    chipFg: "#7e22ce",
    description: "AI request for a quotation",
  },
  "panel-todo": {
    label: "Todo",
    chipBg: "#f0fdf4",
    chipFg: "#15803d",
    description: "AI request for a task",
  },
};

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

interface BuildArgs {
  bibReviewRequests: BibReviewRequest[];
  bibEntryRequests: BibEntryRequest[];
  generalRevisions: GeneralRevision[];
  textRevisions: TextRevision[];
  users: RevisionUser[];
  panelAiRequests: AiRequest[];
  cancelBibReview: (bibKey: string, type: "fields" | "notes") => void;
  removeEntryRequest: (id: string) => void;
  deletePanelAiRequest: (id: string) => void;
}

function buildRequests(args: BuildArgs): AIRequestVM[] {
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
    });
  }

  const userById = new Map(args.users.map((u) => [u.id, u]));
  const claudeIds = new Set(
    args.users.filter((u) => u.id === "claude" || /claude/i.test(u.name)).map((u) => u.id),
  );
  const hasClaudeReply = (turns: { authorId: string }[]): boolean =>
    turns.some((t) => claudeIds.has(t.authorId));

  for (const rev of args.generalRevisions) {
    const author = userById.get(rev.authorId);
    const status: AIRequestStatus = rev.resolved
      ? "resolved"
      : hasClaudeReply(rev.turns.slice(1))
        ? "responded"
        : "open";
    out.push({
      id: `genrev:${rev.id}`,
      kind: "revision-general",
      status,
      label: author?.name || "Me",
      snippet: rev.text,
      turnCount: rev.turns.length,
      createdAt: rev.createdAt,
    });
  }

  for (const rev of args.textRevisions) {
    const author = userById.get(rev.authorId);
    const status: AIRequestStatus = rev.resolved
      ? "resolved"
      : hasClaudeReply(rev.turns.slice(1))
        ? "responded"
        : "open";
    out.push({
      id: `txtrev:${rev.id}`,
      kind: "revision-text",
      status,
      label: author?.name || "Me",
      snippet:
        (rev.selectedText ? `"${truncate(rev.selectedText, 60)}" — ` : "") +
        rev.text,
      turnCount: rev.turns.length,
      createdAt: rev.createdAt,
    });
  }

  const PANEL_KIND_MAP: Record<PanelAiRequestKind, AIRequestKind> = {
    footnote: "panel-footnote",
    note: "panel-note",
    citation: "panel-citation",
    quotation: "panel-quotation",
    todo: "panel-todo",
  };

  for (const r of args.panelAiRequests) {
    out.push({
      id: `panel:${r.id}`,
      kind: PANEL_KIND_MAP[r.kind],
      status: r.status === "complete" ? "resolved" : "open",
      label: r.kind,
      snippet: r.text || "(empty draft)",
      turnCount: 0,
      createdAt: r.createdAt,
      onCancel:
        r.status !== "complete"
          ? () => args.deletePanelAiRequest(r.id)
          : undefined,
    });
  }

  return out;
}

/* ── Component ─────────────────────────────────────────────────────── */

export interface AIWindowProps {
  open: boolean;
  onClose: () => void;

  // Live state — flow straight from the hooks in EditorLayout.
  bibReviewRequests: BibReviewRequest[];
  bibEntryRequests: BibEntryRequest[];
  generalRevisions: GeneralRevision[];
  textRevisions: TextRevision[];
  users: RevisionUser[];
  bibEntries: BibEntry[];

  // Panel AI requests (useAiRequests unified store).
  panelAiRequests: AiRequest[];
  addPanelAiRequest: (kind: PanelAiRequestKind, text?: string) => AiRequest;
  deletePanelAiRequest: (id: string) => void;

  // Mutators
  requestBibReview: (
    bibKey: string,
    type: "fields" | "notes",
    requestNotes?: string,
  ) => void;
  cancelBibReview: (bibKey: string, type: "fields" | "notes") => void;
  addEntryRequest: (description: string) => void;
  removeEntryRequest: (id: string) => void;
  addGeneralRevision: (text: string) => unknown;

  // Refresh on open
  refreshAll: () => void;
}

type FilterKind = "all" | AIRequestKind;

export default function AIWindow({
  open,
  onClose,
  bibReviewRequests,
  bibEntryRequests,
  generalRevisions,
  textRevisions,
  users,
  bibEntries,
  panelAiRequests,
  addPanelAiRequest,
  deletePanelAiRequest,
  requestBibReview,
  cancelBibReview,
  addEntryRequest,
  removeEntryRequest,
  addGeneralRevision,
  refreshAll,
}: AIWindowProps) {
  const [filter, setFilter] = useState<FilterKind>("all");
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

  // ESC to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const handleBackdrop = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  const requests = useMemo(
    () =>
      buildRequests({
        bibReviewRequests,
        bibEntryRequests,
        generalRevisions,
        textRevisions,
        users,
        panelAiRequests,
        cancelBibReview,
        removeEntryRequest,
        deletePanelAiRequest,
      }),
    [
      bibReviewRequests,
      bibEntryRequests,
      generalRevisions,
      textRevisions,
      users,
      panelAiRequests,
      cancelBibReview,
      removeEntryRequest,
      deletePanelAiRequest,
    ],
  );

  const filtered = useMemo(
    () => (filter === "all" ? requests : requests.filter((r) => r.kind === filter)),
    [requests, filter],
  );

  const buckets = useMemo(() => {
    const sortByDate = (a: AIRequestVM, b: AIRequestVM) =>
      b.createdAt.localeCompare(a.createdAt);
    return {
      open: filtered.filter((r) => r.status === "open").sort(sortByDate),
      responded: filtered.filter((r) => r.status === "responded").sort(sortByDate),
      resolved: filtered.filter((r) => r.status === "resolved").sort(sortByDate),
    };
  }, [filtered]);

  // Counts across the full (unfiltered) set, used in chip labels.
  const totalCounts = useMemo(() => {
    const counts: Record<string, number> = { all: requests.length };
    for (const k of Object.keys(KIND_META) as AIRequestKind[]) {
      counts[k] = requests.filter((r) => r.kind === k).length;
    }
    return counts as Record<FilterKind, number>;
  }, [requests]);

  const PANEL_KIND_REVERSE: Record<string, PanelAiRequestKind> = {
    "panel-footnote": "footnote",
    "panel-note": "note",
    "panel-citation": "citation",
    "panel-quotation": "quotation",
    "panel-todo": "todo",
  };

  const submitComposer = useCallback(() => {
    const text = composerText.trim();
    if (composerKind === "revision-general") {
      if (!text) return;
      addGeneralRevision(text);
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
  }, [
    composerKind,
    composerText,
    composerBibKey,
    addGeneralRevision,
    addEntryRequest,
    requestBibReview,
    addPanelAiRequest,
  ]);

  if (!open) return null;

  const composerNeedsBibKey =
    composerKind === "bib-fields" || composerKind === "bib-notes";

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/30"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-window-title"
      onClick={handleBackdrop}
    >
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-2xl w-full max-w-[760px] max-h-[82vh] mx-4 flex flex-col overflow-hidden">
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
            className="text-sm font-semibold text-stone-700"
          >
            AI requests
          </h2>
          <span className="text-[11px] text-stone-400">
            {buckets.open.length} open · {buckets.responded.length} responded · {buckets.resolved.length} resolved
          </span>
          <div className="flex-1" />
          <button
            onClick={() => refreshAll()}
            className="p-1 rounded text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors"
            title="Refresh"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-colors"
            title="Close (Esc)"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 3l8 8M11 3l-8 8" />
            </svg>
          </button>
        </div>

        {/* Filter chips */}
        <div className="flex items-center gap-1.5 px-5 py-2 border-b border-[var(--border)] overflow-x-auto bg-stone-50/50">
          <FilterChip
            label="All"
            count={totalCounts.all}
            active={filter === "all"}
            onClick={() => setFilter("all")}
          />
          {(Object.keys(KIND_META) as AIRequestKind[]).map((k) => (
            <FilterChip
              key={k}
              label={KIND_META[k].label}
              count={totalCounts[k]}
              active={filter === k}
              chipFg={KIND_META[k].chipFg}
              chipBg={KIND_META[k].chipBg}
              onClick={() => setFilter(k)}
            />
          ))}
        </div>

        {/* Body — request list */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          <Bucket title="Open" status="open" items={buckets.open} />
          <Bucket title="Responded" status="responded" items={buckets.responded} />
          <Bucket title="Resolved" status="resolved" items={buckets.resolved} />
          {filtered.length === 0 && (
            <div className="text-center text-xs text-stone-400 py-8">
              No requests yet. Use the form below to start one.
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-[var(--border)] bg-stone-50/60 px-5 py-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider">
              New request
            </span>
            <select
              value={composerKind}
              onChange={(e) => {
                setComposerKind(e.target.value as AIRequestKind);
                setComposerBibKey("");
              }}
              className="text-xs bg-white border border-[var(--border)] rounded px-1.5 py-0.5 text-stone-700"
            >
              <option value="revision-general">General dialogue</option>
              <option value="bib-entry">New bibliography entry</option>
              <option value="bib-fields">Bib field review</option>
              <option value="bib-notes">Bib notes review</option>
              <optgroup label="Panel requests">
                <option value="panel-footnote">Footnote request</option>
                <option value="panel-note">Note request</option>
                <option value="panel-citation">Citation request</option>
                <option value="panel-quotation">Quotation request</option>
                <option value="panel-todo">Todo request</option>
              </optgroup>
            </select>
            <span className="text-[11px] text-stone-400 truncate">
              {KIND_META[composerKind].description}
            </span>
          </div>

          {composerNeedsBibKey && (
            <div className="flex items-center gap-2 mb-2">
              <label className="text-[11px] text-stone-500">Entry key</label>
              <input
                list="ai-window-bib-keys"
                value={composerBibKey}
                onChange={(e) => setComposerBibKey(e.target.value)}
                placeholder="e.g. smith2020"
                className="flex-1 text-xs bg-white border border-[var(--border)] rounded px-2 py-1 text-stone-700 placeholder:text-stone-400 focus:outline-none focus:border-[var(--accent)]"
              />
              <datalist id="ai-window-bib-keys">
                {bibEntries.map((b) => (
                  <option key={b.key} value={b.key}>
                    {b.fields.title || b.type}
                  </option>
                ))}
              </datalist>
            </div>
          )}

          <div className="flex items-end gap-2">
            <textarea
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
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  submitComposer();
                }
              }}
              className="flex-1 text-xs bg-white border border-[var(--border)] rounded px-2 py-1.5 text-stone-700 placeholder:text-stone-400 focus:outline-none focus:border-[var(--accent)] resize-none"
            />
            <button
              onClick={submitComposer}
              disabled={
                (composerNeedsBibKey && !composerBibKey.trim()) ||
                (!composerNeedsBibKey && !composerText.trim())
              }
              className="px-3 py-1.5 text-xs font-medium rounded-md border bg-stone-800 hover:bg-stone-900 text-white border-stone-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              title="Submit (⌘↵)"
            >
              Submit
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Sub-components ────────────────────────────────────────────────── */

function FilterChip({
  label,
  count,
  active,
  onClick,
  chipBg,
  chipFg,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  chipBg?: string;
  chipFg?: string;
}) {
  const style = active && chipBg && chipFg
    ? { background: chipBg, color: chipFg, borderColor: chipFg }
    : undefined;
  return (
    <button
      onClick={onClick}
      style={style}
      className={`shrink-0 text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
        active
          ? "border-stone-700 bg-stone-800 text-white"
          : "border-[var(--border)] bg-white text-stone-500 hover:text-stone-700 hover:border-stone-300"
      }`}
    >
      {label}
      <span className={`ml-1 ${active ? "opacity-80" : "text-stone-400"}`}>
        {count}
      </span>
    </button>
  );
}

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
        <span className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider">
          {title}
        </span>
        <span className="text-[10px] text-stone-400">{items.length}</span>
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
  return (
    <li className="flex gap-2.5 items-start px-2.5 py-2 rounded-md border border-[var(--border)] bg-white hover:border-stone-300 transition-colors">
      <span
        className="shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium"
        style={{ background: meta.chipBg, color: meta.chipFg }}
        title={meta.description}
      >
        {meta.label}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-stone-700 truncate">
            {req.label}
          </span>
          {req.resolvedHint && (
            <span className="text-[10px] text-stone-400 truncate">
              {req.resolvedHint}
            </span>
          )}
          {req.turnCount > 1 && (
            <span
              className="shrink-0 text-[9px] text-stone-500 bg-stone-100 px-1 rounded"
              title={`${req.turnCount} turns in this thread`}
            >
              {req.turnCount} turns
            </span>
          )}
          <span className="text-[10px] text-stone-400 ml-auto shrink-0">
            {relTime(req.createdAt)}
          </span>
        </div>
        <p className="text-[11px] text-stone-500 leading-snug mt-0.5 break-words">
          {truncate(req.snippet)}
        </p>
      </div>
      {req.onCancel && (
        <button
          onClick={req.onCancel}
          className="shrink-0 text-[10px] text-stone-400 hover:text-[#b45757] transition-colors px-1"
          title="Cancel this request"
        >
          ×
        </button>
      )}
    </li>
  );
}

// Re-export status type for callers that need it.
export type { AIRequestStatus };

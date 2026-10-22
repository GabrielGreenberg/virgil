"use client";

/**
 * "Archived with this passage" — the two sides of the passage↔card link,
 * made visible (task 1195; the data is 1193's dormant links + 1194's carry).
 *
 * Archiving a passage CARRIES the cards anchored to it: each one goes dormant
 * with the snippet and, when every anchor went, is archived with it. This
 * module is the ONE place that link is drawn:
 *
 *  - on the ARCHIVE card, a row of chips — "Archived with this passage:
 *    2 notes, 1 task" — each chip opening that card in its own panel (the
 *    Archives view when it is still archived);
 *  - on a TRAVELLED card, a line naming its passage with a jump to the
 *    Archive card — or, once the user has unarchived the card on its own
 *    while the passage stays archived (PARKED), the explanation that it will
 *    re-attach if the passage is restored.
 *
 * Both rows read ONE derivation, `cardsArchivedWith` (`@/links/dormant`),
 * built by the pane over the five card stores — no list is stored on the
 * snippet, so deleting or re-archiving a card updates both sides with no
 * second write. Both rows are ONE shell slot (`archiveRelation`) supplied by
 * `useAnchoredCardShell`, so every card kind inherits it (task 822's lesson:
 * a shared affordance is never opted into per component). Kind nouns come
 * from `CARD_REGISTRY`, never hand-typed.
 */

import { createContext, useContext, type ReactNode } from "react";
import type { CardKind } from "@/cards/types";
import { CARD_REGISTRY } from "@/cards/card-registry";
import { makeCompressedSummary } from "@/components/panel-primitives";
import type { TravelledCard } from "@/links/dormant";

/** The parked copy — the SSOT for the card line and the omni bin row. */
export const PARKED_WITH_PASSAGE_COPY =
  "Its text is still archived. It will re-attach if you restore the passage.";

/** One card that travelled with a passage. */
export interface ArchivedWithEntry {
  kind: CardKind;
  id: string;
  /** Still archived — false once the user unarchived it on its own (parked). */
  archived: boolean;
  /** Display title (the card's own text, or its kind label). */
  title: string;
}

/** A travelled card's passage. */
export interface PassageRef {
  snippetId: string;
  title: string;
  /** The card itself is still archived (vs. parked). */
  archived: boolean;
}

export interface ArchivedWithApi {
  /** The cards that travelled with a passage (empty when none). */
  travelledWith: (snippetId: string) => readonly ArchivedWithEntry[];
  /** The passage a card travelled with, or null. */
  passageOf: (kind: CardKind, id: string) => PassageRef | null;
  /** Open a card in its own panel (widening to its Archives view as needed). */
  openCard: (kind: CardKind, id: string) => void;
  /** Open the Archive card for a passage. */
  openPassage: (snippetId: string) => void;
}

const NONE: readonly ArchivedWithEntry[] = [];
const INERT: ArchivedWithApi = {
  travelledWith: () => NONE,
  passageOf: () => null,
  openCard: () => {},
  openPassage: () => {},
};

const ArchivedWithContext = createContext<ArchivedWithApi>(INERT);

export function ArchivedWithProvider({
  value,
  children,
}: {
  value: ArchivedWithApi;
  children: ReactNode;
}) {
  return <ArchivedWithContext.Provider value={value}>{children}</ArchivedWithContext.Provider>;
}

export function useArchivedWith(): ArchivedWithApi {
  return useContext(ArchivedWithContext);
}

/** Lower-case kind noun from the registry, pluralised by count. */
export function kindNoun(kind: CardKind, count: number): string {
  const label = CARD_REGISTRY[kind].label.toLowerCase();
  return count === 1 ? label : `${label}s`;
}

/** "2 notes, 1 task" — counts per kind, in first-seen order. */
export function travelledSummary(entries: readonly ArchivedWithEntry[]): string {
  const counts = new Map<CardKind, number>();
  for (const e of entries) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  return [...counts].map(([k, n]) => `${n} ${kindNoun(k, n)}`).join(", ");
}

/** The delete-confirm sentence for a passage carrying cards (decision 5). */
export function passageDeleteMessage(entries: readonly ArchivedWithEntry[]): string | undefined {
  if (entries.length === 0) return undefined;
  const verb = entries.length === 1 ? "stays" : "stay";
  return (
    `Delete this archived passage? ${travelledSummary(entries)} archived with it ` +
    `${verb} in your archived cards, no longer tied to this text.`
  );
}

const TITLE_MAX = 48;

function clip(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= TITLE_MAX ? t : t.slice(0, TITLE_MAX).trimEnd() + "…";
}

/** A card's display title, from the registry's declared content fields: the
 *  first non-empty text field, else the rich body's opening words, else the
 *  kind label. */
export function travelledCardTitle(kind: CardKind, card: object): string {
  const model = CARD_REGISTRY[kind].content;
  const textFields = model?.textFields ?? [];
  const bodyField = model?.bodyField ?? null;
  const rec = card as Record<string, unknown>;
  for (const f of textFields) {
    const v = rec[f];
    if (typeof v === "string" && v.trim()) return clip(v);
  }
  if (bodyField) {
    const body = makeCompressedSummary(rec[bodyField], 1);
    if (body) return clip(body);
  }
  return `Untitled ${kindNoun(kind, 1)}`;
}

/** A passage's display title: its own title, else its opening words. */
export function passageTitle(snippet: { title?: string; content?: unknown }): string {
  if (snippet.title?.trim()) return clip(snippet.title);
  return clip(makeCompressedSummary(snippet.content, 1)) || "Untitled passage";
}

/**
 * Build the context value from THE derivation (`cardsArchivedWith`). `open`
 * is the pane's one cross-panel jump (`openItemInPanel`), which already widens
 * a panel to its Archives view when the target card is archived.
 */
export function buildArchivedWithApi(
  travelled: ReadonlyMap<string, readonly TravelledCard<CardKind>[]>,
  snippetTitle: (snippetId: string) => string,
  open: (panel: string, id: string) => void,
): ArchivedWithApi {
  const bySnippet = new Map<string, ArchivedWithEntry[]>();
  const byCard = new Map<string, PassageRef>();
  for (const [snippetId, list] of travelled) {
    const title = snippetTitle(snippetId);
    bySnippet.set(
      snippetId,
      list.map((t) => {
        byCard.set(`${t.kind}:${t.card.id}`, { snippetId, title, archived: t.archived });
        return {
          kind: t.kind,
          id: t.card.id,
          archived: t.archived,
          title: travelledCardTitle(t.kind, t.card),
        };
      }),
    );
  }
  return {
    travelledWith: (snippetId) => bySnippet.get(snippetId) ?? NONE,
    passageOf: (kind, id) => byCard.get(`${kind}:${id}`) ?? null,
    openCard: (kind, id) => {
      const panel = CARD_REGISTRY[kind].panel;
      if (panel) open(panel, id);
    },
    openPassage: (snippetId) => open("archive", snippetId),
  };
}

const ROW = "mx-2 mb-1.5 mt-0.5 flex flex-wrap items-center gap-1 text-[11px] leading-snug text-[var(--muted)]";
const CHIP =
  "inline-flex max-w-full items-center gap-1 rounded-xs border border-[var(--border)] px-1.5 py-px cursor-pointer hover-on-light hover:text-ink-strong focus-ring";

/**
 * THE shell slot. Renders the travelled-cards chip row on an Archive card and
 * the passage line on any other card; nothing for a card with no relation.
 */
export function ArchiveRelationRow({ kind, id }: { kind: CardKind; id: string }) {
  const api = useArchivedWith();
  if (kind === "archive") {
    const entries = api.travelledWith(id);
    if (entries.length === 0) return null;
    return (
      <div className={ROW} data-archive-travelled="" onClick={(e) => e.stopPropagation()}>
        <span data-archive-travelled-summary="">
          Archived with this passage: {travelledSummary(entries)}
        </span>
        {entries.map((e) => (
          <button
            key={`${e.kind}:${e.id}`}
            type="button"
            className={CHIP}
            data-archive-travelled-chip={`${e.kind}:${e.id}`}
            data-hint={`Open this ${kindNoun(e.kind, 1)}${e.archived ? " in its archive" : ""}`}
            onClick={() => api.openCard(e.kind, e.id)}
          >
            <span className="font-medium">{CARD_REGISTRY[e.kind].label}</span>
            <span className="truncate">{e.title}</span>
          </button>
        ))}
      </div>
    );
  }
  const passage = api.passageOf(kind, id);
  if (!passage) return null;
  return (
    <div
      className={ROW}
      data-archive-passage={passage.snippetId}
      data-archive-passage-state={passage.archived ? "archived" : "parked"}
      onClick={(e) => e.stopPropagation()}
    >
      {passage.archived ? (
        <span>Archived with passage</span>
      ) : (
        <span>{PARKED_WITH_PASSAGE_COPY}</span>
      )}
      <button
        type="button"
        className={CHIP}
        data-archive-passage-jump=""
        data-hint="Open the archived passage"
        onClick={() => api.openPassage(passage.snippetId)}
      >
        <span className="truncate">{passage.archived ? passage.title : `Passage: ${passage.title}`}</span>
      </button>
    </div>
  );
}

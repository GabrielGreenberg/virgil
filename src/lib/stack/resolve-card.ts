/**
 * Look up the source card record for a given stack-card kind + id from
 * the per-doc sidecar hooks. Returns null when not found.
 *
 * The returned record is the live entity — the caller is responsible
 * for cloning it before persisting (snapshotCard does so).
 */

import type {
  ArchivedSnippet,
  BibEntry,
  CitationRef,
  CutterCard,
  FootnoteRef,
  HighlightCard,
  RevisionCard,
  TodoItem,
  UserNote,
} from "@/lib/types";
import type { StackCardKind } from "./types";

/** Translate the prefix in a popped-out `cardKey` (e.g. `revision:<id>`,
 *  `bib:<key>`) to its corresponding `StackCardKind`. Returns null for
 *  prefixes that have no stack representation (e.g. `ai`, `error`,
 *  `paragraph`, `heading`). */
export function cardKeyPrefixToStackKind(prefix: string): StackCardKind | null {
  switch (prefix) {
    case "note":
      return "note";
    case "highlight":
      return "highlight";
    case "footnote":
      return "footnote";
    case "citation":
      return "citation";
    case "bib":
      return "bibliography";
    case "example":
      return "example";
    case "todo":
      return "todo";
    case "archive":
      return "archive";
    case "revision":
      return "comment";
    case "revision-suggestion":
      return "revision-suggestion";
    case "cutter-comment":
      return "cutter-comment";
    case "cutter-suggestion":
      return "cutter-suggestion";
    default:
      return null;
  }
}

export interface CardLookupHooks {
  notesHook: {
    notes: UserNote[];
    highlights: HighlightCard[];
  };
  todosHook: { items: TodoItem[] };
  archiveHook: { snippets: ArchivedSnippet[] };
  revisionsHook: { cards: RevisionCard[] };
  cutterHook: { cards: CutterCard[] };
  footnotesHook: { footnoteRefs: FootnoteRef[] };
  citationsHook: {
    citations: CitationRef[];
    bibEntries: BibEntry[];
    getBibEntry: (key: string) => BibEntry | undefined;
  };
}

export function resolveCardData(
  kind: StackCardKind,
  id: string,
  hooks: CardLookupHooks,
):
  | UserNote
  | HighlightCard
  | FootnoteRef
  | CitationRef
  | BibEntry
  | TodoItem
  | ArchivedSnippet
  | Extract<RevisionCard, { kind: "comment" }>
  | Extract<RevisionCard, { kind: "suggestion" }>
  | Extract<CutterCard, { kind: "comment" }>
  | Extract<CutterCard, { kind: "suggestion" }>
  | null {
  switch (kind) {
    case "note":
      return hooks.notesHook.notes.find((n) => n.id === id) ?? null;
    case "highlight":
      return hooks.notesHook.highlights.find((h) => h.id === id) ?? null;
    case "footnote":
      return hooks.footnotesHook.footnoteRefs.find((f) => f.id === id) ?? null;
    case "citation":
      return hooks.citationsHook.citations.find((c) => c.id === id) ?? null;
    case "bibliography": {
      // Bibliography popout key uses `bib:<bibKey>` — id IS the bib key.
      return hooks.citationsHook.getBibEntry(id) ?? null;
    }
    case "example":
      // Examples don't have a useful standalone snapshot payload in v1.
      return null;
    case "todo":
      return hooks.todosHook.items.find((t) => t.id === id) ?? null;
    case "archive":
      return hooks.archiveHook.snippets.find((s) => s.id === id) ?? null;
    case "comment": {
      const c = hooks.revisionsHook.cards.find((cc) => cc.id === id);
      return c && c.kind === "comment" ? c : null;
    }
    case "revision-suggestion": {
      const c = hooks.revisionsHook.cards.find((cc) => cc.id === id);
      return c && c.kind === "suggestion" ? c : null;
    }
    case "cutter-comment": {
      const c = hooks.cutterHook.cards.find((cc) => cc.id === id);
      return c && c.kind === "comment" ? c : null;
    }
    case "cutter-suggestion": {
      const c = hooks.cutterHook.cards.find((cc) => cc.id === id);
      return c && c.kind === "suggestion" ? c : null;
    }
    default:
      return null;
  }
}

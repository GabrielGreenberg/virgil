"use client";

/**
 * The tool gutter's READING LISTS — footnotes, bibliography and numbered
 * examples (Gabriel, 2026-11-08). Each is a `GutterList` of groups built by
 * `gutter-lists.ts`, with its own header controls; an open row mounts the
 * kind's own card through `renderCard` (EditorPane supplies it, with the same
 * handlers the old panels used).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { FootnoteInfo, ExampleInfo } from "@/components/Editor";
import type { BibEntry, BibEntryRequest, FootnoteRef, OrphanedFootnote } from "@/lib/types";
import type { SaveBibEntry } from "@/hooks/useCitations";
import type { RequestBibReview } from "@/hooks/useBibReview";
import { useLibraryItems, useLibraryMasterBib } from "@/hooks/useLibrary";
import { searchCentralLibrary } from "@/lib/bib-search";
import { AnchoredMenu } from "@/components/menu/AnchoredMenu";
import {
  BibConflictStrip,
  BibLibraryPicker,
  BibPendingRequests,
  BibRequestForm,
  LIBRARY_NOT_CONNECTED_HINT,
  useBibLibraryFlow,
  type BibLibraryFlow,
} from "@/panels/Bibliography/bib-library-flow";
import { readDocStructure } from "@/lib/tiptap/doc-structure";
import { useStructuralRevisions } from "@/hooks/useStructuralRevisions";
import { useCardStore } from "@/links/_shared/anchored-card-store";
import { countLabelRefs } from "@/lib/tiptap/label-rename";
import { downloadCitedBib } from "@/lib/bib-export-cited";
import { startBibEntryDrag } from "@/components/bib-entry-drag";
import { isCancelEscape, swallowRepeatsUntilKeyup } from "@/lib/key-intent";
import { Button, ItemMenu } from "@/components/panel-primitives";
import { MenuActionRow } from "@/components/menu/MenuActionRow";
import { SegmentedToggle } from "@/components/SegmentedToggle";
import { iconHint } from "@/components/Hint";
import { CardViewModeMenuItems } from "@/panels/_shared/CardViewModeMenu";
import { useCardArchiveView } from "@/panels/_shared/card-archive-view";
import { useEditorRefContext } from "../contexts/editor-ref";
import { useSelectionsContext } from "../contexts/selections";
import { useCardCreationContext } from "../contexts/card-creation";
import { GutterList } from "./GutterList";
import { BibOpenView } from "./BibOpenView";
import {
  bibliographyGroups,
  citationsByKey,
  exampleGroups,
  footnoteGroups,
  referenceParts,
  topSections,
  type GutterCardRef,
  type GutterCitation,
  type GutterListGroup,
  type GutterListRow,
  type GutterSectionHead,
} from "./gutter-lists";

export type ReadingListKind = "footnotes" | "bibliography" | "examples";

export const READING_LISTS: ReadonlySet<string> = new Set<ReadingListKind>([
  "footnotes",
  "bibliography",
  "examples",
]);

export interface ReadingListsData {
  footnotes: readonly FootnoteInfo[];
  orphanedFootnotes: readonly OrphanedFootnote[];
  unanchoredFootnotes: readonly FootnoteRef[];
  examples: readonly ExampleInfo[];
  bibEntries: readonly BibEntry[];
  /** The raw `.bib` text, for "Export cited.bib". */
  bibSource?: string;
  /** Every citation in the paper with its keys and position. */
  editorCitations: readonly GutterCitation[];
  /** The kind's own card, for an open row. */
  renderCard: (card: GutterCardRef) => ReactNode;
  /** The citation the bibliography is currently pointing at. */
  onActiveCitation?: (citationId: string | null) => void;
  /** The bibliography's writes: add from the library, the conflict flow's
   *  one-write Replace and AI merge, and entry requests. */
  bibActions?: {
    addBibEntry: (entry: BibEntry) => void;
    saveBibEntry: SaveBibEntry;
    requestReview: RequestBibReview;
    entryRequests: readonly BibEntryRequest[];
    addEntryRequest: (description: string) => void;
    removeEntryRequest: (id: string) => void;
    /** The entry's annotation, shown as one line in its open view. */
    getAnnotation?: (key: string) => string;
  };
}

// A host with no bibliography writes (none today) — the flow's actions do nothing.
const NO_SAVE = (() => Promise.resolve(undefined)) as unknown as SaveBibEntry;
const NO_REVIEW = (() => Promise.resolve(undefined)) as unknown as RequestBibReview;
const NO_REQUEST = () => {};

export function ReadingList({
  kind,
  title,
  data,
}: {
  kind: ReadingListKind;
  title: string;
  data: ReadingListsData;
}) {
  const { editorInstance, editorRef } = useEditorRefContext();
  const sel = useSelectionsContext();
  const cardStore = useCardStore();
  const rev = useStructuralRevisions(editorInstance);
  // Headings only change on a structural edit (`rev.headings`), never on a
  // keystroke, so the sections are re-read at that pace.
  const sections = useMemo<GutterSectionHead[]>(
    () => (editorInstance && !editorInstance.isDestroyed ? topSections(readDocStructure(editorInstance.state).headings) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editorInstance, rev.headings],
  );

  const { getView } = useCardArchiveView();
  const fnView = getView("footnotes");
  const [bibMode, setBibMode] = useState<"az" | "cited">(() => readBibMode());
  const [citedOnly, setCitedOnly] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [scope, setScope] = useState<"local" | "library">("local");

  // The library flow the Bibliography panel runs too: add from the library,
  // the four-way citekey conflict, entry requests.
  const flow = useBibLibraryFlow({
    bibEntries: data.bibEntries,
    onAddBibEntry: data.bibActions?.addBibEntry,
    onSaveBibEntry: data.bibActions?.saveBibEntry ?? NO_SAVE,
    onRequestReview: data.bibActions?.requestReview ?? NO_REVIEW,
    onAddEntryRequest: data.bibActions?.addEntryRequest ?? NO_REQUEST,
    select: (key) => sel.setSelectedBibKey(key),
    onAddedUnderNewKey: (key) => {
      // A new `<key>-N` is uncited: leave the search, show every entry, select it.
      setQuery(null);
      setScope("local");
      setCitedOnly(false);
      sel.setSelectedBibKey(key);
    },
  });
  const { hasFolder: libraryConnected } = useLibraryItems();
  const librarySearch = kind === "bibliography" && query !== null && scope === "library";
  const { entries: libraryEntries } = useLibraryMasterBib(librarySearch);
  const libraryResults = useMemo(
    () => (librarySearch && query?.trim() ? searchCentralLibrary(libraryEntries, query) : []),
    [librarySearch, libraryEntries, query],
  );
  const closeSearch = () => {
    setQuery(null);
    setScope("local");
    flow.clearConflict();
  };

  const groups = useMemo<GutterListGroup[]>(() => {
    switch (kind) {
      case "footnotes":
        return footnoteGroups(data.footnotes, data.orphanedFootnotes, data.unanchoredFootnotes, sections, fnView);
      case "examples": {
        const doc = editorInstance && !editorInstance.isDestroyed ? editorInstance.state.doc : null;
        return exampleGroups(data.examples, (label) => (doc ? countLabelRefs(doc, label) : 0));
      }
      case "bibliography":
        return filterBib(
          bibliographyGroups(data.bibEntries, data.editorCitations, sections, bibMode, citedOnly),
          scope === "local" ? query : null,
        );
    }
    // `rev.labels`-free on purpose: example ref counts refresh with the
    // examples list itself (a `\ref` edit is a structural change upstream).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, data, sections, fnView, bibMode, citedOnly, query, scope, editorInstance]);

  const count = useMemo(() => {
    if (kind === "bibliography") return new Set(data.bibEntries.map((e) => e.key)).size;
    if (kind === "examples") return data.examples.length;
    return data.footnotes.length;
  }, [kind, data]);

  // ── On screen ───────────────────────────────────────────────────────────
  // Which rows' anchors are in view: an IntersectionObserver over the
  // anchors' own DOM nodes, re-synced only on a STRUCTURAL change (the
  // revision counters), never per keystroke and never per scroll frame — the
  // browser reports crossings, and nothing here reads layout.
  const targets = useMemo(() => {
    const out: { id: string; pos: number }[] = [];
    if (kind === "footnotes") for (const f of data.footnotes) out.push({ id: f.footnoteId, pos: f.pos });
    else if (kind === "examples") for (const e of data.examples) out.push({ id: e.exampleId, pos: e.pos });
    else for (const c of data.editorCitations) for (const k of c.keys) out.push({ id: k, pos: c.pos });
    return out;
    // Positions are read once per structural revision: plain typing shifts
    // them, but the observed DOM nodes are the same nodes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, rev.footnotes, rev.citations, rev.examples, editorInstance]);
  const hereIds = useOnScreenIds(editorInstance, targets);

  // ── Selection, jumps, stepping ──────────────────────────────────────────
  const { selected, selectedBibKey } = sel;
  const selectedIds = useMemo(() => {
    const s = new Set<string>();
    if (selected?.id) s.add(selected.id);
    if (selectedBibKey) s.add(selectedBibKey);
    return s;
  }, [selected, selectedBibKey]);

  const byKey = useMemo(() => citationsByKey(data.editorCitations), [data.editorCitations]);
  const [occurrence, setOccurrence] = useState<Record<string, number>>({});

  const onSelect = useCallback(
    (row: GutterListRow) => {
      const c = row.card;
      if (row.bibKey) {
        sel.setSelectedBibKey(row.bibKey);
        const ids = byKey.get(row.bibKey) ?? [];
        data.onActiveCitation?.(ids[occurrence[row.bibKey] ?? 0] ?? ids[0] ?? null);
        return;
      }
      if (!c) return;
      if (c.kind === "example") sel.setSelectedExampleId(c.id);
      else if (c.kind !== "bib") sel.setSelectedFootnoteId(c.id);
    },
    [sel, byKey, occurrence, data],
  );

  const onJump = useCallback(
    (row: GutterListRow, el: HTMLElement | null) => {
      const j = row.jump;
      const handle = editorRef.current;
      if (!j) return;
      if (j.kind === "footnote") {
        sel.setSelectedFootnoteId(j.id);
        handle?.scrollToFootnote(j.id, el);
      } else if (j.kind === "example") {
        sel.setSelectedExampleId(j.id);
        handle?.scrollToExample(j.id, el);
      } else if (j.kind === "bib" && j.citationId) {
        sel.setSelectedBibKey(j.key);
        handle?.scrollToCitation(j.citationId, el);
        data.onActiveCitation?.(j.citationId);
      }
    },
    [editorRef, sel, data],
  );

  /** Jump to the `i`th citation of `key` and make it the current one. */
  const goTo = useCallback(
    (key: string, i: number, el: HTMLElement | null) => {
      const id = (byKey.get(key) ?? [])[i];
      if (!id) return;
      setOccurrence((o) => ({ ...o, [key]: i }));
      sel.setSelectedBibKey(key);
      editorRef.current?.scrollToCitation(id, el);
      data.onActiveCitation?.(id);
    },
    [byKey, sel, editorRef, data],
  );

  const onOpenChange = useCallback(
    (card: GutterCardRef, open: boolean) => {
      if (card.kind === "bib") {
        // A bibliography card is open while its entry is selected.
        sel.setSelectedBibKey(open ? card.key : null);
        return;
      }
      const ref = { kind: card.kind === "example" ? "example" : "footnote", id: card.id } as const;
      if (open) cardStore.expand(ref);
      else cardStore.collapse(ref);
    },
    [sel, cardStore],
  );

  const renderCard = useCallback(
    (card: GutterCardRef, row: GutterListRow, close: () => void) =>
      card.kind === "bib" ? (
        <BibOpenView
          row={row}
          bibKey={card.key}
          close={close}
          citationIds={byKey.get(card.key) ?? []}
          current={occurrence[card.key] ?? -1}
          goTo={(i, el) => goTo(card.key, i, el)}
          cites={data.editorCitations}
          bibEntries={data.bibEntries}
          sections={sections}
          doc={editorInstance && !editorInstance.isDestroyed ? editorInstance.state.doc : null}
          annotation={data.bibActions?.getAnnotation?.(card.key)}
          renderSection={data.renderCard}
        />
      ) : (
        data.renderCard(card)
      ),
    [data, byKey, occurrence, goTo, sections, editorInstance],
  );

  return (
    <section className="tool-gutter-section" data-gutter-section={kind}>
      <div className="tool-gutter-section-head">
        <h3 className="tool-gutter-heading">
          {title}
          {count > 0 && <span className="tool-gutter-count">{count}</span>}
        </h3>
        <span className="flex-1" />
        {kind === "bibliography" && (
          <BibControls
            mode={bibMode}
            onMode={(m) => {
              setBibMode(m);
              writeBibMode(m);
            }}
            searching={query !== null}
            onToggleSearch={() => (query === null ? setQuery("") : closeSearch())}
            libraryConnected={libraryConnected}
            onSearchLibrary={(rect) => flow.libraryMenu.openAt(rect)}
            onRequestEntry={() => {
              closeSearch();
              flow.request.show();
            }}
            citedOnly={citedOnly}
            onCitedOnly={setCitedOnly}
            onExport={() => downloadCitedBib(data.bibEntries, new Set(byKey.keys()), data.bibSource)}
          />
        )}
        {kind === "footnotes" && <FootnoteControls />}
      </div>
      {kind === "bibliography" && query !== null && (
        <div className="gutter-list-searchbar">
          <input
            className="gutter-list-search"
            type="search"
            autoFocus
            placeholder={scope === "library" ? "Search the library" : "Search the bibliography"}
            aria-label={scope === "library" ? "Search the library" : "Search the bibliography"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (isCancelEscape(e)) {
                e.preventDefault();
                if (e.repeat) return;
                swallowRepeatsUntilKeyup(e);
                closeSearch();
              }
            }}
          />
          <SegmentedToggle
            ariaLabel="Search scope"
            value={scope}
            onChange={(v) => {
              setScope(v);
              // Leaving the library abandons the context that raised a conflict.
              if (v === "local") flow.clearConflict();
            }}
            options={[
              { value: "local", label: "Local", hint: "Search this paper's bibliography" },
              {
                value: "library",
                label: "Library",
                hint: "Search the library",
                disabled: !libraryConnected,
                disabledHint: LIBRARY_NOT_CONNECTED_HINT,
              },
            ]}
          />
        </div>
      )}
      {kind === "bibliography" && (
        <>
          <BibConflictStrip flow={flow} />
          <BibRequestForm flow={flow} />
        </>
      )}
      {librarySearch ? (
        <LibraryResults query={query ?? ""} results={libraryResults} flow={flow} />
      ) : (
      <GutterList
        list={kind}
        groups={groups}
        selectedIds={selectedIds}
        hereIds={hereIds}
        onSelect={onSelect}
        onJump={onJump}
        renderCard={renderCard}
        leadingToggle={kind === "bibliography" ? (row) => !!row.bibKey : undefined}
        onOpenChange={onOpenChange}
        canDrag={kind === "bibliography" ? (row) => !!rowEntry(row) : undefined}
        onRowDragStart={(row, e) => {
          const entry = rowEntry(row);
          if (entry) startBibEntryDrag(e, entry, data.bibEntries);
        }}
        empty={kind === "bibliography" && query ? "Nothing matches" : "None yet"}
      />
      )}
      {kind === "bibliography" && data.bibActions && (
        <BibPendingRequests
          requests={data.bibActions.entryRequests}
          onRemove={data.bibActions.removeEntryRequest}
        />
      )}
      {kind === "bibliography" && <BibLibraryPicker flow={flow} />}
    </section>
  );
}

/** An element's rect, to anchor a popover under it (none when unmounted). */
function anchorOf(el: HTMLElement | null): DOMRect | null {
  return el ? el.getBoundingClientRect() : null;
}

/** `referenceParts`, or null for an entry that can't be read (it then shows
 *  by its key, or not at all, rather than taking the list down). */
function safeReference(entry: BibEntry): ReturnType<typeof referenceParts> | null {
  try {
    return referenceParts(entry);
  } catch {
    return null;
  }
}

/** The bib entry a bibliography row stands for (none for a missing key). */
function rowEntry(row: GutterListRow): BibEntry | undefined {
  const s = row.snippet;
  return s.kind === "reference" || s.kind === "short" ? s.entry : undefined;
}

/** Library-scope search results: each entry as it will print, with Add
 *  (or Added, or Resolve when the paper holds a different version). */
function LibraryResults({
  query,
  results,
  flow,
}: {
  query: string;
  results: readonly BibEntry[];
  flow: BibLibraryFlow;
}) {
  if (!query.trim()) return <p className="tool-gutter-empty">Type to search the library</p>;
  if (results.length === 0) return <p className="tool-gutter-empty">Nothing in the library matches</p>;
  return (
    <ul className="gutter-library-results">
      {results.map((e) => {
        const state = flow.libraryRowState(e);
        const p = safeReference(e);
        if (!p) return null;
        return (
          <li key={`${e.key}:${e.uid}`} className="gutter-library-result">
            <span className="gutter-snippet gutter-reference" data-lines="3">
              <b>{p.surname}</b>
              {p.rest ? `, ${p.rest}` : ""}
              {p.year ? ` ${p.year}.` : "."} {p.title ? (p.titleStyle === "italic" ? <i>{p.title}</i> : `“${p.title}.”`) : null}
            </span>
            <Button
              variant={state === "added" ? "ghost" : "warm"}
              size="sm"
              disabled={state === "added"}
              onClick={() => flow.addEntry(e, true)}
            >
              {state === "added" ? "Added" : state === "conflict" ? "Resolve" : "Add"}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

/** The ids whose anchor (a node at `pos` in the main editor) is in view. */
function useOnScreenIds(
  editor: { view: { dom: HTMLElement; nodeDOM(pos: number): Node | null }; isDestroyed: boolean } | null,
  targets: readonly { id: string; pos: number }[],
): ReadonlySet<string> {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    if (!editor || editor.isDestroyed || typeof IntersectionObserver === "undefined") return;
    const root = editor.view.dom.closest<HTMLElement>("[data-virgil-row-scroll]");
    const idsOf = new Map<Element, string[]>();
    for (const t of targets) {
      let el: Node | null = null;
      try {
        el = editor.view.nodeDOM(t.pos);
      } catch {
        el = null;
      }
      if (!(el instanceof Element)) continue;
      const list = idsOf.get(el) ?? [];
      list.push(t.id);
      idsOf.set(el, list);
    }
    const visible = new Set<Element>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target);
          else visible.delete(e.target);
        }
        const next = new Set<string>();
        for (const el of visible) for (const id of idsOf.get(el) ?? []) next.add(id);
        setIds((prev) => (sameSet(prev, next) ? prev : next));
      },
      { root },
    );
    for (const el of idsOf.keys()) io.observe(el);
    return () => io.disconnect();
  }, [editor, targets]);
  return ids;
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

// ── Header controls ───────────────────────────────────────────────────────

function FootnoteControls() {
  const { createFootnote } = useCardCreationContext();
  return (
    <ItemMenu hint="Footnote options">
      <MenuActionRow id="gutter-fn-add" label="Add a footnote" onSelect={() => createFootnote({})} />
      <CardViewModeMenuItems kind="footnotes" />
    </ItemMenu>
  );
}

function BibControls(p: {
  mode: "az" | "cited";
  onMode: (m: "az" | "cited") => void;
  searching: boolean;
  onToggleSearch: () => void;
  libraryConnected: boolean;
  onSearchLibrary: (anchor: DOMRect | null) => void;
  onRequestEntry: () => void;
  citedOnly: boolean;
  onCitedOnly: (v: boolean) => void;
  onExport: () => void;
}) {
  const plusRef = useRef<HTMLSpanElement>(null);
  return (
    <>
      <SegmentedToggle
        ariaLabel="Order"
        size="sm"
        value={p.mode}
        onChange={(v) => p.onMode(v as "az" | "cited")}
        options={[
          { value: "az", label: "A–Z" },
          { value: "cited", label: "As cited" },
        ]}
      />
      <button
        type="button"
        className="iconbtn-sm iconbtn-toggle"
        aria-pressed={p.searching}
        onClick={p.onToggleSearch}
        {...iconHint({ label: p.searching ? "Close search" : "Search" })}
      >
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-4-4" />
        </svg>
      </button>
      <span ref={plusRef} className="relative inline-flex">
        <AnchoredMenu
          ariaLabel="Add an entry"
          triggerAriaLabel="Add an entry"
          triggerHint="Add an entry"
          triggerClassName="iconbtn-sm"
          wrapperClassName="relative"
          align="end"
          menuClassName="flex flex-col w-max min-w-[160px] whitespace-nowrap"
          trigger={() => (
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          )}
        >
          {({ close }) => (
            <>
              <MenuActionRow
                id="gutter-bib-search-library"
                label="Search library…"
                disabledReason={p.libraryConnected ? undefined : LIBRARY_NOT_CONNECTED_HINT}
                onSelect={() => {
                  // The picker opens under the "+" it came from.
                  const rect = anchorOf(plusRef.current);
                  close();
                  p.onSearchLibrary(rect);
                }}
              />
              <MenuActionRow
                id="gutter-bib-request-entry"
                label="Request entry"
                onSelect={() => {
                  close();
                  p.onRequestEntry();
                }}
              />
            </>
          )}
        </AnchoredMenu>
      </span>
      <ItemMenu hint="Bibliography options">
        <MenuActionRow
          id="gutter-bib-cited-only"
          label={p.citedOnly ? "Show all entries" : "Show cited entries only"}
          onSelect={() => p.onCitedOnly(!p.citedOnly)}
        />
        <MenuActionRow id="gutter-bib-export" label="Export cited.bib" onSelect={p.onExport} />
      </ItemMenu>
    </>
  );
}

// ── Bibliography helpers ──────────────────────────────────────────────────

// The A–Z / As-cited choice holds for the session, across list switches.
let bibModeForSession: "az" | "cited" = "az";
function readBibMode(): "az" | "cited" {
  return bibModeForSession;
}
function writeBibMode(m: "az" | "cited"): void {
  bibModeForSession = m;
}

/** Keep the rows whose reference (or citekey) contains every word typed. */
function filterBib(groups: GutterListGroup[], query: string | null): GutterListGroup[] {
  const words = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return groups;
  const text = (r: GutterListRow): string => {
    const s = r.snippet;
    const entry = s.kind === "reference" || s.kind === "short" ? s.entry : undefined;
    if (!entry) return (r.bibKey ?? "").toLowerCase();
    const p = safeReference(entry);
    return p ? `${entry.key} ${p.surname} ${p.rest} ${p.year} ${p.title} ${p.venue}`.toLowerCase() : entry.key.toLowerCase();
  };
  return groups
    .map((g) => ({ ...g, rows: g.rows.filter((r) => words.every((w) => text(r).includes(w))) }))
    .filter((g) => g.rows.length > 0);
}

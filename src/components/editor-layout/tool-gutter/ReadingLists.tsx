"use client";

/**
 * The tool gutter's READING LISTS — footnotes, bibliography and numbered
 * examples (Gabriel, 2026-11-08). Each is a `GutterList` of groups built by
 * `gutter-lists.ts`, with its own header controls; an open row mounts the
 * kind's own card through `renderCard` (EditorPane supplies it, with the same
 * handlers the old panels used).
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { FootnoteInfo, ExampleInfo } from "@/components/Editor";
import type { BibEntry, FootnoteRef, OrphanedFootnote } from "@/lib/types";
import { readDocStructure } from "@/lib/tiptap/doc-structure";
import { useStructuralRevisions } from "@/hooks/useStructuralRevisions";
import { useCardStore } from "@/links/_shared/anchored-card-store";
import { countLabelRefs } from "@/lib/tiptap/label-rename";
import { richJsonToPlainText } from "@/lib/footnote-content";
import { downloadCitedBib } from "@/lib/bib-export-cited";
import { isCancelEscape, swallowRepeatsUntilKeyup } from "@/lib/key-intent";
import { ItemMenu } from "@/components/panel-primitives";
import { MenuActionRow } from "@/components/menu/MenuActionRow";
import { SegmentedToggle } from "@/components/SegmentedToggle";
import { iconHint } from "@/components/Hint";
import { CardViewModeMenuItems } from "@/panels/_shared/CardViewModeMenu";
import { useCardArchiveView } from "@/panels/_shared/card-archive-view";
import { useEditorRefContext } from "../contexts/editor-ref";
import { useSelectionsContext } from "../contexts/selections";
import { useCardCreationContext } from "../contexts/card-creation";
import { useCitationDisplayContextOrNull } from "../contexts/citation-display";
import { GutterList } from "./GutterList";
import { readableInline } from "./gutter-rows";
import {
  bibliographyGroups,
  citationsByKey,
  exampleGroups,
  footnoteGroups,
  referenceParts,
  sectionIndexAt,
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
}

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
          query,
        );
    }
    // `rev.labels`-free on purpose: example ref counts refresh with the
    // examples list itself (a `\ref` edit is a structural change upstream).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, data, sections, fnView, bibMode, citedOnly, query, editorInstance]);

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

  const onStep = useCallback(
    (row: GutterListRow, delta: 1 | -1, el: HTMLElement | null) => {
      const key = row.bibKey;
      if (!key) return;
      const ids = byKey.get(key) ?? [];
      if (ids.length === 0) return;
      const cur = occurrence[key] ?? -1;
      const next = (((cur + delta) % ids.length) + ids.length) % ids.length;
      setOccurrence((o) => ({ ...o, [key]: next }));
      sel.setSelectedBibKey(key);
      editorRef.current?.scrollToCitation(ids[next], el);
      data.onActiveCitation?.(ids[next]);
    },
    [byKey, occurrence, sel, editorRef, data],
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
    (card: GutterCardRef) => (
      <>
        {data.renderCard(card)}
        {card.kind === "bib" && (
          <CitedIn
            citationIds={byKey.get(card.key) ?? []}
            cites={data.editorCitations}
            bibEntries={data.bibEntries}
            sections={sections}
            doc={editorInstance && !editorInstance.isDestroyed ? editorInstance.state.doc : null}
            onJump={(citationId, el) => {
              editorRef.current?.scrollToCitation(citationId, el);
              data.onActiveCitation?.(citationId);
            }}
          />
        )}
      </>
    ),
    [data, byKey, sections, editorInstance, editorRef],
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
            onToggleSearch={() => setQuery((q) => (q === null ? "" : null))}
            citedOnly={citedOnly}
            onCitedOnly={setCitedOnly}
            onExport={() => downloadCitedBib(data.bibEntries, new Set(byKey.keys()), data.bibSource)}
          />
        )}
        {kind === "footnotes" && <FootnoteControls />}
      </div>
      {kind === "bibliography" && query !== null && (
        <input
          className="gutter-list-search"
          type="search"
          autoFocus
          placeholder="Search the bibliography"
          aria-label="Search the bibliography"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (isCancelEscape(e)) {
              e.preventDefault();
              if (e.repeat) return;
              swallowRepeatsUntilKeyup(e);
              setQuery(null);
            }
          }}
        />
      )}
      <GutterList
        list={kind}
        groups={groups}
        selectedIds={selectedIds}
        hereIds={hereIds}
        onSelect={onSelect}
        onJump={onJump}
        onStep={kind === "bibliography" ? onStep : undefined}
        renderCard={renderCard}
        onOpenChange={onOpenChange}
        empty={kind === "bibliography" && query ? "Nothing matches" : "None yet"}
      />
    </section>
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
  citedOnly: boolean;
  onCitedOnly: (v: boolean) => void;
  onExport: () => void;
}) {
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
    const p = referenceParts(entry);
    return `${entry.key} ${p.surname} ${p.rest} ${p.year} ${p.title} ${p.venue}`.toLowerCase();
  };
  return groups
    .map((g) => ({ ...g, rows: g.rows.filter((r) => words.every((w) => text(r).includes(w))) }))
    .filter((g) => g.rows.length > 0);
}

/**
 * "Cited in" — each citation of an open bibliography entry, as the sentence it
 * sits in, with its section. Read from the live doc when the card opens;
 * nothing here runs per keystroke.
 */
function CitedIn({
  citationIds,
  cites,
  bibEntries,
  sections,
  doc,
  onJump,
}: {
  citationIds: readonly string[];
  cites: readonly GutterCitation[];
  bibEntries: readonly BibEntry[];
  sections: readonly GutterSectionHead[];
  doc: PMNode | null;
  onJump: (citationId: string, el: HTMLElement | null) => void;
}) {
  const display = useCitationDisplayContextOrNull();
  const items = useMemo(() => {
    if (!doc) return [];
    const posOf = new Map(cites.map((c) => [c.citationId, c.pos]));
    return citationIds.flatMap((id) => {
      const pos = posOf.get(id);
      if (pos == null) return [];
      const i = sectionIndexAt(sections, pos);
      const where = i < 0 ? "" : sections[i].number ? `§${sections[i].number}` : sections[i].text;
      return [{ id, where, text: sentenceAt(doc, pos, bibEntries, display?.getCitationDisplayText) }];
    });
  }, [citationIds, cites, bibEntries, sections, doc, display]);
  if (items.length === 0) return null;
  return (
    <div className="gutter-cited-in">
      <div className="gutter-cited-in-head">Cited in</div>
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          className="gutter-cited-in-row"
          onClick={(e) => onJump(it.id, e.currentTarget)}
          {...iconHint({ label: "Jump to this citation" })}
        >
          {it.where && <b>{it.where}</b>} {it.text}
        </button>
      ))}
    </div>
  );
}

/** The sentence around `pos`, with citations shown as they read in the text.
 *  A citation inside a footnote reads as the footnote's opening words. */
function sentenceAt(
  doc: PMNode,
  pos: number,
  bibEntries: readonly BibEntry[],
  citeText?: (command: string) => string,
): string {
  const at = doc.nodeAt(pos);
  if (at?.type.name === "footnote") {
    const t = readableInline(richJsonToPlainText(at.attrs.content), bibEntries).replace(/\s+/g, " ").trim();
    return `Footnote: “${t.length > 140 ? `${t.slice(0, 140)}…` : t}”`;
  }
  const $pos = doc.resolve(pos);
  const block = $pos.parent;
  const start = $pos.start();
  const leaf = (n: PMNode) =>
    n.type.name === "citation" ? (citeText?.(n.attrs.command as string) || (n.attrs.displayText as string) || "[cite]") : "";
  const before = doc.textBetween(start, pos, " ", leaf);
  const after = doc.textBetween(pos, start + block.content.size, " ", leaf);
  const head = before.split(/(?<=[.!?])\s+/).pop() ?? before;
  const tail = after.split(/(?<=[.!?])\s+/)[0] ?? after;
  const s = `${head}${tail}`.replace(/\s+/g, " ").trim();
  return `“${s.length > 220 ? `${s.slice(0, 220)}…` : s}”`;
}

"use client";

import { useMemo, useEffect, useCallback, useState, memo, useRef } from "react";
import type { BibEntry, CitationRef } from "@/lib/types";
// A selector may spell the ATTRIBUTE name inline, but not the token: the
// `<cardKind>:<cardId>` grammar has one builder, and a query that restates it
// is a second speller that silently stops matching if it ever changes (202).
import { linkCardSelector } from "@/links/link-dom-contract";
import {
  ItemMenu,
  PANEL,
  useCycle,
  useListNavKeys,
} from "@/components/panel-primitives";
import PanelThemePicker from "@/components/PanelThemePicker";
import ConfirmDialog from "@/components/ConfirmDialog";
import { citeNotesDroppedByPackage } from "@/lib/cite-command-model";
import { MenuSeparator, MenuSectionLabel } from "@/components/menu/MenuChrome";
import { CardListPanel } from "@/panels/_shared/CardListPanel";
import { useArchiveVisibleItems } from "@/panels/_shared/card-archive-view";
import { CardViewModeMenuItems } from "@/panels/_shared/CardViewModeMenu";
import { withRecentlyAddedFirst } from "@/hooks/useRecentlyAddedTracker";
import type { NestedContainerInfo } from "@/components/editor-layout/panels/nest-footnote-children";
import { partitionDockedCitations } from "@/components/editor-layout/panels/nest-footnote-children";
import { CitationCard } from "./CitationCard";

interface CitationsPanelProps {
  citations: CitationRef[];
  bibEntries: BibEntry[];
  citationStyle: string;
  bibPackage: string;
  selectedId: string | null;
  citationOrder: string[];
  onSelect: (id: string | null) => void;
  onScrollToMarker: (citationId: string, sourceEl?: HTMLElement | null) => void;
  onUpdateCitation: (id: string, command: string) => void;
  onDeleteCitation: (id: string) => void;
  onSetStyle: (style: string) => void;
  onSetBibPackage: (pkg: string) => void;
  getDisplayText: (command: string) => string;
  pendingCreate: string | null;
  pendingCreateMode: "anchored" | "unanchored";
  onCreateCitation: (command: string) => string;
  onInsertCitation: (command: string, citationId: string, displayText: string) => void;
  onClearPendingCreate: () => void;
  onStartCreate: () => void;
  getFormattedBib: (entry: BibEntry) => string;
  getAnnotation: (key: string) => string;
  setAnnotation: (key: string, text: string) => void;
  onRequestReview: (
    bibKey: string,
    type: "fields" | "notes",
    requestNotes?: string,
  ) => void;
  onCancelReview: (bibKey: string, type: "fields" | "notes") => void;
  getReviewStatus: (
    bibKey: string,
    type: "fields" | "notes",
  ) => "none" | "pending" | "complete";
  onUpdateBibEntry: (key: string, fields: Record<string, string>) => void;
  onUpdateBibKeyAndType: (oldKey: string, newKey: string, newType: string) => void;
  onAddBibEntry: (entry: BibEntry) => void;
  recentlyAddedId?: string | null;
  /** Container-nested cite nesting (Part B / Phase 2a). `citationId →
   *  NestedContainerInfo` (kind footnote OR example) for every cite whose
   *  `\cite` lives inside a footnote body OR an example block, derived
   *  snapshot-gated in `CitationsHost` from
   *  `structure.citations[].nestedInContainerId` (no per-keystroke doc walk).
   *  Such cites are pulled out of the flat top-level list and rendered as
   *  indented children, tagged "in footnote N" / "in example N" — the docked
   *  analog of the omni "nested under the container card" behavior. Absent /
   *  empty ⇒ the panel renders a flat list exactly as before. */
  nestedContainerOf?: ReadonlyMap<string, NestedContainerInfo>;
}

const STYLES = [
  { value: "apa", label: "APA" },
  { value: "vancouver", label: "Vancouver" },
  { value: "harvard1", label: "Harvard" },
];

/** Stable empty map so the partition memo doesn't churn when the host passes
 *  no nesting info (the common, no-nested-cite case). */
const EMPTY_NESTED: ReadonlyMap<string, NestedContainerInfo> = new Map();

const BIB_PACKAGES = [
  { value: "biblatex", label: "biblatex" },
  { value: "natbib", label: "natbib" },
];

function CitationsPanel({
  citations,
  bibEntries,
  citationStyle,
  bibPackage,
  selectedId,
  citationOrder,
  onSelect,
  onScrollToMarker,
  onUpdateCitation,
  onDeleteCitation,
  onSetStyle,
  onSetBibPackage,
  getDisplayText,
  pendingCreate,
  pendingCreateMode,
  onCreateCitation,
  onInsertCitation,
  onClearPendingCreate,
  onStartCreate,
  getFormattedBib,
  getAnnotation,
  setAnnotation,
  onRequestReview,
  onCancelReview,
  getReviewStatus,
  onUpdateBibEntry,
  onUpdateBibKeyAndType,
  onAddBibEntry,
  recentlyAddedId,
  nestedContainerOf,
}: CitationsPanelProps) {
  const panelScrollRef = useRef<HTMLDivElement>(null);
  const sortedCitations = useMemo(
    () => {
      const out = [...citations].sort((a, b) => {
        const ai = citationOrder.indexOf(a.id);
        const bi = citationOrder.indexOf(b.id);
        if (ai === -1 && bi === -1) return 0;
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      });
      return withRecentlyAddedFirst(out, recentlyAddedId, (c) => c.id);
    },
    [citations, citationOrder, recentlyAddedId],
  );

  // Part B / Phase 2a — container-child nesting. Split the flat list into
  // top-level cites and container-nested children (footnote OR example;
  // identity-stable when nothing nests, so the common case pays zero churn).
  // The rendered order is: every flat cite, then the nested cites grouped after
  // — each nested cite carries its host container info for the "in footnote N" /
  // "in example N" label + the `ml-4` indent. We order the nested run with
  // footnote-nested cites first, then example-nested, so each kind clusters
  // under its own section divider. `orderedCitations` (the array driving
  // CardListPanel + the keyboard cycle + selection) is this combined order so
  // nav/selection stay consistent with what's on screen.
  const { topLevel, nested } = useMemo(
    () => partitionDockedCitations(sortedCitations, nestedContainerOf ?? EMPTY_NESTED),
    [sortedCitations, nestedContainerOf],
  );
  const nestedOrdered = useMemo(() => {
    if (nested.length === 0) return nested;
    // Stable partition by kind (footnotes first, then examples), preserving
    // document order within each kind.
    const footnoteNested = nested.filter((n) => n.info.kind === "footnote");
    const exampleNested = nested.filter((n) => n.info.kind === "example");
    return [...footnoteNested, ...exampleNested];
  }, [nested]);
  const orderedCitations = useMemo<CitationRef[]>(
    () =>
      nestedOrdered.length === 0
        ? [...topLevel]
        : [...topLevel, ...nestedOrdered.map((n) => n.citation)],
    [topLevel, nestedOrdered],
  );
  const nestedInfoById = useMemo(() => {
    const m = new Map<string, NestedContainerInfo>();
    for (const n of nestedOrdered) m.set(n.citation.id, n.info);
    return m;
  }, [nestedOrdered]);
  // (The "In footnotes" / "In examples" section dividers are placed in
  // `renderCard` below, on the first nested cite of each kind that actually
  // renders — see the flags at the return site.)

  const handleBuilderCreate = (command: string) => {
    const id = onCreateCitation(command);
    if (pendingCreateMode === "anchored") {
      const display = getDisplayText(command);
      onInsertCitation(command, id, display);
    }
    onClearPendingCreate();
  };

  const anchoredIds = useMemo(() => new Set(citationOrder), [citationOrder]);

  const jumpToCitation = useCallback(
    (id: string, sourceEl?: HTMLElement | null) => {
      onSelect(id);
      onScrollToMarker(id, sourceEl);
    },
    [onSelect, onScrollToMarker],
  );

  const onActivateCitation = useCallback(
    (cit: CitationRef) => {
      jumpToCitation(cit.id);
      requestAnimationFrame(() => {
        const card = panelScrollRef.current?.querySelector(
          linkCardSelector("citation", cit.id),
        );
        card?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
    },
    [jumpToCitation, panelScrollRef],
  );

  // The keyboard cycle must iterate the SAME set the panel renders. CardListPanel
  // filters its list to the archive view (Active / Archives / All); feed the
  // cycle that filtered list too, via the shared hook, so ArrowUp/Down never
  // steps onto an archived, off-screen citation (M1). `getCitArchived` is stable
  // so `visibleCitations` stays identity-stable for the cycle across renders,
  // and CardListPanel receives the same accessor so both derive one set.
  const getCitArchived = useCallback((c: CitationRef) => !!c.archived, []);
  const visibleCitations = useArchiveVisibleItems(
    "citations",
    orderedCitations,
    getCitArchived,
  );
  const {
    idx: cycleIdx,
    next: cycleNext,
    prev: cyclePrev,
    setIdx: setCycleIdx,
  } = useCycle(visibleCitations, onActivateCitation);

  useEffect(() => {
    if (!selectedId) {
      if (cycleIdx != null) setCycleIdx(null);
      return;
    }
    const i = visibleCitations.findIndex((c) => c.id === selectedId);
    if (i >= 0 && i !== cycleIdx) setCycleIdx(i);
  }, [selectedId, visibleCitations, cycleIdx, setCycleIdx]);

  const handleNavKeys = useListNavKeys(
    visibleCitations.length,
    cycleNext,
    cyclePrev,
  );

  const sharedCardProps = {
    bibEntries,
    bibPackage,
    getDisplayText,
    onUpdateCitation,
    onAddBibEntry,
    getFormattedBib,
    getAnnotation,
    setAnnotation,
    onRequestReview,
    onCancelReview,
    getReviewStatus,
    onUpdateBibEntry,
    onUpdateBibKeyAndType,
  };

  const DRAFT_ID = "__virgil_draft_citation__";
  const draftCitation: CitationRef | null = useMemo(() => {
    if (pendingCreate === null) return null;
    return {
      id: DRAFT_ID,
      command: pendingCreate.includes("{") ? pendingCreate : "",
      keys: [],
      createdAt: new Date().toISOString(),
      unanchored: pendingCreateMode === "unanchored",
    };
  }, [pendingCreate, pendingCreateMode]);

  /** When the draft serialises to its first valid command, promote it to
   *  a real citation. Subsequent updates fall through harmlessly because
   *  pendingCreate is cleared by then. */
  const handleDraftUpdate = useCallback(
    (id: string, command: string) => {
      if (id !== DRAFT_ID) return;
      if (!command) return;
      const newId = onCreateCitation(command);
      if (pendingCreateMode === "anchored") {
        const display = getDisplayText(command);
        onInsertCitation(command, newId, display);
      }
      onClearPendingCreate();
    },
    [
      onCreateCitation,
      pendingCreateMode,
      getDisplayText,
      onInsertCitation,
      onClearPendingCreate,
    ],
  );

  /* ── The package flip is allowed to be LOSSY, but never SILENTLY (403 #3) ──
   *
   * natbib's `[pre][post]` is whole-citation BY DEFINITION, so a biblatex
   * `\cites[p. 1]{a}[p. 99]{b}` cannot be represented under it — one of the two
   * ranges leaves the user's `.tex`, and flipping back will not bring it home.
   * Of the three defensible answers (flatten silently / refuse the demotion /
   * warn first) this takes the repo's standing posture: a loss the user has
   * been TOLD about and chosen beats either a silent one or a blocked control.
   *
   * Asked HERE, at the Package control, rather than inside each card's flip
   * effect: the flip is ONE decision the user makes once, while the cards
   * rewrite themselves one by one (and only the mounted, non-archived ones do
   * — so a per-card confirm would ask N times and still miss the rest). The
   * scan is per CLICK, never per render.
   */
  const [pendingPackage, setPendingPackage] = useState<{
    pkg: string;
    keys: string[];
  } | null>(null);

  const requestBibPackage = useCallback(
    (pkg: string) => {
      // Picking the package the view ALREADY shows is how a user confirms a
      // DETECTED seed as their own choice (task 344 made the stored family
      // optional and the shown one `stored ?? detected ?? default`), so that
      // click still writes — it just cannot lose anything.
      if (pkg === bibPackage) {
        onSetBibPackage(pkg);
        return;
      }
      const keys = Array.from(
        new Set(
          citations.flatMap((c) => citeNotesDroppedByPackage(c.command, pkg)),
        ),
      );
      if (keys.length === 0) {
        onSetBibPackage(pkg);
        return;
      }
      setPendingPackage({ pkg, keys });
    },
    [bibPackage, citations, onSetBibPackage],
  );

  // Render-scoped flags (reset every render): the first nested cite of each
  // kind that CardListPanel actually RENDERS gets its kind's divider ("In
  // footnotes" / "In examples"). Tracking the first rendered card per kind (not
  // a fixed pre-filter id) keeps the divider present even when the archive-view
  // filter drops the document-first nested cite. `renderCard` is called
  // synchronously in list order during this render; `nestedOrdered` clusters
  // footnote- then example-nested, so each divider appears once, before its run.
  const dividerShown: Record<NestedContainerInfo["kind"], boolean> = {
    footnote: false,
    example: false,
  };
  return (
    <>
    <CardListPanel
      kind="citations"
      onAdd={() => {
        onStartCreate();
      }}
      headerLeading={
        <ItemMenu align="left">
          <div className="px-3 py-1.5 flex items-center justify-end gap-2">
            <PanelThemePicker panelKey="citation" label="Citation color" />
          </div>
          <MenuSeparator />
          <MenuSectionLabel>Package</MenuSectionLabel>
          {BIB_PACKAGES.map((p) => (
            <button
              key={p.value}
              onClick={() => requestBibPackage(p.value)}
              className="w-full text-left px-3 py-1.5 text-xs text-ink-body hover-on-light flex items-center justify-between gap-3"
            >
              <span>{p.label}</span>
              <span className="text-[var(--accent)]">
                {bibPackage === p.value ? "\u2713" : ""}
              </span>
            </button>
          ))}
          <MenuSeparator />
          <MenuSectionLabel>Style</MenuSectionLabel>
          {STYLES.map((s) => (
            <button
              key={s.value}
              onClick={() => onSetStyle(s.value)}
              className="w-full text-left px-3 py-1.5 text-xs text-ink-body hover-on-light flex items-center justify-between gap-3"
            >
              <span>{s.label}</span>
              <span className="text-[var(--accent)]">
                {citationStyle === s.value ? "\u2713" : ""}
              </span>
            </button>
          ))}
          <CardViewModeMenuItems kind="citations" />
        </ItemMenu>
      }
      panelExtras={
        draftCitation ? (
          <div className="mx-2 mt-2">
            <div className="text-xs font-medium text-ink-subtle mb-1">
              New citation
            </div>
            <CitationCard
              citation={draftCitation}
              isSelected
              isDraft
              isAnchored={false}
              {...sharedCardProps}
              onUpdateCitation={handleDraftUpdate}
              onSelect={() => {}}
              onJump={() => {}}
              onDelete={() => onClearPendingCreate()}
            />
          </div>
        ) : null
      }
      items={orderedCitations}
      getId={(c) => c.id}
      getArchived={getCitArchived}
      selectedId={selectedId}
      onSelect={onSelect}
      emptyState={
        !pendingCreate ? (
          <div className={PANEL.empty}>
            <>
              No citations yet. Type{" "}
              <code className="text-xs bg-surface-muted-strong px-1 rounded">
                \cite
              </code>{" "}
              in the editor to add one.
            </>
          </div>
        ) : undefined
      }
      scrollRef={panelScrollRef}
      onKeyDown={handleNavKeys}
      scrollTabIndex={0}
      renderCard={(cit, { selected }) => {
        // Part B / Phase 2a — a container-nested cite renders indented (`ml-4`,
        // pixel-matching the omni nesting + bib-under-cite) and carries a small
        // "in footnote N" / "in example N" context line above it, the docked
        // analog of sitting under the container card. Top-level cites are
        // unchanged.
        //
        // The nested cites are grouped after every top-level cite (see
        // `orderedCitations`), clustered by kind (footnotes then examples), so
        // the first rendered card OF EACH KIND gets its kind's section divider
        // ("In footnotes" / "In examples") above it. Render-scoped per-kind
        // flags (not fixed ids) keep each divider present even if the
        // archive-view filter drops a kind's document-first nested cite.
        const nestedInfo = nestedInfoById.get(cit.id);
        const kindLabel = nestedInfo?.kind === "example" ? "example" : "footnote";
        const showSectionDivider =
          nestedInfo != null && !dividerShown[nestedInfo.kind];
        if (nestedInfo != null && showSectionDivider) {
          dividerShown[nestedInfo.kind] = true;
        }
        const card = (
          <CitationCard
            citation={cit}
            isSelected={selected}
            isAnchored={anchoredIds.has(cit.id)}
            wrapperClassName={nestedInfo ? "ml-4" : undefined}
            extraDataAttrs={
              nestedInfo
                ? { "data-citation-nested-in-container": `${nestedInfo.kind}:${nestedInfo.id}` }
                : undefined
            }
            onSelect={() => {
              // C15: monotonic select — the store is the single selection
              // source; the panel slot mirrors it. Re-click idempotence lives
              // in `ac.onBodyActivate`, not a toggling host slot.
              onSelect(cit.id);
              panelScrollRef.current?.focus();
            }}
            onJump={(sourceEl) => jumpToCitation(cit.id, sourceEl)}
            onDelete={onDeleteCitation}
            {...sharedCardProps}
          />
        );
        if (!nestedInfo) return card;
        return (
          <div data-citation-nested-group={nestedInfo.kind}>
            {showSectionDivider && (
              <div className="mt-1 mb-1 px-1 flex items-center gap-2">
                <span className="text-[10px] font-medium text-ink-muted uppercase tracking-wide">
                  {nestedInfo.kind === "example" ? "In examples" : "In footnotes"}
                </span>
                <span className="flex-1 border-t border-edge-subtle" />
              </div>
            )}
            <div className="ml-4 mb-0.5 text-[10px] font-medium text-ink-muted">
              {nestedInfo.number != null
                ? `↳ in ${kindLabel} ${nestedInfo.number}`
                : `↳ in ${kindLabel}`}
            </div>
            {card}
          </div>
        );
      }}
    />
    <ConfirmDialog
      open={pendingPackage !== null}
      title="Switch citation package?"
      message={
        pendingPackage
          ? `natbib writes one page range per citation, not one per key — so these ranges cannot be represented under it: ${pendingPackage.keys.join(", ")}. They are dropped from the .tex as those citations are rewritten, and switching back will not restore them.`
          : ""
      }
      confirmLabel="Switch anyway"
      tone="danger"
      onConfirm={() => {
        const next = pendingPackage;
        setPendingPackage(null);
        if (next) onSetBibPackage(next.pkg);
      }}
      onCancel={() => setPendingPackage(null)}
    />
    </>
  );
}

export default memo(CitationsPanel);

/**
 * Card float-body registry entry point. Mirrors
 * `src/text-objects/floats/index.ts`: importing this module registers every
 * poppable card kind's `toFloatable` builder onto `CARD_REGISTRY` via
 * `registerCardFloatable`. The card float dispatcher (`renderPoppedCard` in
 * `editor-layout/floating-cards.tsx`, and later AF's `FloatHost`) then calls
 * `CARD_REGISTRY[kind].toFloatable(id, ctx)`.
 *
 * Imported once on the float-render path (`floating-cards.tsx`) so the
 * registrations run before any popout renders. Kept SEPARATE from
 * `card-registry.tsx` (which stays card-UI-free) so `predicates.ts` and the
 * low-level modules that consume it never pull the card UI in / never cycle.
 *
 * Each builder is the verbatim body of the old `renderPoppedCard` case, wrapped
 * in the `Floatable` contract. `renderBody()` is the (still header-ful) card
 * JSX; AF makes it headerless when the header moves into `FloatChrome`.
 * `error` is intentionally NOT registered (ratified not-poppable, §3.5).
 *
 * `snapshotForStack` is now LIVE: each stackable builder serializes the record
 * it already resolved for `renderBody()` via `snapshotCard(...)`. EditorPane's
 * `virgil-stack-drop` handler calls it through `CARD_REGISTRY[kind].toFloatable`
 * (the legacy prefix-lookup resolver under `lib/stack/` is retired).
 * Non-stackable poppable kinds (`report` / `report-request` / `example`) return
 * null — and "which kinds those are" is not a judgement call made here: it is
 * `CARD_REGISTRY[kind].stackable`, pinned to the Stack's real vocabulary by
 * `assertStackCoverage()` and to THESE closures by
 * `cards/__tests__/stack-coverage.test.ts`, which builds every kind's float and
 * checks the snapshot against the declaration (task 259).
 */
import type { ReactNode } from "react";
import { NoteCard, HighlightCard } from "@/panels/Notes";
import { FootnoteCard, UnanchoredFootnoteCard } from "@/panels/Footnotes";
import { ArchiveCard } from "@/panels/Archive";
import { CutterCommentCard, CutterSuggestionCard, CutterSuggestionTrailing } from "@/panels/Cutter";
import { TodoRow, TodoDoneToggle } from "@/panels/Todo";
import { CitationCard } from "@/panels/Citations";
import {
  RevisionRequestCard,
  RevisionSuggestionCard,
  RevisionSuggestionTrailing,
} from "@/panels/Revisions";
import { ReportCard, ReportRequestCard } from "@/panels/Reports";
import { ExampleCard } from "@/panels/Examples/ExampleCard";
import BibEntryCard from "@/components/BibEntryCard";
import { CardChromeTrailing } from "@/components/panel-primitives";
import { getLinkedTextObjectIds } from "@/links/links";
import type {
  ReportCard as ReportCardData,
  ReportRequestCard as ReportRequestCardData,
} from "@/lib/types";
import type { Floatable, FloatChromeSlots } from "@/floats/types";
import { getPanelColor, themeFromAccent } from "@/lib/panel-theme";
import { snapshotCard } from "@/lib/stack/snapshot";
import type { FootnoteRef } from "@/lib/types";
import { buildFloatKey } from "@/floats/float-key";
import type { CardFloatCtx } from "../card-float-ctx";
import type { CardKind } from "../types";
import { CARD_REGISTRY, registerCardFloatable } from "../card-registry";
import { cardKindsForPanel, hasCollabClaims } from "../predicates";
import { canMorphNoteToHighlight } from "../morphs";
import { CardKindHeader } from "@/components/panel-primitives";

/** Shared shell for a card `Floatable`. `key`/`domain`/`surface` are uniform;
 *  `title` defaults to the kind label. `renderBody()` is **headerless** — the
 *  card passes `chromeless` so its in-card header is suppressed and AF's
 *  `FloatChrome` (in `FloatWindow`) owns it; `chromeSlots.trailing` carries the
 *  collab pill / per-card slot up into that chrome. `bareWindow` cards (bib/ai)
 *  keep a bespoke in-body header for now (Stage 6 migrates them).
 *
 *  Collab trailing is KIND-DRIVEN here (R28/D-2): every claim-bearing kind
 *  (`CardMeta.collabClaims`) automatically gets the shared `CardChromeTrailing`
 *  — scope derived from the registry inside it — so no per-registration scope
 *  literal exists. A builder's own `trailing` (status dot / done toggle) rides
 *  in `CardChromeTrailing`'s `headerTrailing` slot for claim-bearing kinds and
 *  passes through untouched for the rest. */
function cardFloatable(
  kind: CardKind,
  id: string,
  opts: {
    canJump: boolean;
    jumpToSource: () => void;
    renderBody: () => ReactNode;
    /** Serialize this card onto the Stack on a drop gesture. Each stackable
     *  builder hands a closure over the record it ALREADY resolved for
     *  `renderBody()` (a pure per-id resolver — no doc walk, runs only on the
     *  drop). Non-stackable kinds pass `() => null`. */
    snapshotForStack: Floatable["snapshotForStack"];
    title?: string;
    chromeSlots?: Floatable["chromeSlots"];
    bareWindow?: boolean;
  },
): Floatable {
  const baseSlots: FloatChromeSlots = opts.chromeSlots ?? {};
  const chromeSlots: Floatable["chromeSlots"] = hasCollabClaims(kind)
    ? {
        ...baseSlots,
        trailing: (
          <CardChromeTrailing
            kind={kind}
            cardId={id}
            headerTrailing={baseSlots.trailing}
          />
        ),
      }
    : opts.chromeSlots;
  return {
    // The canonical float key via the runtime-leaf SSOT builder — same string
    // `cardPopKey(kind,id)` emits, never a hand-built `float:card:…` literal.
    key: buildFloatKey({ domain: "card", kind, id }),
    domain: "card",
    kind,
    id,
    // Pop-out continuity (#20): the float keeps the docked card's look —
    // white card surface, 1px ambient border (NOT the beige panel pod) —
    // same shell text-object floats use.
    surface: "card",
    // …and the kind-tinted header strip the docked card has. Resolved via
    // the non-hook theme path (override-aware): the same accent →
    // headerDefault derivation `useCardTheme` performs.
    headerTint: themeFromAccent(getPanelColor(CARD_REGISTRY[kind].themeKey))
      .headerDefault,
    // …and the raw kind accent for the popped-card WINDOW ring (bug #34) —
    // same override-aware theme path; FloatWindow stamps it as
    // `--link-anchor-color` on the FloatingPanel root so the `:has()`
    // window-ring rules resolve the kind color.
    accentTint: themeFromAccent(getPanelColor(CARD_REGISTRY[kind].themeKey))
      .accent,
    title: opts.title ?? CARD_REGISTRY[kind].label,
    canJump: opts.canJump,
    jumpToSource: opts.jumpToSource,
    // (Re)anchor drop button gate (chip D): read the STATIC per-kind
    // `droppable` facet here — the ONE place the card-side registry meets the
    // neutral `Floatable`. FloatChrome stays card-blind: it only sees the
    // resulting boolean + the `key` string (its `dropCardKey`). `bareWindow`
    // floats (bib/ai) are `droppable:false`, so no button there regardless.
    canDrop: CARD_REGISTRY[kind].droppable,
    chromeSlots,
    bareWindow: opts.bareWindow,
    snapshotForStack: opts.snapshotForStack,
    renderBody: opts.renderBody,
  };
}

registerCardFloatable("note", (id, ctx: CardFloatCtx) => {
  const note = ctx.notes.find((n) => n.id === id);
  if (!note) return null;
  const canJump = getLinkedTextObjectIds(note).length > 0;
  return cardFloatable("note", id, {
    chromeSlots: {
      // WS7 (A6): the kind-chevron title slot is gated off for
      // paragraph-only Mode-A notes (no text range → nothing for a
      // highlight to tint); FloatChrome falls back to the plain title.
      ...(canMorphNoteToHighlight(note)
        ? {
            title: (
              <CardKindHeader
                kind="note"
                options={cardKindsForPanel("notes")}
                onChange={(k) => {
                  if (k !== "note") ctx.convertNotesCard(id, "highlight");
                }}
              />
            ),
          }
        : {}),
    },
    canJump,
    jumpToSource: () => ctx.editorRef.current?.jumpToCard(note, null),
    snapshotForStack: (source) => snapshotCard("note", note, source),
    renderBody: () => (
      <NoteCard
        note={note}
        selected={ctx.selectedNoteId === note.id}
        onUpdate={ctx.updateNote}
        onUpdateTitle={ctx.updateNoteTitle}
        onConvert={ctx.convertNotesCard}
        onSetAiRequest={ctx.setNoteAiRequest}
        onDelete={ctx.deleteNote}
        onSelect={ctx.setSelectedNoteId}
        onJump={canJump ? (sourceEl) => ctx.editorRef.current?.jumpToCard(note, sourceEl) : undefined}
        onEditorFocus={ctx.setOverrideEditor}
        getCitationDisplayText={ctx.getCitationDisplayText}
        onCitationCreated={ctx.handleCitationCreated}
        isPoppedOut
      />
    ),
  });
});

registerCardFloatable("highlight", (id, ctx: CardFloatCtx) => {
  const hl = ctx.highlights.find((h) => h.id === id);
  if (!hl) return null;
  const canJump = getLinkedTextObjectIds(hl).length > 0;
  return cardFloatable("highlight", id, {
    chromeSlots: {
      title: (
        <CardKindHeader
          kind="highlight"
          options={cardKindsForPanel("notes")}
          onChange={(k) => {
            if (k !== "highlight") ctx.convertNotesCard(id, "note");
          }}
        />
      ),
    },
    canJump,
    jumpToSource: () => ctx.editorRef.current?.jumpToCard(hl, null),
    snapshotForStack: (source) => snapshotCard("highlight", hl, source),
    renderBody: () => (
      <HighlightCard
        card={hl}
        selected={ctx.selectedNoteId === hl.id}
        onConvert={ctx.convertNotesCard}
        onSetAiRequest={ctx.setHighlightAiRequest}
        onDelete={ctx.deleteNote}
        onSelect={ctx.setSelectedNoteId}
        onJump={canJump ? (sourceEl) => ctx.editorRef.current?.jumpToCard(hl, sourceEl) : undefined}
        isPoppedOut
      />
    ),
  });
});

registerCardFloatable("footnote", (id, ctx: CardFloatCtx) => {
  // Read directly from the editor so the float renders on first paint even
  // before the `footnotes` memo recomputes (deps update on content edits, not
  // initial hydration). Once per float render — NOT per main-doc transaction.
  const liveFootnotes = ctx.editorRef.current?.getFootnotes() ?? ctx.footnotes;
  const fn = liveFootnotes.find((f) => f.footnoteId === id);
  // Task 316 — the ATOMLESS fallback. A footnote's anchored and parked views
  // come from DIFFERENT sources (the live editor vs the `footnotes.json`
  // sidecar), so resolving only the first meant an archived / unanchored ref
  // returned null and its float rendered nothing. That was survivable while the
  // card had no way to be lifted; threading its `cardKey` arms the header lift,
  // which would otherwise pop it into a blank window. The citation twin already
  // had this shape for free (it iterates ONE list and resolves a position per
  // entry) — this is that fork closed, not a new capability.
  if (!fn) return unanchoredFootnoteFloatable(id, ctx);
  const isSelected = ctx.selectedFootnoteId === fn.footnoteId;
  return cardFloatable("footnote", id, {
    canJump: true,
    jumpToSource: () => ctx.editorRef.current?.scrollToFootnote(fn.footnoteId, null),
    // R1 (Option B): build a FootnoteRef-shaped record from the FootnoteInfo
    // already in hand. The stack payload only consumes `content`; `id` /
    // `createdAt` are filled with sensible fallbacks (no live FootnoteRef
    // is reachable here without a sidecar read).
    snapshotForStack: (source) =>
      snapshotCard(
        "footnote",
        { id: fn.footnoteId, content: fn.content, createdAt: "" } satisfies FootnoteRef,
        source,
      ),
    renderBody: () => (
      <FootnoteCard
        footnote={fn}
        isSelected={isSelected}
        onSelect={() => ctx.setSelectedFootnoteId(isSelected ? null : fn.footnoteId)}
        onJump={(sourceEl) => ctx.editorRef.current?.scrollToFootnote(fn.footnoteId, sourceEl)}
        onEdit={(json) => ctx.handleEditFootnote(fn.footnoteId, json)}
        onDelete={() => ctx.handleDeleteFootnote(fn.footnoteId)}
        onEditTitle={(title) => ctx.handleEditFootnoteTitle(fn.footnoteId, title)}
        onEditorFocus={ctx.setOverrideEditor}
        getCitationDisplayText={ctx.getCitationDisplayText}
        onCitationCreated={ctx.handleCitationCreated}
        aiRequest={!!ctx.footnoteAiRequests[fn.footnoteId]}
        onSetAiRequest={(value) => ctx.setFootnoteAiRequest(fn.footnoteId, value)}
        isPoppedOut
      />
    ),
  });
});

/** The atomless (archived / unanchored) half of the footnote float — a
 *  `FootnoteRef` read from the sidecar, rendered by the SAME
 *  `UnanchoredFootnoteCard` the docked panel and omni mount, so the popped card
 *  keeps its parked cue and its drop button (`canDrop` is the static registry
 *  facet, unchanged). No live marker ⇒ no jump, mirroring the citation twin's
 *  `isAnchored` fork. Returns null only when the ref is genuinely gone (deleted
 *  mid-gesture), which is the same "nothing to render" answer as before. */
function unanchoredFootnoteFloatable(id: string, ctx: CardFloatCtx): Floatable | null {
  // `unanchoredFootnotes` is a REQUIRED field, so production can't omit it; the
  // `??` guards only a cast-built ctx (the suites construct theirs through
  // `as unknown as CardFloatCtx`, which defeats the check) — and a TypeError
  // here would blank the whole float host, not just this card.
  const ref = (ctx.unanchoredFootnotes ?? []).find((r) => r.id === id);
  if (!ref) return null;
  const isSelected = ctx.selectedFootnoteId === ref.id;
  return cardFloatable("footnote", id, {
    canJump: false,
    jumpToSource: () => {},
    // The ref IS the snapshot shape — no synthesized `createdAt` needed, unlike
    // the anchored branch, which has only a doc-derived `FootnoteInfo` in hand.
    snapshotForStack: (source) => snapshotCard("footnote", ref, source),
    renderBody: () => (
      <UnanchoredFootnoteCard
        footnote={ref}
        isSelected={isSelected}
        onSelect={() => ctx.setSelectedFootnoteId(isSelected ? null : ref.id)}
        onEdit={(json) => ctx.handleEditFootnote(ref.id, json)}
        onDelete={() => ctx.handleDeleteUnanchoredFootnote(ref.id)}
        onEditorFocus={ctx.setOverrideEditor}
        getCitationDisplayText={ctx.getCitationDisplayText}
        onCitationCreated={ctx.handleCitationCreated}
        isPoppedOut
      />
    ),
  });
}

registerCardFloatable("archive", (id, ctx: CardFloatCtx) => {
  const snippet = ctx.archiveSnippets.find((s) => s.id === id);
  if (!snippet) return null;
  const orphaned = ctx.anchoredIds && !ctx.anchoredIds.has(snippet.id);
  return cardFloatable("archive", id, {
    canJump: true,
    jumpToSource: () => ctx.editorRef.current?.jumpToCard(snippet, null),
    snapshotForStack: (source) => snapshotCard("archive", snippet, source),
    renderBody: () => (
      <ArchiveCard
        snippet={snippet}
        selected={ctx.selectedArchiveId === snippet.id}
        orphaned={orphaned}
        onSelect={ctx.setSelectedArchiveId}
        onEdit={ctx.updateArchiveSnippet}
        onUpdateTitle={ctx.updateArchiveSnippetTitle}
        onDelete={ctx.handleDeleteArchive}
        onJump={(sourceEl) => ctx.editorRef.current?.jumpToCard(snippet, sourceEl)}
        onEditorFocus={ctx.setOverrideEditor}
        getCitationDisplayText={ctx.getCitationDisplayText}
        onCitationCreated={ctx.handleCitationCreated}
        isPoppedOut
      />
    ),
  });
});

registerCardFloatable("cutter-comment", (id, ctx: CardFloatCtx) => {
  const card = ctx.cutterCards.find((c) => c.id === id && c.kind === "comment");
  if (!card || card.kind !== "comment") return null;
  const canJump = getLinkedTextObjectIds(card).length > 0;
  return cardFloatable("cutter-comment", id, {
    chromeSlots: {
      // Restore the comment↔suggestion morph control on popout (the docked
      // CardKindDropdown is suppressed when the card renders chromeless).
      title: (
        <CardKindHeader
          kind="cutter-comment"
          options={cardKindsForPanel("cutter")}
          onChange={(k) => {
            if (k !== "cutter-comment") ctx.convertCutterCard(id, "suggestion");
          }}
        />
      ),
    },
    canJump,
    jumpToSource: () => ctx.editorRef.current?.jumpToCard(card, null),
    snapshotForStack: (source) => snapshotCard("cutter-comment", card, source),
    renderBody: () => (
      <CutterCommentCard
        card={card}
        selected={ctx.selectedCutterCardId === card.id}
        onUpdateContent={ctx.updateCutterCommentContent}
        onConvert={ctx.convertCutterCard}
        onSetAiRequest={ctx.setCutterCommentAiRequest}
        onDelete={ctx.deleteCutterCard}
        onSelect={ctx.setSelectedCutterCardId}
        onJump={canJump ? (sourceEl) => ctx.editorRef.current?.jumpToCard(card, sourceEl) : undefined}
        isPoppedOut
      />
    ),
  });
});

registerCardFloatable("cutter-suggestion", (id, ctx: CardFloatCtx) => {
  const card = ctx.cutterCards.find((c) => c.id === id && c.kind === "suggestion");
  if (!card || card.kind !== "suggestion") return null;
  const canJump = getLinkedTextObjectIds(card).length > 0;
  return cardFloatable("cutter-suggestion", id, {
    chromeSlots: {
      trailing: <CutterSuggestionTrailing card={card} />,
      title: (
        <CardKindHeader
          kind="cutter-suggestion"
          options={cardKindsForPanel("cutter")}
          onChange={(k) => {
            if (k !== "cutter-suggestion") ctx.convertCutterCard(id, "comment");
          }}
        />
      ),
    },
    canJump,
    jumpToSource: () => ctx.editorRef.current?.jumpToCard(card, null),
    snapshotForStack: (source) => snapshotCard("cutter-suggestion", card, source),
    renderBody: () => (
      <CutterSuggestionCard
        card={card}
        selected={ctx.selectedCutterCardId === card.id}
        onUpdateField={ctx.updateCutterSuggestionField}
        onConvert={ctx.convertCutterCard}
        onAccept={(cid) => ctx.setCutterSuggestionStatus(cid, "accepted")}
        onReject={(cid) => ctx.setCutterSuggestionStatus(cid, "rejected")}
        onDelete={ctx.deleteCutterCard}
        onSelect={ctx.setSelectedCutterCardId}
        onJump={canJump ? (sourceEl) => ctx.editorRef.current?.jumpToCard(card, sourceEl) : undefined}
        isPoppedOut
      />
    ),
  });
});

registerCardFloatable("report", (id, ctx: CardFloatCtx) => {
  const card = ctx.reportCards.find(
    (c): c is ReportCardData => c.id === id && c.kind === "report",
  );
  if (!card) return null;
  const canJump = getLinkedTextObjectIds(card).length > 0;
  return cardFloatable("report", id, {
    chromeSlots: {
      title: (
        <CardKindHeader
          kind="report"
          options={cardKindsForPanel("reports")}
          onChange={(k) => {
            if (k !== "report") ctx.convertReportCard(id, "report-request");
          }}
        />
      ),
    },
    canJump,
    jumpToSource: () => ctx.editorRef.current?.jumpToCard(card, null),
    snapshotForStack: () => null, // not stackable (no StackCardKind for reports)
    renderBody: () => (
      <ReportCard
        report={card}
        selected={ctx.selectedReportCardId === card.id}
        onUpdate={ctx.updateReportContent}
        onUpdateTitle={ctx.updateReportTitle}
        onConvert={ctx.convertReportCard}
        onDelete={ctx.deleteReportCard}
        onSelect={ctx.setSelectedReportCardId}
        onJump={canJump ? (sourceEl) => ctx.editorRef.current?.jumpToCard(card, sourceEl) : undefined}
        isPoppedOut
      />
    ),
  });
});

registerCardFloatable("report-request", (id, ctx: CardFloatCtx) => {
  const card = ctx.reportCards.find(
    (c): c is ReportRequestCardData => c.id === id && c.kind === "report-request",
  );
  if (!card) return null;
  const canJump = getLinkedTextObjectIds(card).length > 0;
  return cardFloatable("report-request", id, {
    chromeSlots: {
      title: (
        <CardKindHeader
          kind="report-request"
          options={cardKindsForPanel("reports")}
          onChange={(k) => {
            if (k !== "report-request") ctx.convertReportCard(id, "report");
          }}
        />
      ),
    },
    canJump,
    jumpToSource: () => ctx.editorRef.current?.jumpToCard(card, null),
    snapshotForStack: () => null, // not stackable (no StackCardKind for reports)
    renderBody: () => (
      <ReportRequestCard
        request={card}
        selected={ctx.selectedReportCardId === card.id}
        onUpdate={ctx.updateRequestContent}
        onConvert={ctx.convertReportCard}
        onSetAiRequest={ctx.setRequestAiRequest}
        onDelete={ctx.deleteReportCard}
        onSelect={ctx.setSelectedReportCardId}
        onJump={canJump ? (sourceEl) => ctx.editorRef.current?.jumpToCard(card, sourceEl) : undefined}
        isPoppedOut
      />
    ),
  });
});

registerCardFloatable("todo", (id, ctx: CardFloatCtx) => {
  const item = ctx.todoItems.find((t) => t.id === id);
  if (!item) return null;
  const canJump = getLinkedTextObjectIds(item).length > 0;
  return cardFloatable("todo", id, {
    chromeSlots: { trailing: <TodoDoneToggle item={item} onToggle={ctx.toggleTodo} /> },
    canJump,
    jumpToSource: () => ctx.editorRef.current?.jumpToCard(item, null),
    snapshotForStack: (source) => snapshotCard("todo", item, source),
    renderBody: () => (
      <TodoRow
        item={item}
        selected={ctx.selectedTodoId === item.id}
        onToggle={ctx.toggleTodo}
        onUpdate={ctx.updateTodo}
        onUpdateNotes={ctx.updateTodoNotes}
        onSetAiRequest={ctx.setTodoAiRequest}
        onDelete={ctx.deleteTodo}
        onSelect={ctx.setSelectedTodoId}
        isAnchored={canJump}
        onJump={canJump ? (sourceEl) => ctx.editorRef.current?.jumpToCard(item, sourceEl) : undefined}
        isPoppedOut
      />
    ),
  });
});

registerCardFloatable("bib", (id, ctx: CardFloatCtx) => {
  const entry = ctx.bibEntries.find((e) => e.key === id);
  if (!entry) return null;
  const isCited = ctx.allEditorCitations.some((c) => c.keys.includes(entry.key));
  return cardFloatable("bib", id, {
    bareWindow: true, // bespoke in-body header until Stage 6
    canJump: false,
    jumpToSource: () => {},
    snapshotForStack: (source) =>
      snapshotCard("bibliography", entry, source, {
        getAnnotation: ctx.getAnnotation,
      }),
    renderBody: () => (
      <BibEntryCard
        entry={entry}
        isSelected={ctx.selectedBibKey === entry.key}
        onClick={() => ctx.setSelectedBibKey(ctx.selectedBibKey === entry.key ? null : entry.key)}
        getAnnotation={ctx.getAnnotation}
        setAnnotation={ctx.setAnnotation}
        onRequestReview={ctx.requestBibReview}
        onCancelReview={ctx.cancelBibReview}
        getReviewStatus={ctx.getBibReviewStatus}
        onUpdateBibEntry={ctx.updateBibEntry}
        onReplaceBibEntry={ctx.replaceBibEntry}
        onUpdateBibKeyAndType={ctx.updateBibKeyAndType}
        bibPackage={ctx.bibPackage}
        bibEntries={ctx.bibEntries}
        isCited={isCited}
        isPoppedOut
      />
    ),
  });
});

registerCardFloatable("citation", (id, ctx: CardFloatCtx) => {
  const cit = ctx.citations.find((c) => c.id === id);
  if (!cit) return null;
  const pos = ctx.citationPositionMap.get(cit.id) ?? null;
  const isAnchored = pos !== null;
  const isSelected = ctx.selectedCitationId === cit.id;
  return cardFloatable("citation", id, {
    // Citation is the only collection that can hold an unanchored-yet-poppable
    // member, so — unlike footnote/example whose atoms are always live — the
    // FloatChrome jump affordance must derive from the anchored state the
    // builder already resolved, matching the docked card, the omni card, and
    // the in-body chevron (all gate on `pos !== null` / `isAnchored`). An
    // unanchored citation's `scrollToCitation` resolves no in-text atom and is
    // a dead control, so gate `jumpToSource` the same way.
    canJump: isAnchored,
    jumpToSource: isAnchored
      ? () => ctx.editorRef.current?.scrollToCitation(cit.id, null)
      : () => {},
    // R3: resolve bib sidecars from the ctx's already-loaded entries — no
    // separate getBibEntry hook needed.
    snapshotForStack: (source) =>
      snapshotCard("citation", cit, source, {
        getBibEntry: (k) => ctx.bibEntries.find((e) => e.key === k),
        getAnnotation: ctx.getAnnotation,
      }),
    renderBody: () => (
      <CitationCard
        citation={cit}
        isSelected={isSelected}
        isAnchored={isAnchored}
        bibEntries={ctx.bibEntries}
        bibPackage={ctx.bibPackage}
        getDisplayText={ctx.getCitationDisplayText}
        onSelect={() => ctx.setSelectedCitationId(isSelected ? null : cit.id)}
        onJump={(sourceEl) => {
          ctx.setSelectedCitationId(cit.id);
          ctx.editorRef.current?.scrollToCitation(cit.id, sourceEl);
        }}
        onUpdateCitation={ctx.updateCitation}
        onDelete={ctx.deleteCitation}
        getFormattedBib={ctx.getFormattedBib}
        getAnnotation={ctx.getAnnotation}
        setAnnotation={ctx.setAnnotation}
        onRequestReview={ctx.requestBibReview}
        onCancelReview={ctx.cancelBibReview}
        getReviewStatus={ctx.getBibReviewStatus}
        onUpdateBibEntry={ctx.updateBibEntry}
        onUpdateBibKeyAndType={ctx.updateBibKeyAndType}
        onAddBibEntry={ctx.addBibEntry}
        isPoppedOut
      />
    ),
  });
});

// Revisions: the live popout dispatches both kinds through the shared
// `revision` prefix and resolves comment-vs-suggestion from `card.kind` (see
// renderPoppedCard's `case "revision"`). Each builder is self-contained
// (defensive kind filter) so AF can call either directly.
registerCardFloatable("revision-comment", (id, ctx: CardFloatCtx) => {
  const card = ctx.comments.find((c) => c.id === id);
  if (!card || card.kind !== "comment") return null; // data discriminator stays
  const canJump = getLinkedTextObjectIds(card).length > 0;
  return cardFloatable("revision-comment", id, {
    snapshotForStack: (source) => snapshotCard("revision-comment", card, source),
    chromeSlots: {
      // Restore the comment↔suggestion morph control on popout (the docked
      // CardKindDropdown is suppressed when the card renders chromeless).
      title: (
        <CardKindHeader
          kind="revision-comment"
          options={["revision-comment", "revision-suggestion"]}
          onChange={(k) => {
            if (k !== "revision-comment") ctx.convertRevisionCard(id, "suggestion");
          }}
        />
      ),
    },
    canJump,
    jumpToSource: () => ctx.editorRef.current?.jumpToCard(card, null),
    renderBody: () => (
      <RevisionRequestCard
        card={card}
        selected={ctx.selectedCommentId === card.id}
        onUpdateContent={ctx.updateRevisionCommentContent}
        onSetAiRequest={ctx.setRevisionCommentAiRequest}
        onConvert={ctx.convertRevisionCard}
        onDelete={ctx.deleteRevisionCard}
        onSelect={ctx.setSelectedCommentId}
        isPoppedOut
      />
    ),
  });
});

registerCardFloatable("revision-suggestion", (id, ctx: CardFloatCtx) => {
  const card = ctx.comments.find((c) => c.id === id);
  if (!card || card.kind !== "suggestion") return null;
  const canJump = getLinkedTextObjectIds(card).length > 0;
  return cardFloatable("revision-suggestion", id, {
    snapshotForStack: (source) => snapshotCard("revision-suggestion", card, source),
    chromeSlots: {
      trailing: <RevisionSuggestionTrailing card={card} />,
      // Restore the comment↔suggestion morph control on popout.
      title: (
        <CardKindHeader
          kind="revision-suggestion"
          options={["revision-comment", "revision-suggestion"]}
          onChange={(k) => {
            if (k !== "revision-suggestion") ctx.convertRevisionCard(id, "comment");
          }}
        />
      ),
    },
    canJump,
    jumpToSource: () => ctx.editorRef.current?.jumpToCard(card, null),
    renderBody: () => (
      <RevisionSuggestionCard
        card={card}
        selected={ctx.selectedCommentId === card.id}
        onUpdateField={ctx.updateRevisionSuggestionField}
        onAccept={(cid) => ctx.setRevisionSuggestionStatus(cid, "accepted")}
        onReject={(cid) => ctx.setRevisionSuggestionStatus(cid, "rejected")}
        onConvert={ctx.convertRevisionCard}
        onDelete={ctx.deleteRevisionCard}
        onSelect={ctx.setSelectedCommentId}
        isPoppedOut
      />
    ),
  });
});

registerCardFloatable("example", (id, ctx: CardFloatCtx) => {
  const ex = ctx.examples.find((e) => e.exampleId === id);
  if (!ex) return null;
  return cardFloatable("example", id, {
    canJump: true,
    jumpToSource: () => ctx.editorRef.current?.scrollToExample(ex.exampleId),
    // Not stackable (`CARD_REGISTRY.example.stackable === false` since task
    // 259). An example's content is the in-text `\ex{…}` block; this panel ref
    // is a sidecar MIRROR of it, so a snapshot of the ref alone could not be
    // pulled back into any document — which is why the pull branch was a
    // placeholder and why the kind left the Stack vocabulary rather than being
    // allowlisted into the guard. Enabling it means synthesizing an
    // `exampleBlock` node on pull first.
    snapshotForStack: () => null,
    renderBody: () => (
      <ExampleCard
        example={ex}
        isSelected={ctx.selectedExampleId === ex.exampleId}
        onSelect={() =>
          ctx.setSelectedExampleId(ctx.selectedExampleId === ex.exampleId ? null : ex.exampleId)
        }
        onJump={() => ctx.editorRef.current?.scrollToExample(ex.exampleId)}
        isPoppedOut
      />
    ),
  });
});

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
 * DORMANT-until-AF fields (`title`, `canJump`, `jumpToSource`,
 * `snapshotForStack`) are populated best-effort: only `renderBody()` is on the
 * live A0 path (the card renders its own header + jump + self-wraps in
 * `<FloatCard>`). `snapshotForStack` returns null pending A0.7 (it's wired when
 * `cardKeyPrefixToStackKind` retires; EditorPane's stack-drop still uses the
 * legacy prefix path in A0).
 */
import type { ReactNode } from "react";
import { NoteCard, HighlightCard } from "@/panels/Notes";
import { FootnoteCard } from "@/panels/Footnotes";
import { ArchiveCard } from "@/panels/Archive";
import { CutterCommentCard, CutterSuggestionCard, CutterSuggestionTrailing } from "@/panels/Cutter";
import { TodoRow, TodoDoneToggle } from "@/panels/Todo";
import { CitationCard } from "@/panels/Citations";
import {
  RevisionCommentCard,
  RevisionSuggestionCard,
  RevisionSuggestionTrailing,
} from "@/panels/Revisions";
import { ReportCard, ReportRequestCard } from "@/panels/Reports";
import { ExampleCard } from "@/panels/Examples/ExampleCard";
import BibEntryCard from "@/components/BibEntryCard";
import { AiRequestCard, CardChromeTrailing } from "@/components/panel-primitives";
import { getLinkedTextObjectIds } from "@/links/links";
import type {
  ReportCard as ReportCardData,
  ReportRequestCard as ReportRequestCardData,
} from "@/lib/types";
import type { Floatable, FloatChromeSlots } from "@/floats/types";
import type { CardFloatCtx } from "../card-float-ctx";
import type { CardKind } from "../types";
import { CARD_REGISTRY, registerCardFloatable } from "../card-registry";
import { CardKindHeader } from "@/components/panel-primitives";

/** Shared shell for a card `Floatable`. `key`/`domain`/`surface` are uniform;
 *  `title` defaults to the kind label. `renderBody()` is **headerless** — the
 *  card passes `chromeless` so its in-card header is suppressed and AF's
 *  `FloatChrome` (in `FloatWindow`) owns it; `chromeSlots.trailing` carries the
 *  collab pill / per-card slot up into that chrome. `bareWindow` cards (bib/ai)
 *  keep a bespoke in-body header for now (Stage 6 migrates them). */
function cardFloatable(
  kind: CardKind,
  id: string,
  opts: {
    canJump: boolean;
    jumpToSource: () => void;
    renderBody: () => ReactNode;
    title?: string;
    chromeSlots?: Floatable["chromeSlots"];
    bareWindow?: boolean;
  },
): Floatable {
  return {
    key: `float:card:${kind}:${id}`,
    domain: "card",
    kind,
    id,
    surface: "panel",
    title: opts.title ?? CARD_REGISTRY[kind].label,
    canJump: opts.canJump,
    jumpToSource: opts.jumpToSource,
    chromeSlots: opts.chromeSlots,
    bareWindow: opts.bareWindow,
    snapshotForStack: () => null, // TODO(Stage 5): wire snapshotCard
    renderBody: opts.renderBody,
  };
}

/** Collab trailing for a card float — the claim pill / presence dots that the
 *  card's docked header shows, hoisted into `FloatChrome`'s trailing slot. */
function collabTrailing(panelKey: string, id: string): FloatChromeSlots {
  return { trailing: <CardChromeTrailing panelKey={panelKey} cardId={id} /> };
}

registerCardFloatable("note", (id, ctx: CardFloatCtx) => {
  const note = ctx.notes.find((n) => n.id === id);
  if (!note) return null;
  const canJump = getLinkedTextObjectIds(note).length > 0;
  return cardFloatable("note", id, {
    chromeSlots: collabTrailing("note", id),
    canJump,
    jumpToSource: () => ctx.editorRef.current?.jumpToCard(note, null),
    renderBody: () => (
      <NoteCard
        note={note}
        selected={ctx.selectedNoteId === note.id}
        onUpdate={ctx.updateNote}
        onUpdateTitle={ctx.updateNoteTitle}
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
    canJump,
    jumpToSource: () => ctx.editorRef.current?.jumpToCard(hl, null),
    renderBody: () => (
      <HighlightCard
        card={hl}
        selected={ctx.selectedNoteId === hl.id}
        onAddNote={(hid) => ctx.addNoteForHighlight(hid)}
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
  if (!fn) return null;
  const isSelected = ctx.selectedFootnoteId === fn.footnoteId;
  return cardFloatable("footnote", id, {
    chromeSlots: collabTrailing("footnote", id),
    canJump: true,
    jumpToSource: () => ctx.editorRef.current?.scrollToFootnote(fn.footnoteId, null),
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
        isPoppedOut
      />
    ),
  });
});

registerCardFloatable("archive", (id, ctx: CardFloatCtx) => {
  const snippet = ctx.archiveSnippets.find((s) => s.id === id);
  if (!snippet) return null;
  const orphaned = ctx.anchoredIds && !ctx.anchoredIds.has(snippet.id);
  return cardFloatable("archive", id, {
    chromeSlots: collabTrailing("archive", id),
    canJump: true,
    jumpToSource: () => ctx.editorRef.current?.jumpToCard(snippet, null),
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
    chromeSlots: collabTrailing("cut", id),
    canJump,
    jumpToSource: () => ctx.editorRef.current?.jumpToCard(card, null),
    renderBody: () => (
      <CutterCommentCard
        card={card}
        selected={ctx.selectedCutterCardId === card.id}
        onUpdateText={ctx.updateCutterCommentText}
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
    chromeSlots: { trailing: <CutterSuggestionTrailing card={card} /> },
    canJump,
    jumpToSource: () => ctx.editorRef.current?.jumpToCard(card, null),
    renderBody: () => (
      <CutterSuggestionCard
        card={card}
        selected={ctx.selectedCutterCardId === card.id}
        onUpdateField={ctx.updateCutterSuggestionField}
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
    chromeSlots: collabTrailing("report", id),
    canJump,
    jumpToSource: () => ctx.editorRef.current?.jumpToCard(card, null),
    renderBody: () => (
      <ReportCard
        report={card}
        selected={ctx.selectedReportCardId === card.id}
        onUpdate={ctx.updateReportContent}
        onUpdateTitle={ctx.updateReportTitle}
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
    chromeSlots: collabTrailing("report", id),
    canJump,
    jumpToSource: () => ctx.editorRef.current?.jumpToCard(card, null),
    renderBody: () => (
      <ReportRequestCard
        request={card}
        selected={ctx.selectedReportCardId === card.id}
        onUpdate={ctx.updateRequestContent}
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
    renderBody: () => (
      <BibEntryCard
        entry={entry}
        isSelected={ctx.selectedBibKey === entry.key}
        onClick={() => ctx.setSelectedBibKey(ctx.selectedBibKey === entry.key ? null : entry.key)}
        getFormattedBib={ctx.getFormattedBib}
        getAnnotation={ctx.getAnnotation}
        setAnnotation={ctx.setAnnotation}
        onRequestReview={ctx.requestBibReview}
        onCancelReview={ctx.cancelBibReview}
        getReviewStatus={ctx.getBibReviewStatus}
        onUpdateBibEntry={ctx.updateBibEntry}
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
  const isSelected = ctx.selectedCitationId === cit.id;
  return cardFloatable("citation", id, {
    canJump: true,
    jumpToSource: () => ctx.editorRef.current?.scrollToCitation(cit.id, null),
    renderBody: () => (
      <CitationCard
        citation={cit}
        isSelected={isSelected}
        isAnchored={pos !== null}
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
    chromeSlots: {
      ...collabTrailing("revision", id),
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
      <RevisionCommentCard
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

registerCardFloatable("ai", (id, ctx: CardFloatCtx) => {
  const req = ctx.aiRequests.find((r) => r.id === id);
  if (!req) return null;
  return cardFloatable("ai", id, {
    bareWindow: true, // bespoke in-body header until Stage 6
    canJump: false,
    jumpToSource: () => {},
    renderBody: () => (
      <AiRequestCard
        request={req}
        onChangeText={(text) => ctx.updateAiRequestText(req.id, text)}
        onDelete={() => ctx.deleteAiRequest(req.id)}
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

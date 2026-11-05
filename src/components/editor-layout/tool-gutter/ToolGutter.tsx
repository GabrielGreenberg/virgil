"use client";

/**
 * The TOOL GUTTER (task 1440) — the left gutter of the cards-right /
 * tools-left layout (`virgil:gutter-layout`, default ON).
 *
 * Everything here is written STRAIGHT ONTO THE MANILA — no pod, no card
 * chrome, no docked band:
 *
 *  1. Three tool icons across the top — Outline, Search, Word count. A click
 *     writes that tool's body at the top of the gutter (the same panel body
 *     the dock used to frame, rendered with no frame). Click again to close.
 *  2. Fold-out TEXT LISTS beneath. Footnotes and Bibliography by default; none
 *     is required, and "More" adds any of the others (Numbered examples,
 *     To-dos, Notes, Citations, Reports, Archive, Revisions, Cuts, Errors).
 *     Each card is ONE LINE of text; a click jumps to it in the paper and
 *     selects its card in the right gutter; a to-do's box still ticks.
 *
 * The CARDS themselves live only in the right gutter (`resolvePanelSide`
 * answers "right" for every panel under this layout). View state is the
 * window-wide `tool-gutter-store`.
 */

import { useCallback, useMemo, type ReactNode } from "react";
import type { FootnoteInfo, ExampleInfo } from "@/components/Editor";
import type {
  ArchivedSnippet,
  BibEntry,
  CitationRef,
  CutterCard,
  NoteCardItem,
  ReportItem,
  RevisionCard,
  TodoItem,
} from "@/lib/types";
import type { PanelKind } from "@/panels/_shared/types";
import { PANEL_REGISTRY } from "@/panels/panel-registry";
import { PANEL_ICONS } from "../panel-icons";
import { iconHint } from "@/components/Hint";
import { AnchoredMenu } from "@/components/menu/AnchoredMenu";
import { MenuActionRow } from "@/components/menu/MenuActionRow";
import { PodDisclosure } from "@/components/PodDisclosure";
import { useEditorRefContext } from "../contexts/editor-ref";
import { useSelectionsContext } from "../contexts/selections";
import { useDiagnosticsContext } from "@/hooks/useDiagnostics";
import {
  GUTTER_SECTIONS,
  GUTTER_TOOLS,
  removeGutterSection,
  revealGutterSection,
  toggleGutterSectionFold,
  toggleGutterTool,
  useToolGutterState,
  type GutterSection,
  type GutterTool,
} from "@/lib/tool-gutter-store";
import {
  archiveRows,
  bibliographyRows,
  citationRows,
  cutterRows,
  errorRows,
  exampleRows,
  footnoteRows,
  noteRows,
  reportRows,
  revisionRows,
  todoRows,
  rowEntityId,
  type GutterJump,
  type GutterRow,
} from "./gutter-rows";

/** Gutter headings. Plural, sentence case — the registry labels except where
 *  the gutter says it the way Gabriel does. */
const SECTION_TITLE: Record<GutterSection, string> = {
  footnotes: "Footnotes",
  examples: "Numbered examples",
  todo: "To-dos",
  notes: "Notes",
  citations: "Citations",
  bibliography: "Bibliography",
  reports: "Reports",
  archive: "Archive",
  revisions: "Revisions",
  cutter: "Cuts",
  errors: "Errors",
};

export interface ToolGutterProps {
  /** The panel kinds this host offers (the chrome whitelist). A tool or list
   *  whose panel is not offered is not shown. */
  visiblePanels: readonly PanelKind[];
  /** Renders a tool's body (the frameless PaneRailBody). */
  renderTool: (tool: GutterTool) => ReactNode;
  /** Leads the tools row — the side's collapse toggle, so the gutter's
   *  controls read as ONE row and no strip column is needed. */
  leading?: ReactNode;
  footnotes: readonly FootnoteInfo[];
  examples: readonly ExampleInfo[];
  todoItems: readonly TodoItem[];
  toggleTodo: (id: string) => void;
  noteCards: readonly NoteCardItem[];
  citations: readonly CitationRef[];
  bibEntries: readonly BibEntry[];
  citationPositionMap: Map<string, number>;
  archiveSnippets: readonly ArchivedSnippet[];
  revisionCards: readonly RevisionCard[];
  cutterCards: readonly CutterCard[];
  reportCards: readonly ReportItem[];
  archivedIds: ReadonlySet<string>;
}

export function ToolGutter(p: ToolGutterProps) {
  const state = useToolGutterState();
  const offered = useMemo(() => new Set<string>(p.visiblePanels), [p.visiblePanels]);
  const tools = GUTTER_TOOLS.filter((t) => offered.has(t));
  const activeTool = state.tool && offered.has(state.tool) ? state.tool : null;

  const sections = state.sections.filter((s) => offered.has(s));
  const moreChoices = GUTTER_SECTIONS.filter(
    (s) => offered.has(s) && !state.sections.includes(s),
  );

  const diagnostics = useDiagnosticsContext();
  const rowsFor = (s: GutterSection): GutterRow[] => {
    switch (s) {
      case "footnotes":
        return footnoteRows(p.footnotes, p.bibEntries);
      case "examples":
        return exampleRows(p.examples);
      case "todo":
        return todoRows(p.todoItems, p.archivedIds);
      case "notes":
        return noteRows(p.noteCards, p.archivedIds);
      case "citations":
        return citationRows(p.citations, p.bibEntries, p.archivedIds, (id) =>
          p.citationPositionMap.get(id),
        );
      case "bibliography":
        return bibliographyRows(p.bibEntries, p.citations);
      case "archive":
        return archiveRows(p.archiveSnippets, p.archivedIds);
      case "revisions":
        return revisionRows(p.revisionCards, p.archivedIds);
      case "cutter":
        return cutterRows(p.cutterCards, p.archivedIds);
      case "reports":
        return reportRows(p.reportCards, p.archivedIds);
      case "errors":
        return errorRows(diagnostics.allLatexErrors, diagnostics.dismissedErrorIds);
    }
  };

  const activate = useGutterJump();
  const { selected, selectedBibKey } = useSelectionsContext();
  const selectedId =
    selectedIdSet(selected?.id ?? null, selectedBibKey, diagnostics.selectedErrorId);

  return (
    <div className="tool-gutter" data-tool-gutter="">
      {(tools.length > 0 || p.leading) && (
        <div className="tool-gutter-tools" role="toolbar" aria-label="Tools">
          {p.leading}
          {tools.map((t) => {
            const on = activeTool === t;
            return (
              <button
                key={t}
                type="button"
                className="iconbtn-md iconbtn-toggle"
                data-gutter-tool-button={t}
                aria-pressed={on}
                onClick={() => toggleGutterTool(t)}
                data-iconbtn-glyph="aligns: the 18px panel glyphs (panel-icons.tsx)"
                {...iconHint({ label: PANEL_REGISTRY[t].label })}
              >
                {PANEL_ICONS[t](on)}
              </button>
            );
          })}
        </div>
      )}

      {activeTool && (
        <div className="tool-gutter-tool" data-gutter-tool={activeTool}>
          {p.renderTool(activeTool)}
        </div>
      )}

      <div className="tool-gutter-lists">
        {sections.map((s) => (
          <GutterSectionView
            key={s}
            section={s}
            rows={rowsFor(s)}
            folded={state.folded.includes(s)}
            onActivate={activate}
            onToggleTodo={p.toggleTodo}
            selectedIds={selectedId}
          />
        ))}

        {moreChoices.length > 0 && (
          <AnchoredMenu
            ariaLabel="More lists"
            triggerHint="Add another list"
            triggerClassName="tool-gutter-heading hover-on-light"
            wrapperClassName="relative"
            // A column, sized to its longest label. The rows are buttons —
            // inline-block by default — so a plain block container's
            // max-content lays all eight side by side on one line and the
            // surface comes out half the window wide; as flex items they are
            // blockified and the column is as wide as "Bibliography".
            menuClassName="flex flex-col w-max min-w-[140px] whitespace-nowrap"
            // "More" ADDS a list rather than folding one, so its glyph is the
            // add "+", not a disclosure chevron.
            trigger={() => (
              <>
                <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                More
              </>
            )}
          >
            {({ close }) => (
              <>
                {moreChoices.map((s) => (
                  <MenuActionRow
                    key={s}
                    id={`gutter-more-${s}`}
                    label={SECTION_TITLE[s]}
                    onSelect={() => {
                      revealGutterSection(s);
                      close();
                    }}
                  />
                ))}
              </>
            )}
          </AnchoredMenu>
        )}
      </div>
    </div>
  );
}

/** The ids a row may be selected by: the card store's one selection, the
 *  bibliography's key slot, and the Errors panel's own slot. */
function selectedIdSet(
  cardId: string | null,
  bibKey: string | null,
  errorId: string | null,
): ReadonlySet<string> {
  const s = new Set<string>();
  if (cardId) s.add(cardId);
  if (bibKey) s.add(bibKey);
  if (errorId) s.add(errorId);
  return s;
}

function GutterSectionView({
  section,
  rows,
  folded,
  onActivate,
  onToggleTodo,
  selectedIds,
}: {
  selectedIds: ReadonlySet<string>;
  section: GutterSection;
  rows: GutterRow[];
  folded: boolean;
  onActivate: (jump: GutterJump, el: HTMLElement | null) => void;
  onToggleTodo: (id: string) => void;
}) {
  const title = SECTION_TITLE[section];
  // A numbered list hangs its markers in ONE column shared by every row (the
  // list is the grid; the rows are `display: contents`), so every row in it
  // fills that column — with its number, its checkbox, or an empty cell.
  const marked = rows.some((r) => !!r.marker || !!r.todo);
  return (
    <section className="tool-gutter-section" data-gutter-section={section}>
      <div className="tool-gutter-section-head group">
        <PodDisclosure
          expanded={!folded}
          onToggle={() => toggleGutterSectionFold(section)}
          className="tool-gutter-heading hover-on-light"
        >
          {title}
          {rows.length > 0 && <span className="tool-gutter-count">{rows.length}</span>}
        </PodDisclosure>
        <button
          type="button"
          className="iconbtn-xs tool-gutter-remove opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          onClick={() => removeGutterSection(section)}
          {...iconHint({ label: `Remove ${title} from the list` })}
        >
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      {!folded && (
        rows.length === 0 ? (
          <p className="tool-gutter-empty">None yet</p>
        ) : (
          <ul className="tool-gutter-rows" data-marked={marked ? "" : undefined}>
            {rows.map((r) => (
              <li
                key={r.key}
                className="tool-gutter-row"
                data-gutter-row={r.key}
                data-muted={r.muted ? "" : undefined}
                data-selected={selectedIds.has(rowEntityId(r)) ? "" : undefined}
              >
                {r.todo ? (
                  <input
                    type="checkbox"
                    className="tool-gutter-check"
                    checked={r.todo.done}
                    onChange={() => onToggleTodo(r.todo!.id)}
                    aria-label={r.todo.done ? "Mark not done" : "Mark done"}
                  />
                ) : marked ? (
                  <span className="tool-gutter-marker" aria-hidden={r.marker ? undefined : true}>
                    {r.marker}
                  </span>
                ) : null}
                <button
                  type="button"
                  className="tool-gutter-row-text"
                  onClick={(e) => onActivate(r.jump, e.currentTarget)}
                >
                  {r.text}
                </button>
              </li>
            ))}
          </ul>
        )
      )}
    </section>
  );
}

/** A row click: land on the item in the paper and select its card (which
 *  lives in the right gutter). Every branch goes through the editor handle's
 *  own jump doors — the same ones the omni cards' jump buttons use. */
function useGutterJump(): (jump: GutterJump, el: HTMLElement | null) => void {
  const { editorRef } = useEditorRefContext();
  const sel = useSelectionsContext();
  const diagnostics = useDiagnosticsContext();
  return useCallback(
    (jump: GutterJump, el: HTMLElement | null) => {
      const handle = editorRef.current;
      switch (jump.kind) {
        case "footnote":
          sel.setSelectedFootnoteId(jump.id);
          handle?.scrollToFootnote(jump.id, el);
          return;
        case "example":
          sel.setSelectedExampleId(jump.id);
          handle?.scrollToExample(jump.id, el);
          return;
        case "citation":
          sel.setSelectedCitationId(jump.id);
          handle?.scrollToCitation(jump.id, el);
          return;
        case "bib":
          sel.setSelectedBibKey(jump.key);
          if (jump.citationId) {
            sel.setSelectedCitationId(jump.citationId);
            handle?.scrollToCitation(jump.citationId, el);
          }
          return;
        case "error":
          diagnostics.setSelectedErrorId(jump.error.id);
          diagnostics.errorJump.jump(jump.error);
          return;
        case "card": {
          const setters = {
            note: sel.setSelectedNoteId,
            todo: sel.setSelectedTodoId,
            archive: sel.setSelectedArchiveId,
            revision: sel.setSelectedCommentId,
            cutter: sel.setSelectedCutterCardId,
            report: sel.setSelectedReportCardId,
          } as const;
          setters[jump.slot](jump.card.id);
          handle?.jumpToCard(jump.card, el);
          return;
        }
      }
    },
    [editorRef, sel, diagnostics],
  );
}

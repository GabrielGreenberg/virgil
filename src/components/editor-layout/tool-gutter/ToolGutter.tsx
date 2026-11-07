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
 *  2. The BOTTOM HALF: a second icon row, one icon per TEXT LIST (Footnotes
 *     and Bibliography by default). A click writes that list beneath the row,
 *     one at a time, like the tools. "+" adds any of the others (Numbered
 *     examples, To-dos, Notes, Citations, Reports, Archive, Revisions, Cuts,
 *     Errors); "…" removes one, or resets to the defaults. Each card is ONE
 *     LINE of text; a click jumps to it in the paper and selects its card in
 *     the right gutter; a to-do's box still ticks.
 *  3. A DIVIDER between the halves while both are open, dragged through the
 *     pane-resize engine; its position is the store's `split`. Each half
 *     scrolls on its own.
 *
 * The CARDS themselves live only in the right gutter (`resolvePanelSide`
 * answers "right" for every panel under this layout). View state is the
 * window-wide `tool-gutter-store`.
 */

import { useCallback, useMemo, useRef, type ReactNode } from "react";
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
import { usePaneResizeHandle } from "@/lib/pane-resize";
import { useEditorRefContext } from "../contexts/editor-ref";
import { useSelectionsContext } from "../contexts/selections";
import { useDiagnosticsContext } from "@/hooks/useDiagnostics";
import {
  GUTTER_SECTIONS,
  GUTTER_TOOLS,
  MAX_GUTTER_SPLIT,
  MIN_GUTTER_SPLIT,
  getToolGutterState,
  removeGutterSection,
  resetGutterSections,
  revealGutterSection,
  setGutterSplit,
  toggleGutterList,
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

/** Gutter headings — each section's panel's `PANEL_REGISTRY.shortLabel`
 *  (task 1475), except where the gutter says it the way Gabriel does. */
const SECTION_TITLE_OVERRIDE: Partial<Record<GutterSection, string>> = {
  examples: "Numbered examples",
};
const sectionTitle = (s: GutterSection): string =>
  SECTION_TITLE_OVERRIDE[s] ?? PANEL_REGISTRY[s].shortLabel;

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
  const activeList = state.list && sections.includes(state.list) ? state.list : null;
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

  // The DIVIDER between the two halves — shown only while both a tool and a
  // list are open (otherwise the open half simply takes the room). Dragged
  // through the ONE pane-resize engine: the halves' share is a CSS var on
  // the gutter, written imperatively per frame and committed to the store
  // once, on release.
  const split = activeTool !== null && activeList !== null;
  const rootRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const totalRef = useRef(0);
  const divider = usePaneResizeHandle({
    id: "tool-gutter-split",
    axis: "y",
    disabled: !split,
    getValue: () => {
      const top = topRef.current?.getBoundingClientRect().height ?? 0;
      const bottom = bottomRef.current?.getBoundingClientRect().height ?? 0;
      totalRef.current = top + bottom;
      return top;
    },
    clamp: (px) => {
      const total = totalRef.current;
      return Math.min(total * MAX_GUTTER_SPLIT, Math.max(total * MIN_GUTTER_SPLIT, px));
    },
    apply: (px) => {
      const total = totalRef.current;
      if (total > 0) rootRef.current?.style.setProperty(SPLIT_VAR, String(px / total));
    },
    commit: (px) => {
      const total = totalRef.current;
      if (total > 0) setGutterSplit(px / total);
    },
    restore: () => {
      rootRef.current?.style.setProperty(SPLIT_VAR, String(getToolGutterState().split));
    },
  });

  return (
    <div
      ref={rootRef}
      className="tool-gutter"
      data-tool-gutter=""
      data-top-open={activeTool ? "" : undefined}
      data-bottom-open={activeList ? "" : undefined}
      style={{ [SPLIT_VAR]: String(state.split) } as React.CSSProperties}
    >
      <div ref={topRef} className="tool-gutter-half" data-gutter-half="top">
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
          <div className="tool-gutter-scroll tool-gutter-tool" data-gutter-tool={activeTool}>
            {p.renderTool(activeTool)}
          </div>
        )}
      </div>

      {split && (
        <div
          {...divider}
          className="drag-gap drag-gap-h band-grip tool-gutter-divider"
          data-gutter-divider=""
        />
      )}

      <div ref={bottomRef} className="tool-gutter-half" data-gutter-half="bottom">
        <div className="tool-gutter-tools tool-gutter-lists-row" role="toolbar" aria-label="Lists">
          {sections.map((s) => {
            const on = activeList === s;
            return (
              <button
                key={s}
                type="button"
                className="iconbtn-md iconbtn-toggle"
                data-gutter-list-button={s}
                aria-pressed={on}
                onClick={() => toggleGutterList(s)}
                data-iconbtn-glyph="aligns: the 18px panel glyphs (panel-icons.tsx)"
                {...iconHint({ label: sectionTitle(s) })}
              >
                {PANEL_ICONS[s](on)}
              </button>
            );
          })}
          <span className="flex-1" />
          {moreChoices.length > 0 && (
            <AnchoredMenu
              ariaLabel="Add a list"
              triggerAriaLabel="Add a list"
              triggerHint="Add a list"
              triggerClassName="iconbtn-md"
              wrapperClassName="relative"
              align="end"
              // A column, sized to its longest label (rows are buttons, so a
              // plain block container would lay them side by side).
              menuClassName="flex flex-col w-max min-w-[140px] whitespace-nowrap"
              trigger={() => (
                <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              )}
            >
              {({ close }) => (
                <>
                  {moreChoices.map((s) => (
                    <MenuActionRow
                      key={s}
                      id={`gutter-more-${s}`}
                      label={sectionTitle(s)}
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
          <AnchoredMenu
            ariaLabel="List options"
            triggerAriaLabel="List options"
            triggerHint="Remove lists"
            triggerClassName="iconbtn-md"
            wrapperClassName="relative"
            align="end"
            menuClassName="flex flex-col w-max min-w-[160px] whitespace-nowrap"
            trigger={() => (
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="5" cy="12" r="1.8" />
                <circle cx="12" cy="12" r="1.8" />
                <circle cx="19" cy="12" r="1.8" />
              </svg>
            )}
          >
            {({ close }) => (
              <>
                {sections.map((s) => (
                  <MenuActionRow
                    key={s}
                    id={`gutter-remove-${s}`}
                    label={`Remove ${sectionTitle(s)}`}
                    onSelect={() => {
                      removeGutterSection(s);
                      close();
                    }}
                  />
                ))}
                <MenuActionRow
                  id="gutter-reset-lists"
                  label="Reset to the defaults"
                  onSelect={() => {
                    resetGutterSections();
                    close();
                  }}
                />
              </>
            )}
          </AnchoredMenu>
        </div>

        {activeList && (
          <div className="tool-gutter-scroll tool-gutter-lists">
            <GutterSectionView
              key={activeList}
              section={activeList}
              rows={rowsFor(activeList)}
              onActivate={activate}
              onToggleTodo={p.toggleTodo}
              selectedIds={selectedId}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/** The CSS var holding the top half's share (0–1) of the split height. */
const SPLIT_VAR = "--tool-gutter-split";

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
  onActivate,
  onToggleTodo,
  selectedIds,
}: {
  selectedIds: ReadonlySet<string>;
  section: GutterSection;
  rows: GutterRow[];
  onActivate: (jump: GutterJump, el: HTMLElement | null) => void;
  onToggleTodo: (id: string) => void;
}) {
  const title = sectionTitle(section);
  // A numbered list hangs its markers in ONE column shared by every row (the
  // list is the grid; the rows are `display: contents`), so every row in it
  // fills that column — with its number, its checkbox, or an empty cell.
  const marked = rows.some((r) => !!r.marker || !!r.todo);
  return (
    <section className="tool-gutter-section" data-gutter-section={section}>
      <div className="tool-gutter-section-head">
        <h3 className="tool-gutter-heading">
          {title}
          {rows.length > 0 && <span className="tool-gutter-count">{rows.length}</span>}
        </h3>
      </div>
      {rows.length === 0 ? (
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

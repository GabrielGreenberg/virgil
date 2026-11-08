"use client";

/**
 * One way of working, in every reading list of the tool gutter (Gabriel,
 * 2026-11-08):
 *
 *  - A row is SANS and shows its item RENDERED — citations, `\ref`, math —
 *    through the static borrowed renderer, clamped to a few lines.
 *  - Clicking the row selects it (its anchor lights in the text); nothing
 *    scrolls.
 *  - Hover or keyboard focus shows the row's buttons at its end: ↗ jump to it
 *    in the text, ⌄ open it. A bibliography entry cited more than once shows
 *    ‹ › instead of ↗, to step through its citations.
 *  - Open turns the row, in place, into the kind's OWN card (`renderCard`),
 *    on paper and in the paper's serif. One open per list; ⌃ or Escape closes
 *    it (Escape cancels — it never saves).
 *  - ↑/↓ move between rows.
 *  - A thin accent bar marks rows whose anchor is on screen (`hereIds`).
 *
 * The groups and rows are `gutter-lists.ts`'s pure projection.
 */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { StaticBorrowedText } from "@/components/StaticBorrowedText";
import { iconHint } from "@/components/Hint";
import { isCancelEscape, swallowRepeatsUntilKeyup } from "@/lib/key-intent";
import {
  referenceParts,
  shortLabel,
  type GutterCardRef,
  type GutterListGroup,
  type GutterListRow,
  type GutterSnippet,
} from "./gutter-lists";
import { exampleBodyText, oneLine } from "./gutter-rows";

export interface GutterListProps {
  /** Names the list for its rows' data attributes and the empty state. */
  list: string;
  groups: readonly GutterListGroup[];
  /** Ids (`row.entityId`) whose card is the selected one. */
  selectedIds: ReadonlySet<string>;
  /** Ids whose anchor is on screen in the paper. */
  hereIds?: ReadonlySet<string>;
  onSelect: (row: GutterListRow) => void;
  onJump: (row: GutterListRow, el: HTMLElement | null) => void;
  /** ‹ › on a bibliography row: step to its previous / next citation. */
  onStep?: (row: GutterListRow, delta: 1 | -1, el: HTMLElement | null) => void;
  /** The kind's own card, for an open row. */
  renderCard: (card: GutterCardRef, row: GutterListRow) => ReactNode;
  /** Opening / closing a row also expands / collapses its card. */
  onOpenChange?: (card: GutterCardRef, open: boolean) => void;
  empty?: ReactNode;
}

export function GutterList(p: GutterListProps) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rows = p.groups.flatMap((g) => g.rows);
  const openRow = openKey ? rows.find((r) => r.key === openKey) ?? null : null;

  // An open row whose item went away (deleted, archived, filtered out) closes.
  useEffect(() => {
    if (openKey && !openRow) setOpenKey(null);
  }, [openKey, openRow]);

  const setOpen = useCallback(
    (row: GutterListRow | null) => {
      const prev = openRow;
      if (prev?.card && prev.key !== row?.key) p.onOpenChange?.(prev.card, false);
      if (row?.card) p.onOpenChange?.(row.card, true);
      setOpenKey(row?.key ?? null);
    },
    [openRow, p],
  );

  const focusRow = (key: string) =>
    listRef.current
      ?.querySelector<HTMLElement>(`[data-gutter-list-row="${CSS.escape(key)}"] .gutter-list-body`)
      ?.focus();

  const close = (row: GutterListRow) => {
    setOpen(null);
    requestAnimationFrame(() => focusRow(row.key));
  };

  const onListKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const target = e.target as HTMLElement;
    if (!target.classList.contains("gutter-list-body")) return;
    const bodies = [...(listRef.current?.querySelectorAll<HTMLElement>(".gutter-list-body") ?? [])];
    const i = bodies.indexOf(target);
    const next = bodies[i + (e.key === "ArrowDown" ? 1 : -1)];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  };

  if (rows.length === 0) {
    return <p className="tool-gutter-empty">{p.empty ?? "None yet"}</p>;
  }

  return (
    <div ref={listRef} className="gutter-list" data-gutter-list={p.list} onKeyDown={onListKeyDown}>
      {p.groups.map((g) => (
        <div key={g.key} className="gutter-list-group" data-group-style={g.style ?? "section"}>
          {g.label && (
            <div className="gutter-list-group-head">
              {g.number && <span className="gutter-list-group-number">{g.number}</span>}
              <span>{g.label}</span>
            </div>
          )}
          <ul className="gutter-list-rows">
            {g.rows.map((r) =>
              r.key === openKey && r.card ? (
                <li key={r.key} className="gutter-list-open" data-gutter-list-open={r.key}>
                  <div
                    className="gutter-list-card"
                    onKeyDown={(e) => {
                      if (isCancelEscape(e) && !e.defaultPrevented) {
                        e.preventDefault();
                        // A held Escape closes the card once, not whatever is behind it too.
                        if (e.repeat) return;
                        swallowRepeatsUntilKeyup(e);
                        close(r);
                      }
                    }}
                  >
                    {p.renderCard(r.card, r)}
                    <div className="gutter-list-card-foot">
                      <button
                        type="button"
                        className="iconbtn-sm"
                        data-gutter-list-close=""
                        aria-expanded={true}
                        onClick={() => close(r)}
                        {...iconHint({ label: "Close", hint: "Close (Escape)" })}
                      >
                        <Chevron up />
                      </button>
                    </div>
                  </div>
                </li>
              ) : (
                <Row
                  key={r.key}
                  row={r}
                  selected={p.selectedIds.has(r.entityId)}
                  here={!!p.hereIds?.has(r.entityId)}
                  onSelect={p.onSelect}
                  onJump={p.onJump}
                  onStep={p.onStep}
                  onOpen={r.card ? () => setOpen(r) : undefined}
                />
              ),
            )}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Row({
  row: r,
  selected,
  here,
  onSelect,
  onJump,
  onStep,
  onOpen,
}: {
  row: GutterListRow;
  selected: boolean;
  here: boolean;
  onSelect: GutterListProps["onSelect"];
  onJump: GutterListProps["onJump"];
  onStep?: GutterListProps["onStep"];
  onOpen?: () => void;
}) {
  const stepping = !!onStep && !!r.bibKey && (r.count ?? 0) > 1;
  return (
    <li
      className="gutter-list-row"
      data-gutter-list-row={r.key}
      data-selected={selected ? "" : undefined}
      data-here={here ? "" : undefined}
      data-muted={r.muted ? "" : undefined}
      data-missing={r.missing ? "" : undefined}
    >
      <button
        type="button"
        className="gutter-list-body hover-on-light"
        onClick={() => onSelect(r)}
        onDoubleClick={onOpen}
      >
        <span className="gutter-list-marker" aria-hidden={r.marker ? undefined : true}>
          {r.marker}
        </span>
        <span className="gutter-list-main">
          <Snippet snippet={r.snippet} />
          {r.sub && <span className="gutter-list-sub">{r.sub}</span>}
        </span>
        {r.count ? <span className="gutter-list-count">{r.count}×</span> : null}
      </button>
      <span className="gutter-list-actions">
        {stepping ? (
          <>
            <button
              type="button"
              className="iconbtn-md gutter-list-act"
              data-gutter-act="prev"
              onClick={(e) => onStep!(r, -1, e.currentTarget)}
              {...iconHint({ label: "Previous citation" })}
            >
              <Caret dir="left" />
            </button>
            <button
              type="button"
              className="iconbtn-md gutter-list-act"
              data-gutter-act="next"
              onClick={(e) => onStep!(r, 1, e.currentTarget)}
              {...iconHint({ label: "Next citation" })}
            >
              <Caret dir="right" />
            </button>
          </>
        ) : r.jump ? (
          <button
            type="button"
            className="iconbtn-md gutter-list-act"
            data-gutter-act="jump"
            onClick={(e) => onJump(r, e.currentTarget)}
            {...iconHint({ label: "Jump to it in the text" })}
          >
            <JumpGlyph />
          </button>
        ) : null}
        {onOpen && (
          <button
            type="button"
            className="iconbtn-md gutter-list-act"
            data-gutter-act="open"
            aria-expanded={false}
            onClick={onOpen}
            {...iconHint({ label: "Open" })}
          >
            <Chevron />
          </button>
        )}
      </span>
    </li>
  );
}

/** A row's snippet: rendered, never raw `\commands`. */
function Snippet({ snippet: s }: { snippet: GutterSnippet }) {
  switch (s.kind) {
    case "rich":
      return (
        <span className="gutter-snippet" data-lines="3">
          {s.value ? <StaticBorrowedText value={s.value} /> : oneLine(s.fallback)}
        </span>
      );
    case "reference": {
      const r = referenceParts(s.entry);
      return (
        <span className="gutter-snippet gutter-reference" data-lines="4">
          <b>{r.surname}</b>
          {r.rest ? `, ${r.rest}` : ""}
          {r.year ? ` ${r.year}.` : "."}{" "}
          {r.title &&
            (r.titleStyle === "italic" ? (
              <>
                <i>{r.title}</i>.{" "}
              </>
            ) : (
              <>“{r.title}.” </>
            ))}
          {r.venue && (r.venueItalic ? <i>{r.venue}</i> : r.venue)}
          {r.venue ? "." : ""}
        </span>
      );
    }
    case "short": {
      const title = s.entry ? referenceParts(s.entry).title.split(/[:.]/)[0] : "";
      return (
        <span className="gutter-snippet" data-lines="1">
          <b>{shortLabel(s.entry, s.key)}</b>
          {title ? (
            <>
              {" · "}
              <i>{title}</i>
            </>
          ) : null}
        </span>
      );
    }
    case "text":
      return (
        <span className="gutter-snippet" data-lines="2">
          {oneLine(s.text)}
        </span>
      );
    case "example": {
      const e = s.example;
      if (e.items.length > 0) {
        return (
          <span className="gutter-example-items">
            {e.items.map((it, i) => (
              <span key={i} className="gutter-example-item">
                <span className="gutter-example-sub">{it.subLabel}.</span>
                <span className="gutter-snippet" data-lines="1">
                  {it.content ? <StaticBorrowedText value={it.content} schemaScope="excerpt" /> : oneLine(it.text)}
                </span>
              </span>
            ))}
          </span>
        );
      }
      // A glossed example shows its first tier (the source line), italic like
      // the object language, then its free translation; a plain one renders
      // its body.
      if (e.gloss?.source) {
        return (
          <span className="gutter-snippet" data-lines="2">
            <i>{e.gloss.source}</i>
            {e.gloss.translation ? <span className="gutter-gloss-translation"> {e.gloss.translation}</span> : null}
          </span>
        );
      }
      return (
        <span className="gutter-snippet" data-lines="2">
          {e.bodyContent ? (
            <StaticBorrowedText value={e.bodyContent} schemaScope="excerpt" />
          ) : (
            oneLine(exampleBodyText(e.bodyContent) || e.bodyText || e.preview)
          )}
        </span>
      );
    }
  }
}

function Chevron({ up = false }: { up?: boolean }) {
  // 14px on the card's small close button, 16px on a row's buttons.
  const size = up ? 14 : 16;
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={up ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} />
    </svg>
  );
}

function Caret({ dir }: { dir: "left" | "right" }) {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={dir === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
    </svg>
  );
}

function JumpGlyph() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 17L17 7M9 7h8v8" />
    </svg>
  );
}

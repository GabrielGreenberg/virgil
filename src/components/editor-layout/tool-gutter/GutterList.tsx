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

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { StaticBorrowedText } from "@/components/StaticBorrowedText";
import { iconHint } from "@/components/Hint";
import { useViewLifetime } from "@/hooks/useViewLifetime";
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
import type { BibEntry } from "@/lib/types";

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
  /** The kind's own card, for an open row; `close` closes it (a view that
   *  carries its own close button uses it). */
  renderCard: (card: GutterCardRef, row: GutterListRow, close: () => void) => ReactNode;
  /** Rows that open from a ⌄ at their LEFT edge and show no hover buttons —
   *  their open view carries the jump and its own close (the bibliography). */
  leadingToggle?: (row: GutterListRow) => boolean;
  /** An open row LEASES its card's expansion: called when a row becomes
   *  open, it returns the release, which runs exactly once whenever that row
   *  stops being open — closed, another opened, its item gone, the list
   *  unmounted. The acquirer decides what the release undoes (a card it found
   *  already expanded it leaves expanded). */
  openLease?: (card: GutterCardRef) => (() => void) | void;
  /** A row that can be dragged into the text (a bibliography entry, as a
   *  `\cite`) — returns false when this row can't. */
  canDrag?: (row: GutterListRow) => boolean;
  onRowDragStart?: (row: GutterListRow, e: React.DragEvent) => void;
  /** A to-do row's checkbox. */
  onToggleTodo?: (id: string) => void;
  empty?: ReactNode;
}

export function GutterList(p: GutterListProps) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const lifetime = useViewLifetime();
  const rows = p.groups.flatMap((g) => g.rows);
  const openRow = openKey ? rows.find((r) => r.key === openKey) ?? null : null;

  // An open row whose item went away (deleted, archived, filtered out) is
  // simply not open: `openRow` is null, so nothing below renders it open —
  // and its lease below is released.
  const openCard = openRow?.card ?? null;
  const leaseKey = openCard ? cardLeaseKey(openCard) : null;
  const openCardRef = useRef(openCard);
  const openLeaseRef = useRef(p.openLease);
  useLayoutEffect(() => {
    openCardRef.current = openCard;
    openLeaseRef.current = p.openLease;
  });
  // The lease: ONE acquire per open card, its release on every ending. Keyed
  // on the card's identity, so a re-render of the same open row re-acquires
  // nothing.
  useEffect(() => {
    const card = openCardRef.current;
    if (!leaseKey || !card) return;
    const release = openLeaseRef.current?.(card);
    return release ?? undefined;
  }, [leaseKey]);

  const setOpen = (row: GutterListRow | null) => setOpenKey(row?.key ?? null);

  const focusRow = (key: string) =>
    listRef.current
      ?.querySelector<HTMLElement>(`[data-gutter-list-row="${CSS.escape(key)}"] .gutter-list-body`)
      ?.focus();

  const close = (row: GutterListRow) => {
    setOpen(null);
    lifetime.requestAnimationFrame(() => focusRow(row.key));
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
              r.key === openRow?.key && r.card ? (
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
                    <OpenCard render={p.renderCard} card={r.card} row={r} close={() => close(r)} />
                    {!p.leadingToggle?.(r) && (
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
                    )}
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
                  onDragStart={p.onRowDragStart && p.canDrag?.(r) ? (e) => p.onRowDragStart!(r, e) : undefined}
                  onToggleTodo={p.onToggleTodo}
                  leadingToggle={!!p.leadingToggle?.(r)}
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
  onDragStart,
  onToggleTodo,
  leadingToggle = false,
}: {
  row: GutterListRow;
  selected: boolean;
  here: boolean;
  onSelect: GutterListProps["onSelect"];
  onJump: GutterListProps["onJump"];
  onStep?: GutterListProps["onStep"];
  onOpen?: () => void;
  onDragStart?: (e: React.DragEvent) => void;
  onToggleTodo?: (id: string) => void;
  leadingToggle?: boolean;
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
      data-leading-toggle={leadingToggle ? "" : undefined}
      draggable={onDragStart ? true : undefined}
      onDragStart={onDragStart}
    >
      {leadingToggle && onOpen && (
        <button
          type="button"
          className="iconbtn-sm gutter-list-toggle"
          data-gutter-act="open"
          aria-expanded={false}
          onClick={onOpen}
          {...iconHint({ label: "Open" })}
        >
          <Chevron right />
        </button>
      )}
      {r.todo && (
        <input
          type="checkbox"
          className="gutter-list-check"
          checked={r.todo.done}
          onChange={() => onToggleTodo?.(r.todo!.id)}
          aria-label={r.todo.done ? "Mark not done" : "Mark done"}
        />
      )}
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
      {!leadingToggle && (
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
      )}
    </li>
  );
}

/** An open row's card. Its own component so `close` (which focuses the row
 *  again through the list's ref) reaches `renderCard` as a plain prop. */
function OpenCard({
  render,
  card,
  row,
  close,
}: {
  render: GutterListProps["renderCard"];
  card: GutterCardRef;
  row: GutterListRow;
  close: () => void;
}) {
  return <>{render(card, row, close)}</>;
}

/** A row's snippet: rendered, never raw `\commands`. */
export function Snippet({ snippet: s }: { snippet: GutterSnippet }) {
  switch (s.kind) {
    case "rich":
      return (
        <span className="gutter-snippet" data-lines="3">
          {s.value ? <StaticBorrowedText value={s.value} /> : oneLine(s.fallback)}
        </span>
      );
    case "reference": {
      // One malformed entry must never take the list down: it shows its key.
      const r = safeParts(s.entry);
      if (!r) return <span className="gutter-snippet" data-lines="1">{s.entry.key}</span>;
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
      const title = s.entry ? (safeParts(s.entry)?.title ?? "").split(/[:.]/)[0] : "";
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

/** A card's identity, for keying its lease. */
function cardLeaseKey(c: GutterCardRef): string {
  return c.kind === "bib" ? `bib:${c.key}:${c.section ?? ""}` : `${c.kind}:${c.id}`;
}

/** `referenceParts`, or null when an entry can't be read. */
function safeParts(entry: BibEntry): ReturnType<typeof referenceParts> | null {
  try {
    return referenceParts(entry);
  } catch {
    return null;
  }
}

function Chevron({ up = false, right = false, down = false }: { up?: boolean; right?: boolean; down?: boolean }) {
  // 14px on the card's close button and the leading toggle, 16px on a row's buttons.
  const size = up || right || down ? 14 : 16;
  const d = up ? "M6 15l6-6 6 6" : right ? "M9 6l6 6-6 6" : "M6 9l6 6 6-6";
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

/** The ⌄ an open view puts where its row's toggle was, closing it. */
export function LeadingClose({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      className="iconbtn-sm gutter-list-toggle"
      data-gutter-list-close=""
      aria-expanded={true}
      onClick={onClose}
      {...iconHint({ label: "Close", hint: "Close (Escape)" })}
    >
      <Chevron down />
    </button>
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

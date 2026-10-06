// @vitest-environment jsdom
//
// Task 699 — **the DOCKED panels' Jump gate is the omni/float gate.**
//
// Task 655 made the omni rows and the floats offer Jump only when the card's
// anchor RESOLVES (`cardJumpGate` over the task-369 authority). The six docked
// panels never got it: five gated on `getLinkedTextObjectIds(card).length > 0`
// ("the card STORES a link") and Archive on nothing at all. Two wrong outcomes
// of one root:
//
//   1. a card whose paragraph was deleted still showed Jump — `jumpToCard`
//      resolves nothing and the click does nothing, silently;
//   2. a range-only highlight (a Mode-B link with `textObjectIds: []`, which
//      `addHighlight` writes when there is no paragraph id) HID a Jump that
//      `resolveLink` would have honoured by its surviving mark.
//
// The fix publishes the pane's ONE anchor pass (`CardAnchorProvider`) and hands
// every docked panel a REQUIRED `jumpGate` prop. The behavioural legs drive the
// REAL `NotesPanel` over the REAL authority; the census is the leg with teeth —
// a seventh panel cannot pick its own predicate again.

import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

// Light card stubs that expose whether the panel handed them a Jump handler.
vi.mock("@/panels/Notes/NoteCard", () => ({
  NoteCard: ({ note, onJump }: { note: { id: string }; onJump?: () => void }) => (
    <div data-testid="card" data-id={note.id} data-jump={onJump ? "yes" : "no"} />
  ),
}));
vi.mock("@/panels/Notes/HighlightCard", () => ({
  HighlightCard: ({ card, onJump }: { card: { id: string }; onJump?: () => void }) => (
    <div data-testid="card" data-id={card.id} data-jump={onJump ? "yes" : "no"} />
  ),
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { render, cleanup } from "@testing-library/react";
import NotesPanel from "@/panels/Notes/NotesPanel";
import type { NoteCardItem } from "@/lib/types";
import type { Link } from "@/links/_shared/types";
import {
  cardJumpGate,
  resolveCardAnchorRows,
  type CardAnchorResolver,
  type DockedJumpGate,
} from "@/links/card-anchor-rows";
import type { ResolveIndex } from "@/links/resolve-card-anchor";
import { codeOnly, REPO_ROOT } from "@/lib/__tests__/_source-scan";

afterEach(cleanup);

const LIVE = "live-uuid";
const DEAD = "dead-uuid";
const MARK = "anchor-mark-1";
const AT = "2026-01-01T00:00:00.000Z";

/** The REAL authority over a synthetic index: one live paragraph, one live
 *  `linkedAnchor` mark on it. A "dead" anchor is dead by the ladder's verdict. */
function resolver(): CardAnchorResolver {
  const index: ResolveIndex = {
    uuidToParagraph: new Set([LIVE]),
    uuidToPos: new Map([[LIVE, 42]]),
    anchorIdToParagraph: new Map([[MARK, LIVE]]),
    snapshotToParagraph: () => null,
  };
  return (card) => resolveCardAnchorRows(card, null, index);
}
const GATE: DockedJumpGate = (card) => cardJumpGate(card, resolver());

function paraLink(uuid: string, id: string): Link {
  return {
    id: `link-${id}`,
    kind: "anchor",
    anchor: { type: "textObject", targetKind: "paragraph", textObjectIds: [uuid] },
    target: { type: "card", ref: { kind: "note", id } },
    createdAt: AT,
  };
}

/** A range-only Mode-B link: no paragraph id, found by its mark alone. */
function rangeOnlyLink(id: string): Link {
  return {
    id: `link-${id}`,
    kind: "anchor",
    anchor: {
      type: "textObject",
      targetKind: "linkedRange",
      textObjectIds: [],
      textRange: { anchorId: MARK, textSnapshot: "highlighted words" },
    },
    target: { type: "card", ref: { kind: "highlight", id } },
    createdAt: AT,
  };
}

const note = (id: string, links: Link[]): NoteCardItem => ({
  kind: "note",
  id,
  title: "",
  content: { type: "doc", content: [] },
  createdAt: AT,
  aiRequest: false,
  links,
});

const highlight = (id: string, links: Link[]): NoteCardItem => ({
  kind: "highlight",
  id,
  createdAt: AT,
  highlightColor: null,
  aiRequest: false,
  links,
}) as NoteCardItem;

function renderNotes(cards: NoteCardItem[]) {
  return render(
    <NotesPanel
      cards={cards}
      onAddNote={vi.fn()}
      onConvertCard={vi.fn()}
      onUpdate={vi.fn()}
      onUpdateTitle={vi.fn()}
      onSetNoteAiRequest={vi.fn()}
      onSetHighlightAiRequest={vi.fn()}
      onDelete={vi.fn()}
      onSelectNote={vi.fn()}
      selectedNoteId={null}
      onJumpToCard={vi.fn()}
      jumpGate={GATE}
    />,
  );
}

function jumpOf(container: HTMLElement, id: string): string | null {
  return container.querySelector(`[data-id="${id}"]`)?.getAttribute("data-jump") ?? null;
}

describe("task 699 — docked Jump is decided by the anchor authority", () => {
  it("a card whose anchor is dead offers NO Jump (it stores a link; it resolves nothing)", () => {
    const { container } = renderNotes([
      note("alive", [paraLink(LIVE, "alive")]),
      note("dead", [paraLink(DEAD, "dead")]),
    ]);
    expect(jumpOf(container, "alive")).toBe("yes");
    expect(jumpOf(container, "dead")).toBe("no");
  });

  it("a range-only highlight (no paragraph id, live mark) offers a Jump", () => {
    const { container } = renderNotes([highlight("hl", [rangeOnlyLink("hl")])]);
    expect(jumpOf(container, "hl")).toBe("yes");
  });
});

// ─── census: no docked panel re-derives the gate ─────────────────────────────

const DOCKED = [
  "src/panels/Notes/NotesPanel.tsx",
  "src/panels/Cutter/CutterPanel.tsx",
  "src/panels/Reports/ReportsPanel.tsx",
  "src/panels/Revisions/RevisionsPanel.tsx",
  "src/panels/Todo/TodoPanel.tsx",
  "src/panels/Archive/ArchivePanel.tsx",
];
const HOSTS = ["notes", "cutter", "reports", "revisions", "todo", "archive"].map(
  (h) => `src/components/editor-layout/panels/${h}-host.tsx`,
);
const read = (rel: string) => codeOnly(readFileSync(join(REPO_ROOT, rel), "utf8"));

describe("task 699 — census", () => {
  it.each(DOCKED)("%s never gates Jump on the card's STORED links", (rel) => {
    const src = read(rel);
    expect(src).not.toMatch(/getLinkedTextObjectIds\s*\(/);
    // Every Jump handler handed to a card passes through the gate.
    expect(src).toMatch(/jumpGate:\s*DockedJumpGate;/);
    expect(src).toMatch(/\.withJump\(/);
  });

  it.each(HOSTS)("%s supplies the shared gate", (rel) => {
    const src = read(rel);
    expect(src).toMatch(/useDockedJumpGate\(\)/);
    expect(src).toMatch(/jumpGate=\{jumpGate\}/);
  });

  // Task 966 — the gate is applied ONCE, by the caller. A card component that
  // conditions `onJump` on its own "anchored" answer (a second prop, or a
  // stored-link predicate like the retired `isCardAnchored`) is a parallel
  // switch: it can only shut a door the caller already decided on, and the
  // next change to one derivation silently diverges from the other.
  //
  // CitationCard is the one sanctioned reader: its `isAnchored` drives BODY
  // state (`inDocument`), and its callers hand it an ungated `onJump`.
  const CARD_REGATE_ALLOWED = new Set(["src/panels/Citations/CitationCard.tsx"]);
  const cardFiles = (dir: string): string[] =>
    readdirSync(join(REPO_ROOT, dir), { withFileTypes: true }).flatMap((e) => {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) return e.name === "__tests__" ? [] : cardFiles(rel);
      return /\.tsx$/.test(e.name) ? [rel] : [];
    });

  it("no card component re-gates the `onJump` its caller already gated", () => {
    const REGATE = /onJump\s*[:=]\s*\{?\s*[\w!.()]+\s*\?\s*onJump\s*:\s*undefined/;
    const offenders = [...cardFiles("src/panels"), ...cardFiles("src/cards")]
      .filter((rel) => !CARD_REGATE_ALLOWED.has(rel))
      .filter((rel) => REGATE.test(read(rel)) || /\bisCardAnchored\s*\(/.test(read(rel)));
    expect(offenders).toEqual([]);
  });

  it("ArchiveCard and TodoRow take no second anchored prop", () => {
    expect(read("src/panels/Archive/ArchiveCard.tsx")).not.toMatch(/\borphaned\b/);
    expect(read("src/panels/Todo/TodoRow.tsx")).not.toMatch(/\bisAnchored\b/);
  });

  it("the omni host reads the pane's ONE pass rather than building its own", () => {
    const src = read("src/components/editor-layout/panels/omni-host.tsx");
    expect(src).not.toMatch(/buildCardAnchorPass\s*\(/);
    expect(src).toMatch(/useCardAnchorPass\(\)/);
  });
});

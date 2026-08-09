// @vitest-environment jsdom
//
// Task 178 — the AI-request inbox paints from the ONE theme SSOT.
//
// The defect: `AIWindow`'s `KIND_META` was a private per-kind table of
// `chipBg`/`chipFg` hex literals — a second per-kind colour vocabulary agreeing
// with no panel theme and subscribing to no override. Independent of any
// override it shipped a straight INVERSION: the Todo chip wore `#15803d`,
// byte-identical to the NOTE accent, while the Note chip wore a blue belonging
// to no kind at all.
//
// This suite renders the REAL window and reads the REAL chips, so it pins the
// three things a source-grep cannot:
//   1. every chip pair is exactly the badge pair its panel paints
//      (`deriveCardPalette(getPanelColor(themeKey))`), for every display kind;
//   2. no chip is painted a colour that belongs to a DIFFERENT kind — the
//      inversion class itself, which survives any future re-hand-rolling;
//   3. a `setPanelColor` re-tints the rendered chip — i.e. the chip really is
//      version-subscribed, not a fold evaluated once at module load (the
//      `card-theme-override-guardrail` sibling law).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";

// AIWindow transitively pulls `@/lib/storage`, whose `require("@/lib/storage-fsa")`
// vitest's resolver can't alias (the known barrel/storage gotcha).
vi.mock("@/lib/storage", () => ({
  readSidecar: vi.fn(),
  writeSidecar: vi.fn(),
}));

import AIWindow, { type AIWindowProps } from "@/components/AIWindow";
import {
  DEFAULT_PANEL_COLORS,
  deriveCardPalette,
  getPanelColor,
  setPanelColor,
  clearPanelColor,
  accentInk,
  type PanelThemeKey,
} from "@/lib/panel-theme";
import type { AiRequest, BibReviewRequest, RevisionCard } from "@/lib/types";

/* ── Fixtures: one row of every display kind the inbox can render ─────── */

const AT = "2026-01-01T00:00:00.000Z";

function panelReq(o: Partial<AiRequest> & { id: string; kind: AiRequest["kind"] }): AiRequest {
  return { text: "…", createdAt: AT, status: "pending", ...o };
}

const BIB_REVIEWS: BibReviewRequest[] = [
  { bibKey: "smith2020", type: "fields", requestedAt: AT, status: "pending" },
  { bibKey: "jones1999", type: "notes", requestedAt: AT, status: "pending" },
];

const COMMENTS: RevisionCard[] = [
  {
    kind: "comment", id: "c-general", createdAt: AT, text: "general thread",
    content: null, aiRequest: true, links: [],
  },
  {
    kind: "comment", id: "c-text", createdAt: AT, text: "on selection",
    content: null, aiRequest: true, selectedText: "some prose", links: [],
  },
];

const PANEL_REQUESTS: AiRequest[] = [
  panelReq({ id: "p-fn", kind: "footnote", linkedTo: { panel: "footnotes", cardId: "f1" } }),
  panelReq({ id: "p-note", kind: "note", linkedTo: { panel: "notes", cardId: "n1" } }),
  panelReq({ id: "p-cite", kind: "citation" }), // no per-card flag path → unlinked
  panelReq({ id: "p-todo", kind: "todo", linkedTo: { panel: "todos", cardId: "t1" } }),
  panelReq({ id: "p-report", kind: "report", linkedTo: { panel: "reports", cardId: "r1" } }),
  panelReq({ id: "p-sugg-rev", kind: "suggestion", linkedTo: { panel: "revisions", cardId: "s1" } }),
  panelReq({ id: "p-sugg-cut", kind: "suggestion", linkedTo: { panel: "cutter", cardId: "s2" } }),
];

function props(): AIWindowProps {
  const noop = () => undefined;
  return {
    open: true,
    onClose: noop,
    bibReviewRequests: BIB_REVIEWS,
    bibEntryRequests: [
      { id: "be1", description: "the new entry", status: "pending", createdAt: AT },
    ],
    comments: COMMENTS,
    bibEntries: [],
    panelAiRequests: PANEL_REQUESTS,
    addPanelAiRequest: (() => ({}) as AiRequest) as AIWindowProps["addPanelAiRequest"],
    deletePanelAiRequest: noop,
    clearLinkedAiRequest: noop,
    requestBibReview: noop,
    cancelBibReview: noop,
    addEntryRequest: noop,
    removeEntryRequest: noop,
    addComment: () => undefined,
    refreshAll: noop,
  };
}

/** Every rendered chip, by its label. The chip is the only element carrying
 *  BOTH an inline background and an inline colour, so it is read positionally
 *  from the row rather than by a test-only hook. */
function chips(): Map<string, { bg: string; fg: string }> {
  const out = new Map<string, { bg: string; fg: string }>();
  for (const el of document.querySelectorAll<HTMLElement>("li span[aria-label]")) {
    const bg = el.style.background;
    const fg = el.style.color;
    if (!bg || !fg) continue;
    out.set(el.textContent?.trim() ?? "", { bg, fg });
  }
  return out;
}

/** jsdom normalises an inline hex to `rgb(r, g, b)`. */
function rgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

function badgePairFor(key: PanelThemeKey) {
  const p = deriveCardPalette(getPanelColor(key));
  return { bg: rgb(p.badgeBg), fg: rgb(p.badgeColor) };
}

/** Which theme key each rendered chip label must paint from. `Suggestion`
 *  appears twice (cutter- and revision-linked) and is asserted separately. */
const EXPECTED: Record<string, PanelThemeKey> = {
  "Bib fields": "bib",
  "Bib notes": "bib",
  "New entry": "bib",
  General: "revision",
  "On selection": "revision",
  Footnote: "footnote",
  Note: "note",
  Citation: "citation",
  Todo: "todo",
  Report: "report",
};

beforeEach(() => {
  for (const k of Object.keys(DEFAULT_PANEL_COLORS) as PanelThemeKey[]) clearPanelColor(k);
});
afterEach(() => {
  cleanup();
  for (const k of Object.keys(DEFAULT_PANEL_COLORS) as PanelThemeKey[]) clearPanelColor(k);
});

describe("AI-request chips derive from the panel-theme SSOT", () => {
  it("every chip is exactly the badge pair its own panel paints", () => {
    render(<AIWindow {...props()} />);
    const rendered = chips();

    // Sanity: the fixtures really did produce a row of every display kind.
    for (const label of Object.keys(EXPECTED)) {
      expect(rendered.has(label), `no "${label}" chip rendered`).toBe(true);
    }

    for (const [label, key] of Object.entries(EXPECTED)) {
      expect(rendered.get(label), `chip "${label}"`).toEqual(badgePairFor(key));
    }
  });

  it("no chip wears a colour that belongs to a DIFFERENT kind (the inversion pin)", () => {
    render(<AIWindow {...props()} />);
    const rendered = chips();

    for (const [label, key] of Object.entries(EXPECTED)) {
      const got = rendered.get(label)!;
      for (const other of Object.keys(DEFAULT_PANEL_COLORS) as PanelThemeKey[]) {
        if (getPanelColor(other) === getPanelColor(key)) continue; // shares the accent, legitimately
        expect(
          got.fg,
          `chip "${label}" is painted the '${other}' accent/ink — that is the todo-wears-note inversion`,
        ).not.toBe(rgb(DEFAULT_PANEL_COLORS[other]));
        expect(got.fg, `chip "${label}" is painted the '${other}' badge ink`).not.toBe(
          rgb(accentInk(DEFAULT_PANEL_COLORS[other])),
        );
      }
    }
  });

  it("a suggestion chip follows the CARD it is linked to, not the coarser display kind", () => {
    render(<AIWindow {...props()} />);
    // Two rows share the "Suggestion" label; the cutter-linked one must paint
    // the cut accent and the revision-linked one the revision accent.
    const pairs = [...document.querySelectorAll<HTMLElement>("li span[aria-label]")]
      .filter((el) => el.textContent?.trim() === "Suggestion")
      .map((el) => ({ bg: el.style.background, fg: el.style.color }));

    expect(pairs).toHaveLength(2);
    expect(pairs).toContainEqual(badgePairFor("revision"));
    expect(pairs).toContainEqual(badgePairFor("cut"));
    expect(badgePairFor("revision")).not.toEqual(badgePairFor("cut")); // the assertion has teeth
  });

  it("a panel-colour override re-tints the chip (the chip is version-subscribed)", () => {
    render(<AIWindow {...props()} />);
    const before = chips().get("Todo")!;

    act(() => setPanelColor("todo", "#9333ea"));

    const after = chips().get("Todo")!;
    expect(after).not.toEqual(before);
    expect(after).toEqual(badgePairFor("todo"));
  });

  // The SOURCE shape of `KIND_META` (labels + descriptions + a registry-read
  // themeKey, no colour of its own) is pinned by the sibling grep law in
  // `card-theme-override-guardrail.test.ts`, which is where a re-hand-rolled
  // per-kind colour table gets caught for the whole repo — not just here.
});

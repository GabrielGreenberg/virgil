// @vitest-environment jsdom
//
// Task 1195 — the passage↔card link made VISIBLE and SAFE from either side.
// 1193 made a card's links dormant with a snippet; 1194 made an archive carry
// them. This suite pins what the user sees and can do with that link:
//   - ONE derivation (`cardsArchivedWith`) lists what travelled with a passage;
//   - the Archive card's chip row and a travelled card's passage line (the
//     ONE shell slot), each opening the other side;
//   - per-card unarchive keeps the dormant links → PARKED (neutral), not
//     orphaned, and re-attaches by itself when the passage is restored;
//   - deleting the passage RELEASES its cards (never deletes them), and the
//     confirm names them.

import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, renderHook } from "@testing-library/react";
import { useState } from "react";
import * as fs from "node:fs";
import * as path from "node:path";
import type { Link } from "@/links/_shared/types";
import {
  cardsArchivedWith,
  isFullyDormant,
  markDormant,
  passageOf,
  releaseFromSnippet,
  reviveLiveLinks,
  setArchivedFlag,
  settleDormancy,
  type AnchorLiveness,
  type DormantCardShape,
} from "@/links/dormant";
import { resolveAnchorState } from "@/links/anchor-state";
import { resolveCardAnchor, type ResolveIndex } from "@/links/resolve-card-anchor";
import { buildOmniAnchorRows } from "@/panels/_shared/omni-anchor-rows";
import { NO_JUMP } from "@/links/card-anchor-rows";
import {
  ArchiveRelationRow,
  ArchivedWithProvider,
  PARKED_WITH_PASSAGE_COPY,
  buildArchivedWithApi,
  passageDeleteMessage,
  travelledSummary,
} from "@/panels/_shared/archived-with";
import { useDormantRevival } from "@/hooks/useDormantRevival";
import type { CardKind } from "@/cards/types";
import { codeOnly, REPO_ROOT } from "@/lib/__tests__/_source-scan";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

type Card = DormantCardShape & { title?: string; text?: string };

function modeA(id: string, pid: string): Link {
  return {
    id,
    kind: "anchor",
    anchor: { type: "textObject", targetKind: "paragraph", textObjectIds: [pid] },
    target: { type: "card", ref: { kind: "note", id: "n" } },
    createdAt: "2026-10-20T00:00:00Z",
  };
}

/** A card that travelled with snippet `snip` (1194's writer). */
function travelled(id: string, pid: string, extra: Partial<Card> = {}): Card {
  return markDormant<Card>({ id, links: [modeA(`l-${id}`, pid)], ...extra }, "snip", {
    pids: new Set([pid]),
  });
}

const EMPTY_INDEX: ResolveIndex = {
  uuidToParagraph: new Set(),
  uuidToPos: new Map(),
  anchorIdToParagraph: new Map(),
  snapshotToParagraph: new Map(),
} as unknown as ResolveIndex;

// ---------------------------------------------------------------------------

describe("the derivation — cardsArchivedWith", () => {
  it("lists every travelled card under its passage, from the stores alone", () => {
    const notes = [travelled("n1", "P1", { title: "First" }), travelled("n2", "P1"), { id: "n3" }];
    const todos = [travelled("t1", "P1", { text: "Check dates" })];
    const map = cardsArchivedWith<CardKind, Card>([
      { cards: notes, kindOf: () => "note" },
      { cards: todos, kindOf: () => "todo" },
    ]);
    expect([...map.keys()]).toEqual(["snip"]);
    expect(map.get("snip")!.map((t) => `${t.kind}:${t.card.id}`)).toEqual([
      "note:n1",
      "note:n2",
      "todo:t1",
    ]);
    expect(map.get("snip")!.every((t) => t.archived)).toBe(true);
  });

  it("a deleted card leaves the list with no second write (derived)", () => {
    const notes = [travelled("n1", "P1")];
    expect(cardsArchivedWith<CardKind, Card>([{ cards: notes, kindOf: () => "note" }]).size).toBe(1);
    expect(cardsArchivedWith<CardKind, Card>([{ cards: [], kindOf: () => "note" }]).size).toBe(0);
  });

  it("an unarchived (parked) card still names its passage", () => {
    const parked = setArchivedFlag(travelled("n1", "P1"), false);
    const map = cardsArchivedWith<CardKind, Card>([{ cards: [parked], kindOf: () => "note" }]);
    expect(map.get("snip")![0].archived).toBe(false);
    expect(passageOf(parked)).toBe("snip");
  });
});

describe("per-card unarchive — parked, not orphaned", () => {
  it("clears the card-level field, keeps the dormant links", () => {
    const card = travelled("n1", "P1");
    expect(card.archived).toBe(true);
    const out = setArchivedFlag(card, false);
    expect(out.archived).toBe(false);
    expect(Object.keys(out)).not.toContain("archived" + "With");
    expect(out.links![0]).toEqual(card.links![0]); // still dormant
    expect(out.archived !== true && isFullyDormant(out)).toBe(true);
    // A repeated archive of a card archived WITH its text is identity.
    expect(setArchivedFlag(card, true)).toBe(card);
  });

  it("the resolver says dormant, the SSOT says parked (never orphaned)", () => {
    const out = setArchivedFlag(travelled("n1", "P1"), false);
    expect(resolveCardAnchor(out, null, EMPTY_INDEX).source).toBe("dormant");
    expect(resolveAnchorState(null, { parked: true })).toBe("parked");
    expect(resolveAnchorState(null, { parked: true, unanchored: false })).toBe("parked");
    expect(resolveAnchorState("P1", { parked: true })).toBe("anchored");
  });

  it("omni rows: an all-dormant card bins as parked; a dead anchor stays orphaned", () => {
    const resolve = () => ({ rows: [], anchored: false });
    const parked = setArchivedFlag(travelled("n1", "P1"), false);
    const [row] = buildOmniAnchorRows(parked, "note:n1", resolve, { unanchored: true });
    expect(row.anchorState).toBe("parked");
    expect(row.withJump).toBe(NO_JUMP);
    const dead = { id: "n2", links: [modeA("l2", "GONE")] };
    const orphanResolve = () => ({
      rows: [{ pid: "GONE", pos: null, sources: [] }],
      anchored: false,
    });
    const [o] = buildOmniAnchorRows(dead, "note:n2", orphanResolve, { unanchored: true });
    expect(o.anchorState).toBe("orphaned");
    // No link at all stays free (unchanged).
    const [f] = buildOmniAnchorRows({ id: "n3" }, "note:n3", resolve, { unanchored: true });
    expect(f.anchorState).toBe("free");
  });

  it("restoring the passage re-attaches the parked card by itself", () => {
    const parked = setArchivedFlag(travelled("n1", "P1"), false);
    const back = reviveLiveLinks(parked, {
      isUuidLive: (u) => u === "P1",
      isAnchorIdLive: () => false,
    });
    expect(back.links![0]).toEqual(modeA("l-n1", "P1"));
    expect(back.archived).toBe(false);
    expect(passageOf(back)).toBeNull();
    expect(isFullyDormant(back)).toBe(false);
  });
});

describe("deleting the passage RELEASES its cards", () => {
  it("drops the dormant links and the card-level field; the card stays archived", () => {
    const card = travelled("n1", "P1");
    const out = releaseFromSnippet(card, "snip");
    expect(out.id).toBe("n1");
    expect(out.archived).toBe(true);
    expect(out.links).toEqual([]);
    expect(passageOf(out)).toBeNull();
    // Another snippet's links are untouched; an unrelated card is identity.
    expect(releaseFromSnippet(card, "other")).toBe(card);
  });

  it("the hook door releases every card of the snippet and deletes none", () => {
    type S = { cards: Card[] };
    const keep = travelled("n2", "P9");
    const other = markDormant<Card>({ id: "n3", links: [modeA("l3", "Q")] }, "snip-2", {
      pids: new Set(["Q"]),
    });
    const { result } = renderHook(() => {
      const [state, setState] = useState<S>({
        cards: [travelled("n1", "P1"), keep, other],
      });
      const doors = useDormantRevival<S, Card>(
        "doc-1",
        (fn) => setState(fn),
        state,
        (s) => s.cards,
        (_s, cards) => ({ cards }),
      );
      return { state, doors };
    });
    act(() => result.current.doors.release("snip"));
    const cards = result.current.state.cards;
    expect(cards.map((c) => c.id)).toEqual(["n1", "n2", "n3"]);
    expect(cards.slice(0, 2).every((c) => c.archived === true && passageOf(c) === null)).toBe(true);
    expect(passageOf(cards[2])).toBe("snip-2");
  });

  it("the confirm names the cards that stay", () => {
    expect(passageDeleteMessage([])).toBeUndefined();
    const msg = passageDeleteMessage([
      { kind: "note", id: "a", archived: true, title: "A" },
      { kind: "note", id: "b", archived: true, title: "B" },
      { kind: "todo", id: "c", archived: false, title: "C" },
    ])!;
    expect(msg).toContain("2 notes, 1 task");
    expect(msg).toContain("stay in your archived cards");
  });
});

// ---------------------------------------------------------------------------
// The two UI lines (one shell slot)
// ---------------------------------------------------------------------------

function api(open: (panel: string, id: string) => void) {
  const map = cardsArchivedWith<CardKind, Card>([
    { cards: [travelled("n1", "P1", { title: "Margin thought" }), setArchivedFlag(travelled("n2", "P1"), false)], kindOf: () => "note" },
    { cards: [travelled("t1", "P1", { text: "Verify quote" })], kindOf: () => "todo" },
  ]);
  return buildArchivedWithApi(map, () => "The annotation passage", open);
}

describe("task 1329 — the dormancy invariant: a dormant link has a way back", () => {
  const NOTHING_LIVE: AnchorLiveness = { isUuidLive: () => false, isAnchorIdLive: () => false };
  const liveUuids = (...u: string[]): AnchorLiveness => ({
    isUuidLive: (x) => u.includes(x),
    isAnchorIdLive: () => false,
  });
  const inArchive = (...ids: string[]) => (id: string) => ids.includes(id);

  it("a passage still in the Archive keeps its cards dormant (identity)", () => {
    const card = travelled("n1", "P1");
    expect(settleDormancy(card, inArchive("snip"), NOTHING_LIVE)).toBe(card);
    // ...even when the text is live: only a STRANDED link revives here, so a
    // still-archived passage's link is never revived onto a squatter.
    expect(settleDormancy(card, inArchive("snip"), liveUuids("P1"))).toBe(card);
  });

  it("archive-card → passage deleted → reinstate: the card is released, not pinned to a deleted snippet", () => {
    // The card sat in archive.json while its passage was deleted, so the
    // delete's release never reached it. Reinstate settles against the Archive.
    const record = travelled("n1", "P1");
    const out = settleDormancy(record, inArchive(/* "snip" is gone */), NOTHING_LIVE);
    expect(out.id).toBe("n1");
    expect(out.links).toEqual([]);
    expect(passageOf(out)).toBeNull();
    expect(out.archived).toBe(true); // an ordinary archived card — never deleted
    // ...so the derivation no longer lists it under a deleted passage.
    expect(cardsArchivedWith([{ cards: [out], kindOf: () => "note" }]).size).toBe(0);
  });

  it("the stranded passage's text is back in the paper: the link revives instead", () => {
    const out = settleDormancy(travelled("n1", "P1"), inArchive(), liveUuids("P1"));
    expect(out.links).toHaveLength(1);
    expect(isFullyDormant(out)).toBe(false);
    expect(out.archived).toBeUndefined();
    expect(passageOf(out)).toBeNull();
  });

  it("two passages, one gone: only the gone one's links go; the card stays archived with the other", () => {
    let card = travelled("n1", "P1");
    card = markDormant<Card>(
      { ...card, links: [...card.links!, modeA("l-2", "Q1")] },
      "snip-2",
      { pids: new Set(["Q1"]) },
    );
    expect(card.archivedWith).toBe("snip-2");
    const out = settleDormancy(card, inArchive("snip"), NOTHING_LIVE);
    expect(out.links!.map((l) => l.archivedWith)).toEqual(["snip"]);
    expect(out.archivedWith).toBe("snip");
    expect(out.archived).toBe(true);
  });

  it("an unreadable reinstated record passes through untouched (reinstate validates it)", () => {
    const junk = { id: "x", links: "nope" } as unknown as Card;
    expect(settleDormancy(junk, inArchive(), NOTHING_LIVE)).toBe(junk);
    const holey = { id: "y", links: [null] } as unknown as Card;
    expect(settleDormancy(holey, inArchive(), NOTHING_LIVE)).toBe(holey);
  });

  it("the hook door writes only when something is stranded (the loader invariant)", () => {
    type S = { cards: Card[] };
    const writes: number[] = [];
    const { result } = renderHook(() => {
      const [state, setState] = useState<S>({ cards: [travelled("n1", "P1")] });
      const doors = useDormantRevival<S, Card>(
        "doc-1",
        (fn) => {
          writes.push(1);
          setState(fn);
        },
        state,
        (s) => s.cards,
        (_s, cards) => ({ cards }),
      );
      return { state, doors };
    });
    act(() => result.current.doors.settle(inArchive("snip"), NOTHING_LIVE));
    expect(writes).toHaveLength(0);
    act(() => result.current.doors.settle(inArchive(), NOTHING_LIVE));
    expect(writes).toHaveLength(1);
    expect(passageOf(result.current.state.cards[0])).toBeNull();
  });
});

describe("the archive-relation row", () => {
  it("Archive card: lists what travelled; each chip opens its card", () => {
    const open = vi.fn();
    const { container, getByText } = render(
      <ArchivedWithProvider value={api(open)}>
        <ArchiveRelationRow kind="archive" id="snip" />
      </ArchivedWithProvider>,
    );
    expect(getByText(/Archived with this passage: 2 notes, 1 task/)).toBeTruthy();
    const chips = container.querySelectorAll("[data-archive-travelled-chip]");
    expect(chips).toHaveLength(3);
    expect(chips[0].textContent).toContain("Margin thought");
    fireEvent.click(chips[2]);
    expect(open).toHaveBeenCalledWith("todo", "t1");
    fireEvent.click(chips[0]);
    expect(open).toHaveBeenCalledWith("notes", "n1");
  });

  it("travelled card: names its passage and jumps to the Archive card", () => {
    const open = vi.fn();
    const { container, getByText } = render(
      <ArchivedWithProvider value={api(open)}>
        <ArchiveRelationRow kind="note" id="n1" />
      </ArchivedWithProvider>,
    );
    expect(getByText("Archived with passage")).toBeTruthy();
    const row = container.querySelector("[data-archive-passage]")!;
    expect(row.getAttribute("data-archive-passage-state")).toBe("archived");
    fireEvent.click(container.querySelector("[data-archive-passage-jump]")!);
    expect(open).toHaveBeenCalledWith("archive", "snip");
  });

  it("parked card: says it will re-attach", () => {
    const { container } = render(
      <ArchivedWithProvider value={api(() => {})}>
        <ArchiveRelationRow kind="note" id="n2" />
      </ArchivedWithProvider>,
    );
    const row = container.querySelector("[data-archive-passage]")!;
    expect(row.getAttribute("data-archive-passage-state")).toBe("parked");
    expect(row.textContent).toContain(PARKED_WITH_PASSAGE_COPY);
  });

  it("a card with no relation renders nothing; no provider renders nothing", () => {
    const { container } = render(
      <ArchivedWithProvider value={api(() => {})}>
        <ArchiveRelationRow kind="note" id="zzz" />
        <ArchiveRelationRow kind="archive" id="other" />
      </ArchivedWithProvider>,
    );
    expect(container.innerHTML).toBe("");
    expect(render(<ArchiveRelationRow kind="note" id="n1" />).container.innerHTML).toBe("");
  });

  it("summary nouns come from the registry", () => {
    expect(
      travelledSummary([{ kind: "report-request", id: "r", archived: true, title: "" }]),
    ).toBe("1 report request");
  });
});

// ---------------------------------------------------------------------------
// CENSUS — the wiring every door relies on
// ---------------------------------------------------------------------------

describe("archived-with CENSUS", () => {
  const read = (rel: string) => codeOnly(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8"));

  it("every carrying hook's setArchived writes through setArchivedFlag", () => {
    for (const f of ["useNotes", "useTodos", "useCutter", "useReports", "useRevisions"]) {
      const code = read(`src/hooks/${f}.ts`);
      expect(code, f).toMatch(/setArchivedFlag\(/);
      expect(code, f).not.toMatch(/\{\s*\.\.\.(c|i),\s*archived\s*\}/);
      expect(code, f).toMatch(/\brelease\b/);
    }
  });

  it("every snippet delete releases all five stores, after the executor", () => {
    const code = read("src/components/EditorPane.tsx");
    const start = code.indexOf("const deletePassage = useCallback(");
    expect(start).toBeGreaterThan(-1);
    const body = code.slice(start, code.indexOf("const archiveHook = useMemo(", start));
    // All five via the ONE carrying-store table (task 1271) — the table's
    // exhaustive `ArchiveOriginPanel` key is what makes it "all five"; the
    // store side is `dormant-store-census.test.ts`.
    expect(body).toMatch(/Object\.values\(dormantStores\)/);
    expect(body.indexOf("await deleteArchiveSnippet(id)")).toBeLessThan(body.indexOf(".release(id)"));
    expect(code).toMatch(/deleteSnippet:\s*deletePassage\b/);
  });

  it("every door that can end a passage's restorability settles dormancy (task 1329)", () => {
    const code = read("src/components/EditorPane.tsx");
    // Restore's end edge: after the landing, strands exactly the restored snippet.
    const restore = code.slice(code.indexOf("const handleArchiveRestore = useCallback("));
    const body = restore.slice(0, restore.indexOf("const handleArchiveDelete"));
    expect(body.indexOf("archiveHook.restoreSnippet(")).toBeGreaterThan(-1);
    expect(body).toMatch(/settleDormantStores\(\(snippetId\) => snippetId !== id\)/);
    expect(body.indexOf("archiveHook.restoreSnippet(")).toBeLessThan(
      body.indexOf("settleDormantStores("),
    );
    // Reinstate: the record is settled against the Archive before it lands.
    expect(body).toMatch(/\.reinstate\(\s*settleDormancy\(/);
    // Load: after the reconciles, and standing down on a sidecar load error.
    expect(code).toMatch(/if \(!anyCardSidecarLoadError\) settleDormantStores\(inArchive\(\)\)/);
    expect(code.indexOf("archiveHook.reconcileAnchors(editor);")).toBeLessThan(
      code.indexOf("settleDormantStores(inArchive())"),
    );
    // Every carrying store, off the one table.
    expect(code).toMatch(/for \(const store of Object\.values\(dormantStores\)\) store\.settle\(/);
  });

  it("the relation row is a SHELL slot — no card passes it by hand", () => {
    expect(read("src/panels/_shared/useAnchoredCardShell.ts")).toMatch(
      /archiveRelation:\s*createElement\(ArchiveRelationRow/,
    );
    const panels = path.join(REPO_ROOT, "src/panels");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== "__tests__") walk(abs);
        } else if (/\.tsx$/.test(e.name) && /archiveRelation=/.test(fs.readFileSync(abs, "utf8"))) {
          offenders.push(path.relative(REPO_ROOT, abs));
        }
      }
    };
    walk(panels);
    expect(offenders).toEqual([]);
  });
});

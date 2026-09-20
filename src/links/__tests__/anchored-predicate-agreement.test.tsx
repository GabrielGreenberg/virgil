// @vitest-environment jsdom
//
// TASK 665 — **"anchored" and "reachable" cannot disagree.**
//
// `resolve-card-anchor.ts` is the four-rung anchor-recovery authority: a card is
// anchored by a live uuid, by a surviving `linkedAnchor` mark, by the RC1
// self-heal, or by its `paragraphSnapshot`. Three surfaces answered "is this
// card anchored?" with a WEAKER predicate, so a card the authority RECOVERED
// read as unanchored (or the reverse) at each of them. Two of the three are
// covered by their own surfaces' suites (`float-jump-agreement.test.tsx` for
// the nine popped kinds). The two here are the ones that had no test at all:
//
//   M2 — the ARCHIVE SORT disagreed with the archive BADGE, in adjacent memos.
//        `anchoredArchiveIds` read the authority; `sortedArchiveSnippets` ran
//        its own `doc.descendants` walk keyed on the LIVE UUID ONLY. So a clip
//        recovered by mark or snapshot was badged anchored and sorted into the
//        orphan tail — in the same rendered row.
//
//   M3 — the ACT had TWO rungs where the GATE has four. `resolveLink` tried the
//        mark and the stored uuid and stopped, so `jumpToCard` returned `false`
//        for a card every gate above it calls anchored: the user presses a live
//        chevron and the app does nothing. The load reconcile normally rewrites
//        a snapshot-recovered link first, but it fires once per `docId`
//        (`modeAReconciledDocRef`), so a MID-SESSION uuid re-mint lands here.
//
// Every leg drives the REAL editor and the REAL authority — a "recovered" card
// below is recovered by the ladder's own verdict, never by a stub.
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  buildCardAnchorPass,
  sortCardsByResolvedAnchor,
} from "@/links/card-anchor-rows";
import { resolveLink, jumpToCard, type CardWithLinks } from "@/links/links";
import type { Link } from "@/links/_shared/types";
import type { ArchivedSnippet } from "@/lib/types";

const P1_TEXT = "The first paragraph.";
const P2_TEXT = "The second paragraph.";
const P3_TEXT = "The third paragraph.";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: new Set() },
    host: null,
  } as unknown as EditorExtensionsCtx;
}

// jsdom implements no scrolling; `jumpToCard` calls it on the element it
// resolved, so a missing stub would fail the leg for a reason it isn't about.
(Element.prototype as unknown as { scrollIntoView?: () => void }).scrollIntoView ??=
  function scrollIntoViewStub() {};

const editors: Editor[] = [];
afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
});

/** A three-paragraph doc whose live uuids are `P1` / `P2` / `P3`. */
function mountDoc(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { uuid: "P1" }, content: [{ type: "text", text: P1_TEXT }] },
        { type: "paragraph", attrs: { uuid: "P2" }, content: [{ type: "text", text: P2_TEXT }] },
        { type: "paragraph", attrs: { uuid: "P3" }, content: [{ type: "text", text: P3_TEXT }] },
      ],
    },
  });
  editors.push(editor);
  return editor;
}

/** A Mode-A paragraph link, optionally carrying a text snapshot. */
function paraLink(uuid: string, snapshot?: string): Link {
  return {
    id: `link-${uuid}`,
    kind: "anchor",
    anchor: {
      type: "textObject",
      targetKind: "paragraph",
      textObjectIds: [uuid],
      ...(snapshot ? { paragraphSnapshot: snapshot } : {}),
    },
    target: { type: "card", ref: { kind: "archive", id: "c1" } },
    createdAt: "2026-01-01T00:00:00.000Z",
  } as Link;
}

function clip(id: string, ...links: Link[]): ArchivedSnippet {
  return {
    id,
    title: id,
    content: { type: "doc", content: [] },
    createdAt: "2026-01-01T00:00:00.000Z",
    links,
  } as unknown as ArchivedSnippet;
}

// ── M2 — the sort and the badge read ONE resolution ─────────────────────────

describe("task 665 M2 — a recovered clip sorts where its badge says it is", () => {
  it("a SNAPSHOT-recovered clip sorts by its recovered paragraph, not into the orphan tail", () => {
    const editor = mountDoc();
    const pass = buildCardAnchorPass(editor);

    // `recovered` stores a dead uuid but its snapshot matches P1 — the ordinary
    // outcome of a `%!v:` anchor failing to round-trip through the `.tex`, and
    // armed for EVERY archive clip, which is created with a snapshot.
    const recovered = clip("recovered", paraLink("DEAD", P1_TEXT));
    const onP3 = clip("onP3", paraLink("P3"));
    const orphan = clip("orphan", paraLink("GONE"));

    // The BADGE (`anchoredArchiveIds` — the authority) …
    expect(pass.resolve(recovered).anchored).toBe(true);
    expect(pass.resolve(onP3).anchored).toBe(true);
    expect(pass.resolve(orphan).anchored).toBe(false);

    // … and the ORDER agree. Pre-fix the sort ran a live-uuid-only walk, so
    // `recovered` had no position and tailed BEHIND `onP3` while wearing the
    // anchored badge.
    const sorted = sortCardsByResolvedAnchor([onP3, orphan, recovered], pass.resolve);
    expect(sorted.map((s) => s.id)).toEqual(["recovered", "onP3", "orphan"]);
  });

  it("every card the sort places before an orphan is one the badge calls anchored", () => {
    const editor = mountDoc();
    const pass = buildCardAnchorPass(editor);
    const cards = [
      clip("a", paraLink("GONE")),
      clip("b", paraLink("DEAD", P2_TEXT)),
      clip("c", paraLink("P1")),
      clip("d"),
    ];
    const sorted = sortCardsByResolvedAnchor(cards, pass.resolve);
    const verdicts = sorted.map((s) => pass.resolve(s).anchored);
    // Anchored ones first, contiguously — no anchored card may sit behind an
    // unanchored one. That IS the disagreement stated as an invariant.
    expect(verdicts).toEqual([...verdicts].sort((x, y) => Number(y) - Number(x)));
    expect(sorted.map((s) => s.id)).toEqual(["c", "b", "a", "d"]);
  });

  it("orphans keep their original relative order (the sort is stable)", () => {
    const editor = mountDoc();
    const pass = buildCardAnchorPass(editor);
    const cards = [clip("z", paraLink("GONE")), clip("y"), clip("x", paraLink("ALSO-GONE"))];
    expect(sortCardsByResolvedAnchor(cards, pass.resolve).map((s) => s.id)).toEqual([
      "z",
      "y",
      "x",
    ]);
  });
});

// ── M3 — the act has the gate's rungs ───────────────────────────────────────

describe("task 665 M3 — whatever the gate calls anchored, jumpToCard reaches", () => {
  it("resolveLink recovers a link whose uuid is dead but whose snapshot matches", () => {
    const editor = mountDoc();
    const link = paraLink("DEAD", P2_TEXT);
    const res = resolveLink(editor, link);
    expect(res).not.toBeNull();
    expect(res!.kind).toBe("paragraph");
    expect((res as { paragraphId: string }).paragraphId).toBe("P2");
  });

  it("the act's snapshot rung matches on the AUTHORITY's normalization, not raw text", () => {
    const editor = mountDoc();
    // Same paragraph, stored with the whitespace drift `normalizeParagraphText`
    // exists to absorb. A raw `textContent ===` compare (the pre-665 helper)
    // misses it, so gate and act would disagree by one space.
    const link = paraLink("DEAD", `  The   second\n paragraph.  `);
    const res = resolveLink(editor, link);
    expect((res as { paragraphId?: string } | null)?.paragraphId).toBe("P2");
  });

  it("a card anchored ONLY by its snapshot is reachable — the gate and the act agree", () => {
    const editor = mountDoc();
    const pass = buildCardAnchorPass(editor);
    const card = clip("c1", paraLink("DEAD", P3_TEXT)) as unknown as CardWithLinks;
    // The GATE says anchored …
    expect(pass.resolve(card).anchored).toBe(true);
    // … and the ACT reaches it. Pre-fix this returned `false`: a live chevron
    // over a jump that did nothing.
    expect(jumpToCard(editor, card)).toBe(true);
  });

  it("CONTROL — a genuinely unrecoverable card is unreachable AND unanchored", () => {
    const editor = mountDoc();
    const pass = buildCardAnchorPass(editor);
    const card = clip("c2", paraLink("DEAD", "Text no paragraph carries.")) as unknown as CardWithLinks;
    expect(pass.resolve(card).anchored).toBe(false);
    expect(jumpToCard(editor, card)).toBe(false);
  });

  it("a still-live uuid still wins over a snapshot that would match elsewhere", () => {
    const editor = mountDoc();
    // Stored on P3, but carrying P1's text as its snapshot. The ladder is
    // uuid-STRICTLY-before-snapshot; the act must not reorder it.
    const res = resolveLink(editor, paraLink("P3", P1_TEXT));
    expect((res as { paragraphId?: string } | null)?.paragraphId).toBe("P3");
  });
});

// @vitest-environment jsdom
//
// TASK 1506 — **"where is this card anchored NOW?" has one door on the act
// side: `CardAnchorPass.anchorBlocksOf`.**
//
// The margin, the omni rows, Jump (935) and hover/selection paint (1505) all
// bind a card through the anchor authority. Five act-side surfaces still read
// the card's FIRST STORED pid (`getLinkedTextObjectIds(card)[0]`, or the raw
// `textObjectIds`) as if it were where the card is — a record that, after a
// mid-session re-mint or a Mode-B move, names a block no marker is drawn on:
//
//   1. suggestions — Apply / Insert below / auto-apply and the can-apply gate
//      refused a visibly anchored card as "unanchored";
//   2. the AI-request wash painted one block of a two-block request, and none
//      of a card whose first pid was re-minted;
//   3. the anchor summary badge counted "paragraph · 0 words";
//   4. drop-mode ignored a drop on a moved highlight's BIRTH block as "already
//      there";
//   5. the Accept prompt named archived (dormant) and birth-record pids.
//
// Every leg drives the REAL editor and the REAL authority; the last leg is the
// census that keeps the stored read from coming back.
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { buildCardAnchorPass } from "@/links/card-anchor-rows";
import { getAnchorSummary, type CardWithLinks } from "@/links/links";
import type { Link } from "@/links/_shared/types";
import {
  applySuggestion,
  suggestionAnchorBlock,
  suggestionApplicability,
  suggestionInsertability,
  type SuggestionLike,
} from "@/links/pending-change-actions";
import { requestWashTargets } from "@/links/_shared/request-wash";
import { buildSuggestionApplyPrompt } from "@/links/suggestion-apply-prompt";
import { textObjectSideReanchorSpec } from "@/components/drop-mode/util/text-object-side-reanchor";
import type { DropCtx, ParagraphAnchorApi, Placement } from "@/components/drop-mode/types";
import { buildFloatKey } from "@/floats/float-key";
import {
  codeOnlyLines,
  matchesWithLines,
  trackedFiles,
  REPO_ROOT,
} from "@/lib/__tests__/_source-scan";

const P1_TEXT = "The first paragraph has five words.";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set() },
    host: null,
  } as unknown as EditorExtensionsCtx;
}

const editors: Editor[] = [];
afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
});

/** P1 (plain), P2 (holds the live mark `a1`), P3 (plain). */
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
        {
          type: "paragraph",
          attrs: { uuid: "P2" },
          content: [
            { type: "text", text: "Before " },
            {
              type: "text",
              text: "marked words",
              marks: [{ type: "linkedAnchor", attrs: { anchorId: "a1", kind: "note" } }],
            },
            { type: "text", text: " after." },
          ],
        },
        { type: "paragraph", attrs: { uuid: "P3" }, content: [{ type: "text", text: "Third one." }] },
      ],
    },
  });
  editors.push(editor);
  return editor;
}

function paraLink(uuid: string, extra: Partial<Link> = {}, snapshot?: string): Link {
  return {
    id: `link-${uuid}`,
    kind: "anchor",
    anchor: {
      type: "textObject",
      targetKind: "paragraph",
      textObjectIds: [uuid],
      ...(snapshot ? { paragraphSnapshot: snapshot } : {}),
    },
    target: { type: "card", ref: { kind: "note", id: "c1" } },
    createdAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  } as Link;
}

/** A Mode-B link born in `birthPid`, drawn by mark `anchorId`. */
function rangeLink(birthPid: string, anchorId: string): Link {
  return {
    id: `range-${anchorId}`,
    kind: "anchor",
    anchor: {
      type: "textObject",
      targetKind: "linkedRange",
      textObjectIds: [birthPid],
      textRange: { anchorId, textSnapshot: "marked words" },
    },
    target: { type: "card", ref: { kind: "note", id: "c1" } },
    createdAt: "2026-01-01T00:00:00.000Z",
  } as Link;
}

/** The re-mint window: the card's stored pid is dead, its snapshot binds P1. */
const REMINTED = () => paraLink("DEAD", {}, P1_TEXT);

function suggestion(links: Link[], over: Partial<SuggestionLike> = {}): SuggestionLike {
  return {
    id: "s1",
    kind: "suggestion",
    author: "human",
    status: "pending",
    original_text: "first paragraph",
    suggested_text: "opening paragraph",
    user_text: "",
    links,
    ...over,
  } as unknown as SuggestionLike;
}

describe("task 1506 — the door itself", () => {
  it("anchorBlocksOf answers the live blocks: snapshot-recovered, the mark's block, never the record", () => {
    const editor = mountDoc();
    const pass = buildCardAnchorPass(editor);
    const c = (...links: Link[]) => ({ id: "c1", links }) as unknown as CardWithLinks;
    expect(pass.anchorBlocksOf(c(REMINTED()))).toEqual(["P1"]);
    // A Mode-B highlight born in P1 whose mark now lies in P2 is on P2 only.
    expect(pass.anchorBlocksOf(c(rangeLink("P1", "a1")))).toEqual(["P2"]);
    expect(pass.anchorBlocksOf(c(paraLink("P1"), paraLink("P3")))).toEqual(["P1", "P3"]);
    // Nothing binds it → not anchored → nothing.
    expect(pass.anchorBlocksOf(c(paraLink("GONE")))).toEqual([]);
    // A dormant link is archived text, not an anchor.
    expect(
      pass.anchorBlocksOf(c(paraLink("P1", { archivedWith: "snip" } as Partial<Link>), paraLink("P3"))),
    ).toEqual(["P3"]);
  });
});

describe("task 1506 — 1. suggestions land where the marker is", () => {
  it("a re-minted card is anchored to the gate, and Apply splices in the recovered block", () => {
    const editor = mountDoc();
    const card = suggestion([REMINTED()]);
    const block = suggestionAnchorBlock(card, buildCardAnchorPass(editor));
    expect(block).toBe("P1");
    expect(suggestionApplicability(card, "revision-suggestion", block)).toEqual({ canApply: true });
    expect(suggestionInsertability(card, block)).toEqual({ canApply: true });

    const setSuggestionStatus = vi.fn();
    const result = applySuggestion({
      editor: editor as never,
      card,
      family: "revision-suggestion",
      setSuggestionStatus,
      setAppliedChange: vi.fn(),
      generateAnchorId: () => "applied-1",
    });
    expect(result).toMatchObject({ outcome: "applied", anchorUuid: "P1" });
    expect(editor.state.doc.child(0).textContent).toContain("opening paragraph");
  });

  it("a card nothing binds is refused as unanchored, though it stores a pid", () => {
    const editor = mountDoc();
    const card = suggestion([paraLink("GONE")]);
    const block = suggestionAnchorBlock(card, buildCardAnchorPass(editor));
    expect(block).toBeNull();
    expect(suggestionApplicability(card, "revision-suggestion", block)).toEqual({
      canApply: false,
      reason: "unanchored",
    });
  });
});

describe("task 1506 — 2. the AI-request wash paints every live block", () => {
  const request = (...links: Link[]) =>
    ({ id: "r1", kind: "note", aiRequest: true, links }) as never;
  const blockOf = (editor: Editor, uuid: string) => {
    let range: { from: number; to: number } | null = null;
    editor.state.doc.forEach((node, offset) => {
      if (node.attrs.uuid === uuid) range = { from: offset + 1, to: offset + node.nodeSize - 1 };
    });
    return range!;
  };

  it("a two-paragraph request washes both", () => {
    const editor = mountDoc();
    const targets = requestWashTargets(editor as never, [request(paraLink("P1"), paraLink("P3"))]);
    expect(targets.map(({ from, to }) => ({ from, to }))).toEqual([
      blockOf(editor, "P1"),
      blockOf(editor, "P3"),
    ]);
  });

  it("a request whose first pid was re-minted washes the block it is bound to", () => {
    const editor = mountDoc();
    const targets = requestWashTargets(editor as never, [request(REMINTED())]);
    expect(targets.map(({ from, to }) => ({ from, to }))).toEqual([blockOf(editor, "P1")]);
  });
});

describe("task 1506 — 3. the anchor summary counts the live block's words", () => {
  it("a snapshot-bound card reads P1's words, not 0", () => {
    const editor = mountDoc();
    const card = { id: "c1", links: [REMINTED()] } as unknown as CardWithLinks;
    const blocks = buildCardAnchorPass(editor).anchorBlocksOf(card);
    expect(getAnchorSummary(card, editor as never, blocks)).toEqual({
      kind: "paragraph",
      words: 6,
    });
  });
});

describe("task 1506 — 4. drop-mode asks where the card is NOW", () => {
  const CARD_KEY = buildFloatKey({ domain: "card", kind: "highlight", id: "c1" });
  const side = (paragraphId: string) =>
    ({ kind: "paragraph-side", paragraphId }) as unknown as Placement;
  const spec = textObjectSideReanchorSpec({ getApi: (ctx) => ctx.notes });
  function ctx(editor: Editor): DropCtx {
    const highlight = { id: "c1", links: [rangeLink("P1", "a1")] };
    const api: ParagraphAnchorApi = {
      exists: (id) => id === "c1",
      getCard: (id) => (id === "c1" ? (highlight as never) : undefined),
      addTextObjectLink: () => {},
      removeTextObjectLink: () => {},
      modeB: { policy: "intrinsic", why: "test: a highlight is its range" },
    };
    return { mainEditor: editor, notes: api } as unknown as DropCtx;
  }

  it("a moved highlight dropped on its BIRTH block re-anchors (not 'already there')", () => {
    const editor = mountDoc();
    expect(spec.classifyDrop(side("P1"), CARD_KEY, ctx(editor))).toEqual({ kind: "apply" });
  });

  it("dropped on the block its mark is in, it is already there", () => {
    const editor = mountDoc();
    expect(spec.classifyDrop(side("P2"), CARD_KEY, ctx(editor))).toEqual({ kind: "no-op" });
  });
});

describe("task 1506 — 5. the Accept prompt names the live blocks", () => {
  it("skips a dormant link's pid and a Mode-B birth record", () => {
    const editor = mountDoc();
    const s = {
      ...suggestion([
        paraLink("P3", { archivedWith: "snip" } as Partial<Link>),
        rangeLink("P1", "a1"),
      ]),
      explanation: "",
      instructions: "",
    };
    const prompt = buildSuggestionApplyPrompt(
      "revision-suggestion",
      s as never,
      buildCardAnchorPass(editor),
    );
    expect(prompt).toContain("paragraphs: P2");
    expect(prompt).not.toMatch(/P1|P3/);
  });
});

describe("task 1506 — census: the stored first pid is never read as the live anchor", () => {
  // `getLinkedTextObjectIds(card)[0]` / `textObjectIds[0]` read the card's
  // STORED record. That is right for a WRITER that edits the record and wrong
  // for a reader asking where the card IS. Each exemption below is a writer
  // (or a scope the writer's own recovery needs), named with its reason; any
  // other site asks `CardAnchorPass.anchorBlocksOf` (or `anchorPidsOf` for one
  // link). A new reader that spells the stored read fails here.
  const EXEMPT: Record<string, string> = {
    // Snapshot-describes-first bookkeeping inside the dormant-link rewrite.
    "src/links/dormant.ts": "writer: withAnchorIds keeps a snapshot only while it describes pid 0",
    // The reconcile writer's idempotence check on the link it is rewriting.
    "src/links/resolve-card-anchor.ts": "writer: reconcile rebind idempotence",
    // A new link's id is minted from the pid it is being created on.
    "src/links/links.ts": "writer: makeAnchorLink mints the link id from its birth pid",
    // Mark recovery scopes its text search to the birth paragraph (task 271).
    "src/links/_shared/reapply-mode-b-anchors.ts": "writer: reanchorByText scope",
  };
  const STORED_FIRST = /getLinkedTextObjectIds\([^)]*\)\s*\[\s*0\s*\]|textObjectIds\s*(?:\?\.)?\[\s*0\s*\]/;

  it("no reader outside the exempt writers spells the stored first pid", () => {
    const offenders: string[] = [];
    for (const abs of trackedFiles("src", /\.(ts|tsx)$/)) {
      const rel = abs.slice(REPO_ROOT.length + 1);
      if (/__tests__|\.test\.|\.d\.ts$/.test(rel)) continue;
      if (rel in EXEMPT) continue;
      const code = codeOnlyLines(readFileSync(abs, "utf8"));
      for (const hit of matchesWithLines(code, STORED_FIRST)) offenders.push(`${rel}:${hit.line}`);
    }
    expect(offenders).toEqual([]);
  });

  it("every exemption is still a real site (no stale excuse)", () => {
    for (const rel of Object.keys(EXEMPT)) {
      const code = codeOnlyLines(readFileSync(`${REPO_ROOT}/${rel}`, "utf8"));
      expect(matchesWithLines(code, STORED_FIRST).length, rel).toBeGreaterThan(0);
    }
  });
});

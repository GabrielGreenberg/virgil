// @vitest-environment jsdom
//
// TASK 758 — Search's card scopes read the ONE card-anchor authority.
//
// "Where is this card anchored?" is answered once, by `buildCardAnchorPass`
// (task 369's four-rung ladder: live uuid → surviving Mode-B mark → RC1
// self-heal → snapshot relocation), and the margin marker + omni card render
// from it. Search used to hand-roll three partial answers of its own — text
// anchor → bare uuid (notes/cuts/reports), bare uuid only (todos/archive),
// text anchor only (revisions) — so a paragraph-pinned revision, a
// snapshot-recovered archive clip and a Mode-B todo all had a margin marker
// while their search hit read "(unanchored)" and its click went nowhere.
//
// Every leg drives the REAL editor, the REAL authority and the REAL search
// functions, and asserts the hit agrees with `pass.resolve(card)`.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { buildCardAnchorPass } from "@/links/card-anchor-rows";
import type { CardWithLinks } from "@/links/links";
import type { Link } from "@/links/_shared/types";
import {
  searchArchive,
  searchComments,
  searchTodos,
  type SearchHit,
} from "@/lib/search-sources";
import { resolveAnchoredHighlight } from "@/panels/Search/SearchPanel";
import type { ArchivedSnippet, RevisionCard, TodoItem } from "@/lib/types";

const P1_TEXT = "The first paragraph.";
const P2_TEXT = "The second paragraph.";
const RE = /UNICORN/g;

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set() },
    host: null,
  };
}

/** Two paragraphs, live uuids `P1` / `P2`; optionally a live `linkedAnchor`
 *  mark carrying `markId` over P2's text. */
function mountDoc(markId?: string): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { uuid: "P1" },
          content: [{ type: "text", text: P1_TEXT }],
        },
        {
          type: "paragraph",
          attrs: { uuid: "P2" },
          content: [
            {
              type: "text",
              text: P2_TEXT,
              ...(markId
                ? { marks: [{ type: "linkedAnchor", attrs: { anchorId: markId } }] }
                : {}),
            },
          ],
        },
      ],
    },
  });
}

/** Mode-A paragraph link, optional text snapshot. */
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

/** Mode-B `linkedRange` link: a mark anchorId + stored paragraph ids. */
function rangeLink(anchorId: string, ...pids: string[]): Link {
  return {
    id: `link-${anchorId}`,
    kind: "anchor",
    anchor: {
      type: "textObject",
      targetKind: "linkedRange",
      textObjectIds: pids,
      textRange: { anchorId, textSnapshot: "" },
    },
    target: { type: "card", ref: { kind: "todo", id: "c1" } },
    createdAt: "2026-01-01T00:00:00.000Z",
  } as Link;
}

function livePos(editor: Editor, uuid: string): number {
  let at = -1;
  editor.state.doc.descendants((n, pos) => {
    if (at < 0 && n.attrs?.uuid === uuid) at = pos;
    return at < 0;
  });
  return at;
}

/** Every hit for `card` is anchored exactly where the authority says. */
function expectAgreesWithAuthority(
  hits: SearchHit[],
  editor: Editor,
  card: CardWithLinks,
  pid: string,
) {
  const res = buildCardAnchorPass(editor).resolve(card);
  expect(res.anchored).toBe(true);
  expect(res.rows[0].pid).toBe(pid);
  const mine = hits.filter((h) => h.itemId === card.id);
  expect(mine.length).toBeGreaterThan(0);
  for (const h of mine) {
    expect(h.unanchored).toBe(false);
    expect(h.from).toBe(res.rows[0].pos);
    expect(h.from).toBe(livePos(editor, pid));
    expect(h.blockId).toEqual({ blockUuid: pid, offset: 0, length: 0 });
  }
}

describe("task 758 — every card scope resolves through the card-anchor pass", () => {
  it("a revision pinned to a PARAGRAPH (Mode-A) is anchored, not '(unanchored)'", () => {
    const editor = mountDoc();
    const card = {
      id: "rev-1",
      kind: "comment",
      text: "UNICORN remark",
      links: [paraLink("P2")],
    } as unknown as RevisionCard;
    const pass = buildCardAnchorPass(editor);
    const hits = searchComments([card], pass.resolve, RE);
    expectAgreesWithAuthority(hits, editor, card, "P2");
    editor.destroy();
  });

  it("an archive clip whose uuid died but whose snapshot matches is anchored at the recovered paragraph", () => {
    const editor = mountDoc();
    const card: ArchivedSnippet = {
      id: "arc-1",
      title: "UNICORN clip",
      content: { type: "doc", content: [] },
      createdAt: "2026-01-01T00:00:00.000Z",
      links: [paraLink("DEAD", P2_TEXT)],
    };
    const pass = buildCardAnchorPass(editor);
    const hits = searchArchive([card], pass.resolve, RE);
    expectAgreesWithAuthority(hits, editor, card, "P2");
    editor.destroy();
  });

  it("a Mode-B (text-range) todo is anchored at its mark's paragraph", () => {
    const editor = mountDoc("mark-1");
    const card = {
      id: "todo-1",
      text: "UNICORN task",
      links: [rangeLink("mark-1", "DEAD")],
    } as unknown as TodoItem;
    const pass = buildCardAnchorPass(editor);
    const hits = searchTodos([card], pass.resolve, RE);
    expectAgreesWithAuthority(hits, editor, card, "P2");
    editor.destroy();
  });

  it("a card with no live anchor at all stays honestly unanchored", () => {
    const editor = mountDoc();
    const card = {
      id: "todo-2",
      text: "UNICORN orphan",
      links: [paraLink("DEAD")],
    } as unknown as TodoItem;
    const pass = buildCardAnchorPass(editor);
    const [hit] = searchTodos([card], pass.resolve, RE);
    expect(pass.resolve(card).anchored).toBe(false);
    expect(hit.unanchored).toBe(true);
    expect(hit.blockId).toBeUndefined();
    editor.destroy();
  });

  it("a card hit's click re-resolves LIVE — an edit in an earlier paragraph does not strand it", () => {
    const editor = mountDoc();
    const card = {
      id: "rev-2",
      kind: "comment",
      text: "UNICORN remark",
      links: [paraLink("P2")],
    } as unknown as RevisionCard;
    const [hit] = searchComments([card], buildCardAnchorPass(editor).resolve, RE);
    const baked = { from: hit.from, to: hit.to };

    // Type into P1 AFTER the search ran: P2 shifts right by the insert length.
    editor.commands.insertContentAt(2, "INSERTED ");
    const shifted = livePos(editor, "P2");
    expect(shifted).toBe(baked.from + "INSERTED ".length);

    const live = resolveAnchoredHighlight(editor, hit.blockId!, baked);
    expect(live).toEqual({ from: shifted + 1, to: shifted + 1 });
    editor.destroy();
  });
});

describe("census — search-sources cannot regrow its own anchor rule", () => {
  const SRC = join(__dirname, "../../..");
  const sources = readFileSync(join(SRC, "lib/search-sources.ts"), "utf8");
  const panel = readFileSync(join(SRC, "panels/Search/SearchPanel.tsx"), "utf8");

  it("search-sources reads no link helper and walks no doc for card positions", () => {
    for (const forbidden of [
      "getTextAnchor",
      "getLinkedTextObjectIds",
      "resolveAnchorRange",
      "descendants(",
      "buildUuidPosMap",
    ]) {
      expect(sources, forbidden).not.toContain(forbidden);
    }
  });

  it("the panel builds no uuid→pos map of its own", () => {
    expect(panel).not.toContain("buildUuidPosMap");
    expect(panel).not.toContain("UUID_POS_SCOPES");
  });
});

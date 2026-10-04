// @vitest-environment jsdom
//
// TASK 935 — **Jump lands where the anchor authority binds the card.**
//
// `jumpToCard` used to run `resolveLink`'s whole ladder PER LINK, in link
// order, and jump to the first link that resolved — while the marker, the omni
// row and the Jump gate bind to `resolveCardAnchor`'s winner, whose ladder
// checks live uuids across ALL links before any snapshot. And every
// multi-anchor omni row jumped to the card's first paragraph, because the act
// was handed the card, never the row. Every leg drives the REAL editor and the
// REAL authority.
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
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
import { jumpToCard, resolveCardJumpTarget } from "@/links/jump-to-card";
import type { CardWithLinks } from "@/links/links";
import type { Link } from "@/links/_shared/types";

const P1_TEXT = "The first paragraph.";

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

const scrolled: Element[] = [];
(Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView =
  function scrollIntoViewSpy(this: Element) {
    scrolled.push(this);
  };

const editors: Editor[] = [];
afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
  scrolled.length = 0;
});

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
        { type: "paragraph", attrs: { uuid: "P2" }, content: [{ type: "text", text: "Second." }] },
        { type: "paragraph", attrs: { uuid: "P3" }, content: [{ type: "text", text: "Third." }] },
      ],
    },
  });
  editors.push(editor);
  return editor;
}

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
    target: { type: "card", ref: { kind: "note", id: "c1" } },
    createdAt: "2026-01-01T00:00:00.000Z",
  } as Link;
}

function card(...links: Link[]): CardWithLinks {
  return { id: "c1", links } as unknown as CardWithLinks;
}

function paragraphDom(editor: Editor, index: number): Element {
  return editor.view.dom.children[index];
}

describe("task 935 — Jump takes the authority's winner, not the first link", () => {
  it("[L0 snapshot-only, L1 live uuid] jumps to L1's paragraph — where the marker is", () => {
    const editor = mountDoc();
    // L0's uuid is dead but its snapshot matches P1; L1 is live on P3. The
    // authority's uuid rung runs across ALL links before any snapshot, so the
    // card is anchored on P3 — and the margin draws its marker there.
    const c = card(paraLink("DEAD", P1_TEXT), paraLink("P3"));
    expect(buildCardAnchorPass(editor).resolve(c).rows[0]?.pid).toBe("P3");

    expect(resolveCardJumpTarget(editor, c)).toMatchObject({
      kind: "paragraph",
      paragraphId: "P3",
    });
    expect(jumpToCard(editor, c)).toBe(true);
    expect(scrolled).toEqual([paragraphDom(editor, 2)]);
  });

  it("a snapshot-only card still reaches its recovered paragraph (task 665 kept)", () => {
    const editor = mountDoc();
    const c = card(paraLink("DEAD", P1_TEXT));
    expect(jumpToCard(editor, c)).toBe(true);
    expect(scrolled).toEqual([paragraphDom(editor, 0)]);
  });

  it("an orphan card jumps nowhere", () => {
    const editor = mountDoc();
    expect(jumpToCard(editor, card(paraLink("GONE")))).toBe(false);
    expect(scrolled).toEqual([]);
  });
});

describe("task 935 — a multi-anchor omni row jumps to ITS OWN paragraph", () => {
  it("row 2 of a two-pid card targets pid 2", () => {
    const editor = mountDoc();
    const c = card(paraLink("P1"), paraLink("P2"));
    const rows = buildCardAnchorPass(editor).resolve(c).rows.map((r) => r.pid);
    expect(rows).toEqual(["P1", "P2"]);

    expect(jumpToCard(editor, c, null, rows[1])).toBe(true);
    expect(scrolled).toEqual([paragraphDom(editor, 1)]);
  });

  it("a row whose pid died since the row was built falls back to the authority", () => {
    const editor = mountDoc();
    const c = card(paraLink("P1"), paraLink("P2"));
    expect(resolveCardJumpTarget(editor, c, "GONE")).toMatchObject({
      kind: "paragraph",
      paragraphId: "P1",
    });
  });

  // Census: every paragraph-anchored omni builder hands its ROW's pid to the
  // jump. A builder that passes only the card regresses every `@<pid>` row to
  // the card-level target — the bug this task fixed, silently.
  it("every omni builder's jumpToCard call passes the row's pid", () => {
    const panelsDir = join(process.cwd(), "src/panels");
    const builders = readdirSync(panelsDir)
      .map((d) => join(panelsDir, d, "omni.tsx"))
      .filter((p) => existsSync(p))
      .map((p) => [p, readFileSync(p, "utf8")] as const)
      .filter(([, src]) => /\ba\.jumpToCard\(/.test(src));
    expect(builders.length).toBeGreaterThanOrEqual(6);
    for (const [path, src] of builders) {
      const calls = src.match(/\ba\.jumpToCard\([^)]*\)/g) ?? [];
      expect(calls.length, path).toBeGreaterThan(0);
      for (const call of calls) {
        expect(call, `${path}: ${call}`).toMatch(/row\.anchorUuid\)$/);
      }
    }
  });
});

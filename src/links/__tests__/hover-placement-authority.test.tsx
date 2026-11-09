// @vitest-environment jsdom
//
// TASK 1505 — **hover / selection paint and selection placement read the
// anchor authority's rows, never a second ladder.**
//
// The margin markers, the omni rows and Jump (task 935) all bind a card through
// `buildCardAnchorPass`. The hover/selection reconciler and `usePlacement` still
// walked each link through `resolveLink`'s own ladder — mark → each STORED pid
// → snapshot re-find — which (a) had no dormant rung, (b) read a Mode-B link's
// stored pids, a BIRTH RECORD (task 1328), once its mark died, and (c) matched
// any paragraph repeating a link's text. So a card with one live pid Py and one
// dead pid whose snapshot matched Px drew ONE marker (Py), lit Px AND Py on
// hover, and could scroll the document to Px on selection.
//
// Both now read the pass: `paintRows` (what the reconciler paints) and
// `resolveCardRowTargets` (what placement aligns among). `resolveLink` is gone;
// `resolveInlineAtomLink` locates inline atoms only. Every leg drives the REAL
// editor and the REAL authority.
import { describe, it, expect, vi, afterEach } from "vitest";
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
import { resolveCardRowTargets } from "@/links/jump-to-card";
import { resolveInlineAtomLink } from "@/links/links";
import type { CardWithLinks } from "@/links/links";
import type { Link } from "@/links/_shared/types";
import {
  commentsStripped,
  trackedFiles,
  REPO_ROOT,
} from "@/lib/__tests__/_source-scan";

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
        { type: "paragraph", attrs: { uuid: "P3" }, content: [{ type: "text", text: "Third." }] },
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
function rangeLink(birthPid: string, anchorId: string, snapshot = "marked words"): Link {
  return {
    id: `range-${anchorId}`,
    kind: "anchor",
    anchor: {
      type: "textObject",
      targetKind: "linkedRange",
      textObjectIds: [birthPid],
      textRange: { anchorId, textSnapshot: snapshot },
    },
    target: { type: "card", ref: { kind: "note", id: "c1" } },
    createdAt: "2026-01-01T00:00:00.000Z",
  } as Link;
}

function card(...links: Link[]): CardWithLinks {
  return { id: "c1", links } as unknown as CardWithLinks;
}

const paintPids = (editor: Editor, c: CardWithLinks) =>
  buildCardAnchorPass(editor).paintRows(c);

describe("task 1505 — hover/selection paint exactly the authority's rows", () => {
  it("[live Py, dead pid + snapshot matching Px] paints only Py — where the marker is", () => {
    const editor = mountDoc();
    const c = card(paraLink("DEAD", {}, P1_TEXT), paraLink("P3"));
    // The margin draws ONE marker, on P3.
    expect(buildCardAnchorPass(editor).resolve(c).rows.map((r) => r.pid)).toEqual(["P3"]);
    const rows = paintPids(editor, c);
    expect(rows.map((r) => r.pid)).toEqual(["P3"]);
    expect(rows[0]).toMatchObject({ rail: true, marks: [] });
  });

  it("placement aligns among the same rows — never to the snapshot-only Px", () => {
    const editor = mountDoc();
    const c = card(paraLink("DEAD", {}, P1_TEXT), paraLink("P3"));
    expect(resolveCardRowTargets(editor, c)).toEqual([
      expect.objectContaining({ kind: "paragraph", paragraphId: "P3" }),
    ]);
  });

  it("a Mode-B link with a LIVE mark washes the mark, never rails its birth paragraph", () => {
    const editor = mountDoc();
    // Born in P1 (the stored pid), but its mark now lives in P2.
    const c = card(rangeLink("P1", "a1"));
    const rows = paintPids(editor, c);
    expect(rows).toEqual([
      expect.objectContaining({ pid: "P2", rail: false, marks: ["a1"] }),
    ]);
    expect(resolveCardRowTargets(editor, c)).toEqual([{ kind: "mark", anchorId: "a1" }]);
  });

  it("a Mode-B link whose mark DIED is painted where `anchorPidsOfLink` binds it", () => {
    const editor = mountDoc();
    const c = card(rangeLink("P3", "gone"));
    const pass = buildCardAnchorPass(editor);
    expect(pass.anchorPidsOf(c.links![0])).toEqual(["P3"]);
    expect(pass.paintRows(c)).toEqual([
      expect.objectContaining({ pid: "P3", rail: true, marks: [] }),
    ]);
  });

  it("a DORMANT link paints nothing, even where its snapshot repeats", () => {
    const editor = mountDoc();
    // Dormant (its words are in an archive snippet) — and its snapshot is P1's
    // text, which the old ladder's snapshot rung re-found and lit.
    const dormant = paraLink("DEAD", { archivedWith: "snip-1" } as Partial<Link>, P1_TEXT);
    expect(paintPids(editor, card(dormant))).toEqual([]);
    // Partly dormant: only the live link's row paints.
    const rows = paintPids(editor, card(dormant, paraLink("P3")));
    expect(rows.map((r) => r.pid)).toEqual(["P3"]);
  });

  it("CONTROL — a multi-anchor Mode-A card paints every live row", () => {
    const editor = mountDoc();
    const rows = paintPids(editor, card(paraLink("P1"), paraLink("P3")));
    expect(rows.map((r) => [r.pid, r.rail])).toEqual([
      ["P1", true],
      ["P3", true],
    ]);
  });

  it("an inline-atom-only card has no rows; placement falls back to the atom", () => {
    const editor = mountDoc();
    const atom = {
      id: "fn-missing",
      kind: "footnote",
      anchor: { type: "inline-atom", nodeName: "footnote", pos: null },
      target: { type: "card", ref: { kind: "footnote", id: "fn-missing" } },
      createdAt: "",
    } as Link;
    expect(paintPids(editor, card(atom))).toEqual([]);
    // Not in the doc → no target at all (the atom door found nothing).
    expect(resolveCardRowTargets(editor, card(atom))).toEqual([]);
    // And the atom door refuses a paragraph link outright.
    expect(resolveInlineAtomLink(editor, paraLink("P1"))).toBeNull();
  });
});

describe("task 1505 CENSUS — no second card-anchor ladder", () => {
  const src = (rel: string) => commentsStripped(readFileSync(join(REPO_ROOT, rel), "utf8"));

  it("`resolveLink` is gone from shipped src/ (the atom door is `resolveInlineAtomLink`)", () => {
    const offenders: string[] = [];
    for (const abs of trackedFiles("src", /\.(ts|tsx)$/)) {
      if (abs.includes("__tests__")) continue;
      if (/\bresolveLink\b|\bjumpToLink\b/.test(commentsStripped(readFileSync(abs, "utf8")))) {
        offenders.push(abs);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the atom door is asked only by the act / paint modules, each behind an inline-atom guard", () => {
    const callers: string[] = [];
    for (const abs of trackedFiles("src", /\.(ts|tsx)$/)) {
      if (abs.includes("__tests__") || abs.endsWith("src/links/links.ts")) continue;
      if (/\bresolveInlineAtomLink\(/.test(commentsStripped(readFileSync(abs, "utf8")))) {
        callers.push(abs.slice(REPO_ROOT.length + 1));
      }
    }
    expect(callers.sort()).toEqual([
      "src/links/_shared/useAnchorHighlightReconciler.ts",
      "src/links/jump-to-card.ts",
    ]);
  });

  it("the reconciler paints `paintRows`; placement aligns among `resolveCardRowTargets`", () => {
    expect(src("src/links/_shared/useAnchorHighlightReconciler.ts")).toMatch(/\.paintRows\(/);
    expect(src("src/links/_shared/usePlacement.ts")).toMatch(/resolveCardRowTargets\(/);
  });
});

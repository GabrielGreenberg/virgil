// @vitest-environment jsdom
//
// CHIP 7 — the end-to-end BUG1 proof: a linkedAnchor's KIND survives the
// `.tex` round-trip via the sidecar-authoritative reconcile.
//
// This is the test the diagnosis flagged as the blind spot (DIAGNOSIS.md §7):
// "no test combines parseLatex + applyLinkedAnchors + the present-skip; the
// existing RC-B tests mount a mark-FREE doc, so the collision is never
// exercised." It drives the FULL real pipeline — serialize → parse → load into
// a real `new Editor` → reconcile — so it pins the WHOLE corruption chain, not
// a hand-mocked slice of it:
//
//   1. A run carrying a non-note `linkedAnchor` (kind:"revision" / todo /
//      cutter-comment / report / highlight) serializes to a BARE
//      `\vlid{id}…\vlidend{id}` pair — the serializer drops kind/linkCard/
//      tintColor (no "revision"/"comment" token on disk).
//   2. `parseLatex` RESURRECTS every `\vlid` pair as a HARDCODED `kind:"note"`
//      mark (`applyLinkedAnchorBoundaries`) — the BUG1 corruption, asserted as a
//      PRECONDITION so the round-trip provably exercises it.
//   3. `applyLinkedAnchorsImpl` (the ONE shared impl, also used by Editor.tsx's
//      handle) RECONCILES the present mark in place from the sidecar record:
//      kind / linkCard token / tintColor restored authoritatively, range + text
//      unchanged, no duplicate mark.
//
// We do the FULL serialize→parse round-trip (not the planted-note fallback):
// the probe in development confirmed the serializer emits a bare `\vlid` and the
// parser stamps `kind:"note"` in jsdom with no doc-bundle needed (the serializer
// is a pure JSON→string transform; the parser a pure string→JSON one). The
// fallback would only have been needed if serialize required a full doc bundle —
// it does not.
//
// The `vi.mock("@/lib/storage", …)` block is required because the editor
// extension barrel (`buildEditorExtensions`) transitively imports `@/lib/storage`
// (whose `require("@/...")` aliasing vitest can't resolve). Copied from
// `reapply-mode-b-anchors.test.ts`.
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRead = vi.fn();
const mockWrite = vi.fn();

vi.mock("@/lib/storage", () => {
  const STORAGE_FNS = [
    "readSidecar", "readSidecarIfExists", "writeSidecar", "readTex", "writeTex",
    "readDocBundle", "writeDocBundle", "readBib", "writeBib",
    "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
    "registerDocInFolder", "openExistingDocFromPicker", "listDocs", "renameDoc",
    "deleteDocFromIndex", "flushDoc", "drainDoc", "detectBibPackage",
    "readPaperFolder", "getTexFilename", "writePdf", "readPdf", "getPdfFilename",
    "pdfFilenameFromTex", "readFigureSource", "readFigureRaster",
    "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  const mod: Record<string, unknown> = { isDevStorage: false };
  for (const name of STORAGE_FNS) mod[name] = vi.fn();
  mod.readSidecar = (...a: unknown[]) => mockRead(...a);
  mod.readSidecarIfExists = (...a: unknown[]) => mockRead(...a);
  mod.writeSidecar = (...a: unknown[]) => mockWrite(...a);
  return mod;
});

import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { parseLatex } from "@/lib/latex-parser";
import { serializeBodyOnly } from "@/lib/latex-serializer";
import { applyLinkedAnchorsImpl } from "../apply-linked-anchors";
import type { ModeBReapplyRecord } from "../reapply-mode-b-anchors";
import { collectLinksFromEditor, type LinkedAnchorKind } from "@/links/links";
import { linkedAnchorRenderAttrs } from "@/lib/tiptap/linked-anchor-attrs";
import { defaultTintForLinkedAnchorKind } from "@/cards/legacy-token-crosswalk";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
}

/** Load a parsed doc JSON into a REAL main-editor extension stack, so marks /
 *  schema behave exactly as in prod. */
function mountParsed(parsed: JSONContent): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: parsed,
  });
}

/** The `linkedAnchor` mark attrs at the given anchorId (or null). */
function markAttrsFor(
  editor: Editor,
  anchorId: string,
): Record<string, unknown> | null {
  let attrs: Record<string, unknown> | null = null;
  editor.state.doc.descendants((node) => {
    if (attrs) return false;
    if (!node.isText) return true;
    for (const m of node.marks) {
      if (m.type.name === "linkedAnchor" && m.attrs.anchorId === anchorId) {
        attrs = m.attrs as Record<string, unknown>;
        return false;
      }
    }
    return true;
  });
  return attrs;
}

/** The text spanned by the linkedAnchor mark with the given anchorId. */
function markedTextFor(editor: Editor, anchorId: string): string {
  let out = "";
  editor.state.doc.descendants((node) => {
    if (
      node.isText &&
      node.marks.some(
        (m) => m.type.name === "linkedAnchor" && m.attrs.anchorId === anchorId,
      )
    ) {
      out += node.text ?? "";
    }
    return true;
  });
  return out;
}

/** How many distinct runs carry the linkedAnchor mark for the given anchorId
 *  (a re-stamp in place must NOT create a second, duplicate mark run). */
function markRunCountFor(editor: Editor, anchorId: string): number {
  let n = 0;
  editor.state.doc.descendants((node) => {
    if (
      node.isText &&
      node.marks.some(
        (m) => m.type.name === "linkedAnchor" && m.attrs.anchorId === anchorId,
      )
    ) {
      n += 1;
    }
    return true;
  });
  return n;
}

/**
 * Build a one-paragraph doc whose middle run carries a `linkedAnchor` of `kind`
 * over `span`, serialize it to body LaTeX, then parse it back. Returns the
 * parsed JSON + the emitted `.tex` so a test can assert the on-disk shape.
 *
 * The doc carries a `linkCard`/`tintColor` on the mark BEFORE serialize to
 * prove the serializer drops them (the on-disk `.tex` must be a bare `\vlid`).
 */
function serializeThenParse(
  kind: string,
  anchorId: string,
  span: string,
  opts?: { linkCard?: string; tintColor?: string },
): { parsed: JSONContent; tex: string } {
  const doc: JSONContent = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { uuid: "p001" },
        content: [
          { type: "text", text: "before " },
          {
            type: "text",
            text: span,
            marks: [
              {
                type: "linkedAnchor",
                attrs: {
                  anchorId,
                  kind,
                  linkId: anchorId,
                  linkKind: "anchor",
                  ...(opts?.linkCard ? { linkCard: opts.linkCard } : {}),
                  ...(opts?.tintColor ? { tintColor: opts.tintColor } : {}),
                },
              },
            ],
          },
          { type: "text", text: " after" },
        ],
      },
    ],
  };
  const tex = serializeBodyOnly(doc);
  const wrapped = `\\documentclass{article}\\begin{document}\n${tex}\n\\end{document}`;
  return { parsed: parseLatex(wrapped), tex };
}

beforeEach(() => {
  mockRead.mockReset();
  mockWrite.mockReset();
  mockWrite.mockResolvedValue(undefined);
});

// ===========================================================================
// BUG1 headline — a REVISION anchor survives the .tex round-trip
// ===========================================================================

describe("BUG1 — linkedAnchor KIND survives the serialize → parse → reconcile round-trip", () => {
  it("a revision anchor reloads as note (corruption) then reconciles back to revision (purple, not green)", () => {
    // --- serialize: the .tex drops kind/linkCard/tintColor → a bare \vlid. ---
    const { parsed, tex } = serializeThenParse("revision", "rev1", "the span", {
      linkCard: "comment:c1",
    });
    expect(tex).toContain("\\vlid{rev1}the span\\vlidend{rev1}");
    // The serializer has NO linkedAnchor case — the kind/card token is gone.
    expect(tex).not.toContain("revision");
    expect(tex).not.toContain("comment");

    // --- parse + load into a real editor: BUG1 corruption is now present. ---
    const editor = mountParsed(parsed);
    // PRECONDITION: the parser resurrected the span as a hardcoded note mark.
    expect(markAttrsFor(editor, "rev1")?.kind).toBe("note");
    expect(markedTextFor(editor, "rev1")).toBe("the span");

    // --- reconcile from the sidecar record (the BUG1 fix). ---
    const record: ModeBReapplyRecord = {
      anchorId: "rev1",
      kind: "revision",
      text: "the span",
      cardId: "c1",
      tintColor: null,
      paragraphId: "p001",
    };
    applyLinkedAnchorsImpl(editor, [record]);

    // POST-FIX: the mark is authoritatively a revision; range + text unchanged;
    // re-stamped IN PLACE (exactly one run, no duplicate mark).
    const attrs = markAttrsFor(editor, "rev1");
    expect(attrs?.kind).toBe("revision");
    expect(markedTextFor(editor, "rev1")).toBe("the span");
    expect(markRunCountFor(editor, "rev1")).toBe(1);
    // `linkCard` is PRESERVED empty (the reconcile re-stamps kind + tint only, and
    // never synthesizes the `<token>:<id>` linkCard — see the apply-linked-anchors
    // linkCard-policy note; a derived `comment:<id>` would parse to the non-spine
    // kind "comment" and break delete-range/bindAnchor for revisions).
    expect(attrs?.linkCard ?? "").toBe("");
    // The render layer derives the revision (purple) token from the KIND fallback,
    // NOT the note (green) token — the user-visible half of the BUG1 fix. The spine
    // `revision-comment:` prefix is exactly what the CSS
    // `[data-link-card^="revision-comment:"]` purple rule matches (unified with
    // updateLinkedAnchorCard; `comment:` is kept only as a legacy CSS alias).
    expect(linkedAnchorRenderAttrs(attrs ?? {})["data-link-card"]).toBe(
      "revision-comment:",
    );
    editor.destroy();
  });

  // -----------------------------------------------------------------------
  // Parametrized: every non-note Mode-B kind degrades identically on reload
  // (parser default `note` wins) and reconciles back to its own token.
  // Tokens verified against legacy-token-crosswalk.ts /
  // legacyKindToCardKindString:
  //   revision        → "revision-comment" (the spine legacyDataKind; CSS keys on
  //                                          [data-link-card^="revision-comment:"],
  //                                          "comment:" kept as a legacy alias)
  //   todo            → "todo"
  //   cutter-comment  → "cutter-comment"   (NOT "cut" — that's the cssToken)
  //   report          → "report"
  //   highlight       → "highlight" + the kind-derived tintColor restored
  // -----------------------------------------------------------------------
  const KIND_TOKEN_CASES: Array<{
    kind: LinkedAnchorKind;
    anchorId: string;
    span: string;
    token: string;
  }> = [
    { kind: "revision", anchorId: "rev2", span: "rev text", token: "revision-comment" },
    { kind: "todo", anchorId: "td1", span: "todo text", token: "todo" },
    {
      kind: "cutter-comment",
      anchorId: "cut1",
      span: "cut text",
      token: "cutter-comment",
    },
    { kind: "report", anchorId: "rep1", span: "report text", token: "report" },
  ];

  it.each(KIND_TOKEN_CASES)(
    "$kind reloads as note then reconciles to data-link-card $token: (kind-fallback)",
    ({ kind, anchorId, span, token }) => {
      const { parsed } = serializeThenParse(kind, anchorId, span);
      const editor = mountParsed(parsed);
      // PRECONDITION: corrupted to a note mark by the parser default.
      expect(markAttrsFor(editor, anchorId)?.kind).toBe("note");

      applyLinkedAnchorsImpl(editor, [
        {
          anchorId,
          kind,
          text: span,
          cardId: "cardX",
          tintColor: null,
          paragraphId: "p001",
        },
      ]);

      const attrs = markAttrsFor(editor, anchorId);
      // The mark's stored `kind` is the legacy mark-attr namespace (revision,
      // todo, cutter-comment, report) — NOT the spine card kind.
      expect(attrs?.kind).toBe(kind);
      expect(markedTextFor(editor, anchorId)).toBe(span);
      expect(markRunCountFor(editor, anchorId)).toBe(1);
      // `linkCard` preserved empty (policy: re-stamp kind + tint only).
      expect(attrs?.linkCard ?? "").toBe("");
      // The render token is the per-kind data-link-card prefix the CSS reads,
      // derived from the KIND fallback (no cardId since linkCard is empty).
      expect(linkedAnchorRenderAttrs(attrs ?? {})["data-link-card"]).toBe(
        `${token}:`,
      );
      editor.destroy();
    },
  );

  it("a reloaded revision (linkCard empty) resolves to the SPINE kind for consumers", () => {
    // Finding A regression guard. An earlier version stamped `comment:<id>` as the
    // linkCard; `parseLinkCardKey` slices that to the NON-spine kind "comment" →
    // `lifecycle.get("comment")` is undefined → a block delete silently fails to
    // remove the revision card, and `collectLinksFromEditor` mints an invalid kind.
    // With linkCard preserved EMPTY, the KIND fallback (`legacyAnchorKindToCardKind`)
    // yields the correct spine kind "revision-comment".
    const { parsed } = serializeThenParse("revision", "revC", "consumer span");
    const editor = mountParsed(parsed);
    applyLinkedAnchorsImpl(editor, [
      {
        anchorId: "revC",
        kind: "revision",
        text: "consumer span",
        cardId: "cardZ",
        tintColor: null,
      },
    ]);
    const link = collectLinksFromEditor(editor).find(
      (l) =>
        l.anchor.type === "textObject" &&
        l.anchor.textRange?.anchorId === "revC",
    );
    expect(link).toBeDefined();
    expect(link?.target.ref.kind).toBe("revision-comment"); // NOT the invalid "comment"
    editor.destroy();
  });

  it("a highlight reloads without its tint then reconciles the accent band back", () => {
    // The serializer drops `data-tint-color`, so the reload mark carries no
    // tint. The fix reconstructs it from the KIND (defaultTintForLinkedAnchorKind),
    // making reload byte-faithful to create — read from the SSOT rather than a
    // literal, since task 174 the value is a theme-derived sentinel.
    const { parsed } = serializeThenParse("highlight", "hl1", "shiny span", {
      tintColor: defaultTintForLinkedAnchorKind("highlight")!,
    });
    const editor = mountParsed(parsed);
    // PRECONDITION: parser default note, and no tint survived the round-trip.
    expect(markAttrsFor(editor, "hl1")?.kind).toBe("note");
    expect(markAttrsFor(editor, "hl1")?.tintColor ?? null).toBe(null);

    applyLinkedAnchorsImpl(editor, [
      {
        anchorId: "hl1",
        kind: "highlight",
        text: "shiny span",
        cardId: "hcard",
        // The reload record's tint is the kind-derived default (the load pass
        // routes it through defaultTintForLinkedAnchorKind).
        tintColor: defaultTintForLinkedAnchorKind("highlight"),
        paragraphId: "p001",
      },
    ]);

    const attrs = markAttrsFor(editor, "hl1");
    expect(attrs?.kind).toBe("highlight");
    expect(attrs?.tintColor).toBe(defaultTintForLinkedAnchorKind("highlight"));
    expect(markedTextFor(editor, "hl1")).toBe("shiny span");
    expect(markRunCountFor(editor, "hl1")).toBe(1);
    editor.destroy();
  });
});

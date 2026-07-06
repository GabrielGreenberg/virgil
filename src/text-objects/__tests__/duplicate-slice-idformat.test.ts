// @vitest-environment jsdom
//
// Task 064 — Duplicate must mint a 4-hex SHORT id for every TextObject kind.
//
// The bug: `mintUuidForKind` discriminated on `meta.sourceMarker?.idLength === 4`,
// but only exampleBlock/exampleItem/linkedRange declare a `sourceMarker`. Every
// other kind (paragraph/heading/list/blockquote/code/displayMath/figure/graphic/
// listItem/latexComment) fell to the `else` and got a 36-char `crypto.randomUUID()`.
// That id cannot round-trip through the 4-hex-only ` %!v:xxxx` anchor: on save it
// serializes untruncated, and on reload `stripUuidAnchor` FAILS to match (the char
// after the first 4 hex is more hex, so the `%!v:[0-9a-f]{4}` group can't repeat to
// the anchored `$`) — so the raw `%!v:<uuid>` string is absorbed as visible block
// text AND the clone loses its identity.
//
// Three contracts pinned here:
//   A. INVARIANT PIN — `mintUuidForKind` yields a 4-hex short id for EVERY kind in
//      TEXT_OBJECT_REGISTRY (a future kind that wrongly needs a long id fails loudly).
//   B. LIVE DUPLICATE — a real `duplicateSlice` + insert gives the clone a 4-hex uuid
//      (not the 36-char v4 form) for every duplicable `%!v:`-anchored kind.
//   C. ROUND-TRIP NO-LEAK — serialize→parse a duplicated block: the tex carries no v4
//      uuid, the reparsed clone RETAINS its id, and no `%!v:` literal leaks into text.
//
// (Storage stub guards the extension-barrel/@/lib/storage gotcha — the figure/
// graphics/tex NodeViews transitively import @/lib/storage.)
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
  return mod;
});

import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  duplicateSlice,
  mintUuidForKind,
  createDuplicateDiagnostics,
} from "@/text-objects/duplicate-slice";
import { TEXT_OBJECT_REGISTRY } from "@/text-objects/text-object-registry";
import type { CardLifecycleApi } from "@/panels/card-lifecycle-registry";
import { serializeBodyOnly } from "@/lib/latex-serializer";
import { parseLatex } from "@/lib/latex-parser";

const SHORT_ID = /^[0-9a-f]{4}$/;
// A v4 uuid signature (8-4 hex with a dash) — the shape the bug leaked.
const V4_UUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-/;

// ---------------------------------------------------------------------------
// Real editor stack (mirrors chip8-lifecycle-perkind.test.ts)
// ---------------------------------------------------------------------------

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

const mounted: Editor[] = [];
function mountDoc(content: JSONContent[]): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: { type: "doc", content },
  });
  mounted.push(editor);
  return editor;
}

const ZERO_RECT = {
  top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0,
  toJSON: () => ({}),
} as DOMRect;
function installLayoutShims(): void {
  const emptyList = Object.assign([], { item: () => null }) as unknown as DOMRectList;
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => emptyList;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => ZERO_RECT;
  if (!Element.prototype.getClientRects) Element.prototype.getClientRects = () => emptyList;
}

beforeEach(() => installLayoutShims());
afterEach(() => {
  while (mounted.length) mounted.pop()?.destroy();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const NOOP_LIFECYCLE = {
  get() {
    return { clone: () => null, delete: () => {}, bindAnchor() {} };
  },
} as CardLifecycleApi;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function locateByUuid(editor: Editor, uuid: string): { pos: number; size: number } | null {
  let out: { pos: number; size: number } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (out) return false;
    if ((node.attrs?.uuid as string | undefined) === uuid) {
      out = { pos, size: node.nodeSize };
      return false;
    }
    return true;
  });
  return out;
}

function uuidsOfType(editor: Editor, typeName: string): string[] {
  const out: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === typeName) {
      const u = node.attrs?.uuid;
      if (typeof u === "string" && u.length > 0) out.push(u);
    }
    return true;
  });
  return out;
}

/** Duplicate the block carrying `uuid` (mirrors the dispatcher's "duplicate"
 *  case: slice(outer) → duplicateSlice → tr.replace(outer.to, ...) → check). */
function duplicateBlock(editor: Editor, uuid: string): void {
  const loc = locateByUuid(editor, uuid)!;
  const outer = { from: loc.pos, to: loc.pos + loc.size };
  const slice = editor.state.doc.slice(outer.from, outer.to);
  const cloned = duplicateSlice(slice, NOOP_LIFECYCLE, createDuplicateDiagnostics());
  const tr = editor.state.tr.replace(outer.to, outer.to, cloned);
  tr.doc.check();
  editor.view.dispatch(tr);
}

/** Collect the text of every text node in a parsed JSONContent doc. */
function allText(doc: JSONContent): string[] {
  const out: string[] = [];
  const walk = (n: JSONContent) => {
    if (n.type === "text" && typeof n.text === "string") out.push(n.text);
    n.content?.forEach(walk);
  };
  walk(doc);
  return out;
}

function uuidsOfTypeJSON(doc: JSONContent, typeName: string): string[] {
  const out: string[] = [];
  const walk = (n: JSONContent) => {
    if (n.type === typeName && typeof n.attrs?.uuid === "string" && n.attrs.uuid.length > 0) {
      out.push(n.attrs.uuid as string);
    }
    n.content?.forEach(walk);
  };
  walk(doc);
  return out;
}

function parseBody(input: string): JSONContent {
  return parseLatex(`\\documentclass{article}\\begin{document}\n${input}\n\\end{document}`);
}

// ---------------------------------------------------------------------------
// A. INVARIANT PIN — every registry kind mints a 4-hex short id.
// ---------------------------------------------------------------------------

describe("mintUuidForKind — every TextObject kind mints a 4-hex short id", () => {
  for (const kind of Object.keys(TEXT_OBJECT_REGISTRY)) {
    it(`${kind} → 4-hex short id (never a 36-char v4 uuid)`, () => {
      const id = mintUuidForKind(kind);
      expect(id).toMatch(SHORT_ID);
      expect(id).not.toMatch(V4_UUID_ANYWHERE);
    });
  }

  it("a NON-TextObject kind keeps the defensive entity-id branch", () => {
    // The sole caller guards on isTextObjectKind, so this branch is defensive;
    // pin it so a refactor can't silently change the non-TO contract.
    expect(mintUuidForKind("someRandomNonTextObjectNode")).toMatch(V4_UUID_ANYWHERE);
  });
});

// ---------------------------------------------------------------------------
// B. LIVE DUPLICATE — the clone's uuid is 4-hex for every duplicable kind.
// ---------------------------------------------------------------------------

// Top-level block builders + the text-object kind whose clone uuid we inspect.
// `checkKind` differs from the mounted block for bulletList (we inspect the
// reminted listItem inside it).
const LIVE_CASES: Array<{
  kind: string;
  checkKind: string;
  json: (uuid: string) => JSONContent;
}> = [
  {
    kind: "paragraph",
    checkKind: "paragraph",
    json: (uuid) => ({ type: "paragraph", attrs: { uuid }, content: [{ type: "text", text: "dup me" }] }),
  },
  {
    kind: "heading",
    checkKind: "heading",
    json: (uuid) => ({ type: "heading", attrs: { level: 2, uuid }, content: [{ type: "text", text: "Head" }] }),
  },
  {
    kind: "blockquote",
    checkKind: "blockquote",
    json: (uuid) => ({
      type: "blockquote",
      attrs: { uuid },
      content: [{ type: "paragraph", attrs: { uuid: "aa11" }, content: [{ type: "text", text: "quoted" }] }],
    }),
  },
  {
    kind: "codeBlock",
    checkKind: "codeBlock",
    json: (uuid) => ({ type: "codeBlock", attrs: { uuid }, content: [{ type: "text", text: "x = 1" }] }),
  },
  {
    kind: "displayMath",
    checkKind: "displayMath",
    json: (uuid) => ({ type: "displayMath", attrs: { uuid, latex: "x^2 + y^2" } }),
  },
  {
    kind: "graphicsBlock",
    checkKind: "graphicsBlock",
    json: (uuid) => ({
      type: "graphicsBlock",
      attrs: { uuid, command: "\\includegraphics[width=0.5\\textwidth]{plot.png}", source: "plot.png", widthPercent: 50 },
    }),
  },
  {
    kind: "figureBlock",
    checkKind: "figureBlock",
    json: (uuid) => ({
      type: "figureBlock",
      attrs: { uuid, extras: "\\centering", label: "fig:dup" },
      content: [{ type: "figureCaption", content: [{ type: "text", text: "cap" }] }],
    }),
  },
  {
    kind: "latexComment",
    checkKind: "latexComment",
    json: (uuid) => ({ type: "latexComment", attrs: { uuid }, content: [{ type: "text", text: "a comment" }] }),
  },
  {
    kind: "bulletList",
    checkKind: "listItem",
    json: (uuid) => ({
      type: "bulletList",
      attrs: { uuid },
      content: [
        {
          type: "listItem",
          attrs: { uuid: "bb22" },
          content: [{ type: "paragraph", attrs: { uuid: "cc33" }, content: [{ type: "text", text: "item" }] }],
        },
      ],
    }),
  },
];

describe("duplicate — the clone's uuid is a 4-hex short id (never a 36-char v4)", () => {
  for (const { kind, checkKind, json } of LIVE_CASES) {
    it(`${kind}: reminted ${checkKind} uuid matches /^[0-9a-f]{4}$/`, () => {
      const SRC = "a1b2"; // a valid 4-hex source id
      const editor = mountDoc([
        json(SRC),
        { type: "paragraph", attrs: { uuid: "ffff" }, content: [{ type: "text", text: "after." }] },
      ]);
      const before = uuidsOfType(editor, checkKind);
      duplicateBlock(editor, SRC);
      const after = uuidsOfType(editor, checkKind);
      const fresh = after.filter((u) => !before.includes(u));
      expect(fresh.length).toBeGreaterThanOrEqual(1);
      for (const id of fresh) {
        expect(id).toMatch(SHORT_ID);
        expect(id).not.toMatch(V4_UUID_ANYWHERE);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// C. ROUND-TRIP NO-LEAK — serialize→parse a duplicated block: no v4 in the tex,
// the clone RETAINS its id, and no `%!v:` literal leaks into text.
// ---------------------------------------------------------------------------

// `%!v:`-anchored kinds that serialize + parse cleanly through the body path.
const ROUNDTRIP_CASES: Array<{ kind: string; checkKind: string; json: (uuid: string) => JSONContent }> =
  LIVE_CASES.filter((c) =>
    ["paragraph", "heading", "blockquote", "codeBlock", "displayMath", "latexComment", "bulletList"].includes(c.kind),
  );

describe("duplicate → save → reload: the clone survives and no marker leaks", () => {
  for (const { kind, checkKind, json } of ROUNDTRIP_CASES) {
    it(`${kind}: clone retains its 4-hex id and leaks no %!v: into text`, () => {
      const SRC = "a1b2";
      const editor = mountDoc([
        json(SRC),
        { type: "paragraph", attrs: { uuid: "ffff" }, content: [{ type: "text", text: "after." }] },
      ]);
      duplicateBlock(editor, SRC);

      // Serialize the live doc to LaTeX. Pre-fix, the clone would emit
      // ` %!v:<36-char-uuid>` — the v4 signature must be absent post-fix.
      const tex = serializeBodyOnly(editor.getJSON());
      expect(tex).not.toMatch(V4_UUID_ANYWHERE);

      // Reload: parse the tex back. The reparsed clone must retain a 4-hex id,
      // and NO text node may contain a literal `%!v:` marker.
      const reparsed = parseBody(tex);
      const ids = uuidsOfTypeJSON(reparsed, checkKind);
      // Two of `checkKind` now: the source + the clone, both 4-hex, both distinct.
      expect(ids.length).toBeGreaterThanOrEqual(2);
      for (const id of ids) expect(id).toMatch(SHORT_ID);
      expect(new Set(ids).size).toBe(ids.length);

      for (const t of allText(reparsed)) {
        expect(t).not.toContain("%!v:");
      }
    });
  }
});

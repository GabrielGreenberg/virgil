// @vitest-environment jsdom
/**
 * Wave-2 C2 — the breadcrumb derivation: ONE hit-test + binary search over
 * the structure snapshot, replacing the per-RAF coordsAtPos walk.
 *
 * The editor is REAL (full main extension set, so the DocStructureObserver
 * maintains the snapshot the derivation reads); the VIEW is a stub — jsdom
 * has no layout, so `posAtCoords` / the rect reads are the controlled
 * inputs, which also makes the doc-position ↔ reference-line mapping exact
 * in each case. Pins:
 *
 *  - the heading chain is the enclosing hierarchy at the reference position
 *    (previous-smaller-level semantics — the walk's pop/push, inverted);
 *  - text/sectionNumber come from the LIVE node (heading text edits are
 *    content-only and never refresh the index entry);
 *  - parTitleIndex is the last titled block before the line, RESET by a
 *    crossed heading; a parTitle FLIP (the S1 bus extension) re-derives the
 *    vocabulary via the version-keyed cache;
 *  - a locked-focus band skips out-of-band headings;
 *  - plain typing (position shift, no structural change) keeps the cached
 *    vocabulary valid because probes read positions from the materialized
 *    snapshot, not the cache.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/storage", () => {
  const noop = () => undefined;
  return new Proxy(
    {},
    {
      get: (_t, prop) =>
        prop === "__esModule" ? true : prop === "then" ? undefined : noop,
    },
  );
});

import { Editor } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { computeSectionPathAt } from "../section-path";

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
  };
}

function makeEditor(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: [
        { type: "heading", attrs: { uuid: "h1", level: 1, sectionNumber: "1" }, content: [{ type: "text", text: "Alpha" }] },
        { type: "paragraph", attrs: { uuid: "p1" }, content: [{ type: "text", text: "one" }] },
        { type: "heading", attrs: { uuid: "h2", level: 2, sectionNumber: "1.1" }, content: [{ type: "text", text: "Beta" }] },
        { type: "paragraph", attrs: { uuid: "p2", parTitle: "Titled" }, content: [{ type: "text", text: "two" }] },
        { type: "paragraph", attrs: { uuid: "p3" }, content: [{ type: "text", text: "three" }] },
      ],
    },
  });
}

/** A stub pane view over the real state: `posAtCoords` returns the test's
 *  chosen position; the rects make referenceY land inside the content box. */
function stubView(editor: Editor, atPos: () => number): EditorView {
  return {
    // LIVE state read — a captured snapshot would desync from dispatches.
    get state() {
      return editor.state;
    },
    dom: {
      getBoundingClientRect: () =>
        ({ top: 0, left: 0, right: 800, bottom: 2000, width: 800, height: 2000 }) as DOMRect,
    },
    posAtCoords: () => ({ pos: atPos(), inside: atPos() }),
  } as unknown as EditorView;
}

function stubScrollEl(): Element {
  return {
    getBoundingClientRect: () =>
      ({ top: 0, left: 0, right: 800, bottom: 600, width: 800, height: 600 }) as DOMRect,
    scrollHeight: 2000,
    clientHeight: 600,
    scrollTop: 100,
  } as unknown as Element;
}

/** Top-level start pos of the i-th child. */
function blockPos(editor: Editor, i: number): number {
  let pos = 0;
  for (let k = 0; k < i; k++) pos += editor.state.doc.child(k).nodeSize;
  return pos;
}

let editor: Editor;

beforeEach(() => {
  editor = makeEditor();
});

afterEach(() => {
  editor.destroy();
});

describe("computeSectionPathAt", () => {
  it("derives the enclosing heading chain + par-title at the reference position", () => {
    // Line inside p3 (index 4): chain = Alpha > Beta, parTitle = p2 (index 3).
    const p = blockPos(editor, 4) + 1;
    const result = computeSectionPathAt(editor, stubView(editor, () => p), stubScrollEl(), null);
    expect(result).not.toBeNull();
    expect(result!.path.map((e) => e.text)).toEqual(["Alpha", "Beta"]);
    expect(result!.path.map((e) => e.index)).toEqual([0, 2]);
    expect(result!.path.map((e) => e.sectionNumber)).toEqual(["1", "1.1"]);
    expect(result!.parTitleIndex).toBe(3);
  });

  it("inside the first section: single-entry chain, no par-title", () => {
    const p = blockPos(editor, 1) + 1; // inside p1
    const result = computeSectionPathAt(editor, stubView(editor, () => p), stubScrollEl(), null);
    expect(result!.path.map((e) => e.text)).toEqual(["Alpha"]);
    expect(result!.parTitleIndex).toBeNull();
  });

  it("a crossed heading RESETS the par-title (the walk's activeParTitleIdx = null)", () => {
    // Retitle p1 (BEFORE h2) and clear p2's title: at a line inside p3 the
    // last titled block (p1) sits before the last crossed heading (h2) → null.
    editor.view.dispatch(editor.state.tr.setNodeAttribute(blockPos(editor, 1), "parTitle", "Early"));
    editor.view.dispatch(editor.state.tr.setNodeAttribute(blockPos(editor, 3), "parTitle", null));
    const p = blockPos(editor, 4) + 1;
    const result = computeSectionPathAt(editor, stubView(editor, () => p), stubScrollEl(), null);
    expect(result!.path.map((e) => e.text)).toEqual(["Alpha", "Beta"]);
    expect(result!.parTitleIndex).toBeNull();
  });

  it("a parTitle FLIP re-derives the vocabulary (S1's blockParTitleChanged bumps the version)", () => {
    const pAt = () => blockPos(editor, 4) + 1; // inside p3, recomputed live
    const view = stubView(editor, pAt);
    expect(
      computeSectionPathAt(editor, view, stubScrollEl(), null)!.parTitleIndex,
    ).toBe(3);
    // Give p3 a title: it is now the last titled block before the line.
    editor.view.dispatch(editor.state.tr.setNodeAttribute(blockPos(editor, 4), "parTitle", "Late"));
    expect(
      computeSectionPathAt(editor, view, stubScrollEl(), null)!.parTitleIndex,
    ).toBe(4);
    // Remove it again: back to p2.
    editor.view.dispatch(editor.state.tr.setNodeAttribute(blockPos(editor, 4), "parTitle", null));
    expect(
      computeSectionPathAt(editor, view, stubScrollEl(), null)!.parTitleIndex,
    ).toBe(3);
  });

  it("plain typing shifts positions without invalidating the cached vocabulary", () => {
    const view = stubView(editor, () => blockPos(editor, 4) + 1);
    expect(
      computeSectionPathAt(editor, view, stubScrollEl(), null)!.parTitleIndex,
    ).toBe(3);
    // Type into p1 — every later position shifts; no structural change.
    editor.view.dispatch(
      editor.state.tr.insertText("xxxxxxxx", blockPos(editor, 1) + 2),
    );
    const result = computeSectionPathAt(editor, view, stubScrollEl(), null);
    expect(result!.path.map((e) => e.text)).toEqual(["Alpha", "Beta"]);
    expect(result!.parTitleIndex).toBe(3);
  });

  it("heading text reads LIVE (index text is content-stale by design)", () => {
    // Type into h2's text; the index entry's text stays "Beta" but the
    // breadcrumb must show the live text.
    editor.view.dispatch(
      editor.state.tr.insertText("!!", blockPos(editor, 2) + 1),
    );
    const p = blockPos(editor, 4) + 1;
    const result = computeSectionPathAt(editor, stubView(editor, () => p), stubScrollEl(), null);
    expect(result!.path[1].text).toBe("!!Beta");
  });

  it("a locked-focus band skips out-of-band headings", () => {
    const p = blockPos(editor, 4) + 1;
    const result = computeSectionPathAt(
      editor,
      stubView(editor, () => p),
      stubScrollEl(),
      { start: 2, end: 4 }, // h1 (index 0) is out of band
    );
    expect(result!.path.map((e) => e.text)).toEqual(["Beta"]);
  });

  it("returns an empty path above the first heading", () => {
    const result = computeSectionPathAt(
      editor,
      stubView(editor, () => 1), // inside h1 itself? pos 1 is inside h1 — h1.pos(0) <= 1 → crossed.
      stubScrollEl(),
      null,
    );
    // pos 1 sits INSIDE h1, so h1 counts as crossed (its top is at/above the
    // line containing pos 1) — single-entry chain, same as the walk.
    expect(result!.path.map((e) => e.text)).toEqual(["Alpha"]);
  });
});

// ---------------------------------------------------------------------------
// Task 585 — the par-titled vocabulary is keyed on the snapshot's STRUCTURAL
// version, so plain typing costs the breadcrumb no per-block work. The
// retired key (`structure.version`) bumps on every content-only diff, which
// rebuilt the vocabulary (O(blocks) + sort) on every typing frame.
// ---------------------------------------------------------------------------

import { __blockVocabBuildCount } from "../block-vocab";
import { getBus } from "@/lib/tiptap/doc-structure";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { codeOnly } from "@/lib/__tests__/_source-scan";

describe("par-titled vocabulary cost (task 585)", () => {
  it("typing 20 characters into a uuid'd paragraph builds the vocabulary ONCE", () => {
    const view = stubView(editor, () => blockPos(editor, 4) + 1);
    computeSectionPathAt(editor, view, stubScrollEl(), null);
    const builds = __blockVocabBuildCount();
    const versionBefore = getBus(editor)!.structure.version;
    const structuralBefore = getBus(editor)!.structure.structuralVersion;
    for (let i = 0; i < 20; i++) {
      editor.view.dispatch(
        editor.state.tr.insertText("x", blockPos(editor, 1) + 2),
      );
      const r = computeSectionPathAt(editor, view, stubScrollEl(), null);
      expect(r!.parTitleIndex).toBe(3);
    }
    // Premise: the retired key really DID move while typing — without this
    // the count leg could pass on a doc whose version never bumps.
    expect(getBus(editor)!.structure.version).toBeGreaterThan(versionBefore);
    expect(getBus(editor)!.structure.structuralVersion).toBe(structuralBefore);
    expect(__blockVocabBuildCount()).toBe(builds);
  });

  it("control: a parTitle flip on another block rebuilds it and the breadcrumb includes the block", () => {
    const view = stubView(editor, () => blockPos(editor, 4) + 1);
    computeSectionPathAt(editor, view, stubScrollEl(), null);
    const builds = __blockVocabBuildCount();
    editor.view.dispatch(
      editor.state.tr.setNodeAttribute(blockPos(editor, 4), "parTitle", "Late"),
    );
    expect(
      computeSectionPathAt(editor, view, stubScrollEl(), null)!.parTitleIndex,
    ).toBe(4);
    expect(__blockVocabBuildCount()).toBe(builds + 1);
  });

  it("control: inserting a titled block rebuilds it (a structural add moves the key)", () => {
    const view = stubView(editor, () => blockPos(editor, 5) + 1); // p3 after the insert
    computeSectionPathAt(editor, view, stubScrollEl(), null);
    const builds = __blockVocabBuildCount();
    editor.view.dispatch(
      editor.state.tr.insert(
        blockPos(editor, 4),
        editor.schema.nodes.paragraph.create(
          { uuid: "pNew", parTitle: "Inserted" },
          editor.schema.text("new"),
        ),
      ),
    );
    expect(
      computeSectionPathAt(editor, view, stubScrollEl(), null)!.parTitleIndex,
    ).toBe(4);
    expect(__blockVocabBuildCount()).toBe(builds + 1);
  });

  it("census: no reader outside doc-structure keys a cache on `structure.version`", () => {
    const root = join(__dirname, "../../.."); // src/
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          if (name === "__tests__" || name === "node_modules") continue;
          walk(p);
        } else if (/\.(ts|tsx)$/.test(name)) {
          if (p.includes(join("tiptap", "doc-structure"))) continue;
          // Symbol needle → `codeOnly` (comments may NAME the retired key).
          const src = codeOnly(readFileSync(p, "utf8"));
          if (/structure\.version\b/.test(src)) hits.push(p);
        }
      }
    };
    walk(root);
    expect(hits).toEqual([]);
  });
});

// ── Task 587: `\part` is heading level 0 ──────────────────────────────────
//
// The fast path climbed `while nextLevel > 1`, stopping at a `\chapter`, and
// both legacy fallbacks gated on `node.attrs?.level` (falsy for 0). No
// pre-587 fixture carried a level-0 heading, so both were unrepresentable.

import { pushCrossedHeading } from "../section-path";
import {
  HEADING_TYPES,
  OUTERMOST_HEADING_LEVEL,
  headingLevelOf,
} from "@/lib/heading-types";

type Spec = { level: number; text: string } | { text: string };

function makeDoc(specs: Spec[]): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: specs.map((s, i) =>
        "level" in s
          ? { type: "heading", attrs: { uuid: `h${i}`, level: s.level }, content: [{ type: "text", text: s.text }] }
          : { type: "paragraph", attrs: { uuid: `p${i}` }, content: [{ type: "text", text: s.text }] },
      ),
    },
  });
}

/** The legacy fallbacks' fold, driven over the doc in order up to (and
 *  including) block `upTo` — exactly what their crossing walk does when the
 *  reference line sits inside that block. */
function fallbackChain(ed: Editor, upTo: number): string[] {
  const stack: { level: number; text: string }[] = [];
  ed.state.doc.forEach((node, _off, index) => {
    if (index > upTo) return;
    if (node.type.name !== "heading") return;
    const level = headingLevelOf(node.attrs);
    if (level === null) return;
    pushCrossedHeading(stack, { level, text: node.textContent });
  });
  return stack.map((s) => s.text);
}

function fastChain(ed: Editor, blockIdx: number): string[] {
  const p = blockPos(ed, blockIdx) + 1;
  const r = computeSectionPathAt(ed, stubView(ed, () => p), stubScrollEl(), null);
  return r!.path.map((e) => e.text);
}

describe("task 587 — \\part (level 0) in the breadcrumb", () => {
  const CASES: { name: string; specs: Spec[]; expected: string[] }[] = [
    {
      name: "part > chapter > section",
      specs: [{ level: 0, text: "I" }, { level: 1, text: "A" }, { level: 2, text: "x" }, { text: "body" }],
      expected: ["I", "A", "x"],
    },
    {
      name: "part > section",
      specs: [{ level: 0, text: "I" }, { level: 2, text: "x" }, { text: "body" }],
      expected: ["I", "x"],
    },
    {
      name: "chapter > section (control)",
      specs: [{ level: 1, text: "A" }, { level: 2, text: "x" }, { text: "body" }],
      expected: ["A", "x"],
    },
    {
      name: "a second part closes the first",
      specs: [{ level: 0, text: "I" }, { level: 1, text: "A" }, { level: 0, text: "II" }, { level: 2, text: "y" }, { text: "body" }],
      expected: ["II", "y"],
    },
  ];

  for (const c of CASES) {
    it(`fast path returns the full chain: ${c.name}`, () => {
      const ed = makeDoc(c.specs);
      try {
        expect(fastChain(ed, c.specs.length - 1)).toEqual(c.expected);
      } finally {
        ed.destroy();
      }
    });

    it(`fallback fold agrees with the fast path at EVERY block: ${c.name}`, () => {
      const ed = makeDoc(c.specs);
      try {
        expect(fallbackChain(ed, c.specs.length - 1)).toEqual(c.expected);
        for (let i = 0; i < c.specs.length; i++) {
          expect(fallbackChain(ed, i)).toEqual(fastChain(ed, i));
        }
      } finally {
        ed.destroy();
      }
    });
  }

  it("the outermost level is DERIVED from HEADING_TYPES, and a level-0 heading reads as a heading", () => {
    expect(OUTERMOST_HEADING_LEVEL).toBe(Math.min(...HEADING_TYPES.map((h) => h.level)));
    expect(OUTERMOST_HEADING_LEVEL).toBe(0);
    expect(headingLevelOf({ level: 0 })).toBe(0);
    expect(headingLevelOf({ level: 3 })).toBe(3);
    expect(headingLevelOf({})).toBeNull();
    expect(headingLevelOf(null)).toBeNull();
    expect(headingLevelOf({ level: "2" })).toBeNull();
  });

  it("census: no breadcrumb path tests a heading level for truthiness or climbs to a literal floor", () => {
    const root = join(__dirname, "../../../..");
    // codeOnly: comments AND string literals blanked — every needle here is
    // a code shape, and this repo renegotiates retired claims in comments.
    const read = (p: string) => codeOnly(readFileSync(join(root, p), "utf8"));
    const sites = [
      "src/components/EditorLayout.tsx",
      "src/components/editor-layout/reader-view-prefs.ts",
      "src/lib/editor-geometry/section-path.ts",
    ];
    for (const p of sites) {
      const src = read(p);
      expect(src, p).not.toMatch(/attrs\??\.level\s*\)\s*\{/);
      expect(src, p).not.toMatch(/nextLevel\s*>\s*\d/);
    }
    // both fallbacks enter the shared fold, and neither re-spells its pop rule
    // (the helper in section-path.ts is its one legitimate speller)
    for (const p of sites.slice(0, 2)) {
      expect(read(p), p).not.toMatch(/stack\[stack\.length - 1\]\.level\s*>=/);
      expect(read(p), p).toMatch(/pushCrossedHeading\(stack,/);
      expect(read(p), p).toMatch(/headingLevelOf\(node\.attrs\)/);
    }
  });
});

// @vitest-environment jsdom
/**
 * TASK 658 — changing a heading's LEVEL must not rebuild the heading.
 *
 * THE FINDING. Three surfaces change an existing heading's level, and they did
 * not agree about what a heading carries:
 *
 *   - the heading-annotation CHIP's type menu spread the node's attrs
 *     (`{ ...node.attrs, level }`) — correct;
 *   - the registry's `headingRun`, the SSOT behind BOTH the BlockType dropdown
 *     levels 1–4 AND the slash `\chapter`/`\section`/`\subsection`/
 *     `\subsubsection` commands, passed a LITERAL `{ level, numbered: true }`;
 *   - the dropdown's out-of-scope levels 0/5/6 passed the same literal through
 *     `setNode("heading", …)`.
 *
 * `setBlockType` / `setNode` compute the new node's attrs from the object they
 * are handed, so every heading attr not named falls back to its default. A
 * heading carries five (`MAIN_STARTERKIT_NODE_ATTRS.heading`): `label`, `uuid`,
 * `numbered`, `sectionNumber`, `shortTitle`. Demoting a
 * `\section*{Foo}\label{sec:foo}` with a `[short]` title from the dropdown
 * therefore silently deleted the user's `\label` (dangling `\ref`s), deleted
 * their `[short]` running head, forced the starred section to become numbered,
 * and re-minted the block's `uuid` (orphaning every card anchored to it).
 *
 * THE ASYMMETRY IS THE PROOF. Pre-fix the preservation legs FAIL on the two
 * registry surfaces and on the 0/5/6 fallback, and PASS on the chip — a guard
 * that goes green on all four before the fix has not reproduced the defect.
 * (Verified by running this suite against the reverted sources.)
 *
 * The census leg is the one with teeth: it DISCOVERS the write population from
 * the tree rather than listing it, so a fourth surface cannot slip the door.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { COMMAND_MAP } from "@/lib/tiptap/commands";
import {
  VIRGIL_ACTION_REGISTRY,
  type ActionContext,
  type ActionId,
  type CursorRef,
} from "@/lib/actions/action-registry";
import { paragraphUuidAt } from "@/links/links";
import { serializeToLatex } from "@/lib/latex-serializer";
import { pickBlockType } from "@/components/MenuBar";
import { headingAttrsForLevel } from "@/lib/tiptap/heading-level";

// ───────────────────────────────────────────────────────────────────────────
// Real editor stack (the same shape the sibling heading suites mount)
// ───────────────────────────────────────────────────────────────────────────

/** jsdom has no layout; PM's scroll math throws without a rect. */
const ZERO_RECT = {
  top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0,
  toJSON() { return this; },
} as DOMRect;
function installLayoutShim() {
  const list = Object.assign([ZERO_RECT], { item: () => ZERO_RECT }) as unknown as DOMRectList;
  for (const proto of [Range.prototype, Text.prototype as unknown as Range]) {
    if (typeof (proto as { getClientRects?: unknown }).getClientRects !== "function") {
      (proto as { getClientRects?: unknown }).getClientRects = () => list;
    }
    if (typeof (proto as { getBoundingClientRect?: unknown }).getBoundingClientRect !== "function") {
      (proto as { getBoundingClientRect?: unknown }).getBoundingClientRect = () => ZERO_RECT;
    }
  }
}

type TypeMenuParams = {
  anchorRect: DOMRect;
  currentLevel: number;
  onPick: (pick: { kind: "level"; level: number } | { kind: "no-heading" }) => void;
};

/** The live type-menu opener the heading NodeView calls on a chip click. */
const openerRef: { current: ((p: TypeMenuParams) => void) | undefined } = {
  current: undefined,
};
let lastTypeMenu: TypeMenuParams | null = null;
/** Read through a call so TS does not narrow on the reset assignment above. */
const takeTypeMenu = (): TypeMenuParams | null => lastTypeMenu;

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {
      onOpenHeadingTypeMenu: openerRef as EditorExtensionsCtx["callbacks"]["onOpenHeadingTypeMenu"],
    },
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
}

let editors: Editor[] = [];

/** Mount a real main editor and put the caret inside its FIRST block. */
function mount(content: Record<string, unknown>[]): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: { type: "doc", content },
  });
  editors.push(editor);
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)),
  );
  return editor;
}

/**
 * THE FIXTURE: an existing `\section*[Short]{Introduction}\label{sec:intro}`
 * carrying every attr the schema gives a heading, plus a following paragraph so
 * the doc is not degenerate.
 */
const FIXTURE_ATTRS = {
  level: 2,
  uuid: "h-intro",
  label: "sec:intro",
  numbered: false,
  sectionNumber: "3",
  shortTitle: "Short",
} as const;

function mountHeadingFixture(): Editor {
  return mount([
    {
      type: "heading",
      attrs: { ...FIXTURE_ATTRS },
      content: [{ type: "text", text: "Introduction" }],
    },
    {
      type: "paragraph",
      attrs: { uuid: "para-A" },
      content: [{ type: "text", text: "Body prose." }],
    },
  ]);
}

const firstBlock = (editor: Editor) => editor.state.doc.firstChild!;

/**
 * The attrs this task is about. `sectionNumber` is deliberately NOT here: it is
 * DERIVED display state owned by the section numberer, which re-solves it for
 * the whole document after any structural change — a heading that becomes a
 * subsection genuinely gets a different number, and pinning the old one would
 * assert a bug. The rule's own contract (leg 3) still proves the attr is
 * carried through the write; the numberer's re-solve is what lands after it.
 */
function headingFacts(editor: Editor) {
  const n = firstBlock(editor);
  return {
    type: n.type.name,
    level: n.attrs.level as number,
    label: n.attrs.label as string | null,
    uuid: n.attrs.uuid as string | null,
    numbered: n.attrs.numbered as boolean,
    shortTitle: n.attrs.shortTitle as string | null,
  };
}

// ── the four surfaces, each setting the SAME target level (3 = subsection) ──

/** 1. The heading-annotation chip's type menu — driven through the REAL click
 *  handler on the NodeView's strip, so the surface under test is the shipped
 *  one and not a re-implementation of it. */
function viaChip(editor: Editor, level: number): void {
  const chip = (editor.view.dom as HTMLElement).querySelector<HTMLElement>(
    '[data-action="type-menu"]',
  );
  if (!chip) throw new Error("heading type chip not rendered");
  lastTypeMenu = null;
  chip.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const opened = takeTypeMenu();
  if (!opened) throw new Error("type menu never opened");
  opened.onPick({ kind: "level", level });
}

/** 2. The BlockType dropdown, levels 1–4 → the registry's `headingRun`. */
function viaDropdown(editor: Editor, id: ActionId): void {
  const spec = VIRGIL_ACTION_REGISTRY[id];
  if (!spec) throw new Error(`no row for ${id}`);
  const pos = editor.state.selection.head;
  const ref: CursorRef = {
    kind: "cursor",
    pos,
    paragraphId: paragraphUuidAt(editor.state.doc, pos) ?? "",
  };
  void spec.run({ editor, view: editor.view, ref, surface: "lightning" } as ActionContext);
}

/** 3. The slash command — the OTHER caller of the one `headingRun`. */
function viaSlash(editor: Editor, name: string): void {
  COMMAND_MAP.get(name)!.action(editor.view, "\\" + name);
}

/** 4. The dropdown's OUT-OF-SCOPE levels (0/5/6), which skip the registry
 *  entirely and used their own `setNode("heading", …)`. */
function viaDropdownOutOfScope(editor: Editor, levelValue: string): void {
  pickBlockType(editor, levelValue);
}

beforeEach(() => {
  installLayoutShim();
  openerRef.current = (p: TypeMenuParams) => {
    lastTypeMenu = p;
  };
});
afterEach(() => {
  for (const e of editors) e.destroy();
  editors = [];
  document.body.innerHTML = "";
  lastTypeMenu = null;
  openerRef.current = undefined;
  vi.restoreAllMocks();
});

// ───────────────────────────────────────────────────────────────────────────
// (1) Every surface preserves every heading attr across a level change
// ───────────────────────────────────────────────────────────────────────────

describe("changing an EXISTING heading's level preserves what it carries", () => {
  const SURFACES: Array<{ name: string; apply: (e: Editor) => void }> = [
    { name: "chip type menu", apply: (e) => viaChip(e, 3) },
    { name: "BlockType dropdown (level 3)", apply: (e) => viaDropdown(e, "heading-subsection") },
    { name: "slash \\subsection", apply: (e) => viaSlash(e, "subsection") },
  ];

  for (const { name, apply } of SURFACES) {
    it(`${name}: label, shortTitle, numbered and uuid all survive`, () => {
      const editor = mountHeadingFixture();
      apply(editor);

      expect(headingFacts(editor)).toEqual({
        type: "heading",
        level: 3,
        label: "sec:intro",
        uuid: "h-intro",
        numbered: false,
        shortTitle: "Short",
      });
    });
  }

  it("the out-of-scope dropdown levels (0/5/6) preserve them too", () => {
    const editor = mountHeadingFixture();
    viaDropdownOutOfScope(editor, "5");

    expect(headingFacts(editor)).toEqual({
      type: "heading",
      level: 5,
      label: "sec:intro",
      uuid: "h-intro",
      numbered: false,
      shortTitle: "Short",
    });
  });

  it("all four surfaces AGREE — the divergence this task closes", () => {
    const facts = [
      (() => { const e = mountHeadingFixture(); viaChip(e, 3); return headingFacts(e); })(),
      (() => { const e = mountHeadingFixture(); viaDropdown(e, "heading-subsection"); return headingFacts(e); })(),
      (() => { const e = mountHeadingFixture(); viaSlash(e, "subsection"); return headingFacts(e); })(),
    ];
    expect(facts[1]).toEqual(facts[0]);
    expect(facts[2]).toEqual(facts[0]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// (2) The proof that matters is at the `.tex` level
// ───────────────────────────────────────────────────────────────────────────

describe("the user's LaTeX survives a level change", () => {
  for (const [name, apply] of [
    ["dropdown", (e: Editor) => viaDropdown(e, "heading-subsection")],
    ["slash", (e: Editor) => viaSlash(e, "subsection")],
    ["chip", (e: Editor) => viaChip(e, 3)],
  ] as Array<[string, (e: Editor) => void]>) {
    it(`${name}: \\label survives, [short] survives, the section stays STARRED`, () => {
      const editor = mountHeadingFixture();
      const before = serializeToLatex(editor.getJSON());
      expect(before).toContain("\\label{sec:intro}");
      expect(before).toContain("[Short]");
      expect(before).toMatch(/\\section\*/);

      apply(editor);
      const after = serializeToLatex(editor.getJSON());

      expect(after).toContain("\\label{sec:intro}");
      expect(after).toContain("[Short]");
      // The command changed (section → subsection) but the STAR did not.
      expect(after).toMatch(/\\subsection\*/);
      expect(after).not.toMatch(/\\subsection\{/);
    });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// (3) The genuine CONVERSION case must not regress
// ───────────────────────────────────────────────────────────────────────────

describe("paragraph → heading is a conversion, and still gets the defaults", () => {
  const CASES: Array<[string, (e: Editor) => void]> = [
    ["dropdown", (e) => viaDropdown(e, "heading-section")],
    ["slash", (e) => viaSlash(e, "section")],
  ];
  for (const [name, apply] of CASES) {
    it(`${name}: a paragraph becomes a NUMBERED heading with no label`, () => {
      const editor = mount([
        { type: "paragraph", attrs: { uuid: "para-A" }, content: [{ type: "text", text: "Hello" }] },
      ]);
      apply(editor);
      const f = headingFacts(editor);
      expect(f.type).toBe("heading");
      expect(f.level).toBe(2);
      expect(f.numbered).toBe(true);
      expect(f.label).toBeNull();
      expect(f.shortTitle).toBeNull();
    });
  }

  it("the rule itself distinguishes the two cases", () => {
    const editor = mountHeadingFixture();
    const headingType = editor.schema.nodes.heading;
    const heading = editor.state.doc.firstChild!;
    const para = editor.state.doc.child(1);

    expect(headingAttrsForLevel(heading, headingType, 4)).toEqual({
      ...FIXTURE_ATTRS,
      level: 4,
    });
    expect(headingAttrsForLevel(para, headingType, 4)).toEqual({
      level: 4,
      numbered: true,
    });
  });

  it("a MIXED range gets the right answer per block — no single literal could", () => {
    const editor = mount([
      { type: "heading", attrs: { ...FIXTURE_ATTRS }, content: [{ type: "text", text: "Introduction" }] },
      { type: "paragraph", attrs: { uuid: "para-A" }, content: [{ type: "text", text: "Body prose." }] },
    ]);
    // Select across BOTH blocks, then set level 3.
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, 2, editor.state.doc.content.size - 1),
      ),
    );
    viaDropdown(editor, "heading-subsection");

    const a = editor.state.doc.child(0);
    const b = editor.state.doc.child(1);
    expect(a.type.name).toBe("heading");
    expect(b.type.name).toBe("heading");
    // The pre-existing heading kept everything…
    expect(a.attrs.label).toBe("sec:intro");
    expect(a.attrs.numbered).toBe(false);
    expect(a.attrs.uuid).toBe("h-intro");
    // …the converted paragraph took the conversion defaults.
    expect(b.attrs.label).toBeNull();
    expect(b.attrs.numbered).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// (4) CENSUS — discover the write population; a fourth surface cannot slip it
// ───────────────────────────────────────────────────────────────────────────

const SRC = join(process.cwd(), "src");

function walkSources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      walkSources(p, out);
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

/** Strip block + line comments so a docblock QUOTING the banned spelling (this
 *  fix's own explanatory comments do) is not mistaken for a write. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("census: one door for every heading-level write", () => {
  const DOOR = join(SRC, "lib", "tiptap", "heading-level.ts");

  it("no source outside the door hand-builds a heading attr literal", () => {
    const offenders: string[] = [];
    for (const file of walkSources(SRC)) {
      if (file === DOOR) continue;
      const body = code(readFileSync(file, "utf8"));
      // The two shapes that rebuild a heading from defaults.
      const literal = /\bnumbered:\s*true\b/.test(body) && /\blevel\b/.test(body);
      const setNodeHeading = /setNode\(\s*["']heading["']/.test(body);
      const setBlockTypeHeading =
        /setBlockType\([^)]*\bheading\b[^)]*\{[^}]*\blevel\b/.test(
          body.replace(/\n/g, " "),
        );
      if ((literal && (setNodeHeading || setBlockTypeHeading)) || setNodeHeading) {
        offenders.push(relative(SRC, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every surface that changes a heading's level imports the door", () => {
    // Discovered, not listed: any non-test source mentioning a heading level
    // pick. The three known surfaces must all be found, so the discovery
    // itself cannot go vacuous.
    const readers = walkSources(SRC)
      .filter((f) => f !== DOOR)
      .filter((f) => /from "@\/lib\/tiptap\/heading-level"/.test(readFileSync(f, "utf8")))
      .map((f) => relative(SRC, f))
      .sort();

    expect(readers).toEqual(
      ["components/MenuBar.tsx", "lib/actions/action-registry.ts", "lib/editor-extensions.ts"].sort(),
    );
  });
});

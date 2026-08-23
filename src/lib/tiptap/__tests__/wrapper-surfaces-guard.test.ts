// @vitest-environment jsdom
//
// Task 2026-08-22-427 — the three wrapper toggles had ONE applicability
// predicate (task 397's `wrapperSafeHere`) and only the registry read it. Three
// live surfaces reached `toggleBulletList` / `toggleOrderedList` /
// `toggleBlockquote` without asking: StarterKit's `Mod-Shift-8/7/b` chords,
// its `- ` / `1. ` / `> ` markdown input rules, and `RichTextField`'s toolbar.
//
// MEASURED on the pre-427 tree, per surface, with the caret inside an expex
// `\a` item (the container whose union has no list and no quote):
//   • the CHORDS destroyed the item — `toggleList` LIFTS the paragraph out of
//     `exampleItem`, `\vxid{it1}` is gone and the example renumbers;
//   • the INPUT RULES did NOT — upstream `wrappingInputRule` asks PM's own
//     `findWrapping` first and declines. That half of the filed diagnosis is
//     REFUTED and pinned below as a CONTROL rather than "fixed". The rules are
//     still routed through the shared predicate so every surface answers from
//     ONE table (the census is the leg with teeth there);
//   • the TOOLBAR buttons destroyed a `codeBlock` / atom block in a card body.
//
// Every leg drives the REAL `buildEditorExtensions("main")` stack through the
// shipped `handleKeyDown` / `handleTextInput` props — a direct `tr` dispatch
// cannot see any of this, since the defect lives in which binding owns the key.
import { describe, expect, it, vi } from "vitest";

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

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { codeOnlyLines } from "@/lib/__tests__/_source-scan";
import { VIRGIL_ACTION_REGISTRY } from "@/lib/actions/action-registry";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import { serializeBodyOnly } from "@/lib/latex-serializer";

// ── harness ──────────────────────────────────────────────────────────────────

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
  } as unknown as EditorExtensionsCtx;
}

const FIXTURE: JSONContent = {
  type: "doc",
  content: [
    { type: "paragraph", attrs: { uuid: "prose" }, content: [{ type: "text", text: "Ordinary prose here." }] },
    { type: "paragraph", attrs: { uuid: "empty" } },
    {
      type: "exampleBlock",
      attrs: { uuid: "ex" },
      content: [
        { type: "paragraph", attrs: { uuid: "ex-body" }, content: [{ type: "text", text: "example body text" }] },
        {
          type: "exampleItemList",
          content: [
            { type: "exampleItem", attrs: { uuid: "it1" }, content: [{ type: "paragraph", attrs: { uuid: "it1p" }, content: [{ type: "text", text: "item text" }] }] },
            { type: "exampleItem", attrs: { uuid: "it2" }, content: [{ type: "paragraph", attrs: { uuid: "it2p" } }] },
          ],
        },
      ],
    },
    { type: "heading", attrs: { uuid: "h", level: 2 }, content: [{ type: "text", text: "A section" }] },
    {
      type: "bulletList",
      attrs: { uuid: "ul" },
      content: [
        { type: "listItem", attrs: { uuid: "li1" }, content: [{ type: "paragraph", attrs: { uuid: "li1p" }, content: [{ type: "text", text: "first item" }] }] },
      ],
    },
  ],
};

function mount(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({ element, extensions: buildEditorExtensions(mainCtx()), content: FIXTURE });
}

/** Caret at the start (or end) of the node carrying `uuid`. */
function caret(ed: Editor, uuid: string, where: "start" | "end" = "end") {
  let pos = -1;
  ed.state.doc.descendants((n, p) => {
    if (pos < 0 && (n.attrs as { uuid?: string })?.uuid === uuid) {
      pos = where === "start" ? p + 1 : p + n.nodeSize - 1;
    }
    return true;
  });
  if (pos < 0) throw new Error(`no node #${uuid}`);
  ed.commands.setTextSelection(pos);
}

const CHORDS = {
  "bullet-list": { key: "8", code: "Digit8", keyCode: 56 },
  "ordered-list": { key: "7", code: "Digit7", keyCode: 55 },
  blockquote: { key: "b", code: "KeyB", keyCode: 66 },
} as const;

/** The SHIPPED chord binding through ProseMirror's own key dispatch. jsdom is
 *  not a mac, so `Mod` resolves to Ctrl. */
function chord(ed: Editor, which: keyof typeof CHORDS): boolean {
  const init = CHORDS[which];
  const ev = new KeyboardEvent("keydown", { ...init, ctrlKey: true, shiftKey: true });
  return ed.view.someProp("handleKeyDown", (f) => f(ed.view, ev)) ?? false;
}

/** Type `text` ONE CHARACTER AT A TIME through the shipped `handleTextInput`
 *  prop — a single `insertContent` never fires an input rule. */
function type(ed: Editor, text: string) {
  for (const ch of text) {
    const { from, to } = ed.state.selection;
    const handled = ed.view.someProp("handleTextInput", (f) =>
      (f as (...a: unknown[]) => boolean)(ed.view, from, to, ch),
    );
    if (!handled) ed.view.dispatch(ed.state.tr.insertText(ch, from, to));
  }
}

const TRIGGERS = { "bullet-list": "- ", "ordered-list": "1. ", blockquote: "> " } as const;

function tex(ed: Editor): string {
  return serializeBodyOnly(ed.state.doc.toJSON() as never);
}
function uuids(ed: Editor): string[] {
  const out: string[] = [];
  ed.state.doc.descendants((n) => {
    const u = (n.attrs as { uuid?: string })?.uuid;
    if (u) out.push(u);
    return true;
  });
  return out.sort();
}

// ── the chords ───────────────────────────────────────────────────────────────

describe("StarterKit chords ask the wrapper gate (task 427)", () => {
  for (const which of ["bullet-list", "ordered-list", "blockquote"] as const) {
    it(`Mod-Shift chord for ${which} at a caret in an example ITEM leaves the item INTACT`, () => {
      const ed = mount();
      caret(ed, "it1p");
      const before = tex(ed);
      const beforeUuids = uuids(ed);
      chord(ed, which);
      expect(tex(ed)).toBe(before);
      expect(uuids(ed)).toEqual(beforeUuids);
      expect(tex(ed)).toContain("\\vxid{it1}\\a item text");
      ed.destroy();
    });

    it(`Mod-Shift chord for ${which} on a HEADING leaves the section intact`, () => {
      const ed = mount();
      caret(ed, "h");
      const before = tex(ed);
      chord(ed, which);
      expect(tex(ed)).toBe(before);
      expect(tex(ed)).toContain("\\section{A section}");
      ed.destroy();
    });
  }

  it("CONTROL: the bullet chord in a plain paragraph still makes a list", () => {
    const ed = mount();
    caret(ed, "prose");
    expect(chord(ed, "bullet-list")).toBe(true);
    expect(tex(ed)).toContain("\\begin{itemize}\n  \\item Ordinary prose here.");
    ed.destroy();
  });

  it("CONTROL: the bullet chord inside a LIST is subtractive and still lifts out", () => {
    const ed = mount();
    caret(ed, "li1p");
    chord(ed, "bullet-list");
    expect(tex(ed)).not.toContain("\\begin{itemize}");
    expect(tex(ed)).toContain("first item");
    ed.destroy();
  });
});

// ── the input rules ──────────────────────────────────────────────────────────

describe("StarterKit markdown input rules ask the wrapper gate (task 427)", () => {
  for (const which of ["bullet-list", "ordered-list", "blockquote"] as const) {
    it(`typing \`${TRIGGERS[which]}\` at the start of an example ITEM leaves the item INTACT (pre-427 CONTROL: findWrapping already declined)`, () => {
      const ed = mount();
      caret(ed, "it2p", "start");
      const beforeUuids = uuids(ed);
      const beforeBlocks = ed.state.doc.childCount;
      type(ed, TRIGGERS[which]);
      expect(uuids(ed)).toEqual(beforeUuids);
      const out = tex(ed);
      expect(out).toContain("\\vxid{it1}\\a item text");
      // the typed trigger stays TEXT inside the item — nothing was wrapped.
      expect(out).toContain(`\\vxid{it2}\\a ${TRIGGERS[which].trim()}`);
      expect(ed.state.doc.childCount).toBe(beforeBlocks);
      ed.destroy();
    });
  }

  it("CONTROL: typing `- ` in an empty top-level paragraph still makes a bullet list", () => {
    const ed = mount();
    caret(ed, "empty", "start");
    type(ed, "- x");
    expect(tex(ed)).toContain("\\begin{itemize}\n  \\item x");
    ed.destroy();
  });

  it("CONTROL: typing `1. ` in an empty top-level paragraph still makes a numbered list", () => {
    const ed = mount();
    caret(ed, "empty", "start");
    type(ed, "1. x");
    expect(tex(ed)).toContain("\\begin{enumerate}\n  \\item x");
    ed.destroy();
  });
});

// ── the record cannot drift from the binding ────────────────────────────────

describe("the registry's RECORD of the wrapper surfaces is the binding (task 427)", () => {
  it("each wrapper row's declared keybinding, pressed through the real stack, fires its toggle", () => {
    for (const [id, which] of [["bullet-list", "bullet-list"], ["ordered-list", "ordered-list"], ["blockquote", "blockquote"]] as const) {
      const row = VIRGIL_ACTION_REGISTRY[id];
      expect(row.surfaces.keyboard, id).toBe(true);
      expect(row.surfaces.typed, id).toBe(true);
      // Derive the KeyboardEvent from the DECLARED string, not from this
      // file's own chord table — that is what makes the record falsifiable.
      const parts = row.keybinding!.split("-");
      const key = parts[parts.length - 1];
      expect(CHORDS[which].key, id).toBe(key);
      const ed = mount();
      caret(ed, "prose");
      const ev = new KeyboardEvent("keydown", {
        key,
        code: CHORDS[which].code,
        keyCode: CHORDS[which].keyCode,
        ctrlKey: parts.includes("Mod"),
        shiftKey: parts.includes("Shift"),
      });
      const handled = ed.view.someProp("handleKeyDown", (f) => f(ed.view, ev)) ?? false;
      expect(handled, id).toBe(true);
      expect(ed.state.doc.firstChild!.type.name, id).toBe(row.id === "blockquote" ? "blockquote" : id === "bullet-list" ? "bulletList" : "orderedList");
      ed.destroy();
    }
  });

  it("each wrapper row's declared inputRulePattern matches the trigger the real rule fires on", () => {
    expect(VIRGIL_ACTION_REGISTRY["bullet-list"].inputRulePattern!.test("- ")).toBe(true);
    expect(VIRGIL_ACTION_REGISTRY["ordered-list"].inputRulePattern!.test("1. ")).toBe(true);
    expect(VIRGIL_ACTION_REGISTRY["blockquote"].inputRulePattern!.test("> ")).toBe(true);
  });
});

// ── the census: the leg with teeth ──────────────────────────────────────────
//
// The door was never the part that could misbehave — a surface that fires a
// toggle without asking it is, and that type-checks perfectly (it is literally
// what shipped three times over). So the question is asked of SOURCE, over
// both silos, with EMPTY allowlists: a hit is WIRE-it.

const ROOT = join(__dirname, "..", "..", "..", "..");

function productionFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === "__tests__" || e.name.startsWith(".")) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

const SILOS = ["src", "library"].map((d) => join(ROOT, d)).filter((d) => existsSync(d));
const FILES = SILOS.flatMap(productionFiles);
const rel = (p: string) => p.slice(ROOT.length + 1);

/** Top-level declaration regions of a (comment-stripped) source: each region
 *  runs from a column-0 declaration line to the next. */
function regions(code: string): { start: number; text: string }[] {
  const lines = code.split("\n");
  const starts: number[] = [];
  lines.forEach((l, i) => {
    if (/^(export\s+)?(async\s+)?(function|const|let|class)\s/.test(l)) starts.push(i);
  });
  return starts.map((s, k) => ({
    start: s,
    text: lines.slice(s, starts[k + 1] ?? lines.length).join("\n"),
  }));
}
function regionAt(regs: { start: number; text: string }[], line: number) {
  let hit = regs[0];
  for (const r of regs) if (r.start <= line) hit = r;
  return hit;
}

const TOGGLE = /\btoggle(BulletList|OrderedList|Blockquote)\s*\(/;
const DOOR = /\bwrapperSafe(InState|Here)\s*\(/;

describe("CENSUS: every production wrapper-toggle call is guarded (task 427)", () => {
  it("a toggleBulletList / toggleOrderedList / toggleBlockquote call sits in a declaration that asks the wrapper door, or is a formatToggleRow argument", () => {
    const offenders: string[] = [];
    let hits = 0;
    for (const file of FILES) {
      const code = codeOnlyLines(readFileSync(file, "utf8"));
      if (!TOGGLE.test(code)) continue;
      const regs = regions(code);
      code.split("\n").forEach((l, i) => {
        if (!TOGGLE.test(l)) return;
        hits += 1;
        if (/\bformatToggleRow\s*\(/.test(l)) return; // the registry row — its builder is censused below
        if (!DOOR.test(regionAt(regs, i).text)) offenders.push(`${rel(file)}:${i + 1}`);
      });
    }
    expect(hits).toBeGreaterThanOrEqual(4); // the canary: the needle sees the live sites
    expect(offenders).toEqual([]);
  });

  it("formatToggleRow's run() asks the door (the registry rows' guard)", () => {
    const code = codeOnlyLines(readFileSync(join(ROOT, "src/lib/actions/action-registry.ts"), "utf8"));
    const reg = regions(code).find((r) => /^(export\s+)?function formatToggleRow\b/.test(r.text));
    expect(reg).toBeDefined();
    expect(DOOR.test(reg!.text)).toBe(true);
  });

  it("every .extend() of BulletList / OrderedList / Blockquote routes BOTH its chords and its input rules through the gate", () => {
    const offenders: string[] = [];
    let hits = 0;
    for (const file of FILES) {
      const code = codeOnlyLines(readFileSync(file, "utf8"));
      if (!/\b(BulletList|OrderedList|Blockquote)\.extend\s*\(/.test(code)) continue;
      const regs = regions(code);
      code.split("\n").forEach((l, i) => {
        if (!/\b(BulletList|OrderedList|Blockquote)\.extend\s*\(/.test(l)) return;
        hits += 1;
        const r = regionAt(regs, i).text;
        if (!/\bguardWrapperShortcuts\s*\(/.test(r) || !/\bguardWrapperInputRules\s*\(/.test(r)) {
          offenders.push(`${rel(file)}:${i + 1}`);
        }
      });
    }
    expect(hits).toBe(3);
    expect(offenders).toEqual([]);
  });

  it("the wrapper question has ONE implementation: findWrapping is spelled only in wrapper-gate.ts", () => {
    const spellers = FILES.filter((f) => /\bfindWrapping\s*\(/.test(codeOnlyLines(readFileSync(f, "utf8")))).map(rel);
    expect(spellers).toEqual(["src/lib/tiptap/wrapper-gate.ts"]);
  });

  it("the gate module itself is a leaf: it imports nothing from @/ (so every surface can reach it)", () => {
    const code = codeOnlyLines(readFileSync(join(ROOT, "src/lib/tiptap/wrapper-gate.ts"), "utf8"));
    expect(code.match(/from\s+"@\//g) ?? []).toEqual([]);
  });
});

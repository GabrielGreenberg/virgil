// @vitest-environment jsdom
// Task 740 — the inline-atom door asks BOTH halves.
//
// "May this inline atom land here?" is a SCHEMA question (can the textblock
// hold an inline node — task 150/396) AND a curated POLICY question (does the
// block kind permit the atom's card action — task 061's `titleField` greying
// `citation` out, so no `\cite` rides into `\title{…}`). The typed rules and
// commands paired the two by hand; the DROP paths (`Editor.tsx`'s citation
// drop, which also MINTS a card, and drop-mode's `inline-host.ts`) asked only
// the schema half, so a citation card dropped on the title landed there.
//
// Since 740 `posHostsInlineAtom` / `inlineRangeAllowsAtom` carry both halves,
// every surface already entering them is covered, and the CENSUS below pins
// that no production file asks the policy half for an inline atom beside the
// door again (the third hand-copy is how 061's fix left the drop path behind).
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  posHostsInlineAtom,
  inlineRangeAllowsAtom,
} from "@/text-objects/text-object-registry";
import {
  inlineCursorHostsNode,
  inlineCursorHostsPayload,
} from "@/components/drop-mode/inline-host";
import { strip } from "@/lib/__tests__/_source-scan";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  } as unknown as EditorExtensionsCtx;
}

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

function mount(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: [
        {
          type: "titleField",
          attrs: { field: "title", uuid: "title-A" },
          content: [{ type: "text", text: "My Paper Title" }],
        },
        {
          type: "paragraph",
          attrs: { uuid: "para-A" },
          content: [{ type: "text", text: "alpha beta gamma" }],
        },
      ],
    },
  });
  return editor;
}

/** A position in the middle of the first `typeName` textblock. */
function midOf(doc: PMNode, typeName: string): number {
  let at = -1;
  doc.descendants((node, pos) => {
    if (at >= 0) return false;
    if (node.type.name === typeName) {
      at = pos + 1 + Math.floor(node.content.size / 2);
      return false;
    }
    return true;
  });
  if (at < 0) throw new Error(`no ${typeName}`);
  return at;
}

describe("the inline-atom door carries the POLICY half (task 740)", () => {
  it("refuses a citation at a caret in the title; admits it in prose", () => {
    const ed = mount();
    const { doc, schema } = ed.state;
    expect(posHostsInlineAtom(doc, midOf(doc, "titleField"), schema.nodes.citation)).toBe(false);
    expect(posHostsInlineAtom(doc, midOf(doc, "paragraph"), schema.nodes.citation)).toBe(true);
  });

  it("keeps the title's legal atoms legal — footnote, inline math, cross-ref", () => {
    const ed = mount();
    const { doc, schema } = ed.state;
    const inTitle = midOf(doc, "titleField");
    expect(posHostsInlineAtom(doc, inTitle, schema.nodes.footnote)).toBe(true);
    expect(posHostsInlineAtom(doc, inTitle, schema.nodes.inlineMath)).toBe(true);
    expect(posHostsInlineAtom(doc, inTitle, schema.nodes.labelRef)).toBe(true);
  });

  it("the RANGE form refuses a selection from prose reaching into the title", () => {
    const ed = mount();
    const { doc, schema } = ed.state;
    const from = midOf(doc, "titleField");
    const to = midOf(doc, "paragraph");
    expect(inlineRangeAllowsAtom(doc, from, to, schema.nodes.citation)).toBe(false);
  });

  it("a gap (no textblock reached) stays permissive — PM wraps a fresh paragraph", () => {
    const ed = mount();
    const { doc, schema } = ed.state;
    const gap = doc.child(0).nodeSize; // between the title and the paragraph
    expect(posHostsInlineAtom(doc, gap, schema.nodes.citation)).toBe(true);
  });

  it("drop-mode's inline host refuses moving a citation into the title", () => {
    const ed = mount();
    const { doc, schema } = ed.state;
    const cite = schema.nodes.citation.create({ citationId: "c1", command: "citep" });
    expect(inlineCursorHostsNode(doc, midOf(doc, "titleField"), cite)).toBe(false);
    expect(inlineCursorHostsNode(doc, midOf(doc, "paragraph"), cite)).toBe(true);
    expect(inlineCursorHostsPayload(ed, midOf(doc, "titleField"), ["citation"])).toBe(false);
    expect(inlineCursorHostsPayload(ed, midOf(doc, "titleField"), ["footnote"])).toBe(true);
  });

  it("the Editor citation-drop door refuses the title BEFORE the mint", () => {
    // The drop handler's order is gate → mint → insert; the gate is the door.
    const src = readFileSync(resolve(REPO, "src/components/Editor.tsx"), "utf8");
    const gate = src.indexOf("if (!posHostsInlineAtom(view.state.doc, pos.pos, citType)) return true;");
    const mint = src.indexOf("onCitationDropRef.current(command, citationId)");
    expect(gate).toBeGreaterThan(0);
    expect(mint).toBeGreaterThan(gate);
  });
});

const REPO = resolve(__dirname, "../../../..");
const REGISTRY = "src/text-objects/text-object-registry.ts";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("census — the inline-atom POLICY half is asked only inside the door", () => {
  it("no production file pairs blockKindAllowsAction with an inline-atom action by hand", () => {
    const INLINE_ATOM_POLICY = /\bblockKindAllowsAction\s*\([^)]*["'](?:citation|footnote)["']/;
    const hits: string[] = [];
    for (const file of walk(join(REPO, "src"))) {
      const rel = relative(REPO, file);
      if (rel === REGISTRY) continue;
      strip(readFileSync(file, "utf8"), true, true).split("\n").forEach((line, i) => {
        if (INLINE_ATOM_POLICY.test(line)) hits.push(`${rel}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });
});

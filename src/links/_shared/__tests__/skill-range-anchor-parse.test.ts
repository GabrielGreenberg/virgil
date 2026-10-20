// @vitest-environment jsdom
//
// Task 1197 — a card a SKILL pins to a span opens in the app as a span anchor.
//
// `create_card.py --range` writes the two halves of a Mode-B anchor: the
// `\vlid{id}…\vlidend{id}` pair in the .tex and the sidecar link
// `{targetKind:"linkedRange", textRange:{anchorId:id, textSnapshot}}`. The
// Python suite (`editor/scripts/tests/test_range_anchor.py`) pins the bytes.
// This pins the CONTRACT with the app: the bytes the script writes, run
// through the app's real load pipeline — `parseLatex` (which resurrects the
// pair as a default `kind:"note"` mark) → a real main editor →
// `buildModeBReapplyRecords` over the script's sidecars →
// `applyLinkedAnchorsImpl` (the load reconcile) — yield a mark over exactly
// the span, carrying the CARD's kind, in the anchored paragraph; and the
// serializer writes the same pair back.
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule({}),
);

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Editor } from "@tiptap/core";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import { parseLatex } from "@/lib/latex-parser";
import { serializeBodyOnly } from "@/lib/latex-serializer";
import { applyLinkedAnchorsImpl } from "../apply-linked-anchors";
import { buildModeBReapplyRecords, type ModeBCardArrays } from "../reapply-mode-b-anchors";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const CREATE = join(REPO, "editor/scripts/create_card.py");

const TEX = [
  "\\documentclass{article}",
  "\\begin{document}",
  "The reader underlines a phrase and then brackets the argument. %!v:aaaa",
  "",
  "A second paragraph about glosses and their readers. %!v:bbbb",
  "\\end{document}",
  "",
].join("\n");

let dir = "";
let doc = "";

function create(kind: string, anchor: string, span: string, extra: string[] = []): void {
  const spanFile = join(dir, `span-${kind}.txt`);
  writeFileSync(spanFile, span);
  execFileSync(
    "python3",
    [CREATE, doc, `--kind=${kind}`, "--anchor", anchor, "--body", "x", "--range", `@${spanFile}`, ...extra],
    { encoding: "utf8" },
  );
}

const sidecar = (name: string, key: string): never[] => {
  try {
    return JSON.parse(readFileSync(join(doc, "virgil", name), "utf8"))[key] ?? [];
  } catch {
    return [];
  }
};

function mount(): Editor {
  const ctx: EditorExtensionsCtx = {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(ctx),
    content: parseLatex(readFileSync(join(doc, "paper.tex"), "utf8")),
  });
}

/** anchorId → { kind, text, paragraph uuid } for every linkedAnchor run. */
function marks(editor: Editor): Map<string, { kind: string; text: string; para: string }> {
  const out = new Map<string, { kind: string; text: string; para: string }>();
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const m = node.marks.find((mk) => mk.type.name === "linkedAnchor");
    if (!m) return true;
    const para = String(editor.state.doc.resolve(pos).parent.attrs.uuid ?? "");
    const prev = out.get(m.attrs.anchorId as string);
    out.set(m.attrs.anchorId as string, {
      kind: m.attrs.kind as string,
      text: (prev?.text ?? "") + (node.text ?? ""),
      para,
    });
    return true;
  });
  return out;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "range-anchor-"));
  doc = join(dir, "paper");
  mkdirSync(join(doc, "virgil"), { recursive: true });
  writeFileSync(join(doc, "paper.tex"), TEX);
  create("todo", "aaaa", "underlines a phrase");
  create("report", "bbbb", "glosses and their readers", ["--title", "R"]);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("a skill-made range card loads as a span anchor (task 1197)", () => {
  it("the parser resurrects each pair, the reconcile restamps the CARD's kind", () => {
    const editor = mount();
    const before = marks(editor);
    const todo = sidecar("todos.json", "items")[0] as { links: { anchor: { textRange: { anchorId: string } } }[] };
    const report = sidecar("reports.json", "cards")[0] as typeof todo;
    const todoId = todo.links[0].anchor.textRange.anchorId;
    const reportId = report.links[0].anchor.textRange.anchorId;
    // Precondition: the parse alone gives the parser's default kind.
    expect(before.get(todoId)?.kind).toBe("note");

    const bag = {
      notes: [],
      todoItems: sidecar("todos.json", "items"),
      comments: [],
      cutterCards: [],
      reportCards: sidecar("reports.json", "cards"),
      highlights: [],
    } as unknown as ModeBCardArrays;
    applyLinkedAnchorsImpl(editor, buildModeBReapplyRecords(bag));
    const after = marks(editor);

    expect(after.get(todoId)).toEqual({ kind: "todo", text: "underlines a phrase", para: "aaaa" });
    expect(after.get(reportId)).toEqual({
      kind: "report",
      text: "glosses and their readers",
      para: "bbbb",
    });
    expect(after.size).toBe(2);

    // And the save writes the same pair back.
    const tex = serializeBodyOnly(editor.getJSON());
    expect(tex).toContain(`\\vlid{${todoId}}underlines a phrase\\vlidend{${todoId}}`);
    expect(tex).toContain(`\\vlid{${reportId}}glosses and their readers\\vlidend{${reportId}}`);
    editor.destroy();
  });
});

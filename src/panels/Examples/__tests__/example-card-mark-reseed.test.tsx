// @vitest-environment jsdom
//
// Task 1494 — a FORMATTING edit in the main editor reaches an open Example
// card. Bolding a word inside an example is an `AddMarkStep`; until task 1494
// the structure observer recorded content only for `linkedAnchor` marks, so
// the example's `contentRev` never bumped, the card kept the un-bolded text,
// and the card's next keystroke wrote its whole stale block back over the
// paper — silently reverting the bold. The proof drives the REAL path: a mark
// transaction on the main editor, then a keystroke through the card's own
// view (`onUpdate` → `writeBackToMain`).
//
// The extension barrel transitively imports `@/lib/storage` — stub it.

import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

// jsdom has no ResizeObserver; the unified card header measures with one.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { render, cleanup, act } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import type { Editor as TiptapEditor, JSONContent } from "@tiptap/react";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { ExampleCard } from "@/panels/Examples/ExampleCard";
import { EditorRefProvider } from "@/components/editor-layout/contexts/editor-ref";
import type { EditorHandle, ExampleInfo } from "@/components/Editor";

afterEach(() => {
  cleanup();
});

// ── fixtures ────────────────────────────────────────────────────────────────

const EX_UUID = "exuuid01";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
}

/** One example block preceded by `lead` plain paragraphs — the example sits
 *  LAST, which is the worst case for a walk from position 0 and makes the
 *  difference between the two document sizes maximal. */
function docWithLead(lead: number): JSONContent {
  const paras: JSONContent[] = Array.from({ length: lead }, (_, i) => ({
    type: "paragraph",
    attrs: { uuid: `p${String(i).padStart(7, "0")}` },
    content: [{ type: "text", text: `Filler paragraph number ${i}.` }],
  }));
  return {
    type: "doc",
    content: [
      ...paras,
      {
        type: "exampleBlock",
        attrs: { uuid: EX_UUID, number: 1, kind: "single" },
        content: [
          {
            type: "paragraph",
            attrs: { uuid: "exbody01" },
            content: [{ type: "text", text: "Body." }],
          },
        ],
      },
    ],
  };
}

function buildMain(content: JSONContent): TiptapEditor {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const ed = new Editor({
    element: el,
    extensions: buildEditorExtensions(mainCtx()),
    content,
  }) as unknown as TiptapEditor;
  ed.view.dom.setAttribute("data-editable", "true");
  return ed;
}

function handleFor(editor: TiptapEditor): EditorHandle {
  return {
    getEditor: () => editor,
    onConfirmLabelRename: async () => "secondary" as const,
  } as unknown as EditorHandle;
}

const exampleInfo: ExampleInfo = {
  exampleId: EX_UUID,
  pos: 0,
  number: 1,
  kind: "single",
  tag: "",
  label: "",
  preview: "Body.",
  subLabelRange: "",
  bodyText: "Body.",
  bodyContent: {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Body." }] }],
  },
  items: [],
  latex: "",
};

function renderCard(editor: TiptapEditor) {
  return render(
    <EditorRefProvider
      value={{
        editorInstance: editor,
        editorRef: { current: handleFor(editor) },
        setOverrideEditor: () => {},
      }}
    >
      <ExampleCard
        example={exampleInfo}
        isSelected={false}
        onSelect={() => {}}
        onJump={() => {}}
        isPoppedOut
      />
    </EditorRefProvider>,
  );
}

/** The embedded card editor (same fiber climb `ExampleCardEditor.test.tsx`
 *  uses — `useEditor` keeps the instance in React state). */
function looksLikeEditor(v: unknown): v is TiptapEditor {
  return (
    !!v &&
    typeof (v as TiptapEditor).getJSON === "function" &&
    typeof (v as TiptapEditor).setEditable === "function" &&
    !!(v as TiptapEditor).view
  );
}
function deepScan(obj: unknown, seen: Set<unknown>, depth: number): TiptapEditor | null {
  if (!obj || typeof obj !== "object" || seen.has(obj) || depth > 4) return null;
  seen.add(obj);
  if (looksLikeEditor(obj)) return obj;
  for (const v of Object.values(obj as Record<string, unknown>)) {
    const r = deepScan(v, seen, depth + 1);
    if (r) return r;
  }
  return null;
}
function embeddedEditor(container: HTMLElement): TiptapEditor {
  let cur: Element | null =
    container.querySelector(".example-card-editor")?.parentElement ?? null;
  while (cur) {
    const key = Object.keys(cur).find((k) => k.startsWith("__reactFiber$"));
    if (key) {
      let f = (
        cur as unknown as Record<
          string,
          { memoizedProps?: unknown; memoizedState?: unknown; return?: unknown }
        >
      )[key];
      let depth = 0;
      while (f && depth < 40) {
        const hit =
          deepScan(f.memoizedProps, new Set(), 0) ??
          deepScan(f.memoizedState, new Set(), 0);
        if (hit) return hit;
        f = f.return as typeof f;
        depth++;
      }
    }
    cur = cur.parentElement;
  }
  throw new Error("card editor not reachable");
}

function hasBold(node: JSONContent | undefined): boolean {
  if (!node) return false;
  if (node.type === "text" && node.marks?.some((m) => m.type === "bold")) return true;
  return (node.content ?? []).some(hasBold);
}

function exampleJson(ed: TiptapEditor): JSONContent | undefined {
  return (ed.getJSON().content ?? []).find((n) => n.type === "exampleBlock");
}

describe("example card hears a main-editor formatting edit (task 1494)", () => {
  it("bolding inside the example re-seeds the open card, and typing there keeps the bold", () => {
    const main = buildMain(docWithLead(2));
    let container!: HTMLElement;
    act(() => {
      ({ container } = renderCard(main));
    });
    const cardEd = embeddedEditor(container);
    expect(hasBold(cardEd.getJSON())).toBe(false);

    // Bold "Body" inside the example, in the MAIN editor.
    let exStart = -1;
    main.state.doc.forEach((n, off) => {
      if (n.type.name === "exampleBlock") exStart = off;
    });
    act(() => {
      main.view.dispatch(
        main.state.tr.addMark(exStart + 2, exStart + 6, main.schema.marks.bold.create()),
      );
    });
    // The card re-seeded from the live block.
    expect(hasBold(cardEd.getJSON())).toBe(true);

    // A keystroke in the card writes the whole block back — with the bold.
    act(() => {
      cardEd.view.dispatch(cardEd.state.tr.insertText("x", cardEd.state.doc.content.size - 2));
    });
    const after = exampleJson(main);
    expect(JSON.stringify(after)).toContain("x");
    expect(hasBold(after)).toBe(true);
    main.destroy();
  });
});

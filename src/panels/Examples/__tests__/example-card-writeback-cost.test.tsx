// @vitest-environment jsdom
//
// Task 723 — the example CARD's write-back costs O(depth) per keystroke, not
// O(doc).
//
// Typing inside an expanded example card fires the embedded editor's
// `onUpdate` → `writeBackToMain`, which has to answer "where is my
// exampleBlock in the MAIN document?" before it can splice. Until task 723 the
// card answered that with its own private `doc.descendants` walk — work
// proportional to the whole paper, on every press, fanned out across every
// rendered card. The example FLOAT had already been fixed (task 140) by
// threading its live source range into the SHARED resolver as a position
// hint; the card was a textually independent copy of the same function, so
// the fix never reached it.
//
// The shape of the proof (the repo's `decoration-probe-cost` /
// `content-drag-move-cost` precedent): drive the SAME keystroke burst through
// the card in a SMALL document and in a LARGE one, and count how many nodes
// the resolver visits. A doc-proportional resolver's count scales with the
// document; a hinted one's does not.
//
// Counting is scoped to the resolver itself — `Node.prototype.nodesBetween`
// is instrumented, but the counter only accrues while a call is INSIDE
// `findSourceNodeByUuid` / `findAndTrackSourceNode`. Without that scoping the
// measurement would be swamped by the main editor's own plugins reacting to
// the write-back's transaction, which is a different contract (keystroke
// sanctity, pinned in `ExampleCardEditor.test.tsx`).
//
// The extension barrel transitively imports `@/lib/storage` (the known barrel/
// storage gotcha) — stub it wholesale; nothing here calls a storage fn.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

// The resolver module is wrapped rather than replaced: both doors call
// through to the real implementation, with a flag raised for the duration so
// the `nodesBetween` instrumentation below knows a visit belongs to a
// resolution.
const probe = { depth: 0, visits: 0 };
vi.mock("@/lib/float-source-range", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("@/lib/float-source-range")>();
  const wrap = <A extends unknown[], R>(fn: (...a: A) => R) =>
    (...a: A): R => {
      probe.depth++;
      try {
        return fn(...a);
      } finally {
        probe.depth--;
      }
    };
  return {
    ...real,
    findSourceNodeByUuid: wrap(real.findSourceNodeByUuid),
    findAndTrackSourceNode: wrap(real.findAndTrackSourceNode),
  };
});

// jsdom has no ResizeObserver; the unified card header measures with one.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { render, cleanup, act } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { Node as PMNode } from "@tiptap/pm/model";
import type { Editor as TiptapEditor, JSONContent } from "@tiptap/react";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
// Resolves to the wrapper installed above, so a direct call is counted too.
import { findSourceNodeByUuid } from "@/lib/float-source-range";
import { ExampleCard } from "@/panels/Examples/ExampleCard";
import { EditorRefProvider } from "@/components/editor-layout/contexts/editor-ref";
import type { EditorHandle, ExampleInfo } from "@/components/Editor";

// ── node-visit instrumentation ──────────────────────────────────────────────
// `descendants(f)` is `nodesBetween(0, size, f)` in prosemirror-model, so one
// patch covers BOTH the full walk and the resolver's bounded region scan —
// and it counts VISITS, which is the quantity that is doc-proportional, not
// call count.
type NodesBetween = PMNode["nodesBetween"];
const realNodesBetween: NodesBetween = PMNode.prototype.nodesBetween;

beforeEach(() => {
  probe.depth = 0;
  probe.visits = 0;
  PMNode.prototype.nodesBetween = function (
    this: PMNode,
    from: number,
    to: number,
    f: Parameters<NodesBetween>[2],
    ...rest: unknown[]
  ) {
    if (probe.depth === 0) {
      return (realNodesBetween as (...a: unknown[]) => unknown).call(
        this,
        from,
        to,
        f,
        ...rest,
      );
    }
    const counting: typeof f = (...args: Parameters<typeof f>) => {
      probe.visits++;
      return f(...args);
    };
    return (realNodesBetween as (...a: unknown[]) => unknown).call(
      this,
      from,
      to,
      counting,
      ...rest,
    );
  } as NodesBetween;
});

afterEach(() => {
  PMNode.prototype.nodesBetween = realNodesBetween;
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
    onConfirmLabelRename: async () => false,
    onConfirmHeadingDelete: async () => true,
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

const BURST = 6;

/** Mount a card over a document with `lead` filler paragraphs, type `BURST`
 *  characters through the card's own view (the real `onUpdate` →
 *  `writeBackToMain` path), and report the resolver's node visits for the
 *  burst — excluding mount + first press, which are the cold-start reads the
 *  hint is allowed to cost. */
function visitsForBurst(lead: number): number {
  const main = buildMain(docWithLead(lead));
  let container!: HTMLElement;
  act(() => {
    ({ container } = renderCard(main));
  });
  const cardEd = embeddedEditor(container);
  // Cold start: mount seed + the first write-back may walk (no hint yet).
  act(() => {
    cardEd.view.dispatch(cardEd.state.tr.insertText("0", 2));
  });
  probe.visits = 0;
  for (let i = 0; i < BURST; i++) {
    act(() => {
      cardEd.view.dispatch(cardEd.state.tr.insertText("x", 2));
    });
  }
  const visits = probe.visits;
  main.destroy();
  return visits;
}

describe("example card write-back cost (task 723)", () => {
  it("resolves the write-back target without work proportional to the document", () => {
    const small = visitsForBurst(4);
    const large = visitsForBurst(400);

    // The contract, stated as the audit stated it: the per-keystroke
    // resolution does not grow with document size. A 100× longer document
    // must not cost more resolver visits.
    expect(large).toBeLessThanOrEqual(small + BURST);

    // And the absolute claim behind it — a hinted resolution answers from
    // `doc.resolve(hint.from)` in O(depth) and visits no nodes at all. Stated
    // as a generous per-keystroke ceiling so a future bounded region scan
    // (the resolver's tier-2 fallback) would still pass, while the O(doc)
    // walk this task removed — ~400 visits per press in the large fixture —
    // could not.
    expect(large).toBeLessThan(BURST * 8);
  });

  it("the same burst in the OLD shape would have been doc-proportional (control)", () => {
    // Guards the measurement itself: if the instrumentation stopped counting
    // (a renamed door, a resolver that no longer goes through `nodesBetween`),
    // the test above would pass vacuously. Drive the resolver's UNHINTED
    // path directly over both fixtures and confirm the probe does see the
    // walk scale with the document.
    const smallDoc = buildMain(docWithLead(4));
    const largeDoc = buildMain(docWithLead(400));

    probe.visits = 0;
    findSourceNodeByUuid(smallDoc.state.doc, EX_UUID, "exampleBlock", null);
    const small = probe.visits;

    probe.visits = 0;
    findSourceNodeByUuid(largeDoc.state.doc, EX_UUID, "exampleBlock", null);
    const large = probe.visits;

    expect(small).toBeGreaterThan(0);
    expect(large).toBeGreaterThan(small * 10);

    smallDoc.destroy();
    largeDoc.destroy();
  });
});

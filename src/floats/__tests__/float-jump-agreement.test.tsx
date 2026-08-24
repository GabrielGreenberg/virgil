// @vitest-environment jsdom
/**
 * Task 435 — **a float's jump affordance agrees with the body it wraps.**
 *
 * `FloatChrome` paints the jump chevron on exactly one input (`canJump`), so a
 * float's `canJump` IS the affordance. Two builders handed it a hardcoded
 * `true` while the answer was already in the same scope:
 *
 *   (A) `archive` — the builder computed `orphaned` from `ctx.anchoredIds` (the
 *       task-369 anchor authority) two lines above and threw it away, so a
 *       popped-out clip whose anchor the four-rung ladder cannot resolve
 *       painted a live Jump whose handler (`jumpToCard`) resolves no link and
 *       returns `false` having done nothing.
 *
 *   (B) `textobject` — a text-object float OUTLIVES its source, and the body
 *       already detects it and renders "Source paragraph deleted — float is
 *       disconnected". The chrome above that banner kept its chevron, which
 *       called `scrollToParagraphId` on a uuid the document no longer has.
 *
 * Every existing float suite drives the CHROME with a hand-supplied `canJump`,
 * so the disagreement between a builder's literal and its own body was
 * unrepresentable in all of them. These legs drive the two REAL producers.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode, Ref } from "react";

// The extension barrel / card factory graph transitively pulls `@/lib/storage`,
// whose `require("@/lib/storage-fsa")` vitest's resolver can't alias (the known
// gotcha). No-op every export — nothing here reads or writes a sidecar.
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

// Thin FloatingPanel passthrough — the legs below exercise the chrome wiring,
// not the panel internals (mirrors `FloatWindow-drop-dispatch.test.tsx`).
vi.mock("@/components/FloatingPanel", async () => {
  const { forwardRef, useImperativeHandle, createElement } = await import(
    "react"
  );
  const FloatingPanelMock = forwardRef(function FloatingPanelMock(
    { children }: { children: ReactNode },
    ref: Ref<unknown>,
  ) {
    useImperativeHandle(ref, () => ({
      setRect: () => {},
      beginDragAt: () => {},
    }));
    return createElement("div", { "data-testid": "panel" }, children);
  });
  return { __esModule: true, default: FloatingPanelMock };
});

vi.mock("@/components/card-lift", () => ({
  consumeCardLiftHandoff: () => null,
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { render, screen, act, cleanup } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";

// Registers every poppable card kind's `toFloatable` builder (side effect).
import "@/cards/floats";
import { CARD_REGISTRY } from "@/cards/card-registry";
import type { CardFloatCtx } from "@/cards/card-float-ctx";
import { FloatWindow } from "@/floats/FloatWindow";
import type { Floatable } from "@/floats/types";
import {
  PoppedCardsContext,
  type PoppedCardsValue,
} from "@/hooks/usePoppedCards";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  SourceMissingBanner,
  useFloatMainSync,
  type SourceRange,
} from "@/lib/float-sync";
import { findSourceNodeByUuid } from "@/lib/float-source-range";

const REPO_SRC = join(process.cwd(), "src");

afterEach(cleanup);

// ── (A) archive: the builder reads the authority it already computed ────────

const richDoc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

/** Build the REAL archive `Floatable` through `CARD_REGISTRY`, with an
 *  `anchoredIds` set that either holds the clip's id or doesn't. */
function archiveFloatable(anchored: boolean, jump = vi.fn()) {
  const ctx = {
    archiveSnippets: [
      {
        id: "arch-1",
        title: "Arch",
        content: richDoc("arch body"),
        createdAt: "t",
        links: [],
      },
    ],
    anchoredIds: anchored ? new Set(["arch-1"]) : new Set<string>(),
    selectedArchiveId: null,
    editorRef: { current: { jumpToCard: jump } },
  } as unknown as CardFloatCtx;
  return CARD_REGISTRY.archive.toFloatable("arch-1", ctx);
}

describe("task 435 (A) — the archive float reads the anchor authority", () => {
  it("an ORPHANED clip offers no jump, and its handler is inert", () => {
    const jump = vi.fn();
    const f = archiveFloatable(false, jump);
    expect(f).not.toBeNull();
    expect(f!.canJump).toBe(false);
    // Gate BOTH halves (task 136's rule): a keyboard/programmatic path that
    // reaches `jumpToSource` anyway must not call the dead handler.
    f!.jumpToSource();
    expect(jump).not.toHaveBeenCalled();
  });

  it("CONTROL — an ANCHORED clip still offers a working jump", () => {
    const jump = vi.fn();
    const f = archiveFloatable(true, jump);
    expect(f!.canJump).toBe(true);
    f!.jumpToSource();
    expect(jump).toHaveBeenCalledTimes(1);
  });
});

// ── The census — the leg with teeth ────────────────────────────────────────
//
// The builders were never the part that could misbehave. A builder that
// RESOLVES an anchor answer three lines above and then hands `canJump` a
// literal is, and it type-checks perfectly and is invisible to every
// behavioural test of the chrome. Allowlist EMPTY.

/** Split `src/cards/floats/index.tsx` into one region per BUILDER — a
 *  `registerCardFloatable("<kind>", …)` call and everything up to the next one,
 *  which is exactly the closure whose `canJump` and whose `renderBody` must
 *  agree. Membership is DISCOVERED from the file, so a new poppable kind is
 *  censused by shipping.
 *
 *  Keying on the REGISTRATION rather than on the inner `cardFloatable(` call is
 *  load-bearing: two builders (`footnote`) fork into a helper, so a
 *  `cardFloatable(`-keyed split puts one kind's `registerCardFloatable` line
 *  inside the PREVIOUS kind's region and a per-kind lookup silently answers
 *  about the wrong builder — measured, that made the archive leg pass under its
 *  own neuter. */
function builderRegions(): { kind: string; start: number; text: string }[] {
  const src = readFileSync(join(REPO_SRC, "cards/floats/index.tsx"), "utf8");
  const lines = src.split("\n");
  const starts: { kind: string; i: number }[] = [];
  lines.forEach((l, i) => {
    const m = /registerCardFloatable\(\s*"([^"]+)"/.exec(l);
    if (m && !/^\s*(\*|\/\/)/.test(l)) starts.push({ kind: m[1], i });
  });
  return starts.map((s, k) => ({
    kind: s.kind,
    start: s.i + 1,
    text: lines.slice(s.i, starts[k + 1]?.i ?? lines.length).join("\n"),
  }));
}

describe("task 435 census — no builder states an anchor answer it already resolved", () => {
  it("no `cardFloatable(` closure pairs a literal `canJump: true` with a resolved anchor answer", () => {
    const offenders = builderRegions()
      .filter((r) => /canJump:\s*true\b/.test(r.text))
      // Comments (and the doc-comments above a builder) legitimately DISCUSS
      // `anchored` / `orphaned` / `pos`; only code counts.
      .filter((r) =>
        r.text
          .split("\n")
          .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
          .some((l) => /\b(orphaned|anchored|isAnchored|pos)\b/.test(l)),
      )
      .map((r) => `${r.kind} @ src/cards/floats/index.tsx:${r.start}`);
    expect(offenders).toEqual([]);
  });

  it("the split is per BUILDER — every registered kind gets its OWN region", () => {
    const regions = builderRegions();
    // Every `registerCardFloatable(` line in the file starts a region, and no
    // region swallows another kind's registration (the vacuous-lookup trap).
    const src = readFileSync(join(REPO_SRC, "cards/floats/index.tsx"), "utf8");
    const registered = [...src.matchAll(/registerCardFloatable\(\s*"([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(regions.map((r) => r.kind)).toEqual(registered);
    expect(new Set(registered).size).toBe(registered.length);
    for (const r of regions) {
      const inner = r.text.split("\n").slice(1).join("\n");
      expect(/registerCardFloatable\(/.test(inner)).toBe(false);
    }
  });

  it("the census can SEE the shape (canary — a synthetic offending region is flagged)", () => {
    // A canary must not stand on the defect: this is a synthetic string, not a
    // production line the fix has just drained.
    const synthetic = [
      "  return cardFloatable('archive', id, {",
      "    canJump: true,",
      "    jumpToSource: () => ctx.editorRef.current?.jumpToCard(snippet, null),",
      "    renderBody: () => <Card orphaned={orphaned} />,",
      "  });",
    ].join("\n");
    expect(/canJump:\s*true\b/.test(synthetic)).toBe(true);
    expect(
      synthetic
        .split("\n")
        .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
        .some((l) => /\b(orphaned|anchored|isAnchored|pos)\b/.test(l)),
    ).toBe(true);
  });

  it("the archive builder no longer spells a bare `canJump: true`", () => {
    const region = builderRegions().find((r) => r.kind === "archive");
    expect(region).toBeTruthy();
    expect(/canJump:\s*true\b/.test(region!.text)).toBe(false);
  });

  it("`anchoredIds` is REQUIRED on the deps bag (an optional field makes the answer silently undefined)", () => {
    const src = readFileSync(
      join(REPO_SRC, "components/editor-layout/floating-cards.tsx"),
      "utf8",
    );
    expect(src).toMatch(/^\s*anchoredIds: Set<string>;/m);
    expect(src).not.toMatch(/anchoredIds\?:/);
  });
});

// ── (B) textobject: the header and the body agree, driven end to end ────────

function extCtx(surface: "main" | "float"): EditorExtensionsCtx {
  return {
    surface,
    editableRef: { current: true },
    editable: true,
    cardContext: surface === "float",
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  } as unknown as EditorExtensionsCtx;
}

const editors: Editor[] = [];
afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
});

function mountEditor(content: JSONContent, surface: "main" | "float"): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(extCtx(surface)),
    content,
  });
  editors.push(editor);
  return editor;
}

function para(uuid: string, text: string): JSONContent {
  return { type: "paragraph", attrs: { uuid }, content: [{ type: "text", text }] };
}

const poppedStub: PoppedCardsValue = {
  poppedKeys: [],
  popOut: () => {},
  popOutAtRect: () => {},
  close: () => {},
  isPoppedOut: () => false,
  getFloatPosition: () => undefined,
  setFloatPosition: () => {},
} as unknown as PoppedCardsValue;

/** A REAL paragraph float body: the real `useFloatMainSync` against a real main
 *  editor, rendering the real `SourceMissingBanner` — i.e. the exact chain a
 *  popped-out paragraph runs. */
function ParagraphBody({
  main,
  float,
  uuid,
}: {
  main: Editor;
  float: Editor;
  uuid: string;
}) {
  const { sourceMissing } = useFloatMainSync({
    mainEditor: main,
    floatEditor: float,
    floatId: `paragraph:${uuid}`,
    readSource: (doc: PMNode, hint: SourceRange | null) => {
      const src = findSourceNodeByUuid(doc, uuid, "paragraph", hint);
      if (!src) {
        return {
          doc: { type: "doc", content: [{ type: "paragraph" }] } as JSONContent,
          missing: true,
        };
      }
      return {
        doc: { type: "doc", content: [src.node.toJSON() as JSONContent] } as JSONContent,
        missing: false,
        range: { from: src.start, to: src.end },
      };
    },
  });
  return sourceMissing ? (
    <SourceMissingBanner kind="paragraph" onClose={() => {}} />
  ) : (
    <div data-testid="body-live">live</div>
  );
}

function textObjectFloatable(main: Editor, float: Editor, uuid: string): Floatable {
  return {
    key: `float:textobject:paragraph:${uuid}`,
    domain: "textobject",
    kind: "paragraph",
    id: uuid,
    title: "Paragraph",
    surface: "card",
    // The STATIC half — what this KIND can ever offer. The live half is the
    // body's own report; the two must be combined by the window, not restated.
    canJump: true,
    jumpToSource: () => {},
    snapshotForStack: () => null,
    renderBody: () => <ParagraphBody main={main} float={float} uuid={uuid} />,
  };
}

describe("task 435 (B) — a text-object float's header agrees with its body", () => {
  it("deleting the source paragraph withdraws the jump chevron in the SAME state as the banner", () => {
    const main = mountEditor(
      { type: "doc", content: [para("p1", "one"), para("p2", "two")] },
      "main",
    );
    const float = mountEditor({ type: "doc", content: [para("p2", "two")] }, "float");

    render(
      <PoppedCardsContext.Provider value={poppedStub}>
        <FloatWindow
          floatable={textObjectFloatable(main, float, "p2")}
          windowKey="float:textobject:paragraph:p2"
        />
      </PoppedCardsContext.Provider>,
    );

    // CONTROL — source alive: the body is live and the chevron is offered.
    expect(screen.getByTestId("body-live")).toBeTruthy();
    expect(screen.queryByLabelText("Jump to paragraph")).toBeTruthy();

    // Delete the source paragraph in main.
    const src = findSourceNodeByUuid(main.state.doc, "p2", "paragraph");
    expect(src).toBeTruthy();
    act(() => {
      main.view.dispatch(main.state.tr.delete(src!.start, src!.end));
    });

    // The contract is that the two AGREE — not that either is right alone.
    expect(screen.getByRole("status").textContent).toContain(
      "Source paragraph deleted",
    );
    expect(screen.queryByLabelText("Jump to paragraph")).toBeNull();
  });

  it("an undo that restores the source brings the chevron back", () => {
    const main = mountEditor(
      { type: "doc", content: [para("p1", "one"), para("p2", "two")] },
      "main",
    );
    const float = mountEditor({ type: "doc", content: [para("p2", "two")] }, "float");

    render(
      <PoppedCardsContext.Provider value={poppedStub}>
        <FloatWindow
          floatable={textObjectFloatable(main, float, "p2")}
          windowKey="float:textobject:paragraph:p2"
        />
      </PoppedCardsContext.Provider>,
    );

    const src = findSourceNodeByUuid(main.state.doc, "p2", "paragraph")!;
    act(() => {
      main.view.dispatch(main.state.tr.delete(src.start, src.end));
    });
    expect(screen.queryByLabelText("Jump to paragraph")).toBeNull();

    act(() => {
      main.commands.undo();
    });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByLabelText("Jump to paragraph")).toBeTruthy();
  });

  it("a float whose KIND offers no jump stays jump-less however its body reports", () => {
    const main = mountEditor({ type: "doc", content: [para("p1", "one")] }, "main");
    const float = mountEditor({ type: "doc", content: [para("p1", "one")] }, "float");
    const f = textObjectFloatable(main, float, "p1");
    render(
      <PoppedCardsContext.Provider value={poppedStub}>
        <FloatWindow
          floatable={{ ...f, canJump: false }}
          windowKey="float:textobject:paragraph:p1"
        />
      </PoppedCardsContext.Provider>,
    );
    expect(screen.queryByLabelText("Jump to paragraph")).toBeNull();
  });
});

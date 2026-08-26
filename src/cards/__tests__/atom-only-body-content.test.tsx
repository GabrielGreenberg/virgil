// @vitest-environment jsdom
//
// TASK 401 — a gate written in the vocabulary of NODE TYPES and TEXT cannot see
// content that lives in ATTRS.
//
// `hasJsonContent` recursed looking for `text` nodes and had no `attrs` arm, so
// `cardHasContent(kind, rec)` answered FALSE for a body that is entirely one
// atom — `$\lambda$`, a citation, a `\ref`, a display-math block, a tex block, a
// forest tree, a caption-less figure. Virgil's payload very often lives in
// attrs, so that is not an exotic body: it is the ordinary shape of a footnote
// holding one formula.
//
// The headline cost was DESTRUCTION, not a missing dialog. `EditorPane`'s
// `handleEditFootnote` marks a new footnote DIRTY only when the predicate says
// the body has content, so an atom-only footnote stayed "pristine"; the
// document-level `pointerdown` watcher in `usePristineCardManager` then fired
// the discard, and the discard handler re-asked the SAME blind predicate before
// deleting. Create a footnote, type `$\lambda$`, click anywhere else: gone. No
// confirm, no orphan card, no undo affordance — and a footnote body is by
// construction the only copy.
//
// Four more doors share the predicate, which is what makes the one-function fix
// total: `EditableCard.tryDelete` (the trash click AND the task-386 key door),
// `usePanelCardTryDelete`, `deleteMarginItem`, and the footnote ORPHAN gate.
// The ARCHIVE case is the worst blast radius — an archive card is born with an
// empty title, its capture DELETES the passage from the document first, and
// there is nothing else for the gate to see.
//
// Three layers here, mirroring the fix:
//   1. THE PREDICATE — swept per member of the blind set, from the declaration
//      (`ATOM_REGISTRY` ∪ `CARD_BODY_BLOCK_ATOMS`) rather than a hand list, so a
//      new atom kind is covered by declaring itself. Plus the CONTROLS: a
//      genuinely empty body must still answer false, or all five doors start
//      confirming on every blank card.
//   2. THE DOORS — one leg each, because they share the predicate and a leg per
//      door is what proves the sharing. The pristine reap is driven through the
//      REAL `usePristineCardManager` with the REAL predicate composed exactly as
//      EditorPane composes it.
//   3. THE CENSUS — EditorPane's two footnote gates must ask the shared
//      predicate. A hand-inlined "does the body have text" check beside them
//      would reinstate the defect with every behavioural leg green.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// `panel-primitives` transitively imports `@/lib/storage` (card body surfaces →
// figure/graphics NodeViews). Same stub the sibling schema suites use — nothing
// here calls a storage function.
vi.mock("@/lib/storage", () => {
  const STORAGE_FNS = [
    "readSidecar", "readSidecarIfExists", "writeSidecar", "mutateSidecar", "readTex",
    "writeTex", "readDocBundle", "writeDocBundle", "readBib", "writeBib",
    "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
    "registerDocInFolder", "openExistingDocFromPicker", "listDocs", "renameDoc",
    "deleteDocFromIndex", "flushDoc", "drainDoc", "detectBibPackage",
    "readPaperFolder", "getTexFilename", "writePdf", "readPdf", "getPdfFilename",
    "pdfFilenameFromTex", "readFigureSource", "readFigureRaster",
    "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
    "snapshotPriorBundle", "snapshotConflictSides",
  ];
  const mod: Record<string, unknown> = { isDevStorage: false };
  for (const name of STORAGE_FNS) mod[name] = vi.fn();
  return mod;
});
import fs from "node:fs";
import path from "node:path";
import { renderHook, render, screen, act, cleanup, fireEvent } from "@testing-library/react";

import { cardHasContent } from "../has-content";
import { jsonCarriesContent, CARD_BODY_BLOCK_ATOMS } from "@/lib/node-attr-sets";
import { ATOM_REGISTRY } from "@/lib/tiptap/atom-registry";
import { usePristineCardManager } from "@/hooks/usePristineCardManager";
import { EditableCard, usePanelCardTryDelete } from "@/components/panel-primitives";
import { themeFromAccent } from "@/lib/panel-theme";
import { deleteMarginItem, type MarginItemHandlers } from "../delete-margin-item";
import type { CardWithLinks } from "@/links/links";
import { commentsStripped } from "@/lib/__tests__/_source-scan";

const REPO_ROOT = path.resolve(__dirname, "../../..");

// jsdom ships no global `CSS`, and the pristine watcher builds its lookup
// selector with `CSS.escape`. Same polyfill the sibling pristine suite uses.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

if (typeof (globalThis as { CSS?: unknown }).CSS === "undefined") {
  (globalThis as { CSS?: { escape: (s: string) => string } }).CSS = {
    escape: (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`),
  };
}

/** The PM node NAMES of the inline atoms — `ATOM_REGISTRY` is keyed by ATOM
 *  KIND (`ref`, `inline-math`), and the node names are a declared column on it.
 *  Reading the keys would sweep the wrong vocabulary, silently. */
const INLINE_ATOM_NODES: readonly string[] = Object.values(ATOM_REGISTRY).map(
  (m) => m.nodeName,
);

/** A doc whose whole body is ONE node of `type`, carrying its payload in attrs
 *  exactly as the schema does. */
function atomOnlyBody(type: string, attrs: Record<string, unknown>): unknown {
  const node = { type, attrs };
  // Inline atoms live inside a paragraph; block atoms sit at doc level. Both
  // shapes hold zero text, which is the whole point.
  return INLINE_ATOM_NODES.includes(type)
    ? { type: "doc", content: [{ type: "paragraph", content: [node] }] }
    : { type: "doc", content: [node] };
}

/** Per-member payloads. Derived membership, hand-written ATTRS — an atom's attr
 *  NAMES are its own schema's business and there is no table to sweep them
 *  from; what matters is that the SET of members comes from the declarations. */
const ATOM_ATTRS: Record<string, Record<string, unknown>> = {
  inlineMath: { latex: "\\lambda" },
  citation: { command: "\\cite{smith2020}", citationId: "c1" },
  labelRef: { label: "sec:a", refCommand: "ref" },
  footnote: { footnoteId: "f9", content: null },
  displayMath: { latex: "E=mc^2" },
  texBlock: { code: "\\begin{align}x\\end{align}" },
  forestBlock: { source: "\\begin{forest}[S]\\end{forest}" },
  graphicsBlock: { command: "\\includegraphics{a.png}" },
  // A caption-LESS figure: `content: "figureCaption?"`, so it holds no text at
  // all and its payload is the image path on the attrs.
  figureBlock: { src: "fig/a.png" },
  latexComment: {},
};

/** The blind set, DISCOVERED: every inline atom the registry declares, plus
 *  every block atom a card body's schema registers.
 *
 *  `figureCaption` is a member of the block-atom vocabulary and NOT of the blind
 *  set — its content is `inline*`, so a caption with text was always seen and a
 *  caption without one carries nothing on its own (it is the enclosing
 *  `figureBlock` that is the content). Stated here rather than silently absent,
 *  because the two facts are easy to conflate. */
const NOT_BLIND: readonly string[] = ["figureCaption"];

const BLIND_MEMBERS: readonly string[] = [
  ...INLINE_ATOM_NODES,
  ...CARD_BODY_BLOCK_ATOMS,
].filter((t, i, a) => a.indexOf(t) === i && !NOT_BLIND.includes(t));

// ── Layer 1 · the predicate ────────────────────────────────────────────────

describe("401 · an atom-only body is CONTENT", () => {
  it("every member of the blind set has a fixture (so the sweep can't go quiet)", () => {
    const missing = BLIND_MEMBERS.filter((t) => !(t in ATOM_ATTRS));
    expect(missing, "a new atom kind shipped with no payload here").toEqual([]);
  });

  it.each(BLIND_MEMBERS)("%s alone in a body reads as content", (type) => {
    const body = atomOnlyBody(type, ATOM_ATTRS[type]);
    expect(jsonCarriesContent(body), `${type}: walker`).toBe(true);
    // Through the real card door, for a kind that declares `bodyField`.
    expect(cardHasContent("footnote", { content: body }), `${type}: footnote`).toBe(true);
    expect(cardHasContent("archive", { content: body }), `${type}: archive`).toBe(true);
    expect(cardHasContent("note", { content: body }), `${type}: note`).toBe(true);
  });

  // The CONTROLS. Without these the fix is "confirm on everything", which is a
  // worse product than the bug: every blank card would nag on delete and no
  // pristine card would ever be reaped.
  it.each([
    ["an empty doc", { type: "doc", content: [] }],
    ["doc > paragraph (emptyRichContent)", { type: "doc", content: [{ type: "paragraph" }] }],
    ["two empty paragraphs", { type: "doc", content: [{ type: "paragraph" }, { type: "paragraph" }] }],
    ["whitespace-only text", {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "   " }] }],
    }],
    // Unreachable from a live PM doc (PM forbids empty text nodes) and entirely
    // reachable from hand-built JSON — an `/editor/*` skill's sidecar write, a
    // legacy blob. A text node's content IS its `text` field.
    ["an EMPTY text node", {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "" }] }],
    }],
    ["null", null],
    ["undefined", undefined],
  ])("%s still reads as EMPTY", (_label, body) => {
    expect(jsonCarriesContent(body)).toBe(false);
    expect(cardHasContent("footnote", { content: body })).toBe(false);
  });

  it("ordinary prose still reads as content (the walker didn't stop working)", () => {
    const body = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }] };
    expect(cardHasContent("note", { content: body })).toBe(true);
  });

  it("a title-only footnote still counts (FN-A1-02 is not regressed)", () => {
    expect(cardHasContent("footnote", { content: null, title: "Acknowledgements" })).toBe(true);
  });
});

// ── Layer 2 · the five doors ───────────────────────────────────────────────

const MATH_BODY = atomOnlyBody("inlineMath", ATOM_ATTRS.inlineMath);

describe("401 · door 1 — the footnote pristine reap (the headline)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  function mountCard(id: string): void {
    const el = document.createElement("div");
    el.setAttribute("data-pristine-card-id", id);
    document.body.appendChild(el);
  }

  function clickAway(): void {
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    outside.remove();
  }

  /** EditorPane's composition, verbatim: the edit handler marks dirty only when
   *  the predicate sees content, and the registered discard re-asks the same
   *  predicate against the LIVE footnote before deleting. The census below pins
   *  that production still spells it this way. */
  function driveFootnote(body: unknown) {
    const { result } = renderHook(() => usePristineCardManager());
    const api = result.current.forKind("footnotes");
    const live = new Map<string, { content: unknown; title?: string }>();
    const deleted: string[] = [];

    act(() => {
      api.registerDiscard((id) => {
        setTimeout(() => {
          const fn = live.get(id);
          if (!fn) return;
          if (cardHasContent("footnote", { content: fn.content, title: fn.title })) return;
          deleted.push(id);
          live.delete(id);
        }, 0);
      });
      // Created blank, registered pristine — the real `createEmptyFootnote` path.
      live.set("f1", { content: { type: "doc", content: [{ type: "paragraph" }] } });
      api.markNew("f1");
    });
    mountCard("f1");

    // The user inserts the atom. `handleEditFootnote`'s gate:
    act(() => {
      live.set("f1", { content: body });
      if (cardHasContent("footnote", { content: body })) api.markDirty("f1");
    });

    act(() => clickAway());
    act(() => vi.runAllTimers());
    return { deleted, live };
  }

  it("a footnote whose whole body is `$\\lambda$` SURVIVES a click-away", () => {
    const { deleted, live } = driveFootnote(MATH_BODY);
    expect(deleted, "the footnote was reaped").toEqual([]);
    expect(live.has("f1")).toBe(true);
  });

  it.each(BLIND_MEMBERS)("…and so does one whose body is a %s", (type) => {
    const { deleted } = driveFootnote(atomOnlyBody(type, ATOM_ATTRS[type]));
    expect(deleted).toEqual([]);
  });

  it("a genuinely blank footnote is STILL reaped (the control)", () => {
    const { deleted } = driveFootnote({ type: "doc", content: [{ type: "paragraph" }] });
    expect(deleted).toEqual(["f1"]);
  });
});

describe("401 · door 2 — usePanelCardTryDelete confirms", () => {
  afterEach(cleanup);

  function Harness({ body }: { body: unknown }) {
    const { tryDelete, dialog } = usePanelCardTryDelete(
      "note",
      { id: "n1", content: body },
      "n1",
      () => {
        /* the delete itself is irrelevant — the CONFIRM is the contract */
      },
    );
    return (
      <div>
        <button onClick={tryDelete}>trash</button>
        {dialog}
      </div>
    );
  }

  it("an atom-only note body raises the 'This item has text' confirm", async () => {
    render(<Harness body={MATH_BODY} />);
    await act(async () => {
      screen.getByText("trash").click();
    });
    expect(screen.queryByText(/This item has text/i)).not.toBeNull();
  });

  it("an empty note body deletes straight through (the control)", async () => {
    render(<Harness body={{ type: "doc", content: [{ type: "paragraph" }] }} />);
    await act(async () => {
      screen.getByText("trash").click();
    });
    expect(screen.queryByText(/This item has text/i)).toBeNull();
  });
});

describe("401 · door 3 — deleteMarginItem confirms", () => {
  function run(body: unknown, answer: boolean) {
    const card = {
      id: "c1",
      kind: "note",
      content: body,
      links: [{ anchor: { type: "textObject", textObjectIds: ["P1"] } }],
    } as unknown as CardWithLinks;
    const del = vi.fn(async () => true);
    const confirm = vi.fn(async () => answer);
    const handlers: MarginItemHandlers = {
      findCard: () => card,
      // The capture-retarget half of the bundle (task 491) — unused by the
      // delete path under test, present because the bundle is one door.
      cards: [card],
      contentKind: "note",
      unanchor: vi.fn(),
      reanchor: vi.fn(),
      delete: del,
    };
    return { del, confirm, handlers };
  }

  it("an atom-only body reaches the confirm, and Cancel preserves the card", async () => {
    const { del, confirm, handlers } = run(MATH_BODY, false);
    await deleteMarginItem({
      kind: "note",
      cardId: "c1",
      paragraphId: "P1",
      handlers,
      confirm,
      editor: null,
    });
    expect(confirm, "no confirm on an atom-only body").toHaveBeenCalledTimes(1);
    expect(del, "deleted despite Cancel").not.toHaveBeenCalled();
  });

  it("an empty body deletes with no confirm (the control)", async () => {
    const { del, confirm, handlers } = run({ type: "doc", content: [{ type: "paragraph" }] }, true);
    await deleteMarginItem({
      kind: "note",
      cardId: "c1",
      paragraphId: "P1",
      handlers,
      confirm,
      editor: null,
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(del).toHaveBeenCalledTimes(1);
  });
});

describe("401 · doors 4 & 5 — EditableCard's trash click and the 386 key door", () => {
  afterEach(cleanup);

  const THEME = themeFromAccent("#7a6ff0");
  const CONFIRM = "This item has text. Delete it?";

  function renderCard(body: unknown) {
    const onDelete = vi.fn();
    render(
      <EditableCard
        id="c-archive"
        kind="archive"
        cardKind="archive"
        selected
        theme={THEME}
        hideToolbar
        inlineDelete
        onDelete={onDelete}
        value={body as never}
        onChange={() => {}}
        placeholder="Text here."
      />,
    );
    return onDelete;
  }

  // ARCHIVE deliberately: its card is by construction the ONLY surviving copy
  // (the capture dispatches `tr.delete` FIRST), it is born with an empty title,
  // and `resolveLoadedTitle` gives a `titleAuto` card no auto-title rescue — so
  // an atom-only body leaves the gate nothing else to see.
  it("the trash click on an atom-only archive body raises the confirm", () => {
    const onDelete = renderCard(MATH_BODY);
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(screen.queryByText(CONFIRM), "deleted with no confirm").not.toBeNull();
    expect(onDelete, "deleted before the user answered").not.toHaveBeenCalled();
  });

  it("the 386 key door on an atom-only archive body raises the confirm", () => {
    const onDelete = renderCard(MATH_BODY);
    const shell = document.querySelector<HTMLElement>("[data-card]")!;
    fireEvent.keyDown(shell, { key: "Backspace" });
    expect(screen.queryByText(CONFIRM)).not.toBeNull();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("an EMPTY archive body still deletes straight through (the control)", () => {
    const onDelete = renderCard({ type: "doc", content: [{ type: "paragraph" }] });
    const shell = document.querySelector<HTMLElement>("[data-card]")!;
    fireEvent.keyDown(shell, { key: "Backspace" });
    expect(screen.queryByText(CONFIRM)).toBeNull();
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});

// ── Layer 3 · the census ───────────────────────────────────────────────────
//
// The predicate was never the part that could misbehave — a call site that asks
// its own question is. Both EditorPane footnote gates and the ORPHAN gate must
// route through the shared door; a hand-inlined body-has-text check beside them
// type-checks perfectly and reinstates the defect.

describe("401 · census — every gate asks the shared predicate", () => {
  const read = (rel: string) =>
    commentsStripped(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8"));

  it("EditorPane's two footnote gates spell `cardHasContent(\"footnote\"`", () => {
    const src = read("src/components/EditorPane.tsx");
    const hits = src.match(/cardHasContent\(\s*"footnote"/g) ?? [];
    expect(hits.length, "the pristine markDirty gate + the discard re-check").toBe(2);
  });

  it("the footnote ORPHAN gates (both flag paths) ask it too", () => {
    // flag OFF — the legacy plugin emitter.
    expect(read("src/lib/tiptap/footnote.ts")).toContain('cardHasContent("footnote"');
    // flag ON — the bus reconciler's policy, which hand-wrote "plainText or
    // title" until this task. Measured, the two tables agree on every shipped
    // body (the flatten hands each block atom a non-empty placeholder), so this
    // is a FORK CLOSURE rather than a second live defect — and the census is
    // therefore the only leg that can see it. A display projection is the wrong
    // authority for a destruction gate whether or not it currently differs.
    expect(read("src/links/_shared/inline-atom-lifecycle-policy.ts")).toContain(
      'cardHasContent("footnote"',
    );
  });

  it("no production file re-declares an empty-wrapper set", () => {
    // The allowlist is EMPTY: the set lives once, in the import-free leaf, and
    // `jsonCarriesContent` is the whole published operation. A second copy is
    // how the mount door and the card doors came to answer differently.
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === "__tests__" || e.name === "node_modules") continue;
          walk(p);
        } else if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
      }
    };
    walk(path.join(REPO_ROOT, "src"));
    walk(path.join(REPO_ROOT, "library"));

    const offenders = files.filter((f) => {
      if (f.endsWith(path.join("lib", "node-attr-sets.ts"))) return false; // the SSOT
      const src = commentsStripped(fs.readFileSync(f, "utf8"));
      // The shape: a Set/array literal naming BOTH wrapper node types together —
      // which is what a re-declared allowlist looks like and what no legitimate
      // classifier is (nothing else groups exactly `doc` with `paragraph`).
      return /\[\s*"doc"\s*,\s*"paragraph"\s*\]/.test(src);
    });
    expect(offenders.map((f) => path.relative(REPO_ROOT, f))).toEqual([]);

    // The canary, SYNTHETIC rather than standing on the line the census just
    // drained — a canary anchored on the defect evaporates with it and the leg
    // then passes vacuously forever. The needle must see the exact shape that
    // shipped: `schema-mount.ts` held `const EMPTY_WRAPPERS = new Set(["doc",
    // "paragraph"])` as a private copy, which is how the mount door and the
    // card doors came to answer differently about the same body.
    const canary = 'const EMPTY_WRAPPERS = new Set(["doc", "paragraph"]);';
    expect(/\[\s*"doc"\s*,\s*"paragraph"\s*\]/.test(commentsStripped(canary))).toBe(true);
    expect(files.length, "the sweep found no files at all").toBeGreaterThan(200);
  });

  it("the retired text-only walker is gone", () => {
    const src = read("src/cards/has-content.ts");
    expect(src).not.toContain("hasJsonContent");
    expect(src).toContain("jsonCarriesContent");
  });
});

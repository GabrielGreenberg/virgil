// @vitest-environment jsdom
/**
 * Task 552 — ONE paragraph-title edit session, not three shapes.
 *
 * Three vanilla NodeViews let the user type a title above a block — the
 * paragraph and the list (`editor-extensions.ts`) and the expex example block
 * (`expex.ts`) — and each carried its own copy of the session. The copies had
 * drifted, and the paragraph's drift was a live defect:
 *
 *   - its RE-ENTRY guard read `titleAnnot.querySelector("input")`, a container
 *     its input never enters (the input is appended to `document.body`). Dead
 *     by construction: a second click on the strip opened a SECOND input,
 *     whose focus blurred the first; the first then committed and repainted
 *     the strip UNDER the still-open second input, dropping `is-editing-title`
 *     off the wrapper mid-edit;
 *   - the same dead probe gated `update()`, so a structural change landing
 *     mid-edit repainted the strip under the input;
 *   - the paragraph committed on blur after a 150 ms deferral where the list
 *     committed immediately behind a click-away overlay;
 *   - the paragraph and the list minted a first-title uuid with a BARE
 *     `generateShortId()` — no collision set — where every other minter in the
 *     tree draws against the document's existing ids.
 *
 * ## Why no pre-552 suite could see any of this
 *
 * Every suite that drives these strips (`nodeview-timer-lifetime`,
 * `render-annot-bail`, `expex-card-context-par-title`) opens the input ONCE
 * and asserts what that one session does. A SECOND click on an already-open
 * strip is unrepresentable in all of them — which is exactly the gesture the
 * dead guard was supposed to refuse. The mint is worse: it is a 1-in-65 536
 * event, so no fixture could reach it without stubbing the randomness.
 *
 * The leg with teeth is the CENSUS: the door was never the part that could
 * misbehave, a NodeView that hand-rolls a fourth copy beside it is, and that
 * type-checks and runs perfectly. Population DISCOVERED (the shared
 * `nodeViewPopulation()` every NodeView census reads), read at the `literals`
 * setting so the input's own class survives the strip, allowlist EMPTY.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { REPO_ROOT } from "@/lib/__tests__/_source-scan";
import { nodeViewRegions, nodeViewPopulation } from "./_nodeview-census";
import * as fs from "node:fs";
import * as path from "node:path";

vi.mock("@/lib/storage", () => {
  const STORAGE_FNS = [
    "isDevStorage", "readSidecar", "readSidecarIfExists", "writeSidecar",
    "readTex", "writeTex", "readDocBundle", "writeDocBundle", "readBib",
    "mutateBib", "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
    "registerDocInFolder", "openExistingDocFromPicker", "listDocs", "renameDoc",
    "deleteDocFromIndex", "flushDoc", "drainDoc", "detectBibPackage",
    "readPaperFolder", "getTexFilename", "writePdf", "readPdf", "getPdfFilename",
    "pdfFilenameFromTex", "readFigureSource", "readFigureRaster",
    "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  const mod: Record<string, unknown> = {};
  for (const name of STORAGE_FNS) mod[name] = name === "isDevStorage" ? false : vi.fn();
  return mod;
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/react";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { mintDocUuid } from "@/lib/anchor-uuid";
import { generateShortId } from "@/lib/uuid";
import {
  PAR_TITLE_INPUT_CLASS,
  PAR_TITLE_OVERLAY_CLASS,
  PAR_TITLE_EDITING_CLASS,
  PAR_TITLE_BLUR_ARM_MS,
} from "@/lib/tiptap/title-edit-session";

// ---------------------------------------------------------------------------
// Harness (the 548 shape — the REAL main extension stack)
// ---------------------------------------------------------------------------

function ctx(): EditorExtensionsCtx {
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

const P = (text: string): JSONContent => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

/** One of every VANILLA strip the door serves, plus a tail to edit into. */
function fixture(): JSONContent {
  return {
    type: "doc",
    content: [
      { type: "paragraph", attrs: { uuid: "p-1" }, content: [{ type: "text", text: "A titled paragraph." }] },
      {
        type: "bulletList",
        attrs: { uuid: "l-1" },
        content: [{ type: "listItem", attrs: { uuid: "li-1" }, content: [P("item")] }],
      },
      {
        type: "exampleBlock",
        attrs: { uuid: "ex-1", kind: "multi" },
        content: [
          {
            type: "exampleItemList",
            content: [{ type: "exampleItem", attrs: { uuid: "exi-1" }, content: [P("gloss")] }],
          },
        ],
      },
      P("Tail paragraph."),
    ],
  };
}

let live: { editor: Editor; el: HTMLElement } | null = null;

function mount(content: JSONContent = fixture()) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const editor = new Editor({
    element: el,
    extensions: buildEditorExtensions(ctx()),
    content,
  });
  live = { editor, el };
  return { editor, el };
}

afterEach(() => {
  if (live) {
    if (!live.editor.isDestroyed) live.editor.destroy();
    live.el.remove();
    live = null;
  }
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

const click = (el: Element) =>
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
const mousedown = (el: Element) =>
  el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
const key = (el: Element, k: string) =>
  el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));

/** Every input the door could have appended, at either placement. */
const allInputs = (root: HTMLElement) => [
  ...document.body.querySelectorAll<HTMLInputElement>(`:scope > input.${PAR_TITLE_INPUT_CLASS}`),
  ...root.querySelectorAll<HTMLInputElement>(`input.${PAR_TITLE_INPUT_CLASS}`),
];

const strip = (root: HTMLElement, uuid: string) =>
  root.querySelector<HTMLElement>(`[data-uuid="${uuid}"] .par-title-annotation`)!;
const wrapperOf = (root: HTMLElement, uuid: string) =>
  root.querySelector<HTMLElement>(`[data-uuid="${uuid}"]`)!;

/** The three VANILLA strips, keyed by how the door places their input. */
const STRIPS: Record<string, { uuid: string; placement: "body" | "inline" }> = {
  paragraph: { uuid: "p-1", placement: "body" },
  list: { uuid: "l-1", placement: "body" },
  exampleBlock: { uuid: "ex-1", placement: "inline" },
};

const titleOf = (editor: Editor, uuid: string): string | null => {
  let out: string | null = null;
  editor.state.doc.descendants((n) => {
    if (n.attrs?.uuid === uuid) out = (n.attrs.parTitle as string | null) ?? null;
    return true;
  });
  return out;
};
const uuidsOf = (editor: Editor): string[] => {
  const out: string[] = [];
  editor.state.doc.descendants((n) => {
    if (n.attrs?.uuid) out.push(n.attrs.uuid as string);
    return true;
  });
  return out;
};

// ---------------------------------------------------------------------------
// M1 / M2 — the session is a per-VIEW fact, not a DOM-containment fact
// ---------------------------------------------------------------------------

describe("task 552 — re-entry is keyed on the SESSION, never on DOM containment", () => {
  for (const [name, { uuid }] of Object.entries(STRIPS)) {
    it(`${name}: a second click on the open strip opens NO second input`, () => {
      const { el } = mount();
      click(strip(el, uuid));
      expect(allInputs(el)).toHaveLength(1);

      // The strip spans the full width, so a click landing where the input
      // does not cover reaches `enterEditMode` with the first still open.
      // Pre-552 the paragraph's guard probed a container its body-appended
      // input is not in, and this minted a SECOND input.
      click(strip(el, uuid));
      click(strip(el, uuid));
      expect(allInputs(el)).toHaveLength(1);
    });

    it(`${name}: COMPANION PIN — the wrapper keeps \`${PAR_TITLE_EDITING_CLASS}\` across a re-entry click`, () => {
      // Passes either way under an isolated neuter of the guard, and says so:
      // the pre-552 loss of this class needed the whole cascade (the second
      // input's focus blurs the first → the first's deferred commit runs
      // `cleanup()` → the class comes off under the still-open second input),
      // which a jsdom fixture cannot faithfully stage. The falsifiable half of
      // that story is the input COUNT, one leg up. This pins the state the
      // cascade used to corrupt.
      const { el } = mount();
      click(strip(el, uuid));
      expect(wrapperOf(el, uuid).classList.contains(PAR_TITLE_EDITING_CLASS)).toBe(true);
      click(strip(el, uuid));
      expect(wrapperOf(el, uuid).classList.contains(PAR_TITLE_EDITING_CLASS)).toBe(true);
    });
  }

  it("M2 — a structural update landing mid-edit does NOT repaint the strip under the input", () => {
    const { editor, el } = mount();
    click(strip(el, "p-1"));
    const input = allInputs(el)[0];
    input.value = "half typed";

    // A dispatch that reaches this paragraph's `update()` while its session is
    // open. Pre-552 the dead `querySelector` probe answered "no input", so the
    // strip repainted and the open input was orphaned above a rebuilt `+T`.
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, " more");

    expect(allInputs(el)).toHaveLength(1);
    expect(allInputs(el)[0]).toBe(input);
    expect(allInputs(el)[0].value).toBe("half typed");
    expect(wrapperOf(el, "p-1").classList.contains(PAR_TITLE_EDITING_CLASS)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The two endings, of which exactly one happens (task 529's latch)
// ---------------------------------------------------------------------------

describe("task 552 — one session, two endings", () => {
  for (const [name, { uuid }] of Object.entries(STRIPS)) {
    it(`${name}: Enter on a CHANGED value commits it once and leaves no input`, () => {
      const { editor, el } = mount();
      click(strip(el, uuid));
      const input = allInputs(el)[0];
      input.value = "Fresh title";
      key(input, "Enter");

      expect(titleOf(editor, uuid)).toBe("Fresh title");
      expect(allInputs(el)).toHaveLength(0);
      expect(wrapperOf(el, uuid).classList.contains(PAR_TITLE_EDITING_CLASS)).toBe(false);
    });

    it(`${name}: Escape writes NOTHING and leaves no input`, () => {
      const { editor, el } = mount();
      click(strip(el, uuid));
      const input = allInputs(el)[0];
      input.value = "discarded";
      key(input, "Escape");

      expect(titleOf(editor, uuid)).toBe(null);
      expect(allInputs(el)).toHaveLength(0);
      expect(wrapperOf(el, uuid).classList.contains(PAR_TITLE_EDITING_CLASS)).toBe(false);
    });

    it(`${name}: an UNCHANGED value dispatches nothing (task 470's zero-move rule)`, () => {
      const { editor, el } = mount();
      // Give it a title, then re-open and Enter without typing.
      click(strip(el, uuid));
      const first = allInputs(el)[0];
      first.value = "Settled";
      key(first, "Enter");

      // The cost of a no-op commit is a HISTORY ENTRY and an autosave arm, not
      // a document change: `setNodeMarkup` with identical attrs still builds a
      // step, so `doc.toJSON()` is equal either way and cannot see this. Count
      // the doc-changing transactions instead.
      let dispatched = 0;
      const count = ({ transaction }: { transaction: { docChanged: boolean } }) => {
        if (transaction.docChanged) dispatched++;
      };
      editor.on("transaction", count);
      try {
        click(strip(el, uuid));
        const again = allInputs(el)[0];
        expect(again.value).toBe("Settled");
        key(again, "Enter");
      } finally {
        editor.off("transaction", count);
      }

      expect(dispatched).toBe(0);
      expect(titleOf(editor, uuid)).toBe("Settled");
      expect(allInputs(el)).toHaveLength(0);
    });
  }

  it("Escape after a re-entry click still ends the ONE session (no orphan input)", () => {
    const { el } = mount();
    click(strip(el, "p-1"));
    click(strip(el, "p-1"));
    key(allInputs(el)[0], "Escape");
    expect(allInputs(el)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Placement — the ONE thing that legitimately differs between the callers
// ---------------------------------------------------------------------------

describe("task 552 — placement", () => {
  it("body placement (paragraph, list) appends the input to document.body behind a click-away overlay", () => {
    const { el } = mount();
    for (const uuid of ["p-1", "l-1"]) {
      click(strip(el, uuid));
      expect(
        document.body.querySelectorAll(`:scope > input.${PAR_TITLE_INPUT_CLASS}`),
      ).toHaveLength(1);
      expect(
        document.body.querySelectorAll(`:scope > div.${PAR_TITLE_OVERLAY_CLASS}`),
      ).toHaveLength(1);
      key(allInputs(el)[0], "Escape");
      expect(document.body.querySelectorAll(`.${PAR_TITLE_OVERLAY_CLASS}`)).toHaveLength(0);
    }
  });

  it("the overlay's mousedown COMMITS — one click-away policy, the 150 ms deferral retired", () => {
    const { editor, el } = mount();
    click(strip(el, "p-1"));
    allInputs(el)[0].value = "By click-away";
    const overlay = document.body.querySelector<HTMLElement>(`.${PAR_TITLE_OVERLAY_CLASS}`)!;

    mousedown(overlay);

    // Immediately — pre-552 the paragraph deferred this 150 ms behind a blur.
    expect(titleOf(editor, "p-1")).toBe("By click-away");
    expect(allInputs(el)).toHaveLength(0);
    expect(document.body.querySelectorAll(`.${PAR_TITLE_OVERLAY_CLASS}`)).toHaveLength(0);
  });

  it("inline placement (expex block) puts the input INSIDE the strip and mounts no overlay", () => {
    const { el } = mount();
    click(strip(el, "ex-1"));
    const input = allInputs(el)[0];
    expect(strip(el, "ex-1").contains(input)).toBe(true);
    expect(document.body.querySelectorAll(`:scope > input.${PAR_TITLE_INPUT_CLASS}`)).toHaveLength(0);
    // A body overlay would paint OVER an input nested in the editor's own
    // stacking contexts, so the inline placement has none — the blur is the
    // click-away.
    expect(document.body.querySelectorAll(`.${PAR_TITLE_OVERLAY_CLASS}`)).toHaveLength(0);
  });

  it("a blur inside the arming window is a focus STEAL, not a leave", () => {
    vi.useFakeTimers();
    try {
      const { editor, el } = mount();
      click(strip(el, "p-1"));
      const input = allInputs(el)[0];
      input.value = "typed";

      input.dispatchEvent(new FocusEvent("blur"));
      expect(titleOf(editor, "p-1")).toBe(null);
      expect(allInputs(el)).toHaveLength(1);

      vi.advanceTimersByTime(PAR_TITLE_BLUR_ARM_MS + 1);
      input.dispatchEvent(new FocusEvent("blur"));
      expect(titleOf(editor, "p-1")).toBe("typed");
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// The session CLAIMS the keys it answers (claimGestureKey's second member)
// ---------------------------------------------------------------------------

describe("task 552 — one press ends exactly ONE thing", () => {
  /** The two real victims register at `window`/`document` BUBBLE — the phase a
   *  claim from the target can still stop. (`useMarginEdit` is window+bubble;
   *  `system-dialog`'s Escape is window+bubble; `NodeEditPopover` and the
   *  marginalia overflow pill are document+bubble.) */
  function withOwners(run: (seen: string[]) => void) {
    const seen: string[] = [];
    const marginEdit = (e: KeyboardEvent) => {
      if (e.key === "Escape") seen.push("margin-edit-cancel");
    };
    const dialog = (e: KeyboardEvent) => {
      if (e.key === "Escape") seen.push("scrimless-dialog-close");
    };
    const popover = (e: KeyboardEvent) => {
      if (e.key === "Escape") seen.push("node-edit-popover");
    };
    const saveShortcut = (e: KeyboardEvent) => {
      if (e.key === "s") seen.push("save");
    };
    // No SHIPPED bubble-phase Enter owner exists today — `system-dialog`'s
    // Enter resolves `hands-off` for a target outside its frame — so this one
    // pins the MECHANISM (an Enter owner downstream would be stopped) rather
    // than a live victim. Without it the Enter legs would pass either way.
    const enterOwner = (e: KeyboardEvent) => {
      if (e.key === "Enter") seen.push("enter-owner");
    };
    window.addEventListener("keydown", marginEdit);
    window.addEventListener("keydown", dialog);
    document.addEventListener("keydown", popover);
    window.addEventListener("keydown", saveShortcut);
    window.addEventListener("keydown", enterOwner);
    try {
      run(seen);
    } finally {
      window.removeEventListener("keydown", marginEdit);
      window.removeEventListener("keydown", dialog);
      document.removeEventListener("keydown", popover);
      window.removeEventListener("keydown", saveShortcut);
      window.removeEventListener("keydown", enterOwner);
    }
  }

  for (const [name, { uuid }] of Object.entries(STRIPS)) {
    it(`${name}: Escape ends the SESSION and reaches no other Escape owner`, () => {
      const { editor, el } = mount();
      withOwners((seen) => {
        click(strip(el, uuid));
        key(allInputs(el)[0], "Escape");
        expect(seen).toEqual([]);
      });
      expect(allInputs(el)).toHaveLength(0);
      expect(titleOf(editor, uuid)).toBe(null);
    });

    it(`${name}: Enter commits and reaches no other owner`, () => {
      const { el } = mount();
      withOwners((seen) => {
        click(strip(el, uuid));
        allInputs(el)[0].value = "T";
        key(allInputs(el)[0], "Enter");
        expect(seen).toEqual([]);
      });
    });
  }

  it("ACCEPTING CONTROL — a key the session does NOT answer passes through", () => {
    // The pre-552 paragraph stopped EVERY keydown, which made the title strip
    // the one field in the app where Cmd-S did nothing. The claim is scoped to
    // the two keys the session answers.
    const { el } = mount();
    withOwners((seen) => {
      click(strip(el, "p-1"));
      key(allInputs(el)[0], "s");
      expect(seen).toEqual(["save"]);
    });
  });

  it("CANARY — the owners fire for an unclaimed Escape (the probe can see them)", () => {
    withOwners((seen) => {
      const loose = document.createElement("input");
      document.body.appendChild(loose);
      key(loose, "Escape");
      loose.remove();
      // Sorted: the propagation path is target → … → document → window, so the
      // `document` owner runs first. WHICH order is not the contract; that all
      // three run — and that the claim above therefore has something to stop —
      // is.
      expect([...seen].sort()).toEqual([
        "margin-edit-cancel",
        "node-edit-popover",
        "scrimless-dialog-close",
      ]);
    });
  });
});

// ---------------------------------------------------------------------------
// M4 — a first-title uuid is minted against the document's existing ids
// ---------------------------------------------------------------------------

describe("task 552 — the first-title mint draws against the document", () => {
  /** `generateShortId` reads `Math.random().toString(16).slice(2, 6)`. */
  const randomYielding = (...ids: string[]) => {
    const queue = ids.map((id) => parseInt(id, 16) / 0x10000);
    return vi.spyOn(Math, "random").mockImplementation(() => queue.shift() ?? 0.5);
  };

  it("the id source is what the legs think it is (canary)", () => {
    randomYielding("aaaa");
    expect(Math.random().toString(16).slice(2, 6)).toBe("aaaa");
  });

  it("the door REJECTS a colliding draw; a bare mint takes it", () => {
    const doc = { type: "doc", content: [
      { type: "paragraph", attrs: { uuid: "aaaa" }, content: [{ type: "text", text: "Anchored." }] },
    ] } as JSONContent;
    const { editor } = mount(doc);

    randomYielding("aaaa", "bbbb");
    expect(mintDocUuid(editor.state.doc)).toBe("bbbb");

    // The pre-552 spelling, for contrast: no collision set, so the first draw
    // stands even though the document already carries it.
    randomYielding("aaaa", "bbbb");
    expect(generateShortId()).toBe("aaaa");
  });

  it("the door never returns an id the document already carries (swept)", () => {
    const { editor } = mount();
    const taken = new Set(uuidsOf(editor));
    expect(taken.size).toBeGreaterThan(2);
    for (const id of taken) {
      randomYielding(id, "f00d");
      expect(taken.has(mintDocUuid(editor.state.doc))).toBe(false);
      vi.restoreAllMocks();
    }
  });

  it("STATED LIMIT — `BlockUuidBackfill` masks the document-level symptom, measured", () => {
    // Both spellings leave the SAME document, because the backfill net re-mints
    // a duplicate as soon as one lands. So M4 is a LATENT correctness hole, not
    // a live user-visible defect, and no end-to-end leg here could tell the two
    // apart — which is exactly why the mint is pinned at the door and by the
    // census instead. It is still worth closing: a gesture states identity
    // before dispatch and the net catches what no mechanism declared (task
    // 320), and a mint that leans on the net is one net-change away from
    // orphaning the cards on an already-anchored block.
    const { editor, el } = mount({
      type: "doc",
      content: [
        { type: "paragraph", attrs: { uuid: "aaaa" }, content: [{ type: "text", text: "Anchored." }] },
        { type: "paragraph", attrs: { uuid: null }, content: [{ type: "text", text: "Untitled." }] },
      ],
    });
    expect(uuidsOf(editor)).toEqual(["aaaa"]);

    randomYielding("aaaa", "bbbb");
    click(el.querySelectorAll<HTMLElement>(".par-title-annotation")[1]);
    const input = allInputs(el)[0];
    input.value = "First title";
    key(input, "Enter");

    const ids = uuidsOf(editor);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("aaaa");
  });
});

// ---------------------------------------------------------------------------
// The leg with teeth — the census
// ---------------------------------------------------------------------------

describe("task 552 — census: the vanilla strips enter the ONE door", () => {
  /** Regions read at the `literals` setting: the needle IS a quoted class. */
  const regions = () =>
    nodeViewPopulation().flatMap((f) => nodeViewRegions(f, "literals"));

  it("the population is non-empty and holds the three title-strip files (canary)", () => {
    const files = new Set(nodeViewPopulation());
    expect(files.has("src/lib/editor-extensions.ts")).toBe(true);
    expect(files.has("src/lib/tiptap/expex.ts")).toBe(true);
    expect(regions().length).toBeGreaterThan(3);
  });

  it("no NodeView body spells the title input's class itself — allowlist EMPTY", () => {
    const offenders = regions()
      .filter((r) => r.text.includes(PAR_TITLE_INPUT_CLASS))
      .map((r) => r.label);
    expect(offenders).toEqual([]);
  });

  it("every NodeView body that mounts a title strip enters the door", () => {
    // A region that renders a `.par-title-annotation` strip AND wires a click
    // on it is a title-editing surface, so it must call `createParTitleSession`
    // — never a hand-rolled input.
    const surfaces = regions().filter((r) => r.text.includes("par-title-annotation"));
    expect(surfaces.length).toBeGreaterThan(0);
    for (const r of surfaces) {
      expect(
        r.text.includes("createParTitleSession"),
        `${r.label} renders a title strip without entering the session door`,
      ).toBe(true);
    }
  });

  it("the retired shapes stay retired", () => {
    const src = fs.readFileSync(
      path.join(REPO_ROOT, "src/lib/editor-extensions.ts"),
      "utf8",
    );
    // The dead containment probe, in the two files it lived in.
    expect(src).not.toMatch(/titleAnnot\.querySelector\(\s*["']input["']\s*\)/);
    const expexSrc = fs.readFileSync(
      path.join(REPO_ROOT, "src/lib/tiptap/expex.ts"),
      "utf8",
    );
    expect(expexSrc).not.toMatch(/titleAnnot\.querySelector\(\s*["']input["']\s*\)/);
  });

  it("no vanilla title strip mints a uuid bare — the mint draws against the doc", () => {
    const src = fs.readFileSync(
      path.join(REPO_ROOT, "src/lib/editor-extensions.ts"),
      "utf8",
    );
    // `generateShortId()` with no collision set is the pre-552 mint.
    expect(src).not.toMatch(/generateShortId\(\s*\)/);
    expect(src).toContain("mintDocUuid");
  });
});

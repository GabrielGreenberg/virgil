// @vitest-environment jsdom
/**
 * Task 548 — a NodeView owns its timers' lifetime.
 *
 * The v0.1.104 release gate FAILED with every test passing:
 *
 *     Tests  11240 passed | 19 skipped
 *     Errors  2 errors
 *     ReferenceError: document is not defined
 *       ❯ Timeout._onTimeout src/lib/editor-extensions.ts:1204:13
 *
 * The heading strip's label input armed a 30 ms refocus KEEPER, cleared by a
 * 250 ms wall-clock timeout and by nothing else. When the owning test file
 * finished inside that window, vitest tore jsdom down with the keeper's last
 * ticks still on Node's timer heap; the next tick read `document` and threw
 * into nobody's handler. Vitest exits 1 on an unhandled error whatever the
 * assertions said. Load-dependent (the file passes 7/7 alone; a re-run of the
 * identical commit went green), so it presents as "the deploy failed" over a
 * green summary — the most expensive shape a CI failure can have.
 *
 * The keeper is NOT the bug — it exists because something steals focus from a
 * freshly-mounted input in its first ~250 ms — and a `typeof document` guard
 * would silence the symptom while leaving the timer running against a dead
 * environment. The bug is a timer whose OUTER bound was a wall clock rather
 * than the view. So every vanilla NodeView now arms its timers through ONE
 * `ViewLifetime` (`view-lifetime.ts`) that `destroy()` disposes.
 *
 * ## What the legs measure
 *
 * Fake timers make the leak COUNTABLE: `vi.getTimerCount()` after
 * `editor.destroy()` is the number of timers that outlived their view. Every
 * leg reads that count as a DELTA against the editor's own baseline (TipTap
 * and the plugins arm timers of their own), and the CANARY leg proves opening
 * an input RAISES the count, so a zero delta can never mean "the probe is
 * blind". The keeper's REASON for existing is pinned too — it holds focus for
 * its window and then lets go — so a fix that quietly deleted it fails here.
 *
 * ## Why no pre-548 suite could see this
 *
 * Every suite that drives these inputs (`refocus-no-scroll`,
 * `label-rename-refs`, `heading-strip-keyboard`, `render-annot-bail`, the
 * expex fixtures) ends with `editor.destroy()` in a `finally` and asserts
 * nothing about what is still armed afterwards — the leaked ticks are
 * unrepresentable in all of them, because they fire after the test that
 * could have observed them has already passed.
 *
 * The leg with teeth is the CENSUS: the lifetime was never the part that
 * could misbehave, a NodeView that arms a bare `setTimeout` beside it is, and
 * that type-checks and runs perfectly. Population DISCOVERED (every shipped
 * file that spells `addNodeView(`), reach = the transitive closure over
 * same-file function declarations (a list NodeView's body lives in a factory
 * one call away), allowlist EMPTY.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { REPO_ROOT, codeOnly, trackedFiles } from "@/lib/__tests__/_source-scan";

vi.mock("@/lib/storage", () => {
  const STORAGE_FNS = [
    "isDevStorage", "readSidecar", "readSidecarIfExists", "writeSidecar",
    "readTex", "writeTex", "readDocBundle", "writeDocBundle", "readBib",
    "writeBib", "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
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

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const FAKE: NonNullable<Parameters<typeof vi.useFakeTimers>[0]> = {
  toFake: [
    "setTimeout", "clearTimeout", "setInterval", "clearInterval",
    "requestAnimationFrame", "cancelAnimationFrame",
  ],
};

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

/** One of every NodeView that mounts an edit input. */
function fixture(): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1, uuid: "h-1", label: null },
        content: [{ type: "text", text: "Introduction" }],
      },
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
            content: [
              { type: "exampleItem", attrs: { uuid: "exi-1" }, content: [P("gloss")] },
            ],
          },
        ],
      },
      P("Tail paragraph."),
    ],
  };
}

let live: { editor: Editor; el: HTMLElement } | null = null;

function mount() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const editor = new Editor({
    element: el,
    extensions: buildEditorExtensions(ctx()),
    content: fixture(),
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
  vi.useRealTimers();
  document.body.innerHTML = "";
});

const click = (el: Element) =>
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

/** Every edit surface the fixture mounts, keyed by the NodeView it belongs to. */
const SURFACES: Record<string, { open: (root: HTMLElement) => HTMLInputElement }> = {
  "heading (label)": {
    open(root) {
      click(root.querySelector('[data-uuid="h-1"] .heading-annotation .heading-label-add')!);
      return root.querySelector<HTMLInputElement>('[data-uuid="h-1"] input.heading-label-input')!;
    },
  },
  "paragraph (title)": {
    open(root) {
      click(root.querySelector('[data-uuid="p-1"] .par-title-annotation')!);
      // The paragraph's input is body-appended (it positions over the strip).
      return document.body.querySelector<HTMLInputElement>(":scope > input.par-title-input")!;
    },
  },
  "list (title)": {
    open(root) {
      click(root.querySelector('[data-uuid="l-1"] .par-title-annotation')!);
      return document.body.querySelector<HTMLInputElement>(":scope > input.par-title-input")!;
    },
  },
  "exampleBlock (title)": {
    open(root) {
      click(root.querySelector('[data-uuid="ex-1"] .par-title-annotation')!);
      return root.querySelector<HTMLInputElement>('[data-uuid="ex-1"] .par-title-annotation input')!;
    },
  },
  "exampleBlock (label)": {
    open(root) {
      click(root.querySelector('[data-uuid="ex-1"] .expex-label-annotation .heading-label-add')!);
      return root.querySelector<HTMLInputElement>('[data-uuid="ex-1"] .expex-label-annotation input')!;
    },
  },
  "exampleItem (label)": {
    open(root) {
      click(root.querySelector('[data-uuid="exi-1"] .expex-item-label-annotation .heading-label-add')!);
      return root.querySelector<HTMLInputElement>('[data-uuid="exi-1"] .expex-item-label-annotation input')!;
    },
  },
};

// ---------------------------------------------------------------------------
// Behavioural legs
// ---------------------------------------------------------------------------

describe("task 548 — no timer outlives the NodeView that armed it", () => {
  for (const [name, surface] of Object.entries(SURFACES)) {
    it(`${name}: opening the input ARMS timers (canary — the probe can see them)`, () => {
      vi.useFakeTimers(FAKE);
      const { el } = mount();
      const baseline = vi.getTimerCount();
      const input = surface.open(el);
      expect(input).not.toBeNull();
      expect(vi.getTimerCount()).toBeGreaterThan(baseline);
    });

    it(`${name}: destroying the editor INSIDE the window takes every timer with it — none fires afterwards`, () => {
      vi.useFakeTimers(FAKE);
      const { editor, el } = mount();
      const baseline = vi.getTimerCount();
      const input = surface.open(el);
      const focus = vi.spyOn(input, "focus");
      // Inside every window the inputs arm: the focus frame (16 ms), the
      // keeper (30 ms), the blur guard (150–200 ms), the keeper expiry (250).
      vi.advanceTimersByTime(5);
      editor.destroy();
      // The delta is the count of timers that outlived their view.
      expect(vi.getTimerCount() - baseline).toBeLessThanOrEqual(0);
      // …and the clock running on says nothing reaches the dead view.
      focus.mockClear();
      expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
      expect(focus).not.toHaveBeenCalled();
    });
  }

  it("heading: a session ended by ESCAPE takes the keeper with it — no timers linger for the wall clock", () => {
    vi.useFakeTimers(FAKE);
    const { el } = mount();
    const baseline = vi.getTimerCount();
    const input = SURFACES["heading (label)"].open(el);
    vi.advanceTimersByTime(20); // the focus frame has fired; keeper + expiry + blur guard remain
    expect(vi.getTimerCount()).toBeGreaterThan(baseline);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    // The blur guard's 200 ms timeout is the ONE timer legitimately left (it
    // only flips a flag) — the keeper and its expiry are gone at once.
    expect(vi.getTimerCount() - baseline).toBeLessThanOrEqual(1);
    vi.advanceTimersByTime(300);
    expect(vi.getTimerCount() - baseline).toBeLessThanOrEqual(0);
  });

  it("body-appended inputs (paragraph / list title) leave the body when their view is destroyed mid-edit", () => {
    vi.useFakeTimers(FAKE);
    const { editor, el } = mount();
    SURFACES["paragraph (title)"].open(el);
    expect(document.body.querySelector(":scope > input.par-title-input")).not.toBeNull();
    editor.destroy();
    expect(document.body.querySelector(":scope > input.par-title-input")).toBeNull();

    const second = mount();
    SURFACES["list (title)"].open(second.el);
    expect(document.body.querySelector(":scope > input.par-title-input")).not.toBeNull();
    expect(document.body.querySelector(":scope > .par-title-edit-overlay")).not.toBeNull();
    second.editor.destroy();
    expect(document.body.querySelector(":scope > input.par-title-input")).toBeNull();
    expect(document.body.querySelector(":scope > .par-title-edit-overlay")).toBeNull();
  });
});

describe("task 548 — the keeper still does the job it exists for", () => {
  it("heading: the label input takes focus BACK for its first 250 ms, then lets go", () => {
    vi.useFakeTimers(FAKE);
    const { el } = mount();
    const thief = document.createElement("button");
    document.body.appendChild(thief);
    const input = SURFACES["heading (label)"].open(el);
    vi.advanceTimersByTime(16); // the focus frame
    expect(document.activeElement).toBe(input);

    // Inside the window: a steal is undone on the next keeper tick.
    thief.focus();
    expect(document.activeElement).toBe(thief);
    vi.advanceTimersByTime(30);
    expect(document.activeElement).toBe(input);

    // Past the window: the keeper has expired and a steal stands.
    vi.advanceTimersByTime(300);
    thief.focus();
    vi.advanceTimersByTime(60);
    expect(document.activeElement).toBe(thief);
  });
});

// ---------------------------------------------------------------------------
// The census
// ---------------------------------------------------------------------------

/** A NodeView region that arms a bare platform timer. EMPTY by design. */
const PERMITTED_BARE_NODEVIEW_TIMERS: Record<string, string> = {};

/**
 * How many NodeView bodies per file OWN a lifetime (spell `createViewLifetime(`).
 * An exact-set pin: a new NodeView that arms a timer must register here, and
 * a retired one must be retired here.
 */
const LIFETIME_OWNERS: Record<string, number> = {
  // paragraph title, heading label, and the list-title factory counted ONCE
  // PER REGION that reaches it — bulletList and orderedList each own one.
  "src/lib/editor-extensions.ts": 4,
  "src/lib/tiptap/expex.ts": 2, // exampleBlock (title + label), exampleItem (label)
};

const BARE_TIMER = /(^|[^.\w$])(setTimeout|setInterval|requestAnimationFrame)\s*\(/g;

function braceBody(s: string, openIdx: number): [number, number] {
  let depth = 0;
  for (let j = openIdx; j < s.length; j++) {
    if (s[j] === "{") depth++;
    else if (s[j] === "}") {
      depth--;
      if (depth === 0) return [openIdx, j];
    }
  }
  return [openIdx, s.length - 1];
}

interface Region { file: string; label: string; text: string }

/**
 * Every `addNodeView()` body in the file, plus the bodies of every same-file
 * `function NAME(` it reaches (transitively). A list NodeView's whole body is
 * `createListTitleNodeView(…)`, one call away — a region that stopped at the
 * method would see nothing but a `return`.
 */
function nodeViewRegions(file: string): Region[] {
  const raw = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
  const src = codeOnly(raw);
  const fnBodies = new Map<string, string>();
  for (const m of src.matchAll(/\bfunction\s+(\w+)\s*\(/g)) {
    const open = src.indexOf("{", src.indexOf(")", m.index!));
    if (open < 0) continue;
    const [a, b] = braceBody(src, open);
    fnBodies.set(m[1], src.slice(a, b + 1));
  }
  const regions: Region[] = [];
  let ordinal = 0;
  for (const m of src.matchAll(/\baddNodeView\s*\(\s*\)\s*\{/g)) {
    const open = m.index! + m[0].length - 1;
    const [a, b] = braceBody(src, open);
    let text = src.slice(a, b + 1);
    // Transitive closure over same-file function declarations.
    const seen = new Set<string>();
    let grew = true;
    while (grew) {
      grew = false;
      for (const [name, body] of fnBodies) {
        if (seen.has(name)) continue;
        if (new RegExp(`\\b${name}\\s*\\(`).test(text)) {
          seen.add(name);
          text += "\n" + body;
          grew = true;
        }
      }
    }
    ordinal++;
    regions.push({ file, label: `${file}#addNodeView[${ordinal}]`, text });
  }
  return regions;
}

function population(): string[] {
  const files = [...trackedFiles("src", /\.tsx?$/), ...trackedFiles("library", /\.tsx?$/)]
    .filter((p) => !p.includes("__tests__"))
    .map((p) => path.relative(REPO_ROOT, p));
  return files.filter((f) => /\baddNodeView\s*\(/.test(codeOnly(fs.readFileSync(path.join(REPO_ROOT, f), "utf8"))));
}

describe("task 548 — census: a NodeView arms every timer through its lifetime", () => {
  const files = population();
  const regions = files.flatMap(nodeViewRegions);

  it("the population is discovered and non-empty (both offenders are in it)", () => {
    expect(files).toContain("src/lib/editor-extensions.ts");
    expect(files).toContain("src/lib/tiptap/expex.ts");
    expect(regions.length).toBeGreaterThan(5);
  });

  it("can see a bare timer (synthetic canary)", () => {
    const planted = "addNodeView() { return () => { setTimeout(() => {}, 30); return { dom }; }; }";
    expect(Array.from(codeOnly(planted).matchAll(BARE_TIMER))).toHaveLength(1);
    const doored = "addNodeView() { return () => { lifetime.setTimeout(() => {}, 30); return { dom }; }; }";
    expect(Array.from(codeOnly(doored).matchAll(BARE_TIMER))).toHaveLength(0);
  });

  it("no NodeView body — or helper it reaches — spells a bare setTimeout / setInterval / requestAnimationFrame", () => {
    const hits: string[] = [];
    for (const r of regions) {
      for (const m of r.text.matchAll(BARE_TIMER)) {
        if (PERMITTED_BARE_NODEVIEW_TIMERS[r.label]) continue;
        hits.push(`${r.label}: ${m[2]}(`);
      }
    }
    expect(hits, "a NodeView timer outside its ViewLifetime — arm it through `lifetime.*` (task 548)").toEqual([]);
  });

  it("every NodeView that owns a lifetime disposes it from destroy() — and the owners are an exact set", () => {
    const owners: Record<string, number> = {};
    const undisposed: string[] = [];
    for (const r of regions) {
      const owns = (r.text.match(/\bcreateViewLifetime\s*\(/g) ?? []).length;
      if (!owns) continue;
      owners[r.file] = (owners[r.file] ?? 0) + owns;
      // Each returned NodeView spec must spell `destroy() { … .dispose() … }`.
      const destroys = Array.from(r.text.matchAll(/\bdestroy\s*\(\s*\)\s*\{/g));
      const disposing = destroys.filter((m) => {
        const [a, b] = braceBody(r.text, m.index! + m[0].length - 1);
        return /\.dispose\s*\(\s*\)/.test(r.text.slice(a, b + 1));
      });
      if (disposing.length < owns) undisposed.push(`${r.label}: ${owns} lifetime(s), ${disposing.length} disposing destroy()`);
    }
    expect(undisposed).toEqual([]);
    expect(owners).toEqual(LIFETIME_OWNERS);
  });

  it("an autoSizeInput mounted by a NodeView hands the lifetime in (its first measure is a frame)", () => {
    const bare: string[] = [];
    for (const r of regions) {
      for (const m of r.text.matchAll(/\bautoSizeInput\s*\(([^()]*)\)/g)) {
        const args = m[1].split(",").map((s) => s.trim()).filter(Boolean);
        if (args.length < 3) bare.push(`${r.label}: autoSizeInput(${m[1].trim()})`);
      }
    }
    expect(bare).toEqual([]);
  });

  it("the React twin (FigureAnnotation) arms no timer at all — its focus is a synchronous effect", () => {
    const src = codeOnly(fs.readFileSync(path.join(REPO_ROOT, "src/components/FigureAnnotation.tsx"), "utf8"));
    expect(Array.from(src.matchAll(BARE_TIMER))).toEqual([]);
  });

  it("every React NodeView component that arms a timer also cancels one (a stated, weaker check)", () => {
    // Population: the component files `ReactNodeViewRenderer(<Name>)` mounts.
    const names = new Set<string>();
    for (const f of files) {
      const src = codeOnly(fs.readFileSync(path.join(REPO_ROOT, f), "utf8"));
      for (const m of src.matchAll(/\bReactNodeViewRenderer\s*\(\s*(\w+)/g)) names.add(m[1]);
    }
    expect(names.size).toBeGreaterThan(0);
    const components = trackedFiles("src", /\.tsx$/)
      .filter((p) => !p.includes("__tests__") && names.has(path.basename(p, ".tsx")));
    expect(components.length).toBeGreaterThan(0);
    const unbounded: string[] = [];
    for (const p of components) {
      const src = codeOnly(fs.readFileSync(p, "utf8"));
      const arms = Array.from(src.matchAll(BARE_TIMER)).length;
      if (!arms) continue;
      if (!/\b(clearTimeout|clearInterval|cancelAnimationFrame)\s*\(/.test(src)) {
        unbounded.push(path.relative(REPO_ROOT, p));
      }
    }
    expect(unbounded).toEqual([]);
  });
});

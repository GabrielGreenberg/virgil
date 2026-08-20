// @vitest-environment jsdom
/**
 * Task 336 — the two costs a WRAP-CHANGING keystroke inside a list paid in the
 * geometry engine, both of them per RO entry rather than per flush.
 *
 * A keystroke that rewraps a line inside a `<li>` resizes the item AND its
 * title wrapper, and both carry `data-uuid`, so the commonest list keystroke
 * delivers TWO entries in one ResizeObserver flush. Before this task each entry
 * ran its own invalidation cascade — an O(observed) pass — for a result
 * identical to running one, because a cascade from index `i` is a superset of a
 * cascade from any `j > i`.
 *
 * And every block the flush then re-measured paid an unconditional
 * `querySelector("[data-glyph-anchor]")`, which for the kinds that cannot carry
 * one (every prose block, every container) means walking the WHOLE subtree to
 * report the only answer it could have had. On a `bulletList` that is a
 * full-list scan per measure.
 *
 * Both legs fail on the pre-336 code (measured).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

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

import { Editor } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { getOrCreateGeometry } from "../registry";
import { GLYPH_ANCHOR_KINDS, resolveGlyphAnchor } from "../glyph-anchor";

// ── Observer fakes (the `blocks-at-y` harness shape, plus a firing RO) ───────

type IOCallback = (entries: IntersectionObserverEntry[]) => void;
let liveIOs: FakeIntersectionObserver[] = [];
let liveROs: FakeResizeObserver[] = [];

class FakeIntersectionObserver {
  cb: IOCallback;
  constructor(cb: IOCallback) {
    this.cb = cb;
    liveIOs.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {
    liveIOs = liveIOs.filter((io) => io !== this);
  }
  takeRecords() {
    return [];
  }
  fireEnter(els: Element[]) {
    this.cb(
      els.map(
        (el) =>
          ({ target: el, isIntersecting: true }) as unknown as IntersectionObserverEntry,
      ),
    );
  }
}

class FakeResizeObserver {
  cb: (entries: ResizeObserverEntry[]) => void;
  constructor(cb: (entries: ResizeObserverEntry[]) => void) {
    this.cb = cb;
    liveROs.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {
    liveROs = liveROs.filter((ro) => ro !== this);
  }
  /** ONE flush carrying several entries — the shape a rewrap delivers. */
  fire(els: Element[]) {
    this.cb(els.map((el) => ({ target: el }) as unknown as ResizeObserverEntry));
  }
}

let rafQueue: FrameRequestCallback[] = [];
function flushRaf() {
  const q = rafQueue;
  rafQueue = [];
  for (const cb of q) cb(performance.now());
}

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: new Set() },
    host: null,
  };
}

function rect(top: number, bottom: number): DOMRect {
  return {
    top,
    bottom,
    left: 0,
    right: 100,
    width: 100,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

const UUIDS = ["b1", "b2", "b3", "b4"];

function mount(): { editor: Editor; els: HTMLElement[] } {
  const host = document.createElement("div");
  host.setAttribute("data-marginalia-host", "");
  host.getBoundingClientRect = () => rect(0, 1000);
  const element = document.createElement("div");
  host.appendChild(element);
  document.body.appendChild(host);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: UUIDS.map((uuid, i) => ({
        type: "paragraph",
        attrs: { uuid },
        content: [{ type: "text", text: `Para ${uuid} number ${i}.` }],
      })),
    },
  });
  let pos = 0;
  const els: HTMLElement[] = [];
  for (let i = 0; i < editor.state.doc.childCount; i++) {
    const node = editor.state.doc.child(i);
    const el = editor.view.nodeDOM(pos) as HTMLElement;
    el.getBoundingClientRect = () => rect(i * 40, i * 40 + 30);
    els.push(el);
    pos += node.nodeSize;
  }
  return { editor, els };
}

let realIO: typeof IntersectionObserver;
let realRO: typeof ResizeObserver;
let realRaf: typeof requestAnimationFrame;
let realCaf: typeof cancelAnimationFrame;

beforeEach(() => {
  liveIOs = [];
  liveROs = [];
  rafQueue = [];
  realIO = globalThis.IntersectionObserver;
  realRO = globalThis.ResizeObserver;
  realRaf = globalThis.requestAnimationFrame;
  realCaf = globalThis.cancelAnimationFrame;
  globalThis.IntersectionObserver =
    FakeIntersectionObserver as unknown as typeof IntersectionObserver;
  globalThis.ResizeObserver =
    FakeResizeObserver as unknown as typeof ResizeObserver;
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
});

afterEach(() => {
  globalThis.IntersectionObserver = realIO;
  globalThis.ResizeObserver = realRO;
  globalThis.requestAnimationFrame = realRaf;
  globalThis.cancelAnimationFrame = realCaf;
  document.body.innerHTML = "";
});

describe("the wrap cascade is per FLUSH, not per entry (task 336)", () => {
  it("two entries in one flush re-measure the same set as the topmost alone", () => {
    const { editor, els } = mount();
    const service = getOrCreateGeometry(editor);
    const release = service.retain();
    flushRaf(); // prime
    liveIOs[0].fireEnter(els);
    flushRaf(); // settle the initial measure

    // Count the blocks the flush actually re-measures. `measureBlock` reads the
    // node DOM's rect, so a per-element read counter names the measured set.
    const measured: string[] = [];
    els.forEach((el, i) => {
      el.getBoundingClientRect = () => {
        measured.push(UUIDS[i]);
        return rect(i * 40, i * 40 + 30);
      };
    });

    const cascadesBefore = (service.stats() as { cascades: number }).cascades;

    // A rewrap inside block 2 resizes the block AND its wrapper — both
    // uuid-carrying, both in ONE flush. Here: entries for b2 and b3.
    liveROs[0].fire([els[1], els[2]]);
    flushRaf();

    // ONE O(observed) pass for the flush, not one per entry. THIS is the leg
    // with teeth — the resulting measured set is identical either way (a
    // cascade from `i` subsumes any cascade from `j > i`), so only the pass
    // COUNT can see the defect.
    expect(
      (service.stats() as { cascades: number }).cascades - cascadesBefore,
      "two entries in one flush must cascade ONCE",
    ).toBe(1);

    // …and the union is unchanged: the cascade runs from the TOPMOST entry
    // (b2), so b2..b4 re-measure and b1 (above the edit) does not.
    expect(new Set(measured)).toEqual(new Set(["b2", "b3", "b4"]));

    release();
    editor.destroy();
  });

  it("a flush with no uuid-carrying entry schedules nothing", () => {
    const { editor, els } = mount();
    const service = getOrCreateGeometry(editor);
    const release = service.retain();
    flushRaf();
    liveIOs[0].fireEnter(els);
    flushRaf();

    const before = service.stats() as { recomputes: number; cascades: number };
    const stranger = document.createElement("div");
    liveROs[0].fire([stranger]);
    flushRaf();
    const after = service.stats() as { recomputes: number; cascades: number };
    expect(
      after.recomputes,
      "an entry with no data-uuid must not queue a measure pass",
    ).toBe(before.recomputes);
    expect(after.cascades, "…nor a cascade").toBe(before.cascades);

    release();
    editor.destroy();
  });
});

describe("the glyph-anchor probe is KIND-gated (task 336)", () => {
  function block(kind: string | null, withAnchor: boolean): HTMLElement {
    const el = document.createElement("div");
    if (kind !== null) el.setAttribute("data-text-object-kind", kind);
    if (withAnchor) {
      const anchor = document.createElement("span");
      anchor.setAttribute("data-glyph-anchor", "");
      el.appendChild(anchor);
    }
    return el;
  }

  it("resolves the anchor for a kind that declares one", () => {
    for (const kind of GLYPH_ANCHOR_KINDS) {
      expect(resolveGlyphAnchor(block(kind, true)), kind).not.toBeNull();
    }
  });

  it("never queries the subtree for a kind that cannot carry one", () => {
    const el = block("bulletList", false);
    const query = vi.spyOn(el, "querySelector");
    expect(resolveGlyphAnchor(el)).toBeNull();
    expect(
      query,
      "a full-subtree scan for a match that cannot exist is the whole cost",
    ).not.toHaveBeenCalled();
    query.mockRestore();
  });

  it("ignores an anchor that belongs to a NESTED block of another kind", () => {
    // A `listItem` holding an `exampleBlock` used to resolve the nested
    // example's `(n)` as the ITEM's visual top — a correctness hole the gate
    // closes on its way past the cost one.
    const item = block("listItem", false);
    const nested = block("exampleBlock", true);
    item.appendChild(nested);
    expect(resolveGlyphAnchor(item)).toBeNull();
    expect(resolveGlyphAnchor(nested)).not.toBeNull();
  });

  it("FAILS OPEN on a block with no kind attribute (a transient render)", () => {
    expect(resolveGlyphAnchor(block(null, true))).not.toBeNull();
  });
});

// ── The census: membership is DISCOVERED from the emitters ──────────────────
//
// The gate was never the part that can misbehave — a THIRD NodeView that
// declares a visual top and whose kind nobody added to the set is. That block
// silently loses its declared anchor (its markers slide to the wrapper's chrome
// top), with no type error and nothing to grep for. So the set is pinned
// against the files that actually emit the attribute.
//
// Stated limit: this maps EMITTER FILE → the kinds it serves, so a second
// emitter added inside an already-listed file for a kind NOT declared beside it
// passes. Naming the kinds from the file is what a grep can do honestly; the
// NodeView's node type is not syntactically present at the emission. One file
// serving SEVERAL kinds is the ordinary case since the source pod was shared
// (task 383) — `SourcePodNodeView` is worn by `texBlock` and `forestBlock`
// alike, so the value is a list rather than a single name.

const GLYPH_ANCHOR_EMITTERS: Record<string, string[]> = {
  "components/SourcePodNodeView.tsx": ["texBlock", "forestBlock"],
  "lib/tiptap/expex.ts": ["exampleBlock"],
};

const SRC = path.resolve(__dirname, "../../..");
const LIB = path.resolve(__dirname, "../../../../library");

function walkSource(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "__tests__" || entry === "__fixtures__" || entry === "node_modules") {
        continue;
      }
      out.push(...walkSource(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** An EMISSION, not a mention: `setAttribute("data-glyph-anchor"…)` or the JSX
 *  attribute form. A `querySelector("[data-glyph-anchor]")` READ (the gate
 *  itself) matches neither. */
const EMITS = /(setAttribute\(\s*["']data-glyph-anchor["']|\bdata-glyph-anchor=)/;

function emitters(root: string): string[] {
  let files: string[];
  try {
    files = walkSource(root);
  } catch {
    return [];
  }
  return files
    .filter((f) => EMITS.test(readFileSync(f, "utf8")))
    .map((f) => path.relative(root, f).split(path.sep).join("/"))
    .sort();
}

describe("glyph-anchor membership is discovered from the emitters (task 336)", () => {
  it("every file that emits the attribute is declared, and its kind is in the set", () => {
    expect(emitters(SRC)).toEqual(Object.keys(GLYPH_ANCHOR_EMITTERS).sort());
    const declared = Object.values(GLYPH_ANCHOR_EMITTERS).flat();
    for (const kind of declared) {
      expect(GLYPH_ANCHOR_KINDS.has(kind), `${kind} must declare an anchor`).toBe(true);
    }
    // Nothing in the set is unreachable — a kind with no emitter is a query the
    // gate would still permit for no reason.
    expect([...GLYPH_ANCHOR_KINDS].sort()).toEqual([...new Set(declared)].sort());
  });

  it("the library silo emits none (the Reader mounts the same NodeViews)", () => {
    expect(emitters(LIB)).toEqual([]);
  });

  it("the census can SEE an emission (canary, on a synthetic fixture)", () => {
    expect(EMITS.test('numberEl.setAttribute("data-glyph-anchor", "");')).toBe(true);
    expect(EMITS.test('<div className="pod" data-glyph-anchor="">')).toBe(true);
    // …and does not indict a reader.
    expect(EMITS.test('dom.querySelector("[data-glyph-anchor]")')).toBe(false);
  });
});

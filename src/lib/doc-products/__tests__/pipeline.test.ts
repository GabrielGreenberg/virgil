// @vitest-environment jsdom
/**
 * DocProducts pipeline contract (perf Wave 1 / P2-S2):
 *   - keystroke path = timer reset only; products refresh on the tiers
 *   - docJson identity: unchanged blocks keep element identity, a no-op
 *     refresh keeps the WHOLE object identity
 *   - per-block cache: one edit = one block re-serialized (miss counters)
 *   - sourceText assembles through the shared serializer with the disk
 *     preamble; the external (code-view) feed suppresses + overrides
 *   - ensureFresh returns synchronously-fresh products
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/storage", () => ({
  readTex: vi.fn(() =>
    Promise.resolve(
      "\\documentclass{article}\n\\begin{document}\n\nbody\n\n\\end{document}\n",
    ),
  ),
}));

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { createDocProducts, getDocProducts, type DocProducts } from "../pipeline";
import { blockCacheStats } from "../block-caches";

let editor: Editor | null = null;
let products: DocProducts | null = null;

function makeEditor(content: string): Editor {
  editor = new Editor({ extensions: [StarterKit], content });
  return editor;
}

function attach(ed: Editor): DocProducts {
  products = createDocProducts(ed, {
    docId: "test-doc",
    getBibFamily: () => null,
    isSuppressed: () => suppressed,
    isVisible: () => visible,
    interactiveMs: 300,
  });
  return products;
}

let suppressed = false;
let visible = true;

beforeEach(() => {
  suppressed = false;
  visible = true;
  vi.useFakeTimers();
});

afterEach(() => {
  products?.destroy();
  products = null;
  editor?.destroy();
  editor = null;
  vi.useRealTimers();
});

/** Flush the attach readTex promise + the idle tier (rIC falls back to
 *  double-rAF→setTimeout(0) in jsdom; fake timers cover both). */
async function settle() {
  await vi.advanceTimersByTimeAsync(400);
}

describe("doc-products pipeline", () => {
  it("registers in the editor-keyed registry and produces after attach", async () => {
    const ed = makeEditor("<p>alpha</p><p>beta</p>");
    const p = attach(ed);
    expect(getDocProducts(ed)).toBe(p);
    await settle();
    const snap = p.snapshot();
    expect(snap.docJson?.content?.length).toBe(2);
    expect(snap.sourceText).toContain("alpha");
    expect(snap.sourceText).toContain("\\documentclass{article}");
    expect(snap.wordCounts?.words.mainText).toBeGreaterThan(0);
  });

  it("one edit re-serializes ONE block and preserves unchanged block identity", async () => {
    const ed = makeEditor("<p>alpha</p><p>beta</p><p>gamma</p>");
    const p = attach(ed);
    await settle();
    const before = p.snapshot().docJson!;
    const missesBefore = blockCacheStats.latexMisses;

    // Type into the LAST paragraph.
    ed.commands.insertContentAt(ed.state.doc.content.size - 1, " edited");
    await vi.advanceTimersByTimeAsync(350); // Tier A
    await settle(); // Tier B

    const after = p.snapshot().docJson!;
    expect(after).not.toBe(before);
    // Unchanged blocks keep their element identity (the WeakMap hit).
    expect(after.content![0]).toBe(before.content![0]);
    expect(after.content![1]).toBe(before.content![1]);
    expect(after.content![2]).not.toBe(before.content![2]);
    // Exactly one block re-serialized to latex.
    expect(blockCacheStats.latexMisses - missesBefore).toBe(1);
    expect(p.snapshot().sourceText).toContain("gamma edited");
  });

  it("keystroke path does no product work (only the debounce boundary does)", async () => {
    const ed = makeEditor("<p>alpha</p>");
    const p = attach(ed);
    await settle();
    const genBefore = p.snapshot().generation;
    ed.commands.insertContentAt(ed.state.doc.content.size - 1, "x");
    ed.commands.insertContentAt(ed.state.doc.content.size - 1, "y");
    // No tier has fired yet — generation unchanged.
    expect(p.snapshot().generation).toBe(genBefore);
    await vi.advanceTimersByTimeAsync(350);
    await settle();
    expect(p.snapshot().generation).toBeGreaterThan(genBefore);
    expect(p.snapshot().sourceText).toContain("alphaxy");
  });

  it("hidden pane stays dirty-but-inert; ensureFresh recovers synchronously", async () => {
    const ed = makeEditor("<p>alpha</p>");
    const p = attach(ed);
    await settle();
    visible = false;
    ed.commands.insertContentAt(ed.state.doc.content.size - 1, " hidden-edit");
    await vi.advanceTimersByTimeAsync(1000);
    expect(p.snapshot().sourceText).not.toContain("hidden-edit");
    const fresh = p.ensureFresh();
    expect(fresh.sourceText).toContain("hidden-edit");
  });

  it("external feed overrides sourceText and suppression blocks the pipeline's own serialize", async () => {
    const ed = makeEditor("<p>alpha</p>");
    const p = attach(ed);
    await settle();
    suppressed = true;
    p.setExternalSourceFeed("RAW CODE TEXT");
    expect(p.snapshot().sourceText).toBe("RAW CODE TEXT");
    ed.commands.insertContentAt(ed.state.doc.content.size - 1, " typed");
    await vi.advanceTimersByTimeAsync(350);
    await settle();
    // Suppressed: the pipeline did not overwrite the code view's feed.
    expect(p.snapshot().sourceText).toBe("RAW CODE TEXT");
    // Code view closes — the next edit re-serializes from TipTap.
    suppressed = false;
    ed.commands.insertContentAt(ed.state.doc.content.size - 1, " more");
    await vi.advanceTimersByTimeAsync(350);
    await settle();
    expect(p.snapshot().sourceText).toContain("alpha typed more");
  });

  it("destroy unregisters and stops all work", async () => {
    const ed = makeEditor("<p>alpha</p>");
    const p = attach(ed);
    await settle();
    p.destroy();
    expect(getDocProducts(ed)).toBeNull();
    const gen = p.snapshot().generation;
    ed.commands.insertContentAt(ed.state.doc.content.size - 1, "x");
    await vi.advanceTimersByTimeAsync(1000);
    expect(p.snapshot().generation).toBe(gen);
  });
});

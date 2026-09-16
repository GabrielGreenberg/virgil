// @vitest-environment jsdom
/**
 * DocProducts pipeline contract (perf Wave 1 / P2-S2):
 *   - keystroke path = timer reset only; products refresh on the tiers
 *   - docJson identity: unchanged blocks keep element identity, a no-op
 *     refresh keeps the WHOLE object identity
 *   - per-block cache: one edit = one block re-serialized (miss counters)
 *   - sourceText assembles through the shared serializer with the disk
 *     preamble; the external (code-view) feed suppresses + overrides
 *   - ensureFresh refreshes TIER A ONLY and re-arms a stale Tier B (592)
 *   - freshness is per-tier and per-input: a bibFamily switch re-derives
 *     sourceText with no edit; a hidden pane converges on the visible edge
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/storage", () => ({
  readTex: vi.fn(() =>
    Promise.resolve(
      "\\documentclass{article}\n\\begin{document}\n\nbody\n\n\\end{document}\n",
    ),
  ),
}));

/** Flipped by the 592 refusal leg: `assembleLatex` sits OUTSIDE
 *  buildSourceText's fail-open catch, and used to throw clean through the old
 *  ensureFresh into the autosave call site — with the debounce disarmed. */
let assembleThrows = false;
vi.mock("@/lib/latex-serializer", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/latex-serializer")>();
  return {
    ...actual,
    assembleLatex: (...args: Parameters<typeof actual.assembleLatex>) => {
      if (assembleThrows) throw new Error("serializer refused a node");
      return actual.assembleLatex(...args);
    },
  };
});

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  createDocProducts,
  getDocProducts,
  pipelineStats,
  type DocProducts,
} from "../pipeline";
import { blockCacheStats } from "../block-caches";
import type { BibFamily } from "@/lib/bib-family";

let editor: Editor | null = null;
let products: DocProducts | null = null;

function makeEditor(content: string): Editor {
  editor = new Editor({ extensions: [StarterKit], content });
  return editor;
}

function attach(ed: Editor): DocProducts {
  products = createDocProducts(ed, {
    docId: "test-doc",
    getBibFamily: () => bibFamily,
    isSuppressed: () => suppressed,
    isVisible: () => visible,
    interactiveMs: 300,
  });
  return products;
}

let suppressed = false;
let visible = true;
let bibFamily: BibFamily | null = null;

beforeEach(() => {
  suppressed = false;
  visible = true;
  bibFamily = null;
  assembleThrows = false;
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

  it("hidden pane stays stale-but-inert; ensureFresh still hands the save path an EXACT docJson", async () => {
    const ed = makeEditor("<p>alpha</p>");
    const p = attach(ed);
    await settle();
    visible = false;
    ed.commands.insertContentAt(ed.state.doc.content.size - 1, " hidden-edit");
    await vi.advanceTimersByTimeAsync(1000);
    expect(p.snapshot().sourceText).not.toContain("hidden-edit");
    // The save path's product is docJson, and it is exact even while hidden.
    const fresh = p.ensureFresh();
    expect(JSON.stringify(fresh.docJson)).toContain("hidden-edit");
    // Tier B is NOT dragged along — it stays where the tier contract puts it.
    expect(fresh.sourceText).not.toContain("hidden-edit");
  });

  it("a hidden pane converges on the visible edge, with no further edit (592)", async () => {
    const ed = makeEditor("<p>alpha</p>");
    const p = attach(ed);
    await settle();
    visible = false;
    ed.commands.insertContentAt(ed.state.doc.content.size - 1, " hidden-edit");
    await vi.advanceTimersByTimeAsync(1000);
    expect(p.snapshot().sourceText).not.toContain("hidden-edit");
    // The pane comes back. useDocProductsHost's input-change effect calls
    // exactly this; nothing else happens — no keystroke, no autosave.
    visible = true;
    p.revalidate();
    await settle();
    expect(p.snapshot().sourceText).toContain("hidden-edit");
    expect(JSON.stringify(p.snapshot().docJson)).toContain("hidden-edit");
  });

  it("ensureFresh after a settled tier runs NO whole-doc walks (592)", async () => {
    const ed = makeEditor("<p>alpha</p><p>beta</p>");
    const p = attach(ed);
    await settle();
    const tierB = pipelineStats.tierBRuns;
    const assemblies = pipelineStats.assemblies;

    // The autosave shape: ensureFresh at the 1500 ms fire, tiers already settled.
    const fresh = p.ensureFresh();
    expect(fresh.docJson?.content?.length).toBe(2);
    expect(pipelineStats.tierBRuns).toBe(tierB);
    expect(pipelineStats.assemblies).toBe(assemblies);
    // And nothing was merely deferred: no idle callback was armed either.
    await settle();
    expect(pipelineStats.tierBRuns).toBe(tierB);
    expect(pipelineStats.assemblies).toBe(assemblies);
  });

  it("ensureFresh mid-pause refreshes Tier A but only RE-ARMS Tier B (592)", async () => {
    const ed = makeEditor("<p>alpha</p>");
    const p = attach(ed);
    await settle();
    const tierB = pipelineStats.tierBRuns;
    const assemblies = pipelineStats.assemblies;

    // An edit lands and the autosave fires before the 300 ms boundary.
    ed.commands.insertContentAt(ed.state.doc.content.size - 1, " typed");
    const fresh = p.ensureFresh();
    // Tier A ran inline — the save gets the exact doc.
    expect(JSON.stringify(fresh.docJson)).toContain("alpha typed");
    // Tier B did NOT run inline.
    expect(pipelineStats.tierBRuns).toBe(tierB);
    expect(pipelineStats.assemblies).toBe(assemblies);
    // It was re-armed, so the idle tier still converges on its own callback.
    await settle();
    expect(pipelineStats.tierBRuns).toBe(tierB + 1);
    expect(p.snapshot().sourceText).toContain("alpha typed");
  });

  it("a bibFamily switch re-derives sourceText with no editor edit (592)", async () => {
    const ed = makeEditor("<p>alpha</p>");
    const p = attach(ed);
    await settle();
    const before = p.snapshot().sourceText!;
    expect(before).not.toContain("natbib");

    // The user's Package control fires NO transaction — the value just moves.
    bibFamily = "natbib";
    p.revalidate();
    await settle();
    const after = p.snapshot().sourceText!;
    expect(after).toContain("natbib");
    expect(after).not.toBe(before);
  });

  it("a Tier B refusal can no longer take the save with it (592)", async () => {
    const ed = makeEditor("<p>alpha</p>");
    const p = attach(ed);
    await settle();
    const counts = p.snapshot().wordCounts;
    const lastGoodSource = p.snapshot().sourceText;
    assembleThrows = true;

    ed.commands.insertContentAt(ed.state.doc.content.size - 1, " typed");
    // The autosave's door: it must return a usable, EXACT docJson rather than
    // propagating the projection's failure into a call site whose debounce is
    // already disarmed.
    const fresh = p.ensureFresh();
    expect(JSON.stringify(fresh.docJson)).toContain("alpha typed");

    // And the re-armed idle tier swallows it too — degraded, never escaping:
    // the source holds its last good text while the counts still advance.
    await settle();
    expect(p.snapshot().sourceText).toBe(lastGoodSource);
    expect(p.snapshot().wordCounts).not.toBe(counts);
    expect(JSON.stringify(p.snapshot().docJson)).toContain("alpha typed");
  });

  it("a delimiters re-read that changes nothing re-arms nothing (592)", async () => {
    const ed = makeEditor("<p>alpha</p>");
    const p = attach(ed);
    await settle();
    const tierB = pipelineStats.tierBRuns;
    // Same inputs → the freshness record says there is nothing to redo.
    p.revalidate();
    await settle();
    expect(pipelineStats.tierBRuns).toBe(tierB);
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

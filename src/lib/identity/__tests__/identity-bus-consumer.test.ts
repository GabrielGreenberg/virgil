// @vitest-environment jsdom
//
// W1b — the single inline-atom DocStructureBus consumer (D1.2 / D1.4).
//
// Pins:
//  - markerless re-parse detection: same-tx add+remove of citations whose ids
//    regenerated but whose `command` survived → an `oldId -> newId` remap,
//    matched by command equality (duplicate commands disambiguated by order).
//  - a pure add or pure delete is NOT a re-parse → no remap (so a real add/
//    delete is never misread as an id move).
//  - the dispatcher fans one diff to an ORDERED policy list, threading the
//    remap; T1's regen policy registered first re-points a selected/floated
//    card id THROUGH the cascade (a downstream `"inlineAtom"` migrator survives).
//  - emitCount stays flat on plain typing: the consumer subscribes to the
//    structural-only `onAnyChange` and bails O(1) on a non-atom transaction.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/storage", () => {
  const STORAGE_FNS = [
    "readSidecar", "readSidecarIfExists", "writeSidecar", "readTex", "writeTex",
    "readDocBundle", "writeDocBundle", "readBib", "writeBib",
    "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
    "registerDocInFolder", "openExistingDocFromPicker", "listDocs", "renameDoc",
    "deleteDocFromIndex", "flushDoc", "drainDoc", "detectBibPackage",
    "readPaperFolder", "getTexFilename", "writePdf", "readPdf", "getPdfFilename",
    "pdfFilenameFromTex", "readFigureSource", "readFigureRaster",
    "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  const mod: Record<string, unknown> = { isDevStorage: false };
  for (const name of STORAGE_FNS) mod[name] = vi.fn();
  return mod;
});

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Citation } from "@/lib/tiptap/citation";
import {
  EMPTY_DIFF,
  getBus,
  type CitationEntry,
  type FootnoteEntry,
  type StructureDiff,
} from "@/lib/tiptap/doc-structure";
import { DocStructureObserver } from "@/lib/tiptap/doc-structure";
import {
  IdentityCascade,
  isRegenIds,
} from "../identity-cascade";
import {
  IdentityBusConsumer,
  detectRegenRemap,
  makeRegenPolicy,
  matchCitationRegen,
  matchFootnoteRegen,
  type InlineAtomPolicy,
} from "../identity-bus-consumer";

// ── Diff builders ───────────────────────────────────────────────────────────

function cite(id: string, command: string, pos: number): CitationEntry {
  return { id, pos, command, displayText: "" };
}
function fn(id: string, pos: number): FootnoteEntry {
  return { id, pos, thanks: false, number: 1 };
}
function diffWith(over: Partial<StructureDiff>): StructureDiff {
  return { ...EMPTY_DIFF, ...over };
}

// ── The pure citation matcher ───────────────────────────────────────────────

describe("matchCitationRegen", () => {
  it("maps each dropped atom to the added atom with the same command", () => {
    const remap = matchCitationRegen(
      [cite("old-a", "\\cite{a}", 1), cite("old-b", "\\cite{b}", 5)],
      [cite("new-a", "\\cite{a}", 1), cite("new-b", "\\cite{b}", 5)],
    );
    expect(remap).not.toBeNull();
    expect(remap!.get("old-a")).toBe("new-a");
    expect(remap!.get("old-b")).toBe("new-b");
    expect(remap!.size).toBe(2);
  });

  it("disambiguates duplicate commands by document order", () => {
    const remap = matchCitationRegen(
      [cite("old-1", "\\cite{x}", 2), cite("old-2", "\\cite{x}", 8)],
      [cite("new-1", "\\cite{x}", 2), cite("new-2", "\\cite{x}", 8)],
    );
    expect(remap!.get("old-1")).toBe("new-1");
    expect(remap!.get("old-2")).toBe("new-2");
  });

  it("returns null on a pure ADD (no removed) — not a re-parse", () => {
    expect(matchCitationRegen([], [cite("new", "\\cite{a}", 1)])).toBeNull();
  });

  it("returns null on a pure DELETE (no added) — not a re-parse", () => {
    expect(matchCitationRegen([cite("old", "\\cite{a}", 1)], [])).toBeNull();
  });

  it("drops self-maps (an id that did not actually change)", () => {
    // Same id re-observed (e.g. one atom moved while another re-minted) — the
    // unchanged id contributes nothing to the remap.
    const remap = matchCitationRegen(
      [cite("same", "\\cite{a}", 1), cite("old-b", "\\cite{b}", 5)],
      [cite("same", "\\cite{a}", 1), cite("new-b", "\\cite{b}", 5)],
    );
    expect(remap!.has("same")).toBe(false);
    expect(remap!.get("old-b")).toBe("new-b");
    expect(remap!.size).toBe(1);
  });

  it("ignores a removed atom whose command has no added counterpart (real delete)", () => {
    const remap = matchCitationRegen(
      [cite("old-a", "\\cite{a}", 1), cite("gone", "\\cite{z}", 5)],
      [cite("new-a", "\\cite{a}", 1)],
    );
    expect(remap!.get("old-a")).toBe("new-a");
    expect(remap!.has("gone")).toBe(false);
  });
});

// ── The footnote matcher (positional) ────────────────────────────────────────

describe("matchFootnoteRegen", () => {
  it("maps i-th dropped footnote to i-th added (document order)", () => {
    const remap = matchFootnoteRegen(
      [fn("old-1", 1), fn("old-2", 9)],
      [fn("new-1", 1), fn("new-2", 9)],
    );
    expect(remap!.get("old-1")).toBe("new-1");
    expect(remap!.get("old-2")).toBe("new-2");
  });

  it("returns null when counts differ (a genuine add/delete, not a re-parse)", () => {
    expect(matchFootnoteRegen([fn("a", 1)], [fn("b", 1), fn("c", 5)])).toBeNull();
  });

  it("returns null on a pure add or pure delete", () => {
    expect(matchFootnoteRegen([], [fn("a", 1)])).toBeNull();
    expect(matchFootnoteRegen([fn("a", 1)], [])).toBeNull();
  });

  it("does NOT remap a same-count footnote SWAP at a different position (Wave-2 prereq)", () => {
    // A genuine same-transaction swap: delete footnote X at pos 3, insert a
    // DIFFERENT footnote Y at pos 12, in ONE tx. Equal count (1 == 1), but the
    // positions differ — this is NOT a whole-doc re-parse. A blind positional
    // pair would false-remap X→Y and strand X's real selection/float card; the
    // pos-set guard must refuse.
    expect(matchFootnoteRegen([fn("x", 3)], [fn("y", 12)])).toBeNull();
  });

  it("does NOT remap a 2↔2 swap whose position sets differ", () => {
    // Two footnotes removed at {2,9}, two added at {2,40} — one stayed put, one
    // moved. Not a re-parse (positions don't coincide as a set) → no remap.
    expect(
      matchFootnoteRegen([fn("a", 2), fn("b", 9)], [fn("c", 2), fn("d", 40)]),
    ).toBeNull();
  });

  it("DOES remap a whole-doc re-parse that preserves every footnote position", () => {
    // The legit case: ids re-minted, but each footnote re-lands at its old pos.
    const remap = matchFootnoteRegen(
      [fn("old-1", 1), fn("old-2", 9)],
      [fn("new-1", 1), fn("new-2", 9)],
    );
    expect(remap!.get("old-1")).toBe("new-1");
    expect(remap!.get("old-2")).toBe("new-2");
  });
});

// ── detectRegenRemap (the consumer's O(1)-bail gate) ─────────────────────────

describe("detectRegenRemap", () => {
  it("returns null for an empty diff (the plain-keystroke fast path)", () => {
    expect(detectRegenRemap(EMPTY_DIFF)).toBeNull();
  });

  it("returns null for a structural diff with no atom add+remove", () => {
    // e.g. a heading rename — addedHeadings only.
    expect(
      detectRegenRemap(diffWith({ addedCitations: [cite("only-add", "\\cite{a}", 1)] })),
    ).toBeNull();
  });

  it("merges citation + footnote remaps when BOTH re-parse in one tx", () => {
    const remap = detectRegenRemap(
      diffWith({
        removedCitations: [cite("oc", "\\cite{a}", 1)],
        addedCitations: [cite("nc", "\\cite{a}", 1)],
        removedFootnotes: [fn("of", 9)],
        addedFootnotes: [fn("nf", 9)],
      }),
    );
    expect(remap!.get("oc")).toBe("nc");
    expect(remap!.get("of")).toBe("nf");
  });
});

// ── The dispatcher: ordered policies + threaded remap ────────────────────────

describe("IdentityBusConsumer dispatcher", () => {
  it("fans one diff to every policy in registration order", async () => {
    const consumer = new IdentityBusConsumer();
    const order: string[] = [];
    consumer.registerPolicy(() => { order.push("first"); });
    consumer.registerPolicy(() => { order.push("second"); });
    await consumer.dispatch(EMPTY_DIFF);
    expect(order).toEqual(["first", "second"]);
  });

  it("computes the remap ONCE and threads it to every policy", async () => {
    const consumer = new IdentityBusConsumer();
    const seen: Array<ReadonlyMap<string, string>> = [];
    const p: InlineAtomPolicy = (_d, ctx) => { seen.push(ctx.remap); };
    consumer.registerPolicy(p);
    consumer.registerPolicy(p);
    await consumer.dispatch(
      diffWith({
        removedCitations: [cite("o", "\\cite{a}", 1)],
        addedCitations: [cite("n", "\\cite{a}", 1)],
      }),
    );
    expect(seen).toHaveLength(2);
    expect(seen[0].get("o")).toBe("n");
    expect(seen[0]).toBe(seen[1]); // same map instance — computed once
  });

  it("a downstream policy sees post-regen ids (regen policy registered FIRST)", async () => {
    const cascade = new IdentityCascade();
    const repointed: string[] = [];
    // A synthetic inline-atom migrator (stands in for selection/float/pin).
    cascade.registerMigrator("inlineAtom", (change) => {
      if (!isRegenIds(change)) return;
      const newId = change.regenIds.remap.get("old-1");
      if (newId) repointed.push(newId);
    });
    const consumer = new IdentityBusConsumer();
    consumer.registerPolicy(makeRegenPolicy(cascade)); // FIRST
    let downstreamSawRemap = false;
    consumer.registerPolicy((_d, ctx) => {
      downstreamSawRemap = ctx.remap.get("old-1") === "new-1";
    });
    await consumer.dispatch(
      diffWith({
        removedCitations: [cite("old-1", "\\cite{a}", 1)],
        addedCitations: [cite("new-1", "\\cite{a}", 1)],
      }),
    );
    expect(repointed).toEqual(["new-1"]); // selection/float migrator re-pointed
    expect(downstreamSawRemap).toBe(true); // T2/T5 see post-remap id
  });

  it("a throwing policy does not strand the rest", async () => {
    const consumer = new IdentityBusConsumer();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ran: string[] = [];
    consumer.registerPolicy(() => { throw new Error("boom"); });
    consumer.registerPolicy(() => { ran.push("survivor"); });
    await consumer.dispatch(EMPTY_DIFF);
    expect(ran).toEqual(["survivor"]);
    spy.mockRestore();
  });

  it("unregister removes a policy", () => {
    const consumer = new IdentityBusConsumer();
    const off = consumer.registerPolicy(() => {});
    expect(consumer.policyCount()).toBe(1);
    off();
    expect(consumer.policyCount()).toBe(0);
  });
});

// ── The regen policy: no remap → cascade never invoked ───────────────────────

describe("makeRegenPolicy", () => {
  it("does NOT invoke the cascade when the diff is not a re-parse", async () => {
    const cascade = new IdentityCascade();
    const run = vi.spyOn(cascade, "runIdentityChange");
    const policy = makeRegenPolicy(cascade);
    // A pure add (empty remap) — must not fire a regenIds change.
    await policy(diffWith({ addedCitations: [cite("a", "\\cite{x}", 1)] }), {
      remap: new Map(),
    });
    expect(run).not.toHaveBeenCalled();
  });
});

// ── emitCount-flat on plain typing (the keystroke-sanctity pin) ──────────────

describe("the +1 consumer leaves emitCount flat on plain typing", () => {
  function mount(): Editor {
    const element = document.createElement("div");
    document.body.appendChild(element);
    return new Editor({
      element,
      extensions: [StarterKit, DocStructureObserver, Citation],
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Body " },
              { type: "citation", attrs: { citationId: "c1", command: "\\cite{a}", displayText: "A" } },
            ],
          },
        ],
      },
    });
  }

  it("a markerless re-parse (whole-doc replace) re-points a card id THROUGH the cascade", () => {
    const editor = mount();
    const bus = getBus(editor)!;
    const cascade = new IdentityCascade();

    // Stand in for the selection / float / pin stores: a card pinned to the
    // pre-reparse citationId. The synthetic migrator re-points it on regenIds.
    let pinnedCardId = "c1";
    cascade.registerMigrator("inlineAtom", (change) => {
      if (!isRegenIds(change)) return;
      const next = change.regenIds.remap.get(pinnedCardId);
      if (next) pinnedCardId = next;
    });

    const consumer = new IdentityBusConsumer();
    consumer.registerPolicy(makeRegenPolicy(cascade));
    const unsub = bus.onAnyChange((diff) => {
      if (
        diff.addedCitations.length === 0 &&
        diff.removedCitations.length === 0 &&
        diff.addedFootnotes.length === 0 &&
        diff.removedFootnotes.length === 0
      ) {
        return;
      }
      void consumer.dispatch(diff);
    });

    // The markerless re-parse: replace the whole doc with the SAME `\cite{a}`
    // command but a FRESH citationId (the parser's `generateShortId` fallback).
    editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Body " },
            { type: "citation", attrs: { citationId: "c1-REGEN", command: "\\cite{a}", displayText: "A" } },
          ],
        },
      ],
    });

    // The pinned id followed the re-parse — selection/float survives.
    expect(pinnedCardId).toBe("c1-REGEN");
    unsub();
    editor.destroy();
  });

  it("typing plain characters dispatches nothing to the consumer", () => {
    const editor = mount();
    const bus = getBus(editor)!;
    const consumer = new IdentityBusConsumer();
    let dispatched = 0;
    consumer.registerPolicy(() => { dispatched += 1; });
    // Mirror the mount hook's single subscription + O(1) bail.
    const unsub = bus.onAnyChange((diff) => {
      if (
        diff.addedCitations.length === 0 &&
        diff.removedCitations.length === 0 &&
        diff.addedFootnotes.length === 0 &&
        diff.removedFootnotes.length === 0
      ) {
        return;
      }
      void consumer.dispatch(diff);
    });

    const before = bus.emitCount;
    // Type 5 plain characters at the end of the paragraph.
    const end = editor.state.doc.content.size - 1;
    editor.chain().focus().setTextSelection(end).insertContent("hello").run();

    expect(bus.emitCount).toBe(before); // plain typing is structurally null
    expect(dispatched).toBe(0); // consumer never woke
    unsub();
    editor.destroy();
  });
});

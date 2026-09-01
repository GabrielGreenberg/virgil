// @vitest-environment jsdom
//
// Task 2026-08-31-518 — Virgil's own squiggle.
//
// Driven against the REAL main stack over the REAL parse, with a hand-built
// port carrying a five-word dictionary: the port seam exists precisely so the
// plugin can be exercised without a worker, a fetch or 550 KB of Hunspell.
//
// Three claims are under test and each has its own failure mode:
//   - WHAT is flagged — prose only, never a carrier, never inside a `%` block,
//     never a word the user has accepted;
//   - WHAT IT COSTS — a plain keystroke does no checking and no document walk,
//     and a burst costs ONE pass;
//   - WHAT IT IS — a decoration, so the result transaction changes no document
//     and enters no history; plus the hand-off that stops the browser drawing
//     a second underline over the same word.
import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";

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
    "mutateSidecar", "enqueueDocWrite",
  ];
  const mod: Record<string, unknown> = { isDevStorage: false };
  for (const name of STORAGE_FNS) mod[name] = vi.fn();
  return mod;
});

import { Editor } from "@tiptap/core";
import { Node as PMNode } from "@tiptap/pm/model";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { parseLatex } from "@/lib/latex-parser";
import {
  SPELL_DEBOUNCE_MS,
  SPELL_ERROR_CLASS,
  spellcheckPluginKey,
} from "@/lib/tiptap/spellcheck-decorator";
import type { SpellcheckPort, SpellcheckPortRef } from "@/lib/spell/spell-port";

// ── the port ─────────────────────────────────────────────────────────────────

/** Words this fake dictionary knows. Everything else is a misspelling. */
const KNOWN = new Set([
  "The", "the", "quick", "brown", "fox", "argued", "inside", "case",
  "prose", "and", "a", "is", "here", "Some", "some", "text", "word",
  "More", "more", "of", "Paragraph", "paragraph",
]);

interface FakePort extends SpellcheckPort {
  ensureCalls: number;
  accepted: Set<string>;
  bump(): void;
  setEnabled(on: boolean): void;
}

function makePort(): { ref: SpellcheckPortRef; port: FakePort } {
  const verdicts = new Map<string, boolean>();
  let version = 0;
  let on = true;
  const port: FakePort = {
    ensureCalls: 0,
    accepted: new Set<string>(),
    enabled: () => on,
    version: () => version,
    isAccepted: (w) => port.accepted.has(w),
    knownSync: (w) => verdicts.get(w),
    ensure: async (words) => {
      port.ensureCalls++;
      for (const w of words) verdicts.set(w, KNOWN.has(w));
    },
    bump: () => {
      version++;
    },
    setEnabled: (v) => {
      on = v;
      version++;
    },
  };
  return { ref: { current: port }, port };
}

// ── harness ──────────────────────────────────────────────────────────────────

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
});
beforeEach(() => {
  vi.useFakeTimers();
});

function mount(body: string, ref: SpellcheckPortRef | null): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const ctx = {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
    spellcheckPortRef: ref,
  } as unknown as EditorExtensionsCtx;
  editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(ctx),
    content: parseLatex(
      `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}\n`,
    ) as never,
  });
  return editor;
}

/** Let the debounce fire and every phase settle. */
async function settle(): Promise<void> {
  // Two rounds: phase A awaits `ensure`, then the pass runs to completion; a
  // version bump can schedule one more.
  for (let i = 0; i < 4; i++) {
    await vi.advanceTimersByTimeAsync(SPELL_DEBOUNCE_MS + 10);
  }
}

/** The words currently underlined, with their document text. */
function flagged(ed: Editor): string[] {
  const set = spellcheckPluginKey.getState(ed.state)!.decos;
  return set
    .find()
    .map((d) => ed.state.doc.textBetween(d.from, d.to))
    .sort();
}

// ── A. what is flagged ───────────────────────────────────────────────────────

describe("what gets underlined", () => {
  it("a misspelling is flagged; correct prose is not", async () => {
    const { ref } = makePort();
    const ed = mount("The quick brown fox and the teh word here.", ref);
    await settle();
    expect(flagged(ed)).toEqual(["teh"]);
  });

  it("the decoration's range holds exactly the word", async () => {
    const { ref } = makePort();
    const ed = mount("The quick teh fox.", ref);
    await settle();
    const decos = spellcheckPluginKey.getState(ed.state)!.decos.find();
    expect(decos).toHaveLength(1);
    expect(ed.state.doc.textBetween(decos[0].from, decos[0].to)).toBe("teh");
    expect((decos[0] as unknown as { type: { attrs: { class: string } } }).type.attrs.class)
      .toBe(SPELL_ERROR_CLASS);
  });

  it("nothing inside a raw-LaTeX carrier is flagged", async () => {
    // `\foobar{…}` is unmodeled, so the whole run is a carrier — the command
    // NAME must never be underlined. The word after it is the control.
    const { ref } = makePort();
    const ed = mount("Some \\foobar{inside} teh here.", ref);
    await settle();
    expect(flagged(ed)).toEqual(["teh"]);
  });

  it("nothing inside a `%` comment block is flagged", async () => {
    const { ref } = makePort();
    const ed = mount("Some prose here.\n\n% teh commented typo\n\nMore teh prose.", ref);
    await settle();
    // Exactly one — the one in real prose.
    expect(flagged(ed)).toEqual(["teh"]);
  });

  it("an ACCEPTED word is never flagged, and accepting one CLEARS its squiggle", async () => {
    const { ref, port } = makePort();
    const ed = mount("The quick zzyzx fox.", ref);
    await settle();
    expect(flagged(ed)).toEqual(["zzyzx"]);

    // "Add to dictionary" — the accepted set changes and the port's version
    // bumps, which is the ONE channel for a change no transaction describes.
    port.accepted.add("zzyzx");
    port.bump();
    ed.view.dispatch(ed.state.tr.setMeta("forceUpdate", true));
    await settle();
    expect(flagged(ed)).toEqual([]);
  });

  it("the word under the caret is not flagged while it is being typed", async () => {
    const { ref } = makePort();
    const ed = mount("The quick brown fox.", ref);
    await settle();
    // Type a fresh misspelling at the end of the first paragraph and leave the
    // caret inside it.
    const end = ed.state.doc.content.size - 2;
    ed.chain().setTextSelection(end).insertContent(" zzyzx").run();
    await settle();
    expect(flagged(ed)).toEqual([]);
    // Move the caret out of the word — the caret MOVING is what finishes it.
    ed.chain().setTextSelection(2).run();
    await settle();
    expect(flagged(ed)).toEqual(["zzyzx"]);
  });
});

// ── B. what it costs ─────────────────────────────────────────────────────────

describe("keystroke sanctity", () => {
  /**
   * What ONE keystroke into an `n`-paragraph document costs, measured through
   * the REAL stack — with the checker mounted (`withPort`) and without.
   *
   * The A/B is the instrument, because an ABSOLUTE count says nothing here:
   * other plugins in the real stack legitimately walk the document on a
   * keystroke, and a whole-document rebuild inside `apply` would add exactly
   * ONE `descendants` call at every document size, so a two-size comparison
   * could not see it. Attributing the delta to this plugin can.
   *
   * The B side passes `null` — no REF AT ALL — because that is what makes
   * `addProseMirrorPlugins` return `[]`. Passing `{ current: null }` registers
   * the plugin with an empty port, so its `apply` still runs and the A/B goes
   * BLIND: measured, a whole-document rebuild planted in `apply` walks in both
   * arms and the leg passes. (That shape is the accepting control two legs
   * down, where an inert port is exactly what is being asserted.)
   */
  async function keystrokeCost(n: number, withPort: boolean) {
    const { ref, port } = makePort();
    const ed = mount(
      Array.from({ length: n }, (_, i) => `Paragraph ${i} of quick brown prose.`).join("\n\n"),
      withPort ? ref : null,
    );
    await settle();
    const before = port.ensureCalls;
    const walk = vi.spyOn(PMNode.prototype, "descendants");
    ed.chain().setTextSelection(3).insertContent("x").run();
    const walks = walk.mock.calls.length;
    walk.mockRestore();
    ed.destroy();
    editor = null;
    return { walks, ensures: port.ensureCalls - before };
  }

  it("a plain keystroke adds NO document walk and consults no dictionary", async () => {
    const on = await keystrokeCost(40, true);
    const off = await keystrokeCost(40, false);
    expect(on.walks).toBe(off.walks);
    expect(on.ensures).toBe(0);
  });

  it("…and that stays true as the document grows", async () => {
    // The scaling half: whatever the plugin costs per keystroke, it must not
    // grow with the paper. Same A/B at 4x the size.
    const on = await keystrokeCost(160, true);
    const off = await keystrokeCost(160, false);
    expect(on.walks).toBe(off.walks);
    expect(on.ensures).toBe(0);
  });

  it("a BURST costs ONE pass, not one per character", async () => {
    const { ref, port } = makePort();
    const ed = mount("The quick brown fox.", ref);
    await settle();
    const before = port.ensureCalls;
    for (let i = 0; i < 12; i++) {
      ed.chain().setTextSelection(3).insertContent("q").run();
      await vi.advanceTimersByTimeAsync(10);
    }
    expect(port.ensureCalls).toBe(before);
    await settle();
    // One warm-up for the whole burst — and it is bounded by the words the
    // cache has never seen, not by the keystrokes.
    expect(port.ensureCalls).toBeLessThanOrEqual(before + 2);
  });
});

// ── C. what it IS ────────────────────────────────────────────────────────────

describe("a squiggle is a view, never document content", () => {
  it("the result transaction changes no document and enters no history", async () => {
    const { ref } = makePort();
    const ed = mount("The quick teh fox.", ref);
    const seen: boolean[] = [];
    ed.on("transaction", ({ transaction }) => {
      if (transaction.getMeta(spellcheckPluginKey)) {
        seen.push(transaction.docChanged || transaction.getMeta("addToHistory") !== false);
      }
    });
    const before = ed.getHTML();
    await settle();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((bad) => bad === false)).toBe(true);
    expect(ed.getHTML()).toBe(before);
  });

  it("ONE owner for the underline: Virgil's checker turns the browser's off", async () => {
    const { ref, port } = makePort();
    const ed = mount("The quick teh fox.", ref);
    await settle();
    expect(ed.view.dom.getAttribute("spellcheck")).toBe("false");

    // …and hands the surface BACK when it cannot check — the honest answer to
    // a failed dictionary load is the browser's underline, not none at all.
    port.setEnabled(false);
    ed.view.dispatch(ed.state.tr.setMeta("forceUpdate", true));
    await settle();
    expect(ed.view.dom.hasAttribute("spellcheck")).toBe(false);
    expect(flagged(ed)).toEqual([]);
  });

  it("a surface with NO port is inert — the accepting control", async () => {
    const ed = mount("The quick teh fox.", { current: null });
    await settle();
    expect(spellcheckPluginKey.getState(ed.state)!.decos.find()).toEqual([]);
    expect(ed.view.dom.hasAttribute("spellcheck")).toBe(false);
  });
});

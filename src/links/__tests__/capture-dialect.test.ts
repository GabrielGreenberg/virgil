// @vitest-environment jsdom
//
// Task 2026-09-21-696 — ONE capture, THREE derived forms.
//
// THE DEFECT. A captured passage is read in three dialects and, until this
// task, only two of them were ever produced. `createLinkedAnchor` took the
// PLAIN form (`doc.textBetween` — the relocation currency a Mode-B anchor is
// re-found by) and, since task 488, the RICH form (the slice the "Original"
// surfaces mount). The APPLY path consumes neither: it serializes the anchored
// paragraph to inline LaTeX and requires the suggestion's `original_text` to
// appear in it VERBATIM. Seeding that field from the plain form therefore
// could only ever work for a span that carried no markup at all — every cut
// over an italic phrase, a citation, a footnote or `$x$` missed, answered
// `stale`, and told the user the paragraph had changed when nothing had. The
// card is marked and never retried, so the suggestion died on first press with
// a false explanation.
//
// THE FIX, in two halves that share ONE derivation:
//   - CAPTURE — `captureRangeLatex` reads the same cut the rich form comes
//     from, in the apply dialect, and `createLinkedAnchor` carries it beside
//     its siblings. New cards hold real `.tex` bytes.
//   - REPAIR — every card already on disk still holds the flattened line, and
//     nothing may rewrite those silently. So `locateSpan` grows a second rung
//     that finds the flattened needle in the paragraph's PLAIN projection,
//     maps the hit back to a document range, RE-CUTS that range through the
//     same capture leaf, and then requires THAT to be verbatim.
//
// The re-cut is what keeps the negative case negative: the rung cannot widen
// what is spliceable, because its own result still has to pass the verbatim
// test. Each markup leg below asserts its precondition explicitly — the
// flattened needle is NOT a substring of the serialization — so a leg that
// stopped exercising the rung would stop being a leg.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Figure / graphics / tex-block React NodeViews transitively import
// `@/lib/storage`; stub it (the apply-suggestion / structural-edit pattern).
vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor, type Content } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { serializeParagraphInline } from "@/lib/latex-serializer";
import { findNodeByUuid } from "@/lib/tiptap/structural-edit";
import {
  captureRangeContent,
  captureRangeLatex,
} from "@/lib/tiptap/slice-capture";
import { createLinkedAnchor } from "@/links/links";
import { applyPendingChange } from "@/links/apply-suggestion";
import { setPendingChangesFlag } from "@/lib/pending-changes-flag";

function mainCtx(): EditorExtensionsCtx {
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

const CARD_ID = "card-696";
const ANCHOR_ID = "anchor-696";

// One paragraph per markup KIND the defect covers — a mark, and the three
// inline atom shapes. Every fixture's span STRADDLES its markup, which is the
// case the verbatim rung cannot see: the inner text of an `\emph{}` is a
// substring of the serialization on its own, so a leg that selected only the
// italic words would pass even unfixed.
const EMPH = "e001";
const CITE = "c001";
const NOTE = "f001";
const MATH = "m001";

function makeContent(): Content {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { uuid: EMPH },
        content: [
          { type: "text", text: "The " },
          { type: "text", marks: [{ type: "italic" }], text: "quick brown" },
          { type: "text", text: " fox jumps." },
        ],
      },
      {
        type: "paragraph",
        attrs: { uuid: CITE },
        content: [
          { type: "text", text: "See " },
          {
            type: "citation",
            attrs: {
              citationId: "cit1",
              command: "\\citet{foo}",
              displayText: "Foo 2020",
            },
          },
          { type: "text", text: " for details." },
        ],
      },
      {
        type: "paragraph",
        attrs: { uuid: NOTE },
        content: [
          { type: "text", text: "A claim" },
          {
            type: "footnote",
            attrs: {
              footnoteId: "fn1",
              content: {
                type: "doc",
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "But see." }] },
                ],
              },
            },
          },
          { type: "text", text: " stands." },
        ],
      },
      {
        type: "paragraph",
        attrs: { uuid: MATH },
        content: [
          { type: "text", text: "Let " },
          { type: "inlineMath", attrs: { latex: "x = 1" } },
          { type: "text", text: " hold." },
        ],
      },
    ],
  };
}

function mount(): { editor: Editor; cleanup: () => void } {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: makeContent(),
  });
  return { editor, cleanup: () => { editor.destroy(); element.remove(); } };
}

/** The live paragraph node carrying `uuid`, and its document position. */
function para(editor: Editor, uuid: string) {
  return findNodeByUuid(editor, uuid)!;
}

/** The inline-LaTeX serialization of the paragraph carrying `uuid`. */
function paraInline(editor: Editor, uuid: string): string {
  return serializeParagraphInline(para(editor, uuid).node.toJSON());
}

/** The paragraph's inner range — exactly the span a "select the whole
 *  paragraph's text" gesture produces. */
function innerRange(editor: Editor, uuid: string): { from: number; to: number } {
  const hit = para(editor, uuid);
  return { from: hit.pos + 1, to: hit.pos + 1 + hit.node.content.size };
}

/** The FLATTENED capture of that span — `doc.textBetween`, byte-for-byte what
 *  `createLinkedAnchor` recorded as `anchorText` before this task, and what
 *  every card already on disk holds as its `original_text`. */
function flattened(editor: Editor, uuid: string): string {
  const { from, to } = innerRange(editor, uuid);
  return editor.state.doc.textBetween(from, to, " ");
}

/** The apply path stamps the blue `pending-ai-change` range over what it
 *  inserted, so the paragraph's serialization carries that mark's
 *  `\vlid`/`\vlidend` boundary markers. Spell the expectation WITH them
 *  rather than stripping them out — a leg that quietly erased the mark would
 *  stop noticing if the mark landed on the wrong span. */
function marked(inner: string): string {
  return `\\vlid{${ANCHOR_ID}}${inner}\\vlidend{${ANCHOR_ID}}`;
}

const KINDS: ReadonlyArray<[string, string]> = [
  ["an emphasis mark", EMPH],
  ["a citation atom", CITE],
  ["a footnote atom", NOTE],
  ["inline math", MATH],
];

describe("the capture produces the APPLY dialect (task 696)", () => {
  let h: { editor: Editor; cleanup: () => void };
  beforeEach(() => { h = mount(); });
  afterEach(() => h.cleanup());

  it.each(KINDS)("captureRangeLatex over %s yields the span's LaTeX, not its flattened line", (_label, uuid) => {
    const { from, to } = innerRange(h.editor, uuid);
    const latex = captureRangeLatex(h.editor.state.doc, from, to);
    // The whole paragraph was selected, so the span's LaTeX IS the paragraph's
    // serialization — the strongest available statement that the two dialects
    // now agree, and the exact property `locateSpan` byte-matches on.
    expect(latex).toBe(paraInline(h.editor, uuid));
    // …and it is a different string from the plain form, which is the defect.
    expect(latex).not.toBe(flattened(h.editor, uuid));
  });

  it("the three forms come from ONE cut: plain, rich and LaTeX describe the same span", () => {
    const { from, to } = innerRange(h.editor, CITE);
    const rich = captureRangeContent(h.editor.state.doc, from, to) as {
      content?: { content?: { type?: string }[] }[];
    };
    // Rich: the citation survives as an ATOM (what `textBetween` drops).
    const inline = rich.content?.[0]?.content ?? [];
    expect(inline.some((n) => n.type === "citation")).toBe(true);
    // LaTeX: the same atom, as the bytes the apply path splices.
    expect(captureRangeLatex(h.editor.state.doc, from, to)).toContain("\\citet{foo}");
    // Plain: the atom contributes nothing at all — lossy by design, and why it
    // must not be the apply currency.
    expect(flattened(h.editor, CITE)).not.toContain("citet");
  });

  it("createLinkedAnchor records the LaTeX form beside the plain and rich ones", () => {
    const { from, to } = innerRange(h.editor, EMPH);
    const record = createLinkedAnchor(h.editor, "cutter-comment", { from, to });
    expect(record).not.toBeNull();
    expect(record!.text).toBe("The quick brown fox jumps.");
    expect(record!.content).toBeTruthy();
    expect(record!.latex).toBe("The \\emph{quick brown} fox jumps.");
  });

  it("a span with no single inline form carries NO LaTeX (absent, never a guess)", () => {
    // Two paragraphs: `locateSpan` only ever searches ONE anchored paragraph,
    // so a multi-block span has no apply currency. Answering with a flattened
    // one is the defect; answering with nothing is what makes the card say
    // `no-capture` instead of offering an Apply that cannot succeed.
    const a = para(h.editor, EMPH);
    const b = para(h.editor, CITE);
    const latex = captureRangeLatex(
      h.editor.state.doc,
      a.pos + 1,
      b.pos + b.node.nodeSize - 1,
    );
    expect(latex).toBeNull();
  });
});

describe("the apply path repairs a FLATTENED original_text (task 696)", () => {
  let h: { editor: Editor; cleanup: () => void };
  beforeEach(() => { setPendingChangesFlag(true); h = mount(); });
  afterEach(() => { h.cleanup(); setPendingChangesFlag(false); });

  it.each(KINDS)("a card captured over %s applies instead of landing stale", (_label, uuid) => {
    const flat = flattened(h.editor, uuid);
    const before = paraInline(h.editor, uuid);
    // PRECONDITION — the verbatim rung alone cannot see this needle. Without
    // this assertion the leg would pass against unfixed code for the fixtures
    // whose plain form happens to survive serialization.
    expect(before.includes(flat)).toBe(false);

    const res = applyPendingChange(h.editor, {
      anchorUuid: uuid,
      originalText: flat,
      replacement: "REPLACED",
      mode: "replace",
      cardId: CARD_ID,
      anchorId: ANCHOR_ID,
      family: "cutter-suggestion",
    });

    expect(res.ok).toBe(true);
    // The splice removed EXACTLY the span the flattened line named — the whole
    // paragraph's markup included, not just the plain words around it.
    expect(paraInline(h.editor, uuid)).toBe(marked("REPLACED"));
    // …and it reports the bytes it actually cut, which is what Revert restores.
    expect(res.ok && res.originalText).toBe(before);
  });

  it("a genuinely stale card still lands stale, with the document untouched", () => {
    const before = paraInline(h.editor, EMPH);
    const res = applyPendingChange(h.editor, {
      anchorUuid: EMPH,
      originalText: "a sentence that was edited away",
      replacement: "REPLACED",
      mode: "replace",
      cardId: CARD_ID,
      anchorId: ANCHOR_ID,
      family: "cutter-suggestion",
    });
    expect(res).toEqual({ ok: false, reason: "stale" });
    expect(paraInline(h.editor, EMPH)).toBe(before);
  });

  it("a paragraph that REALLY changed goes stale — the rung re-derives, it does not match loosely", () => {
    // Capture the flattened line, then edit the paragraph so the span is gone.
    const flat = flattened(h.editor, EMPH);
    const { from, to } = innerRange(h.editor, EMPH);
    h.editor.chain().setTextSelection({ from, to }).insertContent("Something else entirely.").run();
    const before = paraInline(h.editor, EMPH);

    const res = applyPendingChange(h.editor, {
      anchorUuid: EMPH,
      originalText: flat,
      replacement: "REPLACED",
      mode: "replace",
      cardId: CARD_ID,
      anchorId: ANCHOR_ID,
      family: "cutter-suggestion",
    });
    expect(res).toEqual({ ok: false, reason: "stale" });
    expect(paraInline(h.editor, EMPH)).toBe(before);
  });

  it("the rung does NOT rescue a marker-straddling needle", () => {
    // The refusal class `apply-suggestion.ts` names in its header: a span that
    // crosses the citation but omits the invisible `\vcid{…}` id marker —
    // what a model working off the rendered text drafts. The verbatim rung
    // misses it, and the repair rung must miss it too: the needle is not the
    // plain projection either (it carries `\citet{foo}`, which `textBetween`
    // never produces), so nothing re-derives and the card stays stale. A rung
    // that matched "close enough" would splice the wrong bytes here.
    const before = paraInline(h.editor, CITE);
    expect(before).toContain("\\vcid{cit1}\\citet{foo}");
    const res = applyPendingChange(h.editor, {
      anchorUuid: CITE,
      originalText: "See \\citet{foo} for",
      replacement: "REPLACED",
      mode: "replace",
      cardId: CARD_ID,
      anchorId: ANCHOR_ID,
      family: "cutter-suggestion",
    });
    expect(res).toEqual({ ok: false, reason: "stale" });
    expect(paraInline(h.editor, CITE)).toBe(before);
  });

  it("a sub-span repair cuts only its own bytes, leaving the rest of the paragraph alone", () => {
    // "The quick brown fox" — straddles the emphasis, so the verbatim rung
    // misses; the re-cut must land `The \emph{quick brown} fox`, not the whole
    // paragraph and not the italic words alone.
    const before = paraInline(h.editor, EMPH);
    expect(before.includes("The quick brown fox")).toBe(false);
    const res = applyPendingChange(h.editor, {
      anchorUuid: EMPH,
      originalText: "The quick brown fox",
      replacement: "A cat",
      mode: "replace",
      cardId: CARD_ID,
      anchorId: ANCHOR_ID,
      family: "cutter-suggestion",
    });
    expect(res.ok).toBe(true);
    expect(paraInline(h.editor, EMPH)).toBe(`${marked("A cat")} jumps.`);
    expect(res.ok && res.originalText).toBe("The \\emph{quick brown} fox");
  });
});

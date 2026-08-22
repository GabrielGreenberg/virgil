// @vitest-environment jsdom
/**
 * The one home of the empty-StepMap rule (task 400).
 *
 * `AGENTS.md` states it — "a step map is not a description of what changed" —
 * and it was implemented in three places, one of which did not carry it: the
 * `latexCommand` decoration plugin's range extractor read maps only, so the
 * type-time carrier's own `AddMarkStep` was invisible to it and the plugin had
 * to bolt a separate whole-document probe on top to cover the gap.
 *
 * These legs pin the two READINGS of the rule and the exclusion between them,
 * because the exclusion is the part a later "unification" would be most
 * tempted to delete: `contentChangedRanges` must stay blind to mark steps or
 * the carrier re-enters on its own appended transaction, and `touchedRanges`
 * must see them or a decoration goes stale over a run that now renders itself.
 */
import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  contentChangedRanges,
  stepTouches,
  touchedRanges,
  touchedTextblocks,
} from "@/lib/tiptap/changed-ranges";

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

function mount(content: string): Editor {
  editor = new Editor({ extensions: [StarterKit], content });
  return editor;
}

describe("the empty-StepMap rule", () => {
  it("touchedRanges reports an AddMarkStep; contentChangedRanges does not", () => {
    const ed = mount("<p>alpha beta</p><p>gamma</p>");
    const tr = ed.state.tr.addMark(
      2,
      6,
      ed.state.schema.marks.bold!.create(),
    );
    expect(tr.docChanged).toBe(true);
    // The map is EMPTY — the shape that made this invisible.
    expect(tr.mapping.maps.every((m) => {
      let n = 0;
      m.forEach(() => n++);
      return n === 0;
    })).toBe(true);

    expect(touchedRanges([tr])).toEqual([{ from: 2, to: 6 }]);
    expect(contentChangedRanges([tr])).toEqual([]);
  });

  it("touchedTextblocks returns the touched block for an AddMarkStep", () => {
    const ed = mount("<p>alpha beta</p><p>gamma</p>");
    const tr = ed.state.tr.addMark(
      2,
      6,
      ed.state.schema.marks.bold!.create(),
    );
    const blocks = touchedTextblocks(tr.doc, touchedRanges([tr]));
    expect([...blocks.keys()]).toEqual([0]);
    expect(blocks.get(0)!.textContent).toBe("alpha beta");
  });

  it("a RemoveMarkStep and a node AttrStep are positional too", () => {
    const ed = mount("<p>alpha beta</p>");
    const bold = ed.state.schema.marks.bold!;
    const marked = ed.state.tr.addMark(2, 6, bold.create());
    ed.view.dispatch(marked);
    const off = ed.state.tr.removeMark(2, 6, bold);
    expect(touchedRanges([off])).toEqual([{ from: 2, to: 6 }]);

    const attr = ed.state.tr.setNodeAttribute(0, "textAlign", "right");
    // `AttrStep` carries a `pos`, not a range — a zero-width touch AT the node.
    expect(touchedRanges([attr])).toEqual([{ from: 0, to: 0 }]);
    expect(contentChangedRanges([attr])).toEqual([]);
  });

  it("a step that names no position at all fails SAFE, both readings", () => {
    // The `DocAttrStep` shape, and any step type that did not exist when the
    // rule was written: the predicate says "touched" and the extractor says
    // "the whole document". A needless re-derivation is the status quo; a
    // missed one is silently stale.
    const nameless = { getMap: () => ({ forEach: () => {} }) } as never;
    expect(stepTouches(nameless, 10, 20)).toBe(true);
    expect(stepTouches(undefined, 10, 20)).toBe(true);
  });

  it("a content edit is reported by BOTH readings, identically", () => {
    const ed = mount("<p>alpha</p><p>beta</p>");
    const tr = ed.state.tr.insertText("X", 3);
    expect(touchedRanges([tr])).toEqual(contentChangedRanges([tr]));
    expect(touchedRanges([tr])).toHaveLength(1);
  });
});

describe("touchedTextblocks", () => {
  it("resolves ONE block for a caret edit, at any index", () => {
    const paras = Array.from({ length: 30 }, (_, i) => `<p>para ${i}</p>`).join("");
    const ed = mount(paras);
    const last = ed.state.doc.content.size - 2;
    const tr = ed.state.tr.insertText("Z", last);
    const blocks = touchedTextblocks(tr.doc, touchedRanges([tr]));
    expect(blocks.size).toBe(1);
    expect([...blocks.values()][0]!.textContent).toContain("para 2");
  });

  it("resolves EVERY block a multi-block range spans", () => {
    const ed = mount("<p>one</p><p>two</p><p>three</p>");
    const tr = ed.state.tr.delete(2, ed.state.doc.content.size - 2);
    const blocks = touchedTextblocks(tr.doc, touchedRanges([tr]));
    expect(blocks.size).toBeGreaterThanOrEqual(1);
    // The surviving merged block is reported, and nothing throws on a range
    // whose endpoints the delete has collapsed.
    for (const [pos, node] of blocks) {
      expect(node.isTextblock).toBe(true);
      expect(pos).toBeGreaterThanOrEqual(0);
    }
  });

  it("descends into containers and stops at the textblock", () => {
    const ed = mount("<ul><li><p>alpha</p></li><li><p>beta</p></li></ul>");
    const tr = ed.state.tr.insertText("Z", 4);
    const blocks = touchedTextblocks(tr.doc, touchedRanges([tr]));
    expect(blocks.size).toBe(1);
    expect([...blocks.values()][0]!.type.name).toBe("paragraph");
  });

  it("clamps an over-wide range instead of throwing", () => {
    const ed = mount("<p>alpha</p>");
    const blocks = touchedTextblocks(ed.state.doc, [
      { from: -50, to: 10_000 },
    ]);
    expect(blocks.size).toBe(1);
  });

  it("reports the INSERTED range for the delete-then-insert shape (task 320)", () => {
    // A per-transaction `tr.mapping` re-applies earlier steps' maps to
    // positions that already reflect them, which collapses the inserted range
    // to nothing when the insert lands BELOW the cut. Each step is read
    // against its own map and mapped forward instead.
    const ed = mount("<p>alpha</p><p>beta</p><p>gamma</p>");
    const tr = ed.state.tr;
    tr.delete(1, 6); // empty the first paragraph
    tr.insertText("ZZZ", tr.mapping.map(ed.state.doc.content.size - 2));
    const blocks = touchedTextblocks(tr.doc, touchedRanges([tr]));
    const texts = [...blocks.values()].map((n) => n.textContent);
    expect(texts.some((t) => t.includes("ZZZ"))).toBe(true);
  });
});

// @vitest-environment jsdom
//
// Task 1440 — the type-time smart-quote rule and the save-side smartener are
// ONE decision (`straightQuoteRole`, latex-typography.ts).
//
// The input rule used to carry its own regex copy of the save side's opener
// class and had drifted twice: it lacked `/` (so `and/"or"` typed a CLOSING
// quote — task 209 back at type time, via 1288) and it had no escape test (so
// typing `M\"uller` curled the umlaut accent's `"` into `\”`, which the carrier
// then wrote to the .tex byte for byte).
//
// CENSUS: for every context in the table, typing `"` on the shipped main AND
// float stacks picks the same glyph `smartenStraightQuotes` picks for a
// straight `"` in that context — so a future save-side edit cannot drift from
// typing again. Typed through `handleTextInput` (`insertContent` fires no
// input rule, so every leg would pass vacuously on it).
import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import type { JSONContent } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { serializeToLatex } from "@/lib/latex-serializer";
import {
  smartenStraightQuotes,
  straightQuoteRole,
} from "@/lib/latex-typography";
import type { SpellcheckPort, SpellcheckPortRef } from "@/lib/spell/spell-port";

function makePortRef(): SpellcheckPortRef {
  const port: SpellcheckPort = {
    enabled: () => false,
    autocorrect: () => false,
    version: () => 0,
    onInvalidate: () => () => {},
    isAccepted: () => false,
    knownSync: () => undefined,
    ensure: async () => {},
    suggest: async () => [],
    acceptInPaper: () => {},
    acceptGlobally: () => {},
  };
  return { current: port };
}

const SURFACES: Record<"main" | "float", () => EditorExtensionsCtx> = {
  main: () => ({
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
    spellcheckPortRef: makePortRef(),
  }) as unknown as EditorExtensionsCtx,
  float: () => ({
    surface: "float",
    editableRef: { current: true },
    cardContext: true,
    callbacks: {},
    docIdRef: { current: null },
    host: { getMainEditor: () => null },
    spellcheckPortRef: makePortRef(),
  }) as unknown as EditorExtensionsCtx,
};

const live: Editor[] = [];
afterEach(() => {
  while (live.length) live.pop()?.destroy();
});

function mount(surface: "main" | "float"): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const ed = new Editor({
    element,
    extensions: buildEditorExtensions(SURFACES[surface]()),
    content: {
      type: "doc",
      content: [{ type: "paragraph", attrs: { uuid: "p1" }, content: [] }],
    },
  });
  live.push(ed);
  ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, 1)));
  return ed;
}

function typeText(ed: Editor, text: string) {
  for (const ch of text) {
    const { from, to } = ed.state.selection;
    const handled = ed.view.someProp("handleTextInput", (f) =>
      f(ed.view, from, to, ch, () => ed.state.tr.insertText(ch, from, to)),
    );
    if (!handled) ed.view.dispatch(ed.state.tr.insertText(ch, from, to));
  }
}

const para = (ed: Editor) => ed.state.doc.firstChild?.textContent ?? "";

/** Contexts a `"` can be typed after. `""` = start of the paragraph. (An
 *  EVEN backslash run cannot be typed as prose — `\\` becomes a raw-LaTeX
 *  carrier the moment it is typed, and TipTap fires no rule beside a `code`
 *  mark — so that leg is pinned on the predicate itself, below.) */
const CONTEXTS: readonly string[] = [
  "",
  "a ",
  "(",
  "[",
  "{",
  "and/",
  "a—",
  "a–",
  "M\\",
  "word",
  "3",
];

/** What the save side makes of a straight `"` after `prefix`. */
function saveSideGlyph(prefix: string): string {
  const out = smartenStraightQuotes(prefix + '"', () => false).slice(
    prefix.length,
  );
  return out === "``" ? "“" : out === "''" ? "”" : out;
}

describe("type-time smart quotes pick the save side's glyph (task 1440 census)", () => {
  for (const surface of ["main", "float"] as const) {
    for (const prefix of CONTEXTS) {
      const expected = saveSideGlyph(prefix);
      it(`${surface}: \`${prefix}"\` → \`${expected}\``, () => {
        const ed = mount(surface);
        typeText(ed, prefix + '"');
        expect(para(ed)).toBe(prefix + expected);
      });
    }
  }

  it("the escape test counts the backslash run (odd → escaped, even → a quote)", () => {
    expect(straightQuoteRole('\\"', 1)).toBe("escaped");
    expect(straightQuoteRole('x\\\\"', 3)).toBe("close");
    expect(straightQuoteRole('\\\\\\"', 3)).toBe("escaped");
  });

  it("the census table covers all three roles", () => {
    const glyphs = new Set(CONTEXTS.map(saveSideGlyph));
    expect(glyphs).toEqual(new Set(["“", "”", '"']));
  });
});

describe("the two members, end to end to the .tex", () => {
  for (const surface of ["main", "float"] as const) {
    it(`${surface}: typing \`M\\"uller\` keeps the umlaut accent straight`, () => {
      const ed = mount(surface);
      typeText(ed, 'M\\"uller');
      expect(para(ed)).not.toContain("”");
      const tex = serializeToLatex(ed.getJSON() as JSONContent);
      expect(tex).toContain('M\\"uller');
    });

    it(`${surface}: typing \`and/"or"\` saves \`and/\`\`or''\``, () => {
      const ed = mount(surface);
      typeText(ed, 'and/"or"');
      expect(para(ed)).toBe("and/“or”");
      expect(serializeToLatex(ed.getJSON() as JSONContent)).toContain(
        "and/``or''",
      );
    });
  }
});

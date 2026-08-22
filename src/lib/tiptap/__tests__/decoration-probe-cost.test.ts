// @vitest-environment jsdom
/**
 * The decoration floor: no O(document) probe on the keystroke path (task 337).
 *
 * `DecorationSet.find()` with NO arguments is the one call on that class that
 * is O(all decorations in the document): `findInner` runs with the default
 * `0 … 1e9` range, so its child gate (`children[i] < end && children[i+1] >
 * start`) is true for EVERY subtree, and it allocates a copied `Decoration`
 * per hit. `find(from, to)` is bounded — it descends only into children whose
 * span overlaps the query.
 *
 * The latex-command plugin called the argless form on every `docChanged`
 * transaction whose changed region held no backslash — i.e. on every ordinary
 * keystroke — purely to test "is the set non-empty?" before running a bounded
 * loop that already answers `[]` on an empty set. A real paper has hundreds of
 * `\command` decorations; the fixture has a handful, which is why this sat
 * unmeasured. The gate could never change the outcome either: mapping cannot
 * ADD a decoration, so an empty `oldSet` implies an empty `mapped`.
 *
 * Two legs. The behavioural one drives a REAL editor and counts argless calls
 * across a typing burst. The CENSUS is the leg with teeth — the plugin was
 * never the only place this shape can appear, and a second one would be
 * invisible to any behavioural test of this plugin.
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { Node as PMNode } from "@tiptap/pm/model";
import { LatexCommandMark } from "@/lib/tiptap/latex-command";
import { commentsStripped } from "@/lib/__tests__/_source-scan";

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
});

/** A doc with many command decorations — the real-paper shape. */
function commandRichHtml(n: number): string {
  const paras = Array.from(
    { length: n },
    (_, i) => `<p>prose ${i} with \\emph{x} and \\textbf{y} inside</p>`,
  ).join("");
  return `${paras}<p>plain tail</p>`;
}

describe("latex-command decoration probe cost", () => {
  it("never calls the argless (O(doc)) DecorationSet.find on the keystroke path", () => {
    editor = new Editor({
      extensions: [StarterKit, LatexCommandMark],
      content: commandRichHtml(40),
    });
    const ed = editor;

    const proto = DecorationSet.prototype as unknown as {
      find: (...a: unknown[]) => unknown;
    };
    const real = proto.find;
    let argless = 0;
    let bounded = 0;
    proto.find = function patched(this: DecorationSet, ...args: unknown[]) {
      if (args.length === 0 || args[0] === undefined) argless++;
      else bounded++;
      return (real as (...a: unknown[]) => unknown).apply(this, args);
    };
    try {
      // A burst of plain characters into the LAST paragraph: no backslash in
      // any changed region, so every transaction takes the cheap path.
      for (let i = 0; i < 12; i++) {
        ed.commands.insertContentAt(ed.state.doc.content.size - 1, "a");
      }
    } finally {
      proto.find = real;
    }

    expect(argless).toBe(0);
    // The bounded per-step probe still runs — that is the behaviour being
    // preserved, and it is what makes the deleted guard redundant. A FLOOR
    // (one per keystroke), not `> 0`: this counts every DecorationSet.find
    // in the editor, so a bare `> 0` would stay satisfied by some other
    // plugin's bounded probe if this loop were deleted outright.
    expect(bounded).toBeGreaterThanOrEqual(12);
  });

  /**
   * Type `\emph{hi}` into paragraph 0 of an n-paragraph document and report
   * how much was re-derived: `Node.prototype.descendants` counts whole-document
   * WALKS (prosemirror recurses through `nodesBetween`, so one build registers
   * exactly one call), and the two Decoration constructors count the
   * DERIVATIONS — how many blocks' decorations were actually recomputed, which
   * is the contract.
   */
  function typingCost(n: number): { walks: number; derived: number; text: string } {
    const paras = Array.from(
      { length: n },
      (_, i) => `<p>para ${i} holds \\emph{x} inline</p>`,
    ).join("");
    editor = new Editor({
      extensions: [StarterKit, LatexCommandMark],
      content: paras,
    });
    const ed = editor;

    const proto = PMNode.prototype as unknown as {
      descendants: (...a: unknown[]) => unknown;
    };
    const realDescendants = proto.descendants;
    const realInline = Decoration.inline;
    const realNode = Decoration.node;
    let walks = 0;
    let derived = 0;
    proto.descendants = function patched(this: PMNode, ...args: unknown[]) {
      walks++;
      return (realDescendants as (...a: unknown[]) => unknown).apply(this, args);
    };
    const count = (real: unknown) =>
      ((...args: unknown[]) => {
        derived++;
        return (real as (...a: unknown[]) => unknown)(...args);
      }) as never;
    (Decoration as unknown as { inline: unknown }).inline = count(realInline);
    (Decoration as unknown as { node: unknown }).node = count(realNode);

    try {
      const typed = "\\emph{hi}";
      for (let i = 0; i < typed.length; i++) {
        ed.commands.insertContentAt(1 + i, typed[i]!);
      }
    } finally {
      proto.descendants = realDescendants;
      (Decoration as unknown as { inline: unknown }).inline = realInline;
      (Decoration as unknown as { node: unknown }).node = realNode;
    }
    const text = ed.state.doc.firstChild!.textContent;
    ed.destroy();
    editor = null;
    return { walks, derived, text };
  }

  it("re-derives O(touched blocks), not the whole document, while a command is typed", () => {
    // Task 400. The three probes in front of the old rebuild were each correct
    // and each gated a WHOLE-DOCUMENT `buildDecorations` — so a keystroke's
    // cost scaled with the paper. `applyTransaction` runs `applyInner` on the
    // root transaction and again per appended transaction, so every key that
    // also fires the type-time carrier paid two.
    //
    // The leg with teeth is the second one: the cost of typing nine characters
    // into paragraph 0 must be IDENTICAL for a 60- and a 240-paragraph
    // document. No whole-document rebuild can satisfy that, whatever its
    // constant. MEASURED on the pre-fix tree: 5 walks and 605 derivations at
    // n = 60, 2405 at n = 240. After: 0 and 22 at both.
    const small = typingCost(60);
    const large = typingCost(240);

    // Asserted FIRST because it is the leg with teeth, and because its failure
    // message is what reports the pre-fix scaling.
    expect(large.derived).toBe(small.derived);
    expect(small.walks).toBe(0);
    expect(large.walks).toBe(0);
    // Nine keys, at most two re-derivations each (the root transaction and the
    // carrier's appended one), one block apiece, at most two decorations in it
    // (an inline span, and — while the paragraph still renders exactly one
    // element child — its `p-cmd-only` node deco).
    expect(small.derived).toBeLessThanOrEqual(9 * 2 * 2);
    // …and not zero, or the leg would pass on a plugin that stopped painting.
    expect(small.derived).toBeGreaterThan(0);
    expect(small.text).toBe("\\emph{hi}para 0 holds \\emph{x} inline");
  });

  it("a keystroke in a p-cmd-only paragraph re-derives that paragraph only", () => {
    // The broad half of the class. Probe 2 (`mapped.find(newFrom, newTo)`) is
    // true for a keystroke ANYWHERE in a paragraph carrying the `p-cmd-only`
    // NODE decoration, because `findInner` tests inclusively while the node
    // deco lives in the parent's `local`. So every keystroke in any paragraph
    // holding exactly one command run used to rebuild the document.
    const paras = Array.from(
      { length: 40 },
      (_, i) => `<p>para ${i} holds \\emph{x} inline</p>`,
    ).join("");
    editor = new Editor({
      extensions: [StarterKit, LatexCommandMark],
      content: paras,
    });
    const ed = editor;
    const realInline = Decoration.inline;
    let derived = 0;
    (Decoration as unknown as { inline: unknown }).inline = ((
      ...args: unknown[]
    ) => {
      derived++;
      return (realInline as unknown as (...a: unknown[]) => unknown)(...args);
    }) as unknown as typeof Decoration.inline;
    try {
      // A plain character in the LAST decorated paragraph.
      ed.commands.insertContentAt(ed.state.doc.content.size - 2, "z");
    } finally {
      (Decoration as unknown as { inline: unknown }).inline = realInline;
    }
    // One block re-derived ⇒ one inline span. Pre-fix: 40.
    expect(derived).toBe(1);
  });

  it("still REBUILDS when typing lands inside an existing command run", () => {
    editor = new Editor({
      extensions: [StarterKit, LatexCommandMark],
      content: "<p>\\emph</p>",
    });
    const ed = editor;
    // A SPACE inside the command name is the case that distinguishes a
    // rebuild from a map: `\emph` (5 chars) becomes `\em ph`, and only a
    // rebuilt set shrinks the run to `\em`. Mapping alone EXPANDS the
    // existing decoration to cover the inserted character, so this leg
    // fails if the overlap loop the deleted guard used to gate is removed.
    // No backslash lands in the changed region (`m`, ` `), so the cheap
    // scan says nothing and the overlap loop is the only thing that can
    // set `touched`.
    ed.commands.insertContentAt(4, " ");
    expect(ed.state.doc.textContent).toBe("\\em ph");
    const spans = [...ed.view.dom.querySelectorAll(".latex-cmd")];
    expect(spans.map((s) => s.textContent)).toEqual(["\\em"]);
  });
});

// ── Census ────────────────────────────────────────────────────────────────
const ROOTS = ["src", "library"];
const SKIP_DIR = /(^|\/)(node_modules|\.next|dist|build|out|coverage)(\/|$)/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (SKIP_DIR.test(full)) continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

/** Tests may enumerate a whole set — the cost rule is about production. */
const isTest = (f: string) => /__tests__|\.test\.tsx?$/.test(f);

/**
 * The unbounded spellings. `find()` is the obvious one; `find(null, null)` /
 * `find(undefined)` take the SAME `start == null ? 0 : start` default path in
 * prosemirror-view and cost exactly the same, so the needle names them too.
 *
 * Stated limits: the scan is per LINE (a call split across lines is missed),
 * and the reported `file:line` is computed off the comment-stripped source,
 * whose block-comment removal does not preserve newlines — so a hit under a
 * multi-line comment reports a line number that is low by the comment's
 * height. Pre-existing to this suite (`_source-scan.ts`'s CSS twin preserves
 * them and its TS twin does not); the SET of hits is exact either way.
 */
const ARGLESS_FIND =
  /\.find\(\s*(?:\)|(?:null|undefined)\s*(?:,\s*(?:null|undefined)\s*)?\))/;

describe("argless DecorationSet.find census", () => {
  const files = ROOTS.flatMap((r) => walk(r)).filter((f) => !isTest(f));

  it("no production file probes a decoration set with an argless find()", () => {
    const hits: string[] = [];
    for (const file of files) {
      // Comments stripped, string literals KEPT: the drift would live in
      // code, and the plugin's own explanatory comment names the shape.
      const src = commentsStripped(readFileSync(file, "utf8"));
      src.split("\n").forEach((line, i) => {
        if (ARGLESS_FIND.test(line)) hits.push(`${file}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it("the census can see the shape it forbids (canary)", () => {
    // A synthetic fixture, never a live production line — a canary standing
    // on the defect evaporates the moment the defect is drained.
    const fixture = commentsStripped(
      "// oldSet.find() in a comment does not count\n" +
        "const n = oldSet.find().length;\n" +
        "const m = other.find(null, null).length;\n" +
        "const ok = arr.find((x) => x.id === 1);\n",
    );
    const flagged = fixture.split("\n").filter((line) => ARGLESS_FIND.test(line));
    expect(flagged).toHaveLength(2);
    expect(flagged[0]).toContain("const n =");
    expect(flagged[1]).toContain("const m =");
  });
});

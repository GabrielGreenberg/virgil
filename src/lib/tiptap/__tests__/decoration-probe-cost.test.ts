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
import { DecorationSet } from "@tiptap/pm/view";
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

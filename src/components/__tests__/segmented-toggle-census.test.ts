/**
 * SEGMENTED-TOGGLE CENSUS (task 950).
 *
 * > A segmented choice — "pick exactly one of these N" — is spelled ONCE, by
 * > `<SegmentedToggle>` in `src/components/SegmentedToggle.tsx`.
 *
 * Four sites hand-rolled the shape and each drifted a different way: the
 * Bibliography search scope announced no state, painted "on" grey, had no
 * focus ring and hid the disabled Library button's reason; the suggestion
 * card's Original/Suggested preview wore `--accent`; the print dialog's font
 * size and the Library's Dashboard/Browse switch were two more spellings. The
 * primitive fixes all of that in one place; this census keeps a fifth spelling
 * from growing back.
 *
 * Two needles over comments-stripped production source (`src/` + `library/`):
 *  A. a `role="group"` element whose subtree carries `aria-pressed` — the
 *     announced shape of a segmented control;
 *  B. one state variable compared against two or more different literals
 *     inside `className` ternaries — the UNannounced shape (how the
 *     Bibliography scope looked before: no role, no aria-pressed, just two
 *     buttons painted by `scope === "local"` / `scope === "library"`).
 * Needle A has ONE named exemption (`NOT_A_CHOICE`, the Library's status
 * sort headers — pressed means "sorted by", not "chosen"); needle B none. A
 * hit is MIGRATE-it. Each needle carries a canary so a
 * green run cannot be a blind one.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { commentsStripped, elementsNamed, walkFiles } from "@/lib/__tests__/_source-scan";

const ROOT = join(__dirname, "..", "..", "..");
const LEAF = "src/components/SegmentedToggle.tsx";

/** Groups that announce `aria-pressed` and are NOT a segmented choice. Each
 *  entry is a file + the reason; a hit in any other file is MIGRATE-it. */
const NOT_A_CHOICE: Record<string, string> = {
  // The status-facet SORT HEADERS: pressed = "the list is sorted by this
  // facet", re-pressing flips the direction arrow, and the group is a column
  // drag target. A sort header, not "pick one of N".
  "library/components/LeftList.tsx": "status-facet sort headers",
};

function walk(dir: string): string[] {
  return walkFiles(dir, { skipDirs: ["__tests__"] }).filter((p) => /\.tsx$/.test(p));
}

const PRODUCTION = [...walk(join(ROOT, "src")), ...walk(join(ROOT, "library"))].map((p) =>
  relative(ROOT, p),
);

/** Needle A: every `role="group"` element whose own subtree announces a press. */
function pressedGroups(src: string): string[] {
  const out: string[] = [];
  for (const name of ["div", "span", "fieldset"]) {
    for (const hit of elementsNamed(src, name)) {
      if (!/\brole\s*=\s*["']group["']/.test(hit.tag)) continue;
      if (hit.subtree && /aria-pressed/.test(hit.subtree)) out.push(hit.tag.slice(0, 80));
    }
  }
  return out;
}

/** Needle B: `<button className={ … ident === "a" ? … }>` with ≥2 distinct
 *  literals per ident across one file's buttons. */
const CLASSNAME_ATTR = /className\s*=\s*\{/g;
const LITERAL_COMPARE = /([A-Za-z_$][\w$.]*)\s*===\s*["']([^"']+)["']\s*\?/g;
function literalKeyedClassNames(src: string): string[] {
  const seen = new Map<string, Set<string>>();
  for (const { tag } of elementsNamed(src, "button")) {
    let m: RegExpExecArray | null;
    CLASSNAME_ATTR.lastIndex = 0;
    while ((m = CLASSNAME_ATTR.exec(tag))) {
      // The attribute's expression: balance braces from the opening `{`.
      let depth = 0;
      let i = m.index + m[0].length - 1;
      const start = i;
      for (; i < tag.length; i++) {
        if (tag[i] === "{") depth++;
        else if (tag[i] === "}" && --depth === 0) break;
      }
      const expr = tag.slice(start, i + 1);
      let c: RegExpExecArray | null;
      LITERAL_COMPARE.lastIndex = 0;
      while ((c = LITERAL_COMPARE.exec(expr))) {
        const set = seen.get(c[1]) ?? new Set<string>();
        set.add(c[2]);
        seen.set(c[1], set);
      }
    }
  }
  return [...seen]
    .filter(([, lits]) => lits.size >= 2)
    .map(([id, lits]) => `${id} ∈ {${[...lits].join(", ")}}`);
}

function hits(scan: (src: string) => string[]): string[] {
  const out: string[] = [];
  for (const rel of PRODUCTION) {
    if (rel === LEAF) continue;
    if (scan === pressedGroups && rel in NOT_A_CHOICE) continue;
    const src = commentsStripped(readFileSync(join(ROOT, rel), "utf8"));
    for (const h of scan(src)) out.push(`${rel}: ${h}`);
  }
  return out;
}

describe("a segmented choice is spelled ONCE", () => {
  it("A: no hand-rolled role=group of aria-pressed buttons outside the primitive", () => {
    expect(hits(pressedGroups)).toEqual([]);
  });

  it("B: no sibling buttons painted by one state compared to several literals", () => {
    expect(hits(literalKeyedClassNames)).toEqual([]);
  });

  it("every NOT_A_CHOICE exemption still names a live pressed group (no dead entries)", () => {
    for (const rel of Object.keys(NOT_A_CHOICE)) {
      const src = commentsStripped(readFileSync(join(ROOT, rel), "utf8"));
      expect(pressedGroups(src).length, rel).toBeGreaterThan(0);
    }
  });

  it("the primitive is the one speller — group, aria-pressed, solid control-selected", () => {
    const leaf = commentsStripped(readFileSync(join(ROOT, LEAF), "utf8"));
    expect(/role="group"/.test(leaf)).toBe(true);
    expect(/aria-pressed=\{active\}/.test(leaf)).toBe(true);
    expect(/--control-selected\)/.test(leaf)).toBe(true);
    expect(/--accent/.test(leaf)).toBe(false);
    expect(/focus-ring/.test(leaf)).toBe(true);
  });

  it("CANARY: both needles bite on the retired shapes", () => {
    expect(
      pressedGroups(
        '<div role="group" aria-label="x"><button aria-pressed={a}>A</button></div>',
      ),
    ).toHaveLength(1);
    expect(pressedGroups('<div role="group"><button>A</button></div>')).toHaveLength(0);
    expect(
      literalKeyedClassNames(
        '<button className={`a ${scope === "local" ? "on" : "off"}`}>L</button>' +
          '<button className={`a ${scope === "library" ? "on" : "off"}`}>B</button>',
      ),
    ).toEqual(["scope ∈ {local, library}"]);
    expect(
      literalKeyedClassNames('<button className={`a ${open ? "on" : "off"}`}>L</button>'),
    ).toEqual([]);
  });
});

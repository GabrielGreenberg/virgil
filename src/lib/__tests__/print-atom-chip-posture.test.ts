/**
 * Task 1443 — the PRINT FLATTEN is the CHIP atoms, exactly.
 *
 * A framed chip atom (tinted fill, 1px border, padding) is DOCUMENT content
 * dressed as UI. On paper it must read as plain prose, so the `@media print`
 * block in `globals.css` strips its frame. Until this census that rule was a
 * hand list of two classes (`.citation-node, .label-ref-node`), and task 1335's
 * `\today` chip (`.latex-dynamic-node`) — framed exactly like `\ref` — was not
 * in it: a printed paper showed its date inside a grey box, and the border and
 * padding print even with "Background graphics" off. Nothing tied the list to
 * the atoms; `print-view-only-posture.test.ts` only checked the rule existed.
 *
 * "Is this atom a chip?" is a fact about the KIND, so it is declared on the
 * registry row (`AtomMeta.chip`) and this census binds the print flatten's
 * selector list to it in BOTH directions: every chip row is flattened (no
 * boxed print), and nothing that is not a chip row is (a glyph atom — the
 * footnote superscript, inline math — prints as itself in its own ink).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cssCommentsStripped, REPO_ROOT } from "./_source-scan";
import { ATOM_REGISTRY } from "@/lib/tiptap/atom-registry";

const CSS = cssCommentsStripped(readFileSync(join(REPO_ROOT, "src/app/globals.css"), "utf8"));

/** The body of every `@media print { … }` block, brace-balanced. */
function printBlocks(css: string): string[] {
  const out: string[] = [];
  const re = /@media\s+print\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
    }
    out.push(css.slice(start, i - 1));
  }
  return out;
}

const ROWS = Object.values(ATOM_REGISTRY);
const ATOM_CLASSES = new Set(ROWS.map((m) => `.${m.domClass}`));
const CHIP_CLASSES = new Set(ROWS.filter((m) => m.chip).map((m) => `.${m.domClass}`));

/** The flatten rule(s): a print rule that strips a frame (`border: 0
 *  !important` + `background: transparent !important`) and names an atom. */
function flattenSelectors(): string[][] {
  const out: string[][] = [];
  for (const block of printBlocks(CSS)) {
    for (const r of block.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sels = r[1].split(",").map((x) => x.trim()).filter(Boolean);
      if (!sels.some((x) => ATOM_CLASSES.has(x))) continue;
      if (!/border:\s*0\s*!important/.test(r[2])) continue;
      if (!/background:\s*transparent\s*!important/.test(r[2])) continue;
      out.push(sels);
    }
  }
  return out;
}

describe("print flatten ⇔ ATOM_REGISTRY `chip` (task 1443)", () => {
  it("the census can see its population (non-vacuous)", () => {
    expect(printBlocks(CSS).length).toBeGreaterThan(0);
    expect(CHIP_CLASSES.size).toBeGreaterThan(0);
    expect(ROWS.some((m) => !m.chip), "every atom a chip? then the facet says nothing").toBe(true);
    expect(flattenSelectors().length, "no print flatten rule names an atom").toBe(1);
  });

  it("every chip atom is flattened on paper — none prints boxed", () => {
    const [sels] = flattenSelectors();
    for (const cls of CHIP_CLASSES) {
      expect(sels, `${cls} is a chip (ATOM_REGISTRY chip:true) but the print flatten omits it`).toContain(cls);
    }
  });

  it("nothing but the chip atoms is in the flatten — glyph atoms print in their ink", () => {
    const [sels] = flattenSelectors();
    for (const sel of sels) {
      expect(CHIP_CLASSES.has(sel), `${sel} is flattened on paper but is not an ATOM_REGISTRY chip row`).toBe(true);
    }
  });

  it("the flatten strips the whole frame and keeps the prose ink", () => {
    const block = printBlocks(CSS).join("\n");
    const rule = [...block.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((r) =>
      r[1].split(",").map((x) => x.trim()).some((x) => CHIP_CLASSES.has(x)) &&
      /border:\s*0\s*!important/.test(r[2]),
    );
    expect(rule).toBeTruthy();
    expect(rule![2]).toMatch(/padding:\s*0\s*!important/);
    expect(rule![2]).toMatch(/color:\s*inherit\s*!important/);
  });
});

describe("`\\today` is plain prose, so it is not a chip (task 1620)", () => {
  const meta = ATOM_REGISTRY.dynamic;
  /** The declarations of a top-level rule whose selector is exactly `sel`. */
  const ruleBody = (sel: string): string => {
    const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = CSS.match(new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^{}]*)\\}`));
    expect(m, `no rule for ${sel}`).toBeTruthy();
    return m![1];
  };

  it("its rest rule paints no frame — so `chip: false` is TRUE, not a waiver", () => {
    expect(meta.chip).toBe(false);
    const rest = ruleBody(`.${meta.domClass}`);
    // Re-framing it (fill / border / padding at rest) makes it a chip again:
    // flip `chip` back to true and the print flatten census follows.
    expect(rest).not.toMatch(/(?:^|;)\s*background\s*:/);
    expect(rest).not.toMatch(/(?:^|;)\s*border\s*:/);
    expect(rest).not.toMatch(/(?:^|;)\s*padding\s*:/);
  });

  it("its hover wash is the neutral atom hover, not another kind's ink", () => {
    const hover = ruleBody(`.${meta.domClass}:hover`);
    expect(hover).toMatch(/background:\s*var\(--code-bg\)/);
    expect(hover, "a date is not a cross-reference — recoloring \\ref must not move it").not.toMatch(/--label-ref-/);
  });
});

/**
 * Task 1637 — the VOCABULARY half. After 1620 the registry said `chip: false`
 * for `\today` while its own node and command files still called it "the
 * chip" — prose that invites the next author to re-frame it (and then forget
 * the print flatten). A non-chip kind's own source files may not call it one.
 * Every `chip: false` row declares its files here, so a new one joins by name.
 */
describe("a non-chip atom's own files do not call it a chip (task 1637)", () => {
  const OWN_FILES: Record<string, readonly string[]> = {
    footnote: ["src/lib/tiptap/footnote.ts"],
    "inline-math": ["src/lib/tiptap/math.ts"],
    dynamic: ["src/lib/tiptap/latex-dynamic.ts", "src/lib/latex-dynamic-commands.ts"],
  };
  /** "chip"/"chips" as a word — but not the facet's own name (`.chip`,
   *  `chip:`) nor a roadmap milestone label (`CHIP 7b`). */
  const CHIP_WORD = /(?<![.\w])chips?\b(?!\s*:)(?!\s+\d)/i;

  it("every chip:false kind declares its own files", () => {
    const nonChip = Object.entries(ATOM_REGISTRY).filter(([, m]) => !m.chip).map(([k]) => k);
    expect(Object.keys(OWN_FILES).sort()).toEqual(nonChip.sort());
  });

  for (const [kind, files] of Object.entries(OWN_FILES)) {
    for (const rel of files) {
      it(`${kind}: ${rel} never calls it a chip`, () => {
        const lines = readFileSync(join(REPO_ROOT, rel), "utf8").split("\n");
        const hits = lines
          .map((l, i) => (CHIP_WORD.test(l) ? `${i + 1}: ${l.trim()}` : null))
          .filter(Boolean);
        expect(hits, `ATOM_REGISTRY["${kind}"].chip is false — say "atom" / "date" / "marker"`).toEqual([]);
      });
    }
  }
});

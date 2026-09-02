/**
 * FIELD-DRAFT CENSUS (task 532) — the leg with teeth.
 *
 * The hook was never the part that could misbehave. A field that never asks it
 * is, and such a field type-checks, renders, and looks right on screen: a
 * `defaultValue` with no reconciliation shows the value it was mounted with
 * FOREVER and writes it back over whatever landed since, and a controlled box
 * whose `onChange` validates before writing state cannot be typed into at all.
 * Both shipped for as long as the fields have existed, with every suite green,
 * because each one's own tests drive the field the way its author expected it
 * to be used.
 *
 * Two questions, both with EMPTY allowlists — a hit is TAKE-THE-DOOR:
 *
 *  1. Every UNCONTROLLED field (a DOM `defaultValue`) reconciles. Asked per
 *     SITE against the enclosing DECLARATION, not per file: `panel-primitives`
 *     holds two such inputs, and a file-scoped question would let a third added
 *     beside them be excused by its neighbours.
 *  2. The swatch+hex CONTROL has one speller. Scoped by the pair rather than by
 *     either half: a file that renders `<input type="color">` AND spells a
 *     six-hex-digit grammar is rendering this control. `SelectionColorPopover`'s
 *     swatch-only menu widget is out of the population by construction rather
 *     than by an allowlist entry, and every `#rrggbb` validator in the STORE
 *     layer (`panel-theme`, `panel-typography`, `collab`, `color-math`) is
 *     answering a different question — what came off disk — and is likewise
 *     never in it.
 *
 * Beside them, the two retired copies are pinned dead, and the two rules whose
 * placement is load-bearing are pinned at the source: the reconcile runs after
 * EVERY render (no dep array — `TodoRow`'s hand-written copy needed both the
 * source AND the draft in its deps, and an uncontrolled field has no
 * React-visible draft to name at all), and a programmatic `el.value` write in a
 * file that auto-sizes its input re-measures it (the sizer listens to `input`
 * events, which that write does not dispatch, so the box would keep the width
 * of a value it no longer shows and `text-ellipsis` would clip the new one).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT, trackedFiles, elementsNamed, strip } from "@/lib/__tests__/_source-scan";

/** The one module allowed to spell the draft rule. */
const DOOR = "src/components/field-draft.ts";
/** The one module allowed to spell the swatch+hex control. */
const HEX_FIELD = "src/components/HexColorField.tsx";

/** A field that may keep a `defaultValue` without reconciling. EMPTY: a hit is
 *  TAKE-THE-DOOR. There is no true statement of the form "this field edits a
 *  value something else owns and must nonetheless show a stale one". */
const PERMITTED_UNRECONCILED_FIELDS: Record<string, string> = {};

/** A second speller of the swatch+hex control. EMPTY: a hit is RENDER-THE-
 *  PRIMITIVE. The pre-532 second copy is exactly what this forbids. */
const PERMITTED_HEX_CONTROLS: Record<string, string> = {};

function production(): { rel: string; raw: string; src: string }[] {
  return [...trackedFiles("src", /\.tsx?$/), ...trackedFiles("library", /\.tsx?$/)]
    .filter((abs) => !abs.includes("__tests__") && !abs.includes(".test."))
    .map((abs) => {
      const raw = readFileSync(abs, "utf8");
      return {
        rel: path.relative(REPO_ROOT, abs),
        raw,
        // Comments stripped, string LITERALS kept: every needle here
        // (`defaultValue=`, `type="color"`) is quoted text inside a JSX
        // attribute, so blanking strings would erase the thing being grepped —
        // the trap `_source-scan`'s own header records.
        src: strip(raw, true),
      };
    });
}

/** Top-level declaration boundaries, so a per-site question can be asked of the
 *  DECLARATION that renders the field rather than of the whole file. */
function declarationAt(src: string, index: number): string {
  const starts: number[] = [];
  const re = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|const|class)\s/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) starts.push(m.index);
  let from = 0;
  let to = src.length;
  for (let i = 0; i < starts.length; i++) {
    if (starts[i] <= index) from = starts[i];
    else {
      to = starts[i];
      break;
    }
  }
  return src.slice(from, to);
}


/**
 * Every `onChange` handler in `src` whose ONLY write is inside a guard with no
 * else arm — i.e. a field that rejects a keystroke rather than drafting it.
 */
function validatingOnChangeHandlers(src: string): string[] {
  const out: string[] = [];
  const open = /onChange=\{/g;
  let m: RegExpExecArray | null;
  while ((m = open.exec(src))) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < src.length && depth > 0; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") depth--;
    }
    const body = src.slice(m.index, i);
    const guard = /\bif\s*\(/.exec(body);
    if (!guard) continue;
    // A guard that writes on BOTH arms lands every keystroke somewhere.
    if (/\belse\b/.test(body)) continue;
    // A draft written BEFORE the guard is the correct shape.
    if (/\bset[A-Z]\w*\(/.test(body.slice(0, guard.index))) continue;
    if (!/\bset[A-Z]\w*\(/.test(body)) continue; // writes no state at all
    out.push(body);
    open.lastIndex = i;
  }
  return out;
}

function validatingOnChangeSites(): string[] {
  const hits: string[] = [];
  for (const { rel, src } of production()) {
    for (const body of validatingOnChangeHandlers(src)) {
      const at = src.indexOf(body);
      hits.push(`${rel}:${src.slice(0, at).split("\n").length}`);
    }
  }
  return hits;
}

describe("CENSUS — an uncontrolled field reconciles (task 532)", () => {
  it("every DOM defaultValue sits in a declaration that takes the door", () => {
    const bare: string[] = [];
    for (const { rel, src } of production()) {
      if (rel === DOOR) continue;
      for (const tag of ["input", "textarea"]) {
        for (const hit of elementsNamed(src, tag)) {
          if (!/\bdefaultValue=/.test(hit.tag)) continue;
          if (/useFieldDraft/.test(declarationAt(src, hit.index))) continue;
          const line = src.slice(0, hit.index).split("\n").length;
          bare.push(`${rel}:${line}`);
        }
      }
    }
    expect(bare.filter((h) => !(h.split(":")[0] in PERMITTED_UNRECONCILED_FIELDS))).toEqual([]);
  });

  it("the allowlist is EMPTY", () => {
    expect(Object.keys(PERMITTED_UNRECONCILED_FIELDS)).toEqual([]);
  });

  it("…and the census can SEE such a field — the canary", () => {
    // A synthetic fixture, never a live line: a canary standing on the very
    // thing the census is meant to have drained proves nothing the moment it
    // is drained.
    const fixture = [
      "const Thing = () => {",
      "  return <input defaultValue={value} onBlur={(e) => onChange(e.target.value)} />;",
      "};",
    ].join("\n");
    const hits = elementsNamed(fixture, "input").filter((h) => /\bdefaultValue=/.test(h.tag));
    expect(hits).toHaveLength(1);
    expect(/useFieldDraft/.test(declarationAt(fixture, hits[0].index))).toBe(false);
  });

  it("the population is non-empty — the fields it governs really are there", () => {
    const seen = new Set<string>();
    for (const { rel, src } of production()) {
      for (const tag of ["input", "textarea"]) {
        for (const hit of elementsNamed(src, tag)) {
          if (/\bdefaultValue=/.test(hit.tag)) seen.add(rel);
        }
      }
    }
    // The four uncontrolled title fields, and nothing else in either silo.
    expect([...seen].sort()).toEqual([
      "src/components/SourcePodNodeView.tsx",
      "src/components/panel-primitives.tsx",
      "src/text-objects/floats/float-title-field.tsx",
    ]);
  });
});

describe("CENSUS — the swatch+hex control has ONE speller (task 532)", () => {
  it("no production file outside HexColorField renders the pair", () => {
    const hits = production()
      .filter(({ rel }) => rel !== HEX_FIELD)
      .filter(({ src }) => /type="color"/.test(src) && /\[0-9a-fA-F?\]\{6\}|\[0-9a-f\]\{6\}|\[0-9A-F\]\{6\}/.test(src))
      .map(({ rel }) => rel);
    expect(hits.filter((h) => !(h in PERMITTED_HEX_CONTROLS))).toEqual([]);
  });

  it("the allowlist is EMPTY", () => {
    expect(Object.keys(PERMITTED_HEX_CONTROLS)).toEqual([]);
  });

  it("…and HexColorField itself IS the pair — so the needle is live", () => {
    const src = readFileSync(path.join(REPO_ROOT, HEX_FIELD), "utf8");
    expect(/type="color"/.test(src)).toBe(true);
    expect(/\[0-9a-f\]\{6\}/.test(src)).toBe(true);
  });

  it("both preference surfaces render it rather than a copy", () => {
    for (const rel of ["src/components/PreferenceTree.tsx", "src/components/SmartPreferences.tsx"]) {
      const src = readFileSync(path.join(REPO_ROOT, rel), "utf8");
      expect(src).toMatch(/<HexColorField/);
    }
  });
});

describe("CENSUS — the retired copies stay retired (task 532)", () => {
  it("no production file hand-rolls a last-committed ref", () => {
    const hits = production()
      .filter(({ src }) => /lastCommittedRef/.test(src))
      .map(({ rel }) => rel);
    expect(hits).toEqual([]);
  });

  it("no production field validates in onChange with nowhere for a partial to live", () => {
    // The retired M1 rule, which is what made the box untypeable. Its shape is
    // an `onChange` whose only write sits inside a guard with NO else arm — so
    // the keystrokes that fail the guard reach no state at all and React resets
    // the node. A field that writes a DRAFT first and validates afterwards
    // (`PanelTextSizeRow`) is out of the population by construction, and so is
    // one whose guard writes on BOTH arms (`CitationCard`'s picker field): the
    // question is whether every keystroke lands somewhere, not whether a
    // handler has a branch in it.
    //
    // Stated limit: "the draft was written" is read as an unconditional
    // `setXxx(` call, which is what a React state draft is at every controlled
    // site in this tree. A draft written through some other spelling would be
    // reported here, and the answer to that is a name, not an allowlist entry.
    expect(validatingOnChangeSites()).toEqual([]);
  });

  it("…and that needle is LIVE — it fires on the rule this task retired", () => {
    // Measured against the pre-532 source verbatim. A needle whose regex
    // cannot match the defect it names passes forever: this leg's first draft
    // used `[^}]*` to scan the handler body, which stops dead at the `}` inside
    // the `{6}` of the hex grammar itself.
    const legacy = [
      "<Input",
      "  value={typo.color}",
      "  onChange={(e) => {",
      "    const v = e.target.value.trim().toLowerCase();",
      "    if (/^#[0-9a-f]{6}$/.test(v)) setField(\"color\", v);",
      "  }}",
      "/>",
    ].join("\n");
    expect(validatingOnChangeHandlers(legacy)).toHaveLength(1);
  });
});

describe("CENSUS — the two placements that are load-bearing (task 532)", () => {
  it("the reconcile is asserted after EVERY render, not on a dep list", () => {
    const src = readFileSync(path.join(REPO_ROOT, DOOR), "utf8");
    // No dep array on the reconcile effect. A guessed dep list is what
    // `TodoRow`'s hand-written copy had to correct for (it needed BOTH the
    // source and the draft), and an uncontrolled field has no React-visible
    // draft to name in one at all.
    expect(src).toMatch(/useEffect\(\(\) => \{\s*api\.reconcile\(\);\s*\}\);/);
  });

  it("a programmatic value write re-measures an auto-sized input", () => {
    // The sizer listens to `input` events, which `el.value = …` does not
    // dispatch. A file that both auto-sizes and writes the value by hand must
    // say so, or the box keeps the width of a value it no longer shows.
    for (const rel of [
      "src/components/panel-primitives.tsx",
      "src/text-objects/floats/float-title-field.tsx",
    ]) {
      const src = strip(readFileSync(path.join(REPO_ROOT, rel), "utf8"), true);
      expect(src).toMatch(/autoSizeInput/);
      expect(src).toMatch(/syncInputWidth\(/);
    }
  });
});

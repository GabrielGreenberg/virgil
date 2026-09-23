/**
 * MIRROR WRITE-BACKS RESOLVE THROUGH THE ONE HINTED DOOR (task 723).
 *
 * A "mirror body" is any surface that edits a slice of the MAIN document in a
 * second editor and splices the result back: the ten text-object float bodies,
 * and the Examples-panel card. Each one asks the same question on EVERY
 * keystroke — *where is my source node in the main document right now?* — and
 * the answer has exactly one correct shape, stated by
 * [float-source-range.ts](../float-source-range.ts): resolve from the live
 * source range as a POSITION HINT (O(depth)), and fall back to the full walk
 * only when that hint fails verification.
 *
 * Task 140 installed that resolver and threaded the hint through every FLOAT.
 * It did not reach the Examples-panel card, because the card held a textually
 * independent copy of the finder — a private `doc.descendants` walk with no
 * hint parameter — so the card kept paying an O(doc) scan per press for two
 * months, in a file whose own comment said callers MUST NOT do that. Nothing
 * connected the two: no compiler, no test, and no reviewer, because the
 * duplicate shared no identifier with the thing that was fixed.
 *
 * That is the bug class this census exists for, and it is the reason the rule
 * is stated over a DERIVED population rather than a listed one. A new mirror
 * body is in scope the moment it declares a write-back door — nobody has to
 * remember to add it here.
 *
 * Two rules, both about the same thing:
 *
 *   R1  ONE DOOR — no mirror-body module declares its own by-uuid document
 *       walk. (`findSourceNodeByUuid` is the walk; a second copy of it is how
 *       a fix reaches one surface and not the other.)
 *   R2  HINTED WRITE-BACK — every write-back door names a hint ref. The
 *       write-back is the per-keystroke caller; an unhinted one is the defect
 *       in its original form.
 *
 * Both legs are planted-and-failed in `mirror-writeback-hint-census.plant`
 * legs below, in both directions.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, codeOnlyLines, enclosingDeclaration } from "./_source-scan";

const SRC = path.join(REPO_ROOT, "src");

/** Every non-test source file under `src/`. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "__tests__" || e.name === "node_modules") continue;
      sourceFiles(p, out);
    } else if (/\.tsx?$/.test(e.name)) {
      out.push(p);
    }
  }
  return out.sort();
}

/** The write-back door's name, as every mirror body spells it. */
const DOOR = /(?:function\s+|const\s+)(writeBackTo[A-Z]\w*)\b/g;

/**
 * The body of the declaration that starts at `from` — the brace-matched text
 * of the first `{` that actually OPENS a body.
 *
 * Both spellings in the repo are covered: `function writeBackToMain(doc) {`
 * (the brace sits at paren depth 0) and
 * `const writeBackToMain = useCallback((val) => {` (depth 1, but preceded by
 * `=>`). A `{` that is neither — a destructured parameter — is skipped, so
 * the slice can never be a parameter list masquerading as a body.
 */
function doorBody(src: string, from: number): string | null {
  let parens = 0;
  let prev = "";
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === "(") parens++;
    else if (c === ")") parens--;
    else if (c === "{") {
      if (parens === 0 || prev === ">") {
        let d = 0;
        for (let j = i; j < src.length; j++) {
          if (src[j] === "{") d++;
          else if (src[j] === "}") {
            d--;
            if (d === 0) return src.slice(i, j + 1);
          }
        }
        return null;
      }
      // A destructured parameter — skip it whole.
      let d = 0;
      for (; i < src.length; i++) {
        if (src[i] === "{") d++;
        else if (src[i] === "}") {
          d--;
          if (d === 0) break;
        }
      }
    }
    if (!/\s/.test(c)) prev = c;
  }
  return null;
}

interface MirrorBody {
  rel: string;
  code: string;
  /** `[doorName, body]` for each write-back door the module declares. */
  doors: [string, string][];
}

/** Every module that declares a write-back door, with its doors sliced.
 *  Derived, never listed — a new mirror body joins the population by
 *  existing. Comment-stripped, so a file that merely NAMES `writeBackToMain`
 *  in prose (three do) is not a mirror body. */
function mirrorBodies(): MirrorBody[] {
  const out: MirrorBody[] = [];
  for (const abs of sourceFiles(SRC)) {
    const code = codeOnlyLines(fs.readFileSync(abs, "utf8"));
    const doors: [string, string][] = [];
    DOOR.lastIndex = 0;
    for (let m = DOOR.exec(code); m; m = DOOR.exec(code)) {
      const body = doorBody(code, m.index);
      if (body) doors.push([m[1], body]);
    }
    if (doors.length > 0) {
      out.push({ rel: path.relative(REPO_ROOT, abs), code, doors });
    }
  }
  return out;
}

/** A private by-uuid document walk — the shape `findSourceNodeByUuid` owns. */
const UUID_TEST = /attrs\??\.uuid\s*===/;

/** A hint ref, by either spelling in the repo (`sourceRangeRef`, `hintRef`).
 *  Matches whether it is READ (`sourceRangeRef.current` — the floats, which
 *  keep it live through `useFloatMainSync`) or PASSED (`sourceRangeRef` into
 *  `findAndTrackSourceNode` — the card, which re-stamps it itself). */
const HINT_REF = /\b\w*(?:sourceRange|hint)\w*Ref\b/i;

/** A source-resolution call: the shared doors and the four-line per-kind
 *  adapters over them (`findExampleBlockByUuid`, `findListByUuid`,
 *  `getSectionRangeByUuid`, …). Named by SHAPE so an adapter a future body
 *  writes is covered without being listed. */
const RESOLVE_CALL = /\b((?:find|get)\w*(?:ByUuid|SourceNode))\s*\(/g;

/** The argument text of the call whose `(` sits at `open` — paren-matched, so
 *  a nested call in the arguments cannot end the slice early. */
function callArgs(src: string, open: number): string {
  let d = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(") d++;
    else if (src[i] === ")") {
      d--;
      if (d === 0) return src.slice(open + 1, i);
    }
  }
  return src.slice(open + 1);
}

/** Per resolution call in `body`, whether its ARGUMENTS carry a hint ref. */
function hintedResolutions(body: string): boolean[] {
  const out: boolean[] = [];
  RESOLVE_CALL.lastIndex = 0;
  for (let m = RESOLVE_CALL.exec(body); m; m = RESOLVE_CALL.exec(body)) {
    out.push(HINT_REF.test(callArgs(body, m.index + m[0].length - 1)));
  }
  return out;
}

describe("mirror write-backs resolve through the hinted shared resolver", () => {
  const bodies = mirrorBodies();

  it("finds the mirror-body population it is meant to police", () => {
    const rels = bodies.map((b) => b.rel);
    // The card this task moved onto the shared path…
    expect(rels).toContain("src/panels/Examples/ExampleCard.tsx");
    // …and the float bodies it was diverging from. A rename that emptied the
    // population would otherwise make every rule below vacuous.
    expect(rels.filter((r) => r.startsWith("src/text-objects/floats/")).length)
      .toBeGreaterThanOrEqual(9);
  });

  it("R1 — no mirror body declares its own by-uuid document walk", () => {
    const offenders: string[] = [];
    for (const { rel, code } of bodies) {
      for (let i = code.indexOf(".descendants("); i >= 0; i = code.indexOf(".descendants(", i + 1)) {
        const decl = enclosingDeclaration(code, i);
        if (UUID_TEST.test(decl)) {
          const line = code.slice(0, i).split("\n").length;
          offenders.push(`${rel}:${line}`);
        }
      }
    }
    expect(
      offenders,
      "A mirror body resolved a node by uuid with its own walk. That is the " +
        "duplicate `findSourceNodeByUuid` task 723 deleted — the copy a fix " +
        "applied to the shared resolver cannot reach. Resolve through " +
        "`findSourceNodeByUuid` / `findAndTrackSourceNode` instead.",
    ).toEqual([]);
  });

  it("R2 — every write-back door PASSES a hint into its resolution", () => {
    // The rule is about the call's ARGUMENTS, not the door's text. A door that
    // merely mentions its hint ref — stamping it after the write, say — while
    // resolving without it is the exact defect, and an earlier draft of this
    // census passed it. So: every resolution inside a write-back door carries
    // a hint ref among its arguments; a door with no resolution at all (a
    // range-mirroring body writes by its tracked range directly) must still
    // name one.
    const offenders: string[] = [];
    for (const { rel, doors } of bodies) {
      for (const [name, body] of doors) {
        let resolutions = 0;
        RESOLVE_CALL.lastIndex = 0;
        for (let m = RESOLVE_CALL.exec(body); m; m = RESOLVE_CALL.exec(body)) {
          resolutions++;
          const args = callArgs(body, m.index + m[0].length - 1);
          if (!HINT_REF.test(args)) offenders.push(`${rel} → ${name} → ${m[1]}`);
        }
        if (resolutions === 0 && !HINT_REF.test(body)) {
          offenders.push(`${rel} → ${name}`);
        }
      }
    }
    expect(
      offenders,
      "A write-back door resolved its target with no position hint. The " +
        "write-back runs on EVERY keystroke in the mirror, so an unhinted " +
        "resolution is an O(doc) walk per press (keystroke sanctity).",
    ).toEqual([]);
  });

  // ── the census's own legs ────────────────────────────────────────────────
  // A grep census that cannot fail is decoration. Both rules are planted
  // against synthesised module text, in both directions, so the regexes and
  // the slicer are held to the shapes they claim to catch.

  it("R1 catches a re-introduced private finder, and clears the shared call", () => {
    const withPrivateWalk = `
      function findExampleBlockByUuid(doc, uuid) {
        let result = null;
        doc.descendants((node, pos) => {
          if (node.type.name === "exampleBlock" && node.attrs?.uuid === uuid) {
            result = { start: pos, end: pos + node.nodeSize, node };
            return false;
          }
          return true;
        });
        return result;
      }
    `;
    const hit = withPrivateWalk.indexOf(".descendants(");
    expect(UUID_TEST.test(enclosingDeclaration(withPrivateWalk, hit))).toBe(true);

    // The other direction: a walk that is NOT a uuid finder (the card's own
    // expex width pass walks its seeded block) must not be indicted.
    const innocentWalk = `
      function collectLabels(doc) {
        const out = [];
        doc.descendants((node) => {
          if (node.type.name === "exampleItem") out.push(node.attrs.label);
        });
        return out;
      }
    `;
    const hit2 = innocentWalk.indexOf(".descendants(");
    expect(UUID_TEST.test(enclosingDeclaration(innocentWalk, hit2))).toBe(false);
  });

  it("R2 catches an unhinted door, and the slicer finds the right body", () => {
    const unhinted = `
      function writeBackToMain(doc) {
        const src = findSourceNodeByUuid(ed.state.doc, uuid, "exampleBlock");
        if (!src) return;
      }
    `;
    DOOR.lastIndex = 0;
    const m1 = DOOR.exec(unhinted)!;
    const b1 = doorBody(unhinted, m1.index)!;
    expect(b1).toContain("findSourceNodeByUuid");
    expect(hintedResolutions(b1)).toEqual([false]);

    // The shape that fooled the first draft: the door NAMES its hint ref (it
    // stamps it after the write) while resolving without it. Whole-body text
    // matching says "hinted"; the argument rule says "not".
    const mentionsButDoesNotPass = `
      function writeBackToMain(doc) {
        const src = findSourceNodeByUuid(ed.state.doc, uuid, "exampleBlock");
        if (!src) return;
        sourceRangeRef.current = { from: src.start, to: src.end };
      }
    `;
    DOOR.lastIndex = 0;
    const m2 = DOOR.exec(mentionsButDoesNotPass)!;
    const b2 = doorBody(mentionsButDoesNotPass, m2.index)!;
    expect(HINT_REF.test(b2)).toBe(true); // the body mentions it…
    expect(hintedResolutions(b2)).toEqual([false]); // …but the call does not.

    // Hinted, in each of the two live spellings.
    for (const hinted of [
      `function writeBackToMain(doc) {
         const src = findSourceNodeByUuid(ed.state.doc, uuid, "x", sourceRangeRef.current);
       }`,
      `const writeBackToMain = useCallback((val) => {
         const src = findAndTrackSourceNode(ed.state.doc, uuid, "x", sourceRangeRef);
       }, []);`,
    ]) {
      DOOR.lastIndex = 0;
      const m = DOOR.exec(hinted)!;
      const b = doorBody(hinted, m.index)!;
      expect(hintedResolutions(b)).toEqual([true]);
    }

    // The slicer must not mistake a destructured PARAMETER for the body — if
    // it did, every door written that way would pass vacuously (an empty-ish
    // parameter slice contains no hint ref either way, but it also contains
    // no resolver call, so the rule would be asking nothing).
    const destructured = `
      function writeBackToDoc({ json, uuid }) {
        const src = findAndTrackSourceNode(doc, uuid, "x", sourceRangeRef);
      }
    `;
    DOOR.lastIndex = 0;
    const m3 = DOOR.exec(destructured)!;
    const b3 = doorBody(destructured, m3.index)!;
    expect(b3).toContain("findAndTrackSourceNode");
    expect(hintedResolutions(b3)).toEqual([true]);
  });
});

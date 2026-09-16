/**
 * LABEL WRITE CENSUS — who WRITES a `label` attr, and does it enter the door
 * (task 553).
 *
 * Task 534 made `renameLabelWithRefs` the ONE door every `\label` rename
 * enters and pinned its callers as an exact set. That census asks who CALLS
 * the door — and a surface that never calls it and never walks a ref spells
 * no needle at all. The two expex "Ex. · label" pods were exactly that: a bare
 * `setNodeMarkup(pos, undefined, { …attrs, label })` each, for as long as they
 * existed, so every `\ref` to a renamed example was orphaned (`??` in the PDF)
 * and a key another declaration owned was committed anyway — with 534's
 * census green. Task 404's rule: discover a population by the QUESTION, not
 * the MECHANISM. The question is "who writes a `label` attr onto a node?".
 *
 * THE RULE: every production write of a `label` attr through ProseMirror's
 * attr-writing verbs (`setNodeMarkup` / `updateAttributes` /
 * `setNodeAttribute`) lives in the door, or carries an in-place
 * `label-write-exempt: <why>` marker in the lines directly above it. The
 * allowlist of unmarked writes is EMPTY; a hit is ENTER-the-door or
 * STATE-why-not. The two exemptions that exist are each a write that is not a
 * RENAME of a DECLARATION: the `LabelHandler` ABSORB (a `\label` paragraph
 * folding into its heading's attr — the key the paper already held) and the
 * ref popover's RE-POINT (a `labelRef`, which is a reference, not a
 * declaration). Both are pinned as an exact set below, so an exemption can
 * only shrink.
 *
 * Stated limit: a source census sees the WRITE VERB and the `label:` key, not
 * the node type at the position — which is why the exemptions are per LINE
 * with a stated reason rather than derived. `LABEL_DECLARING_NODE_TYPES` is the
 * schema-pinned set the reasons refer to (`node-attr-sets.test.ts`).
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { REPO_ROOT, strip, codeOnlyLines, trackedFiles } from "../../__tests__/_source-scan";

/** Comments blanked, string literals KEPT, line-aligned: `setNodeAttribute(pos,
 *  "label", v)` names the attr as a STRING, which `codeOnly` would erase. */
const scanned = (src: string) => strip(src, true, true);

const DOOR = "src/lib/tiptap/label-rename.ts";
const MARKER = /label-write-exempt:/;
const WRITE_VERB = /\b(setNodeMarkup|updateAttributes|setNodeAttribute)\s*\(/g;
/** A `label` OBJECT KEY inside the call's arguments (`{ label: x }`,
 *  `{ …attrs, label }`), or the attr NAME as `setNodeAttribute`'s string. */
const LABEL_KEY = /(?:[{,]\s*label\s*[:,}])|(?:\blabel\s*[,}])|(?:"label"\s*,)/;
const MARKER_WINDOW = 6;

const isProduction = (p: string) => !/__tests__|\.test\.|\.spec\./.test(p);

/** The balanced `( … )` argument text starting at `open` (the `(` index). */
function callArgs(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return src.slice(open + 1);
}

export interface LabelWriteSite {
  rel: string;
  line: number;
  verb: string;
  exempt: boolean;
}

/** Every label-attr write in `code` (comments blanked, LINE-ALIGNED with the
 *  raw source so the marker comment can be read beside the hit). */
export function labelWriteSites(rel: string, raw: string): LabelWriteSite[] {
  const code = scanned(raw);
  const rawLines = raw.split("\n");
  const out: LabelWriteSite[] = [];
  WRITE_VERB.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WRITE_VERB.exec(code)) !== null) {
    const open = m.index + m[0].length - 1;
    const args = callArgs(code, open);
    if (!LABEL_KEY.test(args)) continue;
    const line = code.slice(0, m.index).split("\n").length; // 1-based
    const above = rawLines.slice(Math.max(0, line - 1 - MARKER_WINDOW), line - 1).join("\n");
    out.push({ rel, line, verb: m[1], exempt: MARKER.test(above) });
  }
  return out;
}

function productionSites(): LabelWriteSite[] {
  const out: LabelWriteSite[] = [];
  for (const root of ["src", "library"]) {
    for (const file of trackedFiles(root, /\.tsx?$/)) {
      if (!isProduction(file)) continue;
      const rel = path.relative(REPO_ROOT, file).split(path.sep).join("/");
      out.push(...labelWriteSites(rel, fs.readFileSync(file, "utf8")));
    }
  }
  return out;
}

describe("label write census (task 553)", () => {
  it("CANARY: the extractor sees the write shapes, reads the marker, and ignores prose", () => {
    const fixture = [
      "// a setNodeMarkup(pos, undefined, { label: x }) named in a comment is not a write",
      "function a(tr) {",
      "  tr.setNodeMarkup(pos, undefined, { ...attrs, label: next });", // 3 — bare
      "  tr.setNodeMarkup(pos, undefined, { ...attrs, parTitle: t });", // not a label write
      '  tr.setNodeAttribute(pos, "label", v);', // 5 — bare, the attr as a STRING
      "  editor.commands.updateAttributes(\"heading\", { label: v });", // 6 — bare
      "  const s = \"label: not a write\";", // a literal, not a call
      "  // label-write-exempt: a stated reason",
      "  tr.setNodeMarkup(pos, undefined,",
      "    { ...attrs, label });", // 9 — shorthand key, exempt
      "}",
    ].join("\n");
    const sites = labelWriteSites("fixture.ts", fixture);
    expect(sites.map((s) => [s.line, s.verb, s.exempt])).toEqual([
      [3, "setNodeMarkup", false],
      [5, "setNodeAttribute", false],
      [6, "updateAttributes", false],
      [9, "setNodeMarkup", true],
    ]);
  });

  it("every production label-attr write is the door or carries a stated exemption — allowlist EMPTY", () => {
    const bare = productionSites()
      .filter((s) => s.rel !== DOOR && !s.exempt)
      .map((s) => `${s.rel}:${s.line} (${s.verb})`);
    expect(bare).toEqual([]);
  });

  it("the door writes the attr (the census can see the one legitimate writer)", () => {
    const door = productionSites().filter((s) => s.rel === DOOR);
    // The declaration is a direct write site. The refs (task 606) are carried
    // through the deep atom door, which also reaches refs inside footnote
    // bodies — its generic `setNodeMarkup` names no `label` key, so pin the
    // route instead: the door hands `labelRef` to `rewriteInlineAtomsDeep`.
    expect(door.length).toBeGreaterThanOrEqual(1);
    const src = fs.readFileSync(path.join(REPO_ROOT, DOOR), "utf8");
    expect(src).toMatch(/rewriteInlineAtomsDeep\([^)]*"labelRef"/);
  });

  it("the exemptions are an EXACT set — each a write that is not a rename of a declaration", () => {
    const exempt = productionSites()
      .filter((s) => s.rel !== DOOR && s.exempt)
      .map((s) => s.rel)
      .sort();
    expect(exempt).toEqual([
      // The ref popover's re-point: a `labelRef` (a REFERENCE) by identity.
      "src/components/editor-layout/card-actions/ref.ts",
      // The figure SOURCE popover's raw-body writeback — a member this census
      // FOUND (the audit named the two expex pods) and a product decision
      // deliberately not made unattended: see the reason at the site.
      "src/lib/figures/apply-env-body.ts",
      // The absorb: a `\label` paragraph folding into the heading it follows.
      "src/lib/tiptap/label.ts",
    ]);
  });

  it("the expex pods spell NO label write of their own any more — they enter the door", () => {
    const expex = fs.readFileSync(path.join(REPO_ROOT, "src/lib/tiptap/expex.ts"), "utf8");
    expect(labelWriteSites("src/lib/tiptap/expex.ts", expex)).toEqual([]);
    expect(codeOnlyLines(expex)).toMatch(/\brenameLabelWithRefs\(/);
  });
});

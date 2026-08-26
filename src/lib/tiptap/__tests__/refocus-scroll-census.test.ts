/**
 * Task 486 — the CENSUS half of "a refocus is a focus, not a navigation".
 *
 * The door ([refocus-editor.ts](../refocus-editor.ts)) was never the part that
 * could misbehave. A chrome commit that edits AT A NODE and then hands TipTap a
 * bare `focus()` is — and it type-checks perfectly, renders perfectly, and is
 * invisible to every behavioural test of the door. That is exactly what shipped
 * at `editor-extensions.ts`'s heading-label commit and went unnoticed for as
 * long as the label strip has existed.
 *
 * ## The question, and why it is asked this way
 *
 * `focus()` schedules a deferred `scrollIntoView()` on whatever the SELECTION is
 * one frame later. So the question is never "does this site call focus?" — most
 * do, correctly. It is: **will that deferred scroll land on the EDIT, or on a
 * stale caret?**
 *
 *  - A **caret commit** (`chain().focus().toggleBold()`, `.insertContent(…)`,
 *    a lightning-grid prelude before a caret insert) edits where the caret
 *    already is, so the scroll IS the edit. Left alone, deliberately.
 *  - A commit that **names a position in the same statement**
 *    (`.setTextSelection(pos)`, `.insertContentAt(at, …)`) moves the selection
 *    onto its own edit BEFORE the frame runs, so the scroll lands there too.
 *  - A commit that spells an **explicit `.scrollIntoView()`** has stated its
 *    navigation intent out loud.
 *  - Everything else in an **at-a-node** declaration is the defect: the write
 *    goes to a resolved position and the scroll goes to the caret.
 *
 * So a HIT is: an editor `focus(` inside a declaration that WRITES or RESOLVES
 * A DOM NODE at a position, whose own statement neither opts out nor names a
 * position nor states a scroll. Allowlist EMPTY — a hit is FIX-it, through the
 * door.
 *
 * ## Stated limits
 *
 *  - The region is the **enclosing declaration** (brace-balanced, hopping out of
 *    control statements), so a node resolve in one branch speaks for a focus in
 *    a sibling branch. That is granularity, not a proof — the same limit
 *    `container-fit-guardrail` states about its own regions. It is why the
 *    at-a-node needles are deliberately the WRITE/RESOLVE family
 *    (`setNodeMarkup` / `insertContentAt` / `nodeDOM` / `domAtPos`) and NOT the
 *    read-only walks (`.descendants(` / `doc.forEach(`): measured on this tree,
 *    including the walks flags two genuine caret commits
 *    (`Editor.tsx`'s `archiveSelection`, `smart-insert.ts`'s prelude) whose
 *    declarations happen to walk the doc for an unrelated reason, and buying
 *    those off with exemptions would put two standing licences where the
 *    allowlist is supposed to be empty.
 *  - It governs the **implicit** scroll `focus()` schedules. An explicit
 *    `view.dispatch(tr.scrollIntoView())` after a caret insert is a different,
 *    deliberate mechanism and is out of scope.
 *  - `editor.view.focus()` (raw ProseMirror) focuses with `preventScroll` and is
 *    therefore never in the population — which is why the drop-mode / NodeView
 *    sites that spell it need no door.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { codeOnlyLines } from "@/lib/__tests__/_source-scan";

const REPO = path.resolve(__dirname, "../../../..");
const SILOS = [
  ["src", path.join(REPO, "src")],
  ["library", path.join(REPO, "library")],
] as const;

/** Every editor-level focus command. `view.focus()` is deliberately absent. */
const FOCUS_CALL = /(?:\.commands\.focus|\.chain\(\)\s*\.focus|\bchain\.focus)\(/;

/** A WRITE or a DOM RESOLVE at a named position — see the limits above. */
const AT_A_NODE = /(?:setNodeMarkup|insertContentAt|nodeDOM|domAtPos)\(/;

/** The two ways a site says "do not chase the caret". */
const OPTS_OUT = /scrollIntoView:\s*false|\brefocusEditor\(/;

/** The two ways a site says "the scroll is mine and it is intended". */
const NAMES_ITS_TARGET = /\.setTextSelection\(|\.insertContentAt\(|\.scrollIntoView\(/;

/** A brace that opens a control statement is not a declaration. */
const CONTROL_HEADER =
  /^\s*(?:\}?\s*(?:else\b|catch\b|finally\b)|if\s*\(|for\s*\(|while\s*\(|switch\s*\(|try\b|do\b)/;

function walkSource(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "__fixtures__" || entry === "node_modules") continue;
      out.push(...walkSource(full));
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function bothSilos(): Array<{ rel: string; source: string }> {
  const files: Array<{ rel: string; source: string }> = [];
  for (const [prefix, root] of SILOS) {
    for (const f of walkSource(root)) {
      files.push({
        rel: `${prefix}/${path.relative(root, f).split(path.sep).join("/")}`,
        source: readFileSync(f, "utf8"),
      });
    }
  }
  return files;
}

/**
 * The enclosing DECLARATION of `offset`: walk back to the innermost unmatched
 * `{`, and keep hopping outward while that brace belongs to a control statement
 * rather than a function/method/arrow. Returns the declaration's whole text.
 */
function enclosingDeclaration(src: string, offset: number): string {
  let i = offset;
  let depth = 0;
  let open = -1;
  while (i >= 0) {
    const c = src[i];
    if (c === "}") depth++;
    else if (c === "{") {
      if (depth === 0) { open = i; break; }
      depth--;
    }
    i--;
  }
  if (open < 0) return src;
  const lineStart = src.lastIndexOf("\n", open) + 1;
  const nl = src.indexOf("\n", open);
  const header = src.slice(lineStart, nl < 0 ? src.length : nl);
  if (CONTROL_HEADER.test(header)) {
    return lineStart === 0 ? src : enclosingDeclaration(src, lineStart - 1);
  }
  let d = 0;
  let j = open;
  for (; j < src.length; j++) {
    if (src[j] === "{") d++;
    else if (src[j] === "}") { d--; if (d === 0) break; }
  }
  return src.slice(lineStart, j + 1);
}

/** The focus call's own STATEMENT — the chain it sits in, to its `;`. */
function focusStatement(lines: string[], idx: number): string {
  const out: string[] = [];
  for (let j = idx; j < Math.min(lines.length, idx + 10); j++) {
    out.push(lines[j]);
    if (/;\s*$/.test(lines[j])) break;
  }
  return out.join("\n");
}

interface Site { rel: string; line: number; text: string; atNode: boolean; excused: boolean }

function focusSites(rel: string, rawSource: string): Site[] {
  // Comments blanked (a `focus()` NAMED in prose is not a call), string
  // literals KEPT — the opt-out and the intent markers are option literals and
  // method names that survive either way, and blanking would erase nothing
  // this census needs while risking the task-205 unfalsifiable-leg shape.
  const scanned = codeOnlyLines(rawSource);
  const lines = scanned.split("\n");
  const sites: Site[] = [];
  let offset = 0;
  lines.forEach((line, i) => {
    const lineOffset = offset;
    offset += line.length + 1;
    if (!FOCUS_CALL.test(line)) return;
    const decl = enclosingDeclaration(scanned, lineOffset);
    const stmt = focusStatement(lines, i);
    sites.push({
      rel,
      line: i + 1,
      text: line.trim(),
      atNode: AT_A_NODE.test(decl),
      excused: OPTS_OUT.test(stmt) || NAMES_ITS_TARGET.test(stmt),
    });
  });
  return sites;
}

const FILES = bothSilos();
const SITES = FILES.flatMap((f) => focusSites(f.rel, f.source));

describe("task 486 — refocus/scroll census", () => {
  it("sees a real population (the scan is not vacuous)", () => {
    // A census whose needle matches nothing passes for the wrong reason.
    expect(FILES.length).toBeGreaterThan(300);
    expect(SITES.length).toBeGreaterThan(10);
    expect(SITES.some((s) => s.atNode)).toBe(true);
  });

  it("no at-a-node commit refocuses with the default caret scroll (allowlist EMPTY)", () => {
    const hits = SITES.filter((s) => s.atNode && !s.excused).map(
      (s) => `${s.rel}:${s.line}  ${s.text}`,
    );
    // If this fails: the commit edits at a RESOLVED position while its
    // `focus()` scrolls the CARET. Route it through `refocusEditor(editor)` —
    // or, if the reader really should be taken to the edited node, say so with
    // an explicit scroll (and, per task 328, a necessity gate).
    expect(hits).toEqual([]);
  });

  it("CANARY: a synthetic at-a-node bare refocus IS flagged", () => {
    const fixture = [
      "function commitLabel() {",
      "  const tr = target.state.tr;",
      '  tr.setNodeMarkup(headingPos, undefined, { label: "x" });',
      "  target.view.dispatch(tr);",
      "  nodeEditor.commands.focus();",
      "}",
    ].join("\n");
    const found = focusSites("fixture.ts", fixture);
    expect(found).toHaveLength(1);
    expect(found[0].atNode).toBe(true);
    expect(found[0].excused).toBe(false);
  });

  it("CANARY: the same fixture through the DOOR is not flagged", () => {
    const fixture = [
      "function commitLabel() {",
      "  const tr = target.state.tr;",
      '  tr.setNodeMarkup(headingPos, undefined, { label: "x" });',
      "  target.view.dispatch(tr);",
      "  refocusEditor(nodeEditor);",
      "}",
    ].join("\n");
    // No `focus(` call at all once the door is spelled — the site leaves the
    // population entirely, which is the point of having a door.
    expect(focusSites("fixture.ts", fixture)).toEqual([]);
  });

  it("CANARY: a caret commit in an at-a-node declaration is NOT flagged", () => {
    const fixture = [
      "function jumpToExample() {",
      "  const domEl = editor.view.nodeDOM(target);",
      "  editor.chain().focus().setTextSelection(target + 1).scrollIntoView().run();",
      "}",
    ].join("\n");
    const found = focusSites("fixture.ts", fixture);
    expect(found).toHaveLength(1);
    expect(found[0].excused).toBe(true);
  });

  it("the no-scroll option literal has exactly TWO spellers — both rooted doors", () => {
    const spellers = FILES.filter((f) => /scrollIntoView:\s*false/.test(codeOnlyLines(f.source)))
      .map((f) => f.rel)
      .sort();
    // A third speller is a THIRD statement of one rule. The chain form lives in
    // `insert-inline-atom.ts` (it must sit inside a chain); the standalone form
    // is `refocus-editor.ts`. Anything else adopts one of them.
    expect(spellers).toEqual([
      "src/lib/tiptap/insert-inline-atom.ts",
      "src/lib/tiptap/refocus-editor.ts",
    ]);
  });

  it("the three converted sites still enter the door", () => {
    // Per-site pins: the census above cannot see a REVERT of `Editor.tsx`'s
    // adopter (its declaration resolves by a doc WALK, not by the write/resolve
    // family), and a revert there would silently re-fork the rule.
    const adopters = [
      "src/lib/editor-extensions.ts",
      "src/components/Editor.tsx",
      "src/components/editor-layout/reader-view-prefs.ts",
    ];
    for (const rel of adopters) {
      const f = FILES.find((x) => x.rel === rel);
      expect(f, `${rel} left the tree`).toBeDefined();
      expect(
        /\brefocusEditor\(/.test(codeOnlyLines(f!.source)),
        `${rel} no longer enters the refocus door`,
      ).toBe(true);
    }
  });
});

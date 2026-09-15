// Task 578 — the CENSUS half of "a type-time rule may rewrite TEXT it matched;
// it never deletes a non-text node".
//
// The door (`rangeHoldsOnlyText`, typed-prose-gate.ts) was never the part that
// could misbehave: a rule handler that replaces a matched range WITHOUT asking
// it is, and such a handler type-checks, fires, and passes every fixture typed
// into plain prose — which is exactly how members 1–2 shipped. So membership is
// DISCOVERED: every production `new InputRule({ … handler … })` and every
// `handleTextInput(…)` prop in both silos. A handler whose body spells a
// replace verb must spell the door in that same body. Allowlist EMPTY.
//
// Regions are read from CODE with string literals BLANKED: a kept `"}"`
// literal unbalances the brace walk and truncates the handler body (measured —
// footnote.ts's `text !== "}"` hid its replace verb from the first draft).
//
// Stated limit: a handler that DELEGATES (wrapper-gate's `rule.handler(props)`)
// spells no replace verb and so is not a member — the upstream rules it wraps
// are covered by the core matcher patch, pinned below.
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import {
  REPO_ROOT,
  strip,
  enclosingDeclaration,
  trackedFiles,
} from "@/lib/__tests__/_source-scan";

const ANCHORS = /\bhandler\s*:\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{|\bhandleTextInput\s*\([^)]*\)\s*\{/g;
const REPLACE_VERB = /\.(?:replaceWith|replaceRangeWith|insertText|delete|replace)\(/;
const DOOR = /\brangeHoldsOnlyText\(/;

interface Site { file: string; line: number; body: string }

function sitesIn(src: string, file: string): Site[] {
  const out: Site[] = [];
  for (const m of src.matchAll(ANCHORS)) {
    const brace = (m.index ?? 0) + m[0].length - 1;
    const body = enclosingDeclaration(src, brace + 1);
    out.push({ file, line: src.slice(0, m.index).split("\n").length, body });
  }
  return out;
}

function productionSources(): Array<{ file: string; src: string }> {
  const files = [
    ...trackedFiles("src", /\.(ts|tsx)$/),
    ...trackedFiles("library", /\.(ts|tsx)$/),
  ].filter((f) => !/__tests__|\.test\.|\.d\.ts$/.test(f));
  return files
    .map((f) => ({ file: path.relative(REPO_ROOT, f), raw: readFileSync(f, "utf8") }))
    .filter(({ raw }) => /new InputRule\(|handleTextInput/.test(raw))
    .map(({ file, raw }) => ({ file, src: strip(raw, false) }));
}

describe("every replacing input-rule handler asks the atom door", () => {
  it("the census can see a violation (synthetic canary)", () => {
    const bad = `new InputRule({ find: /x$/, handler: ({ state, range }) => { state.tr.insertText("y", range.from, range.to); } });`;
    const good = `new InputRule({ find: /x$/, handler: ({ state, range }) => { if (!rangeHoldsOnlyText(state.doc, range.from, range.to)) return null; state.tr.insertText("y", range.from, range.to); } });`;
    const tip = `plugin({ props: { handleTextInput(view, from, _to, text) { view.dispatch(view.state.tr.replaceWith(from - 1, from, n)); return true; } } })`;
    const [b] = sitesIn(bad, "bad");
    const [g] = sitesIn(good, "good");
    const [t] = sitesIn(tip, "tip");
    expect(REPLACE_VERB.test(b.body) && !DOOR.test(b.body)).toBe(true);
    expect(DOOR.test(g.body)).toBe(true);
    expect(REPLACE_VERB.test(t.body) && !DOOR.test(t.body)).toBe(true);
  });

  it("no production handler replaces a matched range without the door", () => {
    const all = productionSources().flatMap(({ file, src }) => sitesIn(src, file));
    const members = all.filter((s) => REPLACE_VERB.test(s.body));
    // Non-vacuity: the known replacing rules are in the population.
    const memberFiles = new Set(members.map((s) => s.file));
    for (const f of [
      "src/lib/tiptap/autocorrect.ts",
      "src/lib/tiptap/math.ts",
      "src/lib/tiptap/footnote.ts",
      "src/lib/tiptap/citation.ts",
      "src/lib/tiptap/smart-quotes.ts",
      "src/lib/tiptap/latex-comment.ts",
    ]) {
      expect(memberFiles, f).toContain(f);
    }
    const offenders = members
      .filter((s) => !DOOR.test(s.body))
      .map((s) => `${s.file}:${s.line}`);
    expect(offenders).toEqual([]);
  });

  it("the door has one implementation", () => {
    const decls = productionSources()
      .concat([{ file: "src/lib/tiptap/typed-prose-gate.ts", src: strip(readFileSync(path.join(REPO_ROOT, "src/lib/tiptap/typed-prose-gate.ts"), "utf8"), false) }])
      .filter(({ src }) => /export function rangeHoldsOnlyText\b/.test(src))
      .map((s) => s.file);
    expect([...new Set(decls)]).toEqual(["src/lib/tiptap/typed-prose-gate.ts"]);
  });

  it("the core matcher patch ships and is applied", () => {
    const patch = path.join(REPO_ROOT, "patches/@tiptap+core+3.20.5.patch");
    expect(existsSync(patch)).toBe(true);
    expect(readFileSync(patch, "utf8")).toContain("task 578");
    const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, "node_modules/@tiptap/core/package.json"), "utf8"));
    expect(pkg.version).toBe("3.20.5");
    for (const dist of ["dist/index.js", "dist/index.cjs"]) {
      const src = readFileSync(path.join(REPO_ROOT, "node_modules/@tiptap/core", dist), "utf8");
      expect(src, dist).not.toContain('node.isAtom && !node.isText ? chunk');
    }
  });
});

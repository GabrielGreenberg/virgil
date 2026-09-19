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
// Stated limit: a handler that DELEGATES to an UPSTREAM rule (wrapper-gate's
// `rule.handler(props)`) spells no replace verb and so is not a member — the
// rules it wraps are covered by the core matcher patch, pinned below.
//
// ── DELEGATION TO A VIRGIL CREATOR (task 639) ─────────────────────────────
// A handler may also hand the replace to a NAMED SHARED CREATOR — which is
// STRONGER than spelling it inline, because the door then travels WITH the
// mutation and a second surface (a registry `run()`, a menu) cannot omit it.
// A body-scoped needle cannot see that: the member simply vanishes, and a
// census that loses members silently is how this one would rot. So the hop is
// FOLLOWED rather than exempted — `DELEGATED_CREATORS` below names each one,
// and for each the creator's own body must spell BOTH the replace verb and the
// door, and the handler must actually call it. The obligation moves; it is
// never dropped.
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

/**
 * Input-rule handlers that hand their replace to a shared creator. Each entry
 * is verified in BOTH halves below: the caller really calls it, and the callee
 * really asks the door before replacing.
 */
const DELEGATED_CREATORS = [
  {
    // task 639 — the `% ` rule and the `latex-comment` registry row share ONE
    // paragraph→comment creator, so the markless-`text*` refusal cannot be
    // omitted by whichever surface is added next.
    caller: "src/lib/tiptap/latex-comment.ts",
    call: "commentifyParagraph(",
    declFile: "src/lib/tiptap/latex-comment-convert.ts",
    fn: "commentifyParagraph",
  },
] as const;

/** The body of a top-level `export function <name>` — sliced to the next
 *  top-level `export` (or EOF). Exports are top-level by definition, so this
 *  isolates one declaration without a second brace walker. */
function exportedFnBody(src: string, name: string): string {
  const start = src.indexOf(`export function ${name}(`);
  if (start < 0) return "";
  const next = src.indexOf("\nexport ", start + 1);
  return next < 0 ? src.slice(start) : src.slice(start, next);
}

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
    ]) {
      expect(memberFiles, f).toContain(f);
    }
    // `latex-comment.ts` is the DELEGATING member (task 639): its handler no
    // longer replaces inline, so it is correctly absent from `members` — and
    // the obligation it carried is discharged by the leg below, not dropped.
    expect(memberFiles).not.toContain("src/lib/tiptap/latex-comment.ts");
    const offenders = members
      .filter((s) => !DOOR.test(s.body))
      .map((s) => `${s.file}:${s.line}`);
    expect(offenders).toEqual([]);
  });

  it("a handler that DELEGATES its replace hands the door to the creator, which asks it", () => {
    expect(DELEGATED_CREATORS.length, "the delegation table is populated").toBeGreaterThan(0);
    for (const d of DELEGATED_CREATORS) {
      const callerSrc = strip(
        readFileSync(path.join(REPO_ROOT, d.caller), "utf8"),
        false,
      );
      expect(callerSrc, `${d.caller} must call ${d.fn}`).toContain(d.call);
      const declSrc = strip(
        readFileSync(path.join(REPO_ROOT, d.declFile), "utf8"),
        false,
      );
      const body = exportedFnBody(declSrc, d.fn);
      expect(body, `${d.declFile} must export ${d.fn}`).not.toBe("");
      expect(
        REPLACE_VERB.test(body),
        `${d.fn} must be the one that replaces (else the delegation is mis-declared)`,
      ).toBe(true);
      expect(
        DOOR.test(body),
        `${d.fn} replaces a range and must ask rangeHoldsOnlyText`,
      ).toBe(true);
    }
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

// ProseMirror plugin `apply` / `appendTransaction` keystroke-sanctity census
// (task 433) — the sibling of `keystroke-subscriber-guardrail.test.ts` for the
// silo that census structurally cannot see.
//
// The keystroke-sanctity law (AGENTS.md) is enforced on `editor.on(…)`
// subscribers by a grep of the call form. A ProseMirror plugin's `apply` and
// `appendTransaction` bodies run on EVERY transaction too — earlier, inside the
// dispatch itself — and make no such call. Every finding in task 400
// (latex-command: three correct probes gating a whole-document
// `buildDecorations` + `DecorationSet.create`, scaling the keystroke with the
// paper) lived in exactly that silo with every guardrail green. The same blind
// spot covered section-folding, focus-view, anchor-highlight,
// transient-highlight, pgmark, linked-anchor, expex, the section numberer and
// the doc-structure observer itself.
//
//   THE QUESTION. For every plugin `apply` / `appendTransaction` in `src/` and
//   `library/`: does its body — or any module-local function it reaches —
//   perform a WHOLE-DOCUMENT walk (`doc.descendants(`, `nodesBetween(0, …)`,
//   `DecorationSet.create(`)? If so it must either
//     (a) take the shared DOOR — `touchedTextblocks(…)` from
//         `src/lib/tiptap/changed-ranges.ts` (task 400), which scopes the
//         rebuild to the blocks the transaction touched; or
//     (b) carry an in-place `[cost: …]`-tagged justification in the comment
//         block IMMEDIATELY ABOVE the method, naming the per-transaction cost
//         on a plain keystroke AND the class of the deferred walk (the same
//         tag rule the subscriber census enforces — "RAF-coalesced" or
//         "meta-gated" alone says nothing about what the body COSTS).
//   A walk with neither is an UNTAGGED whole-doc walk on the keystroke path.
//   `PERMITTED_UNTAGGED_PLUGIN_WALKS` is EMPTY and stays empty — a hit is
//   SCOPE-it (take the door) or JUSTIFY-it (state the gate), never list-it.
//
//   MEMBERSHIP IS DISCOVERED, never hand-listed: every shipped `.ts`/`.tsx`
//   outside `__tests__` that constructs a `new Plugin` is in the population,
//   and every method-definition-shaped `apply(` / `appendTransaction(` inside
//   it is a site. The REACH is the transitive closure over same-file function
//   declarations (`function name(` and `const name = (…) =>`), so a walk hidden
//   one helper down (`buildDecorations`, `buildSet`, `buildFoldArtifacts`) is
//   attributed to the site that calls it. Stated limit: the closure does not
//   follow imports — a walk behind an imported helper is invisible here, the
//   same limit the subscriber census states about its own callbacks.
//
//   WHY THE TAG MUST SIT ABOVE THE METHOD, NOT INSIDE IT. A door site may still
//   carry a whole-doc arm — latex-command's `replacesWholeDoc` (setContent /
//   code-pane re-parse) rebuilds everything, which is correct and stated in
//   place with its own `[cost:` line. If an in-body tag counted as the SITE's
//   justification, neutering the door (restoring a whole-doc
//   `buildDecorations(tr.doc)` in `apply`) would leave the site "tagged" and
//   this census green — the task-400 defect wearing the fix's clothes. So the
//   site tag is read from the contiguous comment above the method line only,
//   and a door site whose reach still hits a needle must carry that in-body
//   tag on its exempt arm (leg 3).
//
//   EXACT-SET PIN. `PLUGIN_SITE_VERDICTS` names every site with its verdict
//   (`door` / `tagged` / `clean`). It is an exact-set assertion in both
//   directions: a new plugin must be acknowledged here, and a site that stops
//   walking is retired here — a floor would let a new walker hide behind a
//   retired one.
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { REPO_ROOT, codeOnlyLines, trackedFiles } from "./_source-scan";

// ---------------------------------------------------------------------------
// The allowlist that stays empty
// ---------------------------------------------------------------------------

/** `file#method@line → reason`. EMPTY by design; see the header. */
const PERMITTED_UNTAGGED_PLUGIN_WALKS: Record<string, string> = {};

/**
 * Every plugin site in the tree, with its stated verdict. Keys are
 * `<repo-relative file>#<method>` (a file with two sites of one method name
 * carries an ordinal: `#appendTransaction[2]`).
 *
 *   door   — the body spells `touchedTextblocks(`; the rebuild is per-block.
 *   tagged — a `[cost: …]` line sits in the comment block directly above the
 *            method and states the keystroke cost + the deferred walk's class.
 *   clean  — the body's reach performs no whole-document walk at all.
 */
const PLUGIN_SITE_VERDICTS: Record<string, "door" | "tagged" | "clean"> = {
  "src/lib/editor-extensions.ts#appendTransaction": "tagged", // sectionNumbers
  "src/lib/focus-view.ts#apply": "tagged",
  "src/lib/section-folding.ts#apply": "tagged",
  "src/lib/tiptap/anchor-highlight-deco.ts#apply": "tagged",
  "src/lib/tiptap/block-uuid-backfill.ts#appendTransaction": "clean",
  "src/lib/tiptap/doc-structure/observer-plugin.ts#apply": "clean",
  "src/lib/tiptap/expex.ts#apply": "clean", // WidthState: meta ?? prev
  "src/lib/tiptap/expex.ts#appendTransaction": "tagged", // the renumberer
  "src/lib/tiptap/footnote.ts#appendTransaction": "clean",
  "src/lib/tiptap/label.ts#appendTransaction": "clean",
  "src/lib/tiptap/latex-command.ts#apply": "door",
  "src/lib/tiptap/latex-command.ts#appendTransaction": "clean", // takes the door too (leg 4), but its reach walks nothing
  "src/lib/tiptap/latex-comment.ts#appendTransaction": "clean",
  "src/lib/tiptap/linked-anchor.ts#appendTransaction": "tagged", // orphan guard (anchors)
  "src/lib/tiptap/linked-anchor.ts#appendTransaction[2]": "tagged", // orphan guard (blocks)
  "src/lib/tiptap/linked-anchor.ts#appendTransaction[3]": "clean", // resurrection guard
  "src/lib/tiptap/pgmark.ts#apply": "tagged",
  "src/lib/tiptap/slash-popup.ts#apply": "clean",
  // Takes the `touchedTextblocks` door too, but its reach walks nothing: the
  // ONE whole-document arm (`allProseBlocks`) is reachable only from the
  // plugin VIEW, behind the debounce, on a port `version()` bump.
  "src/lib/tiptap/spellcheck-decorator.ts#apply": "clean",
  "src/lib/tiptap/title.ts#appendTransaction": "clean",
  "src/lib/tiptap/transient-highlight.ts#apply": "tagged",
};

// ---------------------------------------------------------------------------
// The scanner
// ---------------------------------------------------------------------------

/** Whole-document walks. `nodesBetween(0, …)` is the doc-wide spelling; a
 *  bounded `nodesBetween(from, to, …)` is exactly what the door produces. */
const WALK_NEEDLES: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: "descendants", re: /\.descendants\s*\(/ },
  { name: "nodesBetween(0", re: /\bnodesBetween\s*\(\s*0\b/ },
  { name: "DecorationSet.create", re: /\bDecorationSet\.create\s*\(/ },
];
const DOOR_RE = /\btouchedTextblocks\s*\(/;
const COST_TAG_RE = /\[cost:\s*[^\]]+\]/;

function matchFrom(s: string, i: number, open: string, close: string): number {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === open) depth++;
    else if (s[j] === close) {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
}

/**
 * Given the index of a parameter list's `(`, return `[bodyOpen, bodyClose]`
 * for the `{ … }` that follows — skipping a return-type annotation's own
 * braces (`): { a: B } {`), which sit between the params and the body.
 * Returns null when the `(` is a CALL rather than a definition (the next
 * significant token after `)` is not `{`, `:` or `=>`).
 */
function bodyAfterParams(s: string, parenIdx: number): [number, number] | null {
  const pe = matchFrom(s, parenIdx, "(", ")");
  if (pe < 0) return null;
  let k = pe + 1;
  while (k < s.length && /\s/.test(s[k])) k++;
  const next2 = s.slice(k, k + 2);
  if (!(s[k] === "{" || s[k] === ":" || next2 === "=>")) return null;
  let from = pe + 1;
  for (;;) {
    const b = s.indexOf("{", from);
    if (b < 0) return null;
    let p = b - 1;
    while (p >= 0 && /\s/.test(s[p])) p--;
    const prev = s[p];
    // A brace introduced by `:` / `|` / `&` / `,` / `<` is a TYPE literal.
    if (prev === ":" || prev === "|" || prev === "&" || prev === "," || prev === "<") {
      const e = matchFrom(s, b, "{", "}");
      if (e < 0) return null;
      from = e + 1;
      continue;
    }
    const be = matchFrom(s, b, "{", "}");
    return be < 0 ? null : [b, be];
  }
}

function localFunctions(code: string): Map<string, string> {
  const fns = new Map<string, string>();
  const decl = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = decl.exec(code))) {
    const b = bodyAfterParams(code, m.index + m[0].length - 1);
    if (b) fns.set(m[1], code.slice(b[0], b[1] + 1));
  }
  const arrow = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g;
  while ((m = arrow.exec(code))) {
    const b = bodyAfterParams(code, m.index + m[0].length - 1);
    if (b) fns.set(m[1], code.slice(b[0], b[1] + 1));
  }
  return fns;
}

export interface PluginSite {
  key: string;
  file: string;
  method: "apply" | "appendTransaction";
  line: number;
  /** Whole-doc walk needles found in the body's same-file reach. */
  walks: string[];
  /** Same-file functions the body transitively reaches. */
  reach: string[];
  door: boolean;
  /** `[cost: …]` in the contiguous comment block directly above the method. */
  siteTag: boolean;
  /** `[cost: …]` somewhere INSIDE the body (an exempt arm's own statement). */
  bodyTag: boolean;
}

const SITE_RE = /(^|[\s,{])(apply|appendTransaction)\s*(?::\s*(?:function\s*)?)?\(/gm;

/** Scan one source text (repo-relative `rel` is only used for keys). */
export function scanPluginSites(rel: string, raw: string): PluginSite[] {
  const code = codeOnlyLines(raw);
  const rawLines = raw.split("\n");
  const fns = localFunctions(code);
  const sites: PluginSite[] = [];
  const perMethod = new Map<string, number>();
  let m: RegExpExecArray | null;
  while ((m = SITE_RE.exec(code))) {
    const method = m[2] as PluginSite["method"];
    const parenIdx = m.index + m[0].length - 1;
    const b = bodyAfterParams(code, parenIdx);
    if (!b) continue; // a CALL, not a definition
    const body = code.slice(b[0], b[1] + 1);
    const line = code.slice(0, m.index + m[1].length).split("\n").length;
    // Transitive same-file reach.
    const seen = new Set<string>();
    let reachText = body;
    const queue = [body];
    while (queue.length) {
      const t = queue.pop()!;
      for (const [name, fb] of fns) {
        if (seen.has(name)) continue;
        if (new RegExp(`\\b${name}\\s*\\(`).test(t)) {
          seen.add(name);
          reachText += fb;
          queue.push(fb);
        }
      }
    }
    const walks = WALK_NEEDLES.filter((n) => n.re.test(reachText)).map((n) => n.name);
    // Contiguous comment lines directly above the method line.
    const above: string[] = [];
    for (let i = line - 2; i >= 0; i--) {
      const t = rawLines[i].trim();
      if (t.startsWith("//") || t.startsWith("/*") || t.startsWith("*")) above.push(t);
      else break;
    }
    const bodyLineCount = body.split("\n").length;
    const bodyRaw = rawLines.slice(line - 1, line - 1 + bodyLineCount).join("\n");
    const n = (perMethod.get(method) ?? 0) + 1;
    perMethod.set(method, n);
    sites.push({
      key: `${rel}#${method}${n > 1 ? `[${n}]` : ""}`,
      file: rel,
      method,
      line,
      walks,
      reach: [...seen],
      door: DOOR_RE.test(body),
      siteTag: COST_TAG_RE.test(above.join("\n")),
      bodyTag: COST_TAG_RE.test(bodyRaw),
    });
  }
  return sites;
}

export function verdictOf(s: PluginSite): "door" | "tagged" | "clean" | "UNTAGGED" {
  if (s.walks.length === 0) return "clean";
  if (s.door) return "door";
  if (s.siteTag) return "tagged";
  return "UNTAGGED";
}

function population(): Array<{ rel: string; raw: string }> {
  const out: Array<{ rel: string; raw: string }> = [];
  for (const root of ["src", "library"]) {
    for (const abs of trackedFiles(root, /\.tsx?$/)) {
      if (abs.includes(`${path.sep}__tests__${path.sep}`)) continue;
      const raw = fs.readFileSync(abs, "utf8");
      if (!/\bnew Plugin\b/.test(codeOnlyLines(raw))) continue;
      out.push({ rel: path.relative(REPO_ROOT, abs).split(path.sep).join("/"), raw });
    }
  }
  return out;
}

const ALL_SITES: PluginSite[] = population().flatMap((f) => scanPluginSites(f.rel, f.raw));

// ---------------------------------------------------------------------------
// Legs
// ---------------------------------------------------------------------------

describe("plugin apply/appendTransaction keystroke-sanctity census (task 433)", () => {
  it("discovers a non-empty population that includes the task-400 plugin", () => {
    expect(ALL_SITES.length).toBeGreaterThan(5);
    expect(ALL_SITES.map((s) => s.key)).toContain("src/lib/tiptap/latex-command.ts#apply");
  });

  it("leg 1 — no plugin site performs an UNTAGGED whole-document walk (allowlist EMPTY)", () => {
    const offenders = ALL_SITES.filter((s) => verdictOf(s) === "UNTAGGED").map(
      (s) =>
        `${s.key}@${s.line}: walks [${s.walks.join(", ")}] via [${s.reach.join(", ") || "own body"}] — take touchedTextblocks(…) or add a [cost: …] line directly above the method`,
    );
    expect(Object.keys(PERMITTED_UNTAGGED_PLUGIN_WALKS)).toEqual([]);
    expect(offenders).toEqual([]);
  });

  it("leg 2 — every site's verdict is STATED, as an exact set in both directions", () => {
    const actual = Object.fromEntries(ALL_SITES.map((s) => [s.key, verdictOf(s)]));
    expect(actual).toEqual(PLUGIN_SITE_VERDICTS);
  });

  it("leg 3 — a DOOR site whose reach still hits a needle states its exempt arm in place", () => {
    // latex-command keeps a whole-doc rebuild for the setContent / code-pane
    // re-parse arm (`replacesWholeDoc`). That arm is a stated, tagged exemption:
    // the `[cost:` line lives INSIDE the body beside the arm, never above the
    // method (see the header for why that placement is load-bearing).
    const doorSites = ALL_SITES.filter((s) => s.door);
    expect(doorSites.length).toBeGreaterThan(0);
    for (const s of doorSites) {
      if (s.walks.length === 0) continue;
      expect(s.bodyTag, `${s.key}: door site with a residual whole-doc arm needs an in-body [cost:] statement`).toBe(true);
      expect(s.siteTag, `${s.key}: a door site must NOT carry a site-level tag — it would mask a neutered door`).toBe(false);
    }
  });

  it("leg 4 — the task-400 scoping is pinned: both latex-command sites take the door", () => {
    const keys = ["src/lib/tiptap/latex-command.ts#apply", "src/lib/tiptap/latex-command.ts#appendTransaction"];
    for (const k of keys) {
      const s = ALL_SITES.find((x) => x.key === k);
      expect(s, k).toBeDefined();
      expect(s!.door, `${k} must spell touchedTextblocks(`).toBe(true);
    }
  });

  it("leg 5 — every [cost:] tag above a tagged site names a cost, not just the word", () => {
    for (const s of ALL_SITES) {
      if (verdictOf(s) !== "tagged") continue;
      const rawLines = fs.readFileSync(path.join(REPO_ROOT, s.file), "utf8").split("\n");
      const above: string[] = [];
      for (let i = s.line - 2; i >= 0; i--) {
        const t = rawLines[i].trim();
        if (t.startsWith("//") || t.startsWith("/*") || t.startsWith("*")) above.push(t);
        else break;
      }
      const tag = above.join("\n").match(COST_TAG_RE)?.[0] ?? "";
      // "O(1)", "O(edit)", "O(steps)" … — a complexity class must be named.
      expect(tag, `${s.key}: tag must name a per-transaction cost class`).toMatch(/O\(/);
    }
  });

  // --- scanner self-checks: a census that cannot see the defect is a habit --

  const FIXTURE_UNTAGGED = `
import { Plugin } from "@tiptap/pm/state";
function buildDecorations(doc: any) {
  const decos: any[] = [];
  doc.descendants((n: any, p: number) => { decos.push(p); });
  return DecorationSet.create(doc, decos);
}
export const p = new Plugin({
  state: {
    init: () => null,
    // a comment with no tag
    apply(tr, old) {
      if (!tr.docChanged) return old;
      return buildDecorations(tr.doc);
    },
  },
});
`;

  it("canary — a whole-doc walk one helper down, with no door and no tag, is flagged", () => {
    const sites = scanPluginSites("fixture.ts", FIXTURE_UNTAGGED);
    expect(sites.map((s) => s.key)).toEqual(["fixture.ts#apply"]);
    expect(sites[0].walks).toEqual(["descendants", "DecorationSet.create"]);
    expect(sites[0].reach).toEqual(["buildDecorations"]);
    expect(verdictOf(sites[0])).toBe("UNTAGGED");
  });

  it("canary — the same site taking the door reads as `door`", () => {
    const src = FIXTURE_UNTAGGED.replace(
      "return buildDecorations(tr.doc);",
      // The door scopes the ordinary path; the whole-doc rebuild survives as
      // a setContent arm (the task-400 shape), so the reach still walks.
      "if (replacesWholeDoc(tr)) return buildDecorations(tr.doc);\n      const blocks = touchedTextblocks(tr.doc, touchedRanges([tr])); return rebuild(old, blocks);",
    );
    expect(verdictOf(scanPluginSites("fixture.ts", src)[0])).toBe("door");
  });

  it("canary — a [cost:] line directly above the method reads as `tagged`; one inside the body does not", () => {
    const above = FIXTURE_UNTAGGED.replace(
      "// a comment with no tag",
      "// [cost: O(1)/tx docChanged bail; O(doc) rebuild only on meta] fixture",
    );
    expect(verdictOf(scanPluginSites("fixture.ts", above)[0])).toBe("tagged");
    const inside = FIXTURE_UNTAGGED.replace(
      "if (!tr.docChanged) return old;",
      "// [cost: O(doc)] in-body statement\n      if (!tr.docChanged) return old;",
    );
    const s = scanPluginSites("fixture.ts", inside)[0];
    expect(s.bodyTag).toBe(true);
    expect(verdictOf(s)).toBe("UNTAGGED");
  });

  it("canary — a method CALL named apply(…) is not a site, and a site with no walk is `clean`", () => {
    const src = `
import { Plugin } from "@tiptap/pm/state";
export const p = new Plugin({
  state: { init: () => 0, apply(tr, v) { return tr.getMeta("k") ?? v; } },
  view() { const apply = (s: number) => s; apply(1); return {}; },
});
`;
    const sites = scanPluginSites("fixture.ts", src);
    expect(sites.map((s) => s.key)).toEqual(["fixture.ts#apply"]);
    expect(verdictOf(sites[0])).toBe("clean");
  });

  it("canary — a return-type annotation's braces are not mistaken for the body", () => {
    const src = `
function buildFoldArtifacts(doc: any): { decoSet: any; hiddenIdx: Set<number> } {
  return { decoSet: DecorationSet.create(doc, []), hiddenIdx: new Set() };
}
export const p = new Plugin({
  state: { init: () => 0, apply(tr, v): { decoSet: any } { return buildFoldArtifacts(tr.doc); } },
});
`;
    const s = scanPluginSites("fixture.ts", src)[0];
    expect(s.reach).toEqual(["buildFoldArtifacts"]);
    expect(s.walks).toEqual(["DecorationSet.create"]);
  });
});

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { commentsStripped } from "@/lib/__tests__/_source-scan";

/**
 * Panel-chrome RAW PALETTE census (task 2026-08-02-286).
 *
 * `STYLE_GUIDE.md` has banned `bg-blue-*` / `bg-emerald-*` / `bg-red-*` in
 * panel chrome for as long as the token scales have existed, and until this
 * suite that ban was **unenforced prose** — `npm run check:radius` covers the
 * radius half and nothing covered the colour half. So the family convention
 * grew: ONE banned `bg-emerald-500` became three sites inside the
 * comment/suggestion card family (the two goal-strip twins + the `accepted`
 * status dot), each copied from the last, with CI green the whole way.
 *
 * The census is the leg with teeth here, and it is deliberately WIDER than the
 * three families the prose names: the drift is a habit ("reach for the Tailwind
 * palette") rather than a hue, so it flags every `<utility>-<palette>-<step>`
 * spelling in the panel tree. Every hit must sit on
 * `PERMITTED_RAW_PALETTE_LITERALS` with the reason it survives and, where one
 * exists, the task that owns draining it.
 *
 * **The list may only SHRINK.** A new raw literal is TOKENIZE-it — mint or
 * reuse a semantic token (`--positive` is what this task minted for the
 * goal-reached / accepted role) — never a new allowlist entry. An entry earns
 * its place only by naming a decision nobody has made yet.
 *
 * Two limits, stated rather than implied:
 *
 *  - The key is `file :: literal`, deduped, NOT per line. Line numbers churn
 *    on every unrelated edit above them, and the allowlist would then fail for
 *    reasons that have nothing to do with colour. The cost is that a file may
 *    grow a SECOND occurrence of a literal it already carries without failing.
 *    Accepted: the realistic drift is a new hue in a new place, and that fails.
 *  - Scope is the panel tree plus the two shared panel/field primitives. Panel
 *    chrome authored elsewhere in `src/components/**` (the Library surfaces
 *    above all, which run a deliberate multi-hue chip vocabulary) is NOT
 *    censused here. Widening it is a separate decision with its own draining
 *    cost, not an oversight of this one.
 */
const ROOT = path.resolve(__dirname, "..", "..", "..");

/** The `<utility>-<tailwind palette>-<step>` shape, any utility prefix that
 *  takes a colour. Deliberately not anchored to the three banned families. */
const RAW_PALETTE =
  /\b(?:bg|text|border|ring|from|via|to|fill|stroke|decoration|outline|shadow|accent|caret|divide|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g;

/**
 * PRE-EXISTING sites, each with the reason it is still a literal. Every one of
 * these was here before task 286; the task drained the three `--positive` ones
 * and pinned the rest so the convention cannot grow a fourth.
 */
const PERMITTED_RAW_PALETTE_LITERALS: Record<string, string> = {
  // The five-way suggestion STATUS DOT vocabulary. `accepted` was drained onto
  // `--positive` (task 286); the other four are a traffic-light set whose home
  // is arguably the `--status-*` family, and converging them would MOVE four
  // colours (blue-400 vs --status-* has no member at all; amber-400 ≠
  // --status-warn; red-400 ≠ --status-danger). That is a visual decision, not a
  // swap.
  "src/panels/_shared/suggestion-fields.tsx :: bg-blue-400": "status-dot vocabulary; --status-* convergence is a visual call",
  "src/panels/_shared/suggestion-fields.tsx :: bg-sky-300": "status-dot vocabulary; --status-* convergence is a visual call",
  "src/panels/_shared/suggestion-fields.tsx :: bg-amber-400": "status-dot vocabulary; --status-* convergence is a visual call",
  "src/panels/_shared/suggestion-fields.tsx :: bg-red-400": "status-dot vocabulary; --status-* convergence is a visual call",

  // The suggestion DIFF vocabulary: green = the proposed text, red = the text
  // it replaces. A different role from `--positive` (which means "attained"),
  // and it wants its own added/removed pair whenever someone designs one.
  "src/panels/_shared/suggestion-fields.tsx :: border-red-200": "diff/destructive field chrome — wants an added/removed token pair",
  "src/panels/_shared/suggestion-fields.tsx :: text-red-700": "diff/destructive field chrome — wants an added/removed token pair",
  "src/panels/_shared/suggestion-fields.tsx :: placeholder:text-red-300": "diff/destructive field chrome — wants an added/removed token pair",
  "src/panels/_shared/suggestion-fields.tsx :: focus:border-red-400": "diff/destructive field chrome — wants an added/removed token pair",
  "src/panels/_shared/suggestion-fields.tsx :: bg-emerald-50": "diff/added field chrome — wants an added/removed token pair",
  "src/panels/_shared/suggestion-fields.tsx :: border-emerald-200": "diff/added field chrome — wants an added/removed token pair",
  "src/panels/_shared/suggestion-fields.tsx :: text-emerald-800": "diff/added field chrome — wants an added/removed token pair",
  "src/panels/_shared/suggestion-fields.tsx :: placeholder:text-emerald-400": "diff/added field chrome — wants an added/removed token pair",
  "src/panels/_shared/suggestion-fields.tsx :: focus:border-emerald-400": "diff/added field chrome — wants an added/removed token pair",
  "src/panels/_shared/suggestion-fields.tsx :: text-emerald-600": "accept-action affordance ink; the accept/reject button pair wants one token set",
  "src/panels/_shared/suggestion-fields.tsx :: hover:bg-emerald-50": "accept-action affordance ink; the accept/reject button pair wants one token set",
  "src/panels/_shared/suggestion-fields.tsx :: text-red-700/80": "diff/destructive field chrome — wants an added/removed token pair",
  "src/panels/Cutter/CutterSuggestionCard.tsx :: text-emerald-700/90": "diff/added preview ink (twin of the Revisions card) — wants the added/removed pair",
  "src/panels/Cutter/CutterSuggestionCard.tsx :: text-red-700/70": "diff/removed preview ink (twin of the Revisions card) — wants the added/removed pair",
  "src/panels/Revisions/RevisionSuggestionCard.tsx :: text-emerald-700/90": "diff/added preview ink (twin of the Cutter card) — wants the added/removed pair",
  "src/panels/Revisions/RevisionSuggestionCard.tsx :: text-red-700/70": "diff/removed preview ink (twin of the Cutter card) — wants the added/removed pair",

  // Owned by other filed tasks — deliberately NOT drained here, so this task
  // does not eat their diffs.
  "src/panels/Outline/OutlinePanel.tsx :: text-blue-500": "task 2026-08-02-284 (Outline colour literals)",
  "src/panels/Outline/OutlinePanel.tsx :: border-blue-400": "task 2026-08-02-284 (Outline colour literals)",
  "src/panels/Outline/OutlinePanel.tsx :: text-blue-400": "task 2026-08-02-284 (Outline colour literals)",
  "src/panels/Search/SearchPanel.tsx :: bg-amber-50/60": "task 2026-08-06-309 (search toggles bypass the toggle-state SSOT)",
  "src/panels/Search/SearchPanel.tsx :: bg-amber-200/80": "task 2026-08-06-309 (search toggles bypass the toggle-state SSOT)",

  // Singletons with no filed owner yet.
  "src/panels/Bibliography/BibliographyPanel.tsx :: bg-amber-400": "in-flight pulse dot; wants the amber family or a --status-* member",
  "src/panels/Citations/CitationCard.tsx :: text-emerald-600": "accept-action affordance ink; twin of the suggestion-fields button",
  "src/panels/Omni/OmniViewPanel.tsx :: border-sky-200": "omni notice strip edge; wants an informational edge token",
};

/** Every censused source file, repo-relative, POSIX-separated. */
function censusFiles(): string[] {
  const out: string[] = [];
  const walk = (abs: string) => {
    for (const name of readdirSync(abs)) {
      const child = path.join(abs, name);
      if (statSync(child).isDirectory()) {
        if (name === "__tests__") continue;
        walk(child);
      } else if (/\.tsx?$/.test(name)) {
        out.push(path.relative(ROOT, child).split(path.sep).join("/"));
      }
    }
  };
  walk(path.join(ROOT, "src/panels"));
  // The two shared primitives panel chrome is authored THROUGH. Both are clean
  // today (their only palette mentions are in prose), which is exactly why they
  // belong in the census rather than outside it.
  out.push("src/components/panel-primitives.tsx", "src/components/field-primitives.tsx");
  return out.sort();
}

/**
 * `file :: literal` for every raw palette spelling, comments blanked and string
 * literals KEPT — a Tailwind class only ever lives inside a string, so the
 * code-only stripper would blank the very thing this census greps for (the
 * unfalsifiable-leg mistake task 205 made), while leaving comments in would
 * indict prose that merely names a colour (`panel-primitives.tsx` has exactly
 * such a sentence).
 *
 * The Tailwind VARIANT prefix (`hover:`, `focus:`, `placeholder:`) and the
 * opacity suffix (`/80`) are carried into the key when present, so a literal
 * and its hover twin are two entries rather than one.
 */
function flaggedLiterals(): Set<string> {
  const flagged = new Set<string>();
  for (const rel of censusFiles()) {
    const src = commentsStripped(readFileSync(path.join(ROOT, rel), "utf8"));
    for (const m of src.matchAll(RAW_PALETTE)) {
      const start = m.index ?? 0;
      // Widen left over a `hover:` / `focus:` / `placeholder:` variant chain and
      // right over an `/80` opacity suffix, so the key names what was written.
      const before = /(?:[a-z-]+:)*$/.exec(src.slice(Math.max(0, start - 40), start))?.[0] ?? "";
      const after = /^\/\d{1,3}/.exec(src.slice(start + m[0].length))?.[0] ?? "";
      flagged.add(`${rel} :: ${before}${m[0]}${after}`);
    }
  }
  return flagged;
}

describe("panel-chrome raw palette census", () => {
  it("flags no raw palette literal outside the allowlist", () => {
    const permitted = new Set(Object.keys(PERMITTED_RAW_PALETTE_LITERALS));
    const unexpected = [...flaggedLiterals()].filter((k) => !permitted.has(k)).sort();
    expect(
      unexpected,
      "TOKENIZE these — mint or reuse a semantic token (see STYLE_GUIDE 'Positive / attained' " +
        "for the shape). Do NOT add them to PERMITTED_RAW_PALETTE_LITERALS; that list may only shrink.",
    ).toEqual([]);
  });

  it("keeps the allowlist honest — every entry still names a live site", () => {
    // A drained site whose entry lingers is how an allowlist stops meaning
    // anything. The set may only shrink, so a stale entry is a deletion owed.
    const flagged = flaggedLiterals();
    const stale = Object.keys(PERMITTED_RAW_PALETTE_LITERALS)
      .filter((k) => !flagged.has(k))
      .sort();
    expect(stale, "these sites are drained — delete their allowlist entries").toEqual([]);
  });

  it("every allowlist entry states a reason", () => {
    for (const [key, why] of Object.entries(PERMITTED_RAW_PALETTE_LITERALS)) {
      expect(why.length, `${key} needs a stated reason`).toBeGreaterThan(20);
    }
  });
});

describe("census self-checks", () => {
  it("can see a literal that is really there (canary)", () => {
    // Anchored on a site the allowlist KEEPS, not on one this task drained — a
    // canary standing on the defect evaporates the moment the defect is fixed.
    expect(flaggedLiterals()).toContain(
      "src/panels/_shared/suggestion-fields.tsx :: bg-blue-400",
    );
  });

  it("reads strings and ignores prose", () => {
    const fixture = [
      '// a comment naming bg-emerald-500 is prose, not chrome',
      'const live = "bg-emerald-500";',
      '/* block comment with text-blue-500 */',
    ].join("\n");
    const stripped = commentsStripped(fixture);
    expect([...stripped.matchAll(RAW_PALETTE)].map((m) => m[0])).toEqual([
      "bg-emerald-500",
    ]);
  });

  it("does not swallow the files it scans", () => {
    // The stripper DELETES comments (it does not blank them to spaces), so a
    // length comparison says nothing. What a swallow destroys is CODE — the
    // task-202b runaway ate 7 kB and nine declarations — so count code shapes
    // a comment cannot plausibly carry: the import statements must all survive,
    // and the semicolon mass cannot collapse.
    //
    // Both needles are anchored at COLUMN ZERO, which is what makes them
    // comment-proof: a block comment's continuation lines carry a leading
    // ` * `, and a `//` line is deleted wholesale. Semicolon MASS was the
    // obvious third needle and is not usable — `atomless-refs.ts` keeps more
    // than half of its semicolons inside a worked example in its own header.
    const declCount = (s: string) => (s.match(/^(?:export|import)\s/gm) ?? []).length;
    for (const rel of censusFiles()) {
      const raw = readFileSync(path.join(ROOT, rel), "utf8");
      const stripped = commentsStripped(raw);
      expect(declCount(stripped), rel).toBe(declCount(raw));
      expect(stripped.length, rel).toBeGreaterThan(0);
    }
  });

  it("censuses the files it claims to", () => {
    const files = censusFiles();
    expect(files).toContain("src/panels/Cutter/CutterGoalStrip.tsx");
    expect(files).toContain("src/panels/_shared/PanelGoalStrip.tsx");
    expect(files).toContain("src/components/panel-primitives.tsx");
    expect(files.some((f) => f.includes("__tests__"))).toBe(false);
    expect(files.length).toBeGreaterThan(40);
  });
});

describe("the --positive role-set is defined and read", () => {
  const globals = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");

  it("defines both rungs in :root, pinned to the emeralds they replaced", () => {
    expect(globals).toMatch(/--positive:\s*#10b981\s*;/);
    expect(globals).toMatch(/--positive-strong:\s*#047857\s*;/);
  });

  it("has the goal strip reading them", () => {
    const strip = readFileSync(
      path.join(ROOT, "src/panels/_shared/PanelGoalStrip.tsx"),
      "utf8",
    );
    expect(strip).toContain("bg-[var(--positive)]");
    expect(strip).toContain("text-[var(--positive-strong)]");
  });

  it("leaves no emerald CLASS in the goal strip or its two adapters", () => {
    // Asked through the census, not through raw file text: the primitive's own
    // header NAMES `bg-emerald-500` when it explains what it replaced, and a
    // guard that indicts its own explanation teaches the next author to delete
    // the explanation.
    const flagged = [...flaggedLiterals()];
    for (const rel of [
      "src/panels/Cutter/CutterGoalStrip.tsx",
      "src/panels/Revisions/RevisionsTracker.tsx",
      "src/panels/_shared/PanelGoalStrip.tsx",
    ]) {
      expect(flagged.filter((k) => k.startsWith(`${rel} ::`)), rel).toEqual([]);
    }
  });
});

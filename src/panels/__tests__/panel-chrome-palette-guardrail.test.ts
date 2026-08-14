import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { commentsStripped, cssCommentsStripped } from "@/lib/__tests__/_source-scan";

/**
 * Panel-chrome RAW COLOUR census (task 2026-08-02-286; second needle 284).
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
 *
 * ── The second needle: a VALUE is a palette choice too (task 2026-08-02-284)
 *
 * The header above says the drift is a habit rather than a hue, and that was
 * one word short: the habit is "reach for a colour", and the Tailwind utility
 * is only ONE of its three spellings. The other two are the arbitrary-value
 * class (`text-[#857070]`) and the inline style (`background: "#fef9c3"`), and
 * NOTHING in the repo could see either — `RAW_PALETTE` matches a palette NAME,
 * and `destructive-red-tokens`'s hex needle is scoped to a red hue window with
 * a saturation floor of 0.15. The Outline panel painted seven such literals for
 * a year across all three spellings, with every colour guard green, and the two
 * that were catchable sat on allowlists pointing at this task. `#857070` in
 * particular measures sat ≈0.086 — under the red guard's floor, so even the
 * needle nearest to it was structurally entitled to miss it.
 *
 * So `RAW_VALUE` censuses the value spellings beside the name spelling, and two
 * exclusions keep it honest — each of them a decision, not an omission:
 *
 *  - **A `var(--token, #fallback)` fallback is not a literal.** It is the
 *    repo's compliant idiom (globals.css spells it ~40 times, and STYLE_GUIDE
 *    discusses the form), so indicting it would make the compliant answer the
 *    failing one — the trap task 204 names, where a guard whose compliant form
 *    reads worse than the violation loses quietly.
 *  - **An ACHROMATIC value (r == g == b) is not a palette choice.** The panel
 *    tree's remaining ones are all `rgba(0, 0, 0, α)` drop shadows, which are a
 *    SHADOW decision with its own filed scale task; flagging them would eat
 *    that diff and say nothing about colour. The chromatic test is deliberately
 *    exact rather than a saturation floor, because a floor is precisely what
 *    let `#857070` through the guard that had one.
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
  // does not eat their diffs. (The three Outline blues that sat here retired
  // with task 2026-08-02-284: the Outline's InlineLabel now reads
  // `--heading-annotation-color`, the token its in-prose twin already used.)
  "src/panels/Search/SearchPanel.tsx :: bg-amber-50/60": "task 2026-08-06-309 (search toggles bypass the toggle-state SSOT)",
  "src/panels/Search/SearchPanel.tsx :: bg-amber-200/80": "task 2026-08-06-309 (search toggles bypass the toggle-state SSOT)",

  // Singletons with no filed owner yet.
  "src/panels/Bibliography/BibliographyPanel.tsx :: bg-amber-400": "in-flight pulse dot; wants the amber family or a --status-* member",
  "src/panels/Citations/CitationCard.tsx :: text-emerald-600": "accept-action affordance ink; twin of the suggestion-fields button",
  "src/panels/Omni/OmniViewPanel.tsx :: border-sky-200": "omni notice strip edge; wants an informational edge token",
};

/**
 * A hex literal, or the first three channels of a functional colour. Both
 * spellings resolve to an r/g/b triple so the achromatic test can run on either.
 */
const RAW_VALUE =
  /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b|\b(?:rgba?|hsla?)\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/g;

/** The fallback slot of a `var(--token, …)` read, ending exactly at the match. */
const VAR_FALLBACK = /var\(\s*--[a-zA-Z0-9-]+\s*,\s*$/;

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.slice(1);
  if (h.length === 3 || h.length === 4) h = [...h.slice(0, 3)].map((c) => c + c).join("");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/**
 * PRE-EXISTING raw colour VALUES, same `file :: literal` key and same
 * shrink-only rule as the palette list above.
 */
const PERMITTED_RAW_VALUE_LITERALS: Record<string, string> = {
  // The done-checkbox glyph pair. `TodoRow`'s `TodoDoneToggle` and the shared
  // `AiRequestCheckbox` draw the same 14×14 rounded rect from the same literals
  // — including `#b5b0aa`, which is a verbatim re-spelling of the `--muted-light`
  // token. Both the literals AND the duplicated markup are queued task
  // 2026-08-02-287, which owns draining them together; splitting the value half
  // off here would leave that task holding only the markup half.
  "src/panels/Todo/TodoRow.tsx :: #ece9e4": "task 2026-08-02-287 (done-checkbox glyph: raw hex + markup shared with AiRequestCheckbox)",
  "src/panels/Todo/TodoRow.tsx :: #b5b0aa": "task 2026-08-02-287 (done-checkbox glyph: raw hex + markup shared with AiRequestCheckbox)",
  "src/panels/Todo/TodoRow.tsx :: #1c1917": "task 2026-08-02-287 (done-checkbox glyph: raw hex + markup shared with AiRequestCheckbox)",
  "src/components/panel-primitives.tsx :: #b5b0aa": "task 2026-08-02-287 — the AiRequestCheckbox twin of the TodoRow glyph above",
  "src/components/panel-primitives.tsx :: #0369a1": "task 2026-08-02-287 — the AiRequestCheckbox tick ink; the one blue left in the panel tree",
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

/**
 * `file :: literal` for every raw CHROMATIC colour value, same stripper and the
 * same reasons as `flaggedLiterals` above. Exported shape kept identical so the
 * two censuses read as one family.
 */
function flaggedValues(source?: (rel: string) => string): Set<string> {
  const flagged = new Set<string>();
  for (const rel of censusFiles()) {
    const src = commentsStripped(
      source ? source(rel) : readFileSync(path.join(ROOT, rel), "utf8"),
    );
    for (const m of src.matchAll(RAW_VALUE)) {
      const start = m.index ?? 0;
      if (VAR_FALLBACK.test(src.slice(Math.max(0, start - 80), start))) continue;
      const rgb: [number, number, number] =
        m[0][0] === "#"
          ? hexToRgb(m[0])
          : [Number(m[1]), Number(m[2]), Number(m[3])];
      if (rgb[0] === rgb[1] && rgb[1] === rgb[2]) continue;
      flagged.add(`${rel} :: ${m[0][0] === "#" ? m[0] : `rgb(${rgb.join(",")})`}`);
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
    for (const [key, why] of Object.entries({
      ...PERMITTED_RAW_PALETTE_LITERALS,
      ...PERMITTED_RAW_VALUE_LITERALS,
    })) {
      expect(why.length, `${key} needs a stated reason`).toBeGreaterThan(20);
    }
  });
});

describe("panel-chrome raw colour-VALUE census", () => {
  it("flags no raw chromatic hex / rgb() outside the allowlist", () => {
    const permitted = new Set(Object.keys(PERMITTED_RAW_VALUE_LITERALS));
    const unexpected = [...flaggedValues()].filter((k) => !permitted.has(k)).sort();
    expect(
      unexpected,
      "TOKENIZE these — read the token the concept already has (the Outline's own " +
        "literals each turned out to have one: --heading-annotation-color, " +
        "--par-title-color, --danger-muted, --amber-highlight-wash/-edge). A " +
        "`var(--token, #fallback)` read is fine; a bare value is not. Do NOT add " +
        "them to PERMITTED_RAW_VALUE_LITERALS; that list may only shrink.",
    ).toEqual([]);
  });

  it("keeps the allowlist honest — every entry still names a live site", () => {
    const flagged = flaggedValues();
    const stale = Object.keys(PERMITTED_RAW_VALUE_LITERALS)
      .filter((k) => !flagged.has(k))
      .sort();
    expect(stale, "these sites are drained — delete their allowlist entries").toEqual([]);
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

  it("would have caught every spelling the Outline shipped (defect leg)", () => {
    // Driven through the REAL census over a substituted OutlinePanel, not
    // through a re-implementation of the needle: what has to be proven is that
    // the census catches these, and only the census can prove that. Every line
    // is verbatim from the pre-284 file.
    const OUTLINE = "src/panels/Outline/OutlinePanel.tsx";
    const preFix = [
      'const a = "text-[11px] text-[#857070] truncate";',
      'const b = { background: "#fef9c3" };',
      'const c = { border: "1.5px solid #d4aa17" };',
      'const d = "text-[#b45757] border-[#b45757]";',
      '<PositionHighlight color="rgba(180, 87, 87, 0.13)" />;',
    ].join("\n");
    const flagged = flaggedValues((rel) =>
      rel === OUTLINE ? preFix : readFileSync(path.join(ROOT, rel), "utf8"),
    );
    expect([...flagged].filter((k) => k.startsWith(`${OUTLINE} ::`)).sort()).toEqual([
      `${OUTLINE} :: #857070`,
      `${OUTLINE} :: #b45757`,
      `${OUTLINE} :: #d4aa17`,
      `${OUTLINE} :: #fef9c3`,
      `${OUTLINE} :: rgb(180,87,87)`,
    ]);
    // …and the shipped file is clean, which is the other half of the claim.
    expect([...flaggedValues()].filter((k) => k.startsWith(`${OUTLINE} ::`))).toEqual([]);
  });

  it("spares a var() fallback and an achromatic scrim (the two stated exclusions)", () => {
    const OUTLINE = "src/panels/Outline/OutlinePanel.tsx";
    const fixture = [
      'const ok1 = "text-[var(--par-title-color,#c45a5a)]";',
      'const ok2 = { color: "var(--ink-body, #44403c)" };',
      'const ok3 = { boxShadow: "0 1px 3px rgba(0,0,0,0.15)" };',
      'const ok4 = { border: "2px solid var(--surface, #ffffff)" };',
      // The control: without one, every leg above could pass on a dead needle.
      'const bad = { color: "#857070" };',
    ].join("\n");
    const flagged = flaggedValues((rel) =>
      rel === OUTLINE ? fixture : readFileSync(path.join(ROOT, rel), "utf8"),
    );
    expect([...flagged].filter((k) => k.startsWith(`${OUTLINE} ::`))).toEqual([
      `${OUTLINE} :: #857070`,
    ]);
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

/**
 * The Outline panel is a MIRROR of chrome the document already renders, so its
 * tokens are not a fresh choice — they are the ones its original already reads.
 * These legs assert the agreement rather than restating either side's value, so
 * a retone of the in-prose rule is caught at the panel that copies it.
 */
describe("the Outline panel mirrors its in-prose originals' tokens (task 284)", () => {
  const globals = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
  /**
   * Every leg below reads the COMMENT-STRIPPED source, and the negative legs
   * especially: this task's own edits explain each swap by naming the literal
   * they retired, and a guard that indicts its own explanation teaches the next
   * author to delete the explanation — the rule the `--positive` block below
   * already states about `bg-emerald-500`. Measured, not theorised: three of
   * these legs failed on raw text against a file with zero live literals.
   */
  const globalsCode = cssCommentsStripped(globals);
  const outline = commentsStripped(
    readFileSync(path.join(ROOT, "src/panels/Outline/OutlinePanel.tsx"), "utf8"),
  );
  /** The declarations of one CSS rule, by selector, comments stripped. */
  const ruleBody = (selector: string) =>
    new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`)
      .exec(globalsCode)?.[1] ?? "";

  it("takes the label-key ink its in-prose twin takes", () => {
    // `.heading-label-input` is the SAME affordance in the margin. Read the
    // token out of its rule so this cannot drift into a second opinion.
    const twin = ruleBody(".heading-label-input");
    expect(twin).toMatch(/--heading-annotation-color/);
    expect(outline).toContain("text-[var(--heading-annotation-color,#6b9ac4)]");
    expect(outline).not.toMatch(/text-blue-|border-blue-/);
  });

  it("takes the conflict ink its in-prose twin takes", () => {
    // `.heading-label-input.has-conflict` + `.heading-label-warning`.
    expect(ruleBody(".heading-label-input.has-conflict")).toMatch(/--danger-muted/);
    expect(ruleBody(".heading-label-warning")).toMatch(/--danger-muted/);
    // The Tailwind rung exists, so the panel spells the utility (globals.css
    // declares `--color-danger-muted`; `destructive-red-tokens` leg 3 pins the
    // alias⇔utility biconditional, so this spelling keeps that leg satisfied).
    expect(globalsCode).toMatch(/--color-danger-muted:\s*var\(--danger-muted\)/);
    expect(outline).toContain("text-danger-muted border-danger-muted");
    expect(outline).not.toContain("#b45757");
  });

  it("renders paragraph titles in the preference-backed token its siblings use", () => {
    // Not a new decision: the prose annotation, the card-title primitive and the
    // Search breadcrumb all already read it at full strength. The Outline was
    // the sole surface frozen against a user-recolourable pref.
    const search = commentsStripped(
      readFileSync(path.join(ROOT, "src/panels/Search/SearchPanel.tsx"), "utf8"),
    );
    expect(search).toContain("text-[var(--par-title-color,#c45a5a)]");
    expect(outline).toContain("text-[var(--par-title-color,#c45a5a)]");
    expect(outline).not.toContain("#857070");
  });

  it("paints the focus band from the shared amber-highlight family", () => {
    expect(outline).toContain("var(--amber-highlight-wash)");
    expect(outline).toContain("var(--amber-highlight-edge)");
    // The band's retired fill had a SECOND speller; both read the family now, so
    // neither #fef9c3 nor the gold survives in either file.
    expect(ruleBody(".citation-preview")).toMatch(/var\(--amber-highlight-wash\)/);
    expect(globalsCode).not.toContain("#fef9c3");
    expect(outline).not.toContain("#fef9c3");
    expect(outline).not.toContain("#d4aa17");
  });

  it("marks the caret's section with an accent tint, not a borrowed red", () => {
    // `--accent` is the token whose own preference row reads "Links, selections,
    // and active controls" — which is what a current-position selector is.
    expect(outline).toContain("color-mix(in oklab, var(--accent) 13%, transparent)");
    expect(outline).not.toMatch(/rgba\(\s*180\s*,/);
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

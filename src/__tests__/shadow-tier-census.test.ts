/**
 * Shadow-tier census (task 818).
 *
 * Elevation is a property of the SURFACE TIER, never of the call site
 * (STYLE_GUIDE.md → "Hover never changes elevation"): pods/cards carry the
 * ambient lift (`--pod-shadow` / `--card-shadow-ambient`), menus and floating
 * chips `--menu-shadow`, floating panels `--shadow-float`, drag ghosts
 * `--shadow-drag-ghost-filter`. Radius has `check:radius`, colour has
 * `color-token-consumers`; this is the matching guard for shadow. Before it,
 * the twin pending-change navigators (`PendingChangePill` / Omni's sticky
 * header — the same chrome) wore `shadow-lg` and `shadow-sm`, and five more
 * chips and popovers each picked a literal of their own.
 *
 * Flagged, in `src/` + `library/` (`.ts` / `.tsx` / `.css`, tests excluded):
 *   - a Tailwind elevation utility in a string literal: `shadow`,
 *     `shadow-sm|md|lg|xl|2xl` (any variant prefix), and an arbitrary
 *     `shadow-[…]` whose value is not a `var(…)` read;
 *   - a LITERAL elevation layer anywhere in code: `x y blur [spread] <colour>`
 *     with a positive blur, outside a `var(…)` span (a fallback literal inside
 *     `var(--tok, …)` vouches for itself) and outside a CSS custom-property
 *     definition (that is where the tiers are MINTED).
 * Not flagged (they are not elevation): `inset` layers (seams, pressed wells,
 * insertion bars), zero-blur spread RINGS (`0 0 0 2px …` — focus / selection /
 * drop halos), `shadow-inner`, `shadow-none`.
 *
 * Token-or-literal is half the rule; the guide's other half is WHICH RUNG
 * (task 1059). Two more legs:
 *   - a FALLBACK inside `var(--tok, X)` for a shadow token `:root` defines is
 *     dead (the token always resolves) and drifts (three had: one layer vs the
 *     token's two, or a different shadow entirely) — read the bare token;
 *   - the floating chips/popovers the guide ENUMERATES (STYLE_GUIDE elevation
 *     paragraph) are a declared population, each of which must read
 *     `--menu-shadow` — not the pod/card ambient rung it happens to equal
 *     today through the `--menu-shadow: var(--pod-shadow)` alias.
 * And a ring's COLOUR is a token read, not a hand-picked rgba/hex (a ring is
 * exempt from the elevation leg, which is how two raw ring colours escaped).
 *
 * Task 1247 closes the three holes an enumerated list leaves:
 *   - the floating population is also DERIVED: any `position: absolute|fixed`
 *     surface (a CSS rule, or a TSX style object) whose shadow reads an
 *     AMBIENT rung (`--pod-shadow` / `--card-shadow-ambient`) is a floating
 *     chip on the wrong rung — the Library page lozenge sat there unlisted;
 *   - the in-flow rung is ONE token: the in-flow chips and sticky headers the
 *     guide enumerates each read `--card-shadow-ambient` (Omni's pending
 *     header read `--pod-shadow`, its siblings the card rung);
 *   - elevation is never keyed on a STATE: a ternary on an
 *     active/selected/… condition whose branches differ in an elevation read
 *     is a selected row that lifts (AIWindow's nav row did).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..");
const SCAN_DIRS = ["src", "library"];
const EXTS = new Set([".ts", ".tsx", ".css"]);

/** Annotated exceptions: a site may keep a non-tier shadow only here. */
const ALLOWLIST: ReadonlyArray<{ file: string; needle: string; why: string }> = [];

export interface ShadowViolation {
  line: number;
  kind: "tailwind-utility" | "literal-layer";
  text: string;
}

const TW_ELEVATION = /^(?:[\w-]+:)*shadow(?:-(?:sm|md|lg|xl|2xl))?$/;
const TW_ARBITRARY = /^(?:[\w-]+:)*shadow-\[(.*)\]$/;
const STRING_LITERAL = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
const NUM = String.raw`-?\d*\.?\d+(?:px|rem|em)?`;
const LAYER = new RegExp(
  String.raw`(?<![\w.#-])(${NUM})\s+(${NUM})\s+(\d*\.?\d+)(?:px|rem|em)?(?:\s+${NUM})?\s+(?:rgba?\(|hsla?\(|#[0-9a-fA-F]{3}|color-mix\(|oklch\(|black\b|white\b)`,
  "g",
);

/** Blank every bracket-balanced `var(…)` span (fallback literal included). */
function stripVarSpans(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; ) {
    if (s.startsWith("var(", i)) {
      let depth = 0;
      let j = i + 3;
      for (; j < s.length; j++) {
        if (s[j] === "(") depth++;
        else if (s[j] === ")" && --depth === 0) break;
      }
      out += " ".repeat(j + 1 - i);
      i = j + 1;
      continue;
    }
    out += s[i++];
  }
  return out;
}

const isCommentLine = (l: string) => /^\s*(\/\/|\/\*|\*)/.test(l);

export function scanShadowSource(src: string, file: string): ShadowViolation[] {
  const isCss = file.endsWith(".css");
  // Drop block comments (keeping line structure) so prose never trips a rule.
  const text = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const lines = text.split("\n");
  const out: ShadowViolation[] = [];
  let inTokenDef = false;
  lines.forEach((raw, i) => {
    if (!isCss && isCommentLine(raw)) return;
    const line = isCss ? raw : raw.replace(/(^|[^:"'`])\/\/.*$/, "$1");
    if (isCss) {
      // A custom-property definition (possibly wrapped) MINTS a tier.
      if (/^\s*--[\w-]+\s*:/.test(line)) inTokenDef = true;
      const wasTokenDef = inTokenDef;
      if (line.includes(";") || line.includes("}")) inTokenDef = false;
      if (wasTokenDef) return;
    } else {
      for (const lit of line.match(STRING_LITERAL) ?? []) {
        for (const tok of lit.slice(1, -1).split(/[\s"'`${}]+/)) {
          const arb = TW_ARBITRARY.exec(tok);
          if (TW_ELEVATION.test(tok) || (arb && !arb[1].trim().startsWith("var("))) {
            out.push({ line: i + 1, kind: "tailwind-utility", text: tok });
          }
        }
      }
    }
    const judged = stripVarSpans(line);
    for (const m of judged.matchAll(LAYER)) {
      if (parseFloat(m[3]) <= 0) continue; // a zero-blur spread ring
      const before = judged.slice(0, m.index);
      const layerStart = Math.max(before.lastIndexOf(","), before.lastIndexOf(":"), before.lastIndexOf('"'), before.lastIndexOf("'"));
      if (/\binset\b/.test(before.slice(layerStart + 1))) continue;
      out.push({ line: i + 1, kind: "literal-layer", text: m[0].trim() });
    }
  });
  return out;
}

/** Shadow tokens `:root` mints (name contains `shadow` / `glow`). */
const GLOBALS_CSS = path.join(ROOT, "src", "app", "globals.css");
export function definedShadowTokens(css: string): Set<string> {
  const out = new Set<string>();
  for (const m of css.matchAll(/^\s*(--[\w-]*(?:shadow|glow)[\w-]*)\s*:/gm)) out.add(m[1]);
  return out;
}

/** `var(--tok, …)` reads whose `--tok` is a defined shadow token. */
export function scanDeadShadowFallbacks(src: string, tokens: Set<string>): Array<{ line: number; token: string }> {
  const out: Array<{ line: number; token: string }> = [];
  src.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(/var\(\s*(--[\w-]+)\s*,/g)) {
      if (tokens.has(m[1])) out.push({ line: i + 1, token: m[1] });
    }
  });
  return out;
}

/** A zero-blur ring whose colour is a raw literal (rgba/hsla/hex), not a token read. */
const RAW_RING = new RegExp(
  String.raw`(?<![\w.#-])0(?:px)?\s+0(?:px)?\s+0(?:px)?\s+${NUM}\s+(?:rgba?\(|hsla?\(|#[0-9a-fA-F]{3})`,
  "g",
);
export function scanRawRingColours(src: string): number[] {
  const text = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const out: number[] = [];
  text.split("\n").forEach((raw, i) => {
    if (isCommentLine(raw)) return;
    if (/^\s*--[\w-]+\s*:/.test(raw)) return; // a token definition mints the colour
    const line = raw.replace(/(^|[^:"'`])\/\/.*$/, "$1");
    if (RAW_RING.test(line)) out.push(i + 1);
    RAW_RING.lastIndex = 0;
  });
  return out;
}

/**
 * The floating population the guide enumerates — each a small chip or popover
 * over the editor that takes the MENU rung. `needle` names the surface (it must
 * match exactly once); the first shadow declaration at or after it (within its
 * CSS rule / the next 30 lines) must read `--menu-shadow`. An IN-FLOW chip is
 * not listed: it takes the pod/card ambient rung.
 */
export const FLOATING_SURFACES: ReadonlyArray<{ file: string; needle: string; what: string }> = [
  { file: "src/components/PendingChangePill.tsx", needle: "rounded-md border border-[var(--pending-ai-edge)] bg-surface", what: "pending-change pill" },
  { file: "src/app/globals.css", needle: ".hint-bubble {", what: "hint tooltip" },
  { file: "src/components/EditorPane.tsx", needle: "── Floating Save/Cancel chip", what: "drop-mode Save/Cancel chip" },
  { file: "src/components/CompilePaneStatus.tsx", needle: "bg-yellow-100 text-yellow-800", what: "stale-PDF badge" },
  { file: "src/components/CompilePaneStatus.tsx", needle: "bg-neutral-900/85 text-white/90", what: "compile-running chip" },
  { file: "src/app/globals.css", needle: ".label-ref-popover {", what: "label-ref popover" },
  { file: "src/app/globals.css", needle: ".label-ref-popover-dropdown {", what: "label-ref dropdown" },
  { file: "src/app/globals.css", needle: ".math-popover {", what: "math popover" },
  { file: "src/app/globals.css", needle: ".figure-popover {", what: "figure popover" },
  { file: "src/app/globals.css", needle: ".menu-surface {", what: "every MenuProvider menu" },
  { file: "library/components/Toaster.tsx", needle: "borderLeft: `3px solid ${accent}`,", what: "toast" },
  { file: "src/components/SelectionActionsMenu.tsx", needle: "zIndex: RESTING_MARGIN_TRIGGER_Z,", what: "floating zap trigger" },
  { file: "src/components/stack/StackIcon.tsx", needle: "const boxShadow = illuminated", what: "portaled stack pill" },
  { file: "library/styles/library.css", needle: ".page-scroll-lozenge {", what: "Library page-number lozenge" },
];

/**
 * The in-flow chips / sticky headers the guide enumerates — each takes the
 * ONE in-flow rung, `--card-shadow-ambient` (they sit among cards).
 */
export const IN_FLOW_SURFACES: ReadonlyArray<{ file: string; needle: string; what: string }> = [
  { file: "src/panels/Omni/OmniViewPanel.tsx", needle: "sticky top-0 z-30 mx-2 mb-2", what: "Omni pending navigator (sticky header)" },
  { file: "src/app/globals.css", needle: ".omni-bin-pill {", what: ".omni-bin-pill" },
  { file: "src/panels/Outline/OutlinePanel.tsx", needle: "cursor-grab active:cursor-grabbing ${", what: "outline pod chip" },
];

const AMBIENT_RUNG = /var\(--(?:pod-shadow|card-shadow-ambient)\)/;

/** Annotated exceptions to the derived positioned-surface leg. */
const POSITIONED_ALLOWLIST: ReadonlyArray<{ file: string; needle: string; why: string }> = [
  {
    file: "src/components/FloatingPanel.tsx",
    needle: 'surface === "card"',
    why: "a POPPED card is still a card: it keeps the card tier's ambient lift (task 1246); a whole-panel float reads --shadow-float",
  },
];

/**
 * Positioned (`absolute` / `fixed`) surfaces whose box-shadow reads an ambient
 * rung. `sticky` is not floating — a sticky header is in-flow.
 */
export function scanPositionedAmbient(src: string, file: string): Array<{ line: number; decl: string }> {
  const out: Array<{ line: number; decl: string }> = [];
  const text = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const lineOf = (i: number) => text.slice(0, i).split("\n").length;
  if (file.endsWith(".css")) {
    for (const m of text.matchAll(/\{([^{}]*)\}/g)) {
      if (!/(^|[;\s])position\s*:\s*(?:absolute|fixed)\b/.test(m[1])) continue;
      const bs = /box-shadow\s*:([^;]*)/.exec(m[1]);
      if (bs && AMBIENT_RUNG.test(bs[1])) out.push({ line: lineOf(m.index! + 1 + bs.index), decl: bs[0].replace(/\s+/g, " ") });
    }
    return out;
  }
  for (const m of text.matchAll(/boxShadow\s*:/g)) {
    // The enclosing object literal: back to the unmatched `{`, on to its `}`.
    let start = m.index!;
    for (let d = 0; start >= 0; start--) {
      if (text[start] === "}") d++;
      else if (text[start] === "{" && d-- === 0) break;
    }
    let end = m.index!;
    for (let d = 0; end < text.length; end++) {
      if (text[end] === "{") d++;
      else if (text[end] === "}" && d-- === 0) break;
    }
    const obj = text.slice(start, end + 1);
    if (!/position\s*:\s*["'](?:absolute|fixed)["']/.test(obj)) continue;
    // The value runs to the next property (`,` + newline + key) or the object's end.
    const rest = text.slice(m.index!, end);
    const next = rest.search(/,\s*\n\s*[\w"']+\s*:/);
    const decl = next < 0 ? rest : rest.slice(0, next);
    if (AMBIENT_RUNG.test(decl)) out.push({ line: lineOf(m.index!), decl: decl.replace(/\s+/g, " ") });
  }
  return out;
}

const STATE_COND = String.raw`[\w.!]*(?:active|selected|checked|pressed|current|hover\w*|focus\w*|expanded|open)\w*`;
const STR = String.raw`"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\`(?:[^\`\\]|\\.)*\``;
const STATE_TERNARY = new RegExp(String.raw`(${STATE_COND})\s*\)?\s*\?\s*(${STR})\s*:\s*(${STR})`, "gi");
const ELEVATION_READ = /--(?:pod-shadow|card-shadow-ambient|menu-shadow|shadow-float)\b/;

/** A state-keyed ternary whose two branches differ in an elevation read. */
export function scanStateKeyedElevation(src: string): Array<{ line: number; cond: string }> {
  const out: Array<{ line: number; cond: string }> = [];
  for (const m of src.matchAll(STATE_TERNARY)) {
    if (ELEVATION_READ.test(m[2]) !== ELEVATION_READ.test(m[3])) {
      out.push({ line: src.slice(0, m.index).split("\n").length, cond: m[1] });
    }
  }
  return out;
}

const SHADOW_DECL = /boxShadow\s*[:=]|box-shadow\s*:|shadow-\[/;
export function floatingSurfaceRung(src: string, needle: string): { count: number; decl: string | null } {
  const lines = src.split("\n");
  const at = lines.flatMap((l, i) => (l.includes(needle) ? [i] : []));
  if (at.length !== 1) return { count: at.length, decl: null };
  const isCssRule = needle.trimEnd().endsWith("{");
  for (let i = at[0]; i < Math.min(lines.length, at[0] + 30); i++) {
    const l = lines[i];
    const hit = SHADOW_DECL.exec(l);
    if (hit) {
      // The declaration may wrap (CSS `box-shadow:\n  ring,\n  var(--menu-shadow);`).
      let decl = l.slice(hit.index);
      for (let j = i + 1; j < lines.length && !/;|"[^"]*"|\]/.test(decl) && j < i + 4; j++) decl += " " + lines[j].trim();
      return { count: 1, decl };
    }
    if (isCssRule && i > at[0] && l.includes("}")) break;
  }
  return { count: 1, decl: null };
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === "__tests__" || ent.name.startsWith(".")) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, acc);
    else if (EXTS.has(path.extname(ent.name)) && !/\.(test|spec)\.tsx?$/.test(ent.name)) acc.push(p);
  }
  return acc;
}

describe("shadow-tier census (task 818)", () => {
  it("every shadow in the tree is a tier token, a ring, an inset, or annotated", () => {
    const offenders: string[] = [];
    const usedAllow = new Set<number>();
    for (const dir of SCAN_DIRS) {
      for (const abs of walk(path.join(ROOT, dir))) {
        const rel = path.relative(ROOT, abs).split(path.sep).join("/");
        const src = fs.readFileSync(abs, "utf8");
        const srcLines = src.split("\n");
        for (const v of scanShadowSource(src, rel)) {
          const ai = ALLOWLIST.findIndex((a) => a.file === rel && srcLines[v.line - 1].includes(a.needle));
          if (ai >= 0) {
            usedAllow.add(ai);
            continue;
          }
          offenders.push(`${rel}:${v.line} [${v.kind}] ${v.text}`);
        }
      }
    }
    expect(offenders, "put the shadow on its tier token (STYLE_GUIDE elevation paragraph)").toEqual([]);
    // A stale exception is an unguarded hole: every entry must still match.
    const stale = ALLOWLIST.filter((_, i) => !usedAllow.has(i)).map((a) => `${a.file} (${a.needle})`);
    expect(stale, "remove allowlist entries that no longer match").toEqual([]);
  });

  it("no shadow token is read with a fallback (dead — :root defines it — and driftable)", () => {
    const tokens = definedShadowTokens(fs.readFileSync(GLOBALS_CSS, "utf8"));
    expect(tokens.has("--menu-shadow") && tokens.has("--card-shadow-ambient")).toBe(true);
    const offenders: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const abs of walk(path.join(ROOT, dir))) {
        const rel = path.relative(ROOT, abs).split(path.sep).join("/");
        for (const v of scanDeadShadowFallbacks(fs.readFileSync(abs, "utf8"), tokens)) {
          offenders.push(`${rel}:${v.line} var(${v.token}, …)`);
        }
      }
    }
    expect(offenders, "read the bare token: var(--tok)").toEqual([]);
  });

  it("no ring wears a hand-picked colour (read a colour token or --focus-ring-shadow)", () => {
    const offenders: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const abs of walk(path.join(ROOT, dir))) {
        const rel = path.relative(ROOT, abs).split(path.sep).join("/");
        for (const line of scanRawRingColours(fs.readFileSync(abs, "utf8"))) offenders.push(`${rel}:${line}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every enumerated floating chip/popover reads the MENU rung", () => {
    const problems: string[] = [];
    for (const s of FLOATING_SURFACES) {
      const { count, decl } = floatingSurfaceRung(fs.readFileSync(path.join(ROOT, s.file), "utf8"), s.needle);
      if (count !== 1) problems.push(`${s.what} — ${s.file}: needle matched ${count}× (re-anchor it)`);
      else if (!decl) problems.push(`${s.what} — ${s.file}: no shadow declaration near the needle`);
      else if (!decl.includes("var(--menu-shadow)")) problems.push(`${s.what} — ${s.file}: ${decl.trim()}`);
    }
    expect(problems, "a floating chip takes --menu-shadow (STYLE_GUIDE elevation paragraph)").toEqual([]);
  });

  it("every enumerated in-flow chip / sticky header reads the ONE in-flow rung", () => {
    const problems: string[] = [];
    for (const s of IN_FLOW_SURFACES) {
      const { count, decl } = floatingSurfaceRung(fs.readFileSync(path.join(ROOT, s.file), "utf8"), s.needle);
      if (count !== 1) problems.push(`${s.what} — ${s.file}: needle matched ${count}× (re-anchor it)`);
      else if (!decl) problems.push(`${s.what} — ${s.file}: no shadow declaration near the needle`);
      else if (!decl.includes("var(--card-shadow-ambient)")) problems.push(`${s.what} — ${s.file}: ${decl.trim()}`);
    }
    expect(problems, "an in-flow chip takes --card-shadow-ambient (STYLE_GUIDE elevation paragraph)").toEqual([]);
  });

  it("no positioned (absolute/fixed) surface floats on an ambient rung (derived)", () => {
    const offenders: string[] = [];
    const usedAllow = new Set<number>();
    for (const dir of SCAN_DIRS) {
      for (const abs of walk(path.join(ROOT, dir))) {
        const rel = path.relative(ROOT, abs).split(path.sep).join("/");
        for (const v of scanPositionedAmbient(fs.readFileSync(abs, "utf8"), rel)) {
          const ai = POSITIONED_ALLOWLIST.findIndex((a) => a.file === rel && v.decl.includes(a.needle));
          if (ai >= 0) {
            usedAllow.add(ai);
            continue;
          }
          offenders.push(`${rel}:${v.line} ${v.decl}`);
        }
      }
    }
    expect(offenders, "a floating surface takes --menu-shadow (chip/popover) or --shadow-float (panel)").toEqual([]);
    const stale = POSITIONED_ALLOWLIST.filter((_, i) => !usedAllow.has(i)).map((a) => `${a.file} (${a.needle})`);
    expect(stale, "remove allowlist entries that no longer match").toEqual([]);
  });

  it("no elevation is keyed on a state (selection/hover/open never lifts)", () => {
    const offenders: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const abs of walk(path.join(ROOT, dir))) {
        if (abs.endsWith(".css")) continue;
        const rel = path.relative(ROOT, abs).split(path.sep).join("/");
        for (const v of scanStateKeyedElevation(fs.readFileSync(abs, "utf8"))) offenders.push(`${rel}:${v.line} (${v.cond} ? …)`);
      }
    }
    expect(offenders, "elevation is a property of the tier, never of a state — swap bg/border or ring instead").toEqual([]);
  });

  describe("guard reach (planted fixtures)", () => {
    const hits = (src: string, file = "x.tsx") => scanShadowSource(src, file).map((v) => v.kind);

    it("fails a reintroduced Tailwind elevation utility", () => {
      expect(hits('<div className="rounded-md bg-surface shadow-lg" />')).toEqual(["tailwind-utility"]);
      expect(hits('const c = "px-2 shadow flex";')).toEqual(["tailwind-utility"]);
      expect(hits("const c = `a ${x ? \"hover:shadow-md\" : \"\"}`;")).toContain("tailwind-utility");
      expect(hits('const c = "shadow-[0_1px_2px_rgba(0,0,0,0.04)]";')).toEqual(["tailwind-utility"]);
    });

    it("fails a literal elevation layer in TS and CSS", () => {
      expect(hits('style={{ boxShadow: "0 2px 10px rgba(0,0,0,0.16), var(--drag-ring-faint)" }}')).toEqual(["literal-layer"]);
      expect(hits(".x {\n  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);\n}", "x.css")).toEqual(["literal-layer"]);
      expect(hits(".x {\n  box-shadow:\n    0 0 0 2px red,\n    0 4px 16px rgba(0,0,0,.12);\n}", "x.css")).toEqual(["literal-layer"]);
      // A token branch does not immunize a literal beside it.
      expect(hits('const s = on ? "var(--menu-shadow)" : "0 1px 3px rgba(0,0,0,0.15)";')).toEqual(["literal-layer"]);
    });

    it("passes tier reads, rings, insets, token definitions and comments", () => {
      expect(hits('<div className="shadow-[var(--menu-shadow)] shadow-inner shadow-none" />')).toEqual([]);
      expect(hits('const s = { boxShadow: "var(--card-shadow-ambient, 0 2px 6px rgba(0,0,0,0.10))" };')).toEqual([]);
      expect(hits('const s = { boxShadow: "0 0 0 4px rgba(37, 99, 235, 0.18)" };')).toEqual([]);
      expect(hits('const s = { boxShadow: "inset 0 1px 2px rgba(0,0,0,0.2)" };')).toEqual([]);
      expect(hits(":root {\n  --shadow-float: 0 6px 16px rgba(0,0,0,0.10),\n    0 1px 3px rgba(0,0,0,0.06);\n}", "x.css")).toEqual([]);
      expect(hits("// was `shadow-lg` and 0 4px 16px rgba(0,0,0,.1)\n/* shadow-md */")).toEqual([]);
    });

    it("fails a dead fallback on a defined shadow token, passes the bare read", () => {
      const toks = definedShadowTokens(":root {\n  --card-shadow-ambient: 0 2px 6px rgba(0,0,0,.1);\n}");
      expect(scanDeadShadowFallbacks('boxShadow: "var(--card-shadow-ambient, 0 2px 6px rgba(0,0,0,0.10))"', toks)).toHaveLength(1);
      expect(scanDeadShadowFallbacks('boxShadow: "var(--card-shadow-ambient)"', toks)).toEqual([]);
      expect(scanDeadShadowFallbacks('color: "var(--ink, #000)"', toks)).toEqual([]);
    });

    it("fails a raw ring colour, passes a token ring", () => {
      expect(scanRawRingColours('const s = "0 0 0 4px rgba(37, 99, 235, 0.18), var(--menu-shadow)";')).toEqual([1]);
      expect(scanRawRingColours(".x:focus {\n  box-shadow: 0 0 0 2px #7c5e3c;\n}")).toEqual([2]);
      expect(scanRawRingColours('const s = "0 0 0 4px color-mix(in srgb, var(--accent-blue) 18%, transparent)";')).toEqual([]);
      expect(scanRawRingColours(":root {\n  --ring: 0 0 0 2px rgba(0,0,0,.2);\n}")).toEqual([]);
    });

    it("the floating-rung leg reads the declaration nearest the needle", () => {
      const tsx = 'style={{\n  zIndex: Z,\n  boxShadow: "var(--pod-shadow)",\n}}';
      expect(floatingSurfaceRung(tsx, "zIndex: Z,").decl).toContain("--pod-shadow");
      expect(floatingSurfaceRung(".pop {\n  color: red;\n  box-shadow:\n    var(--menu-shadow);\n}", ".pop {").decl).toContain("var(--menu-shadow)");
      expect(floatingSurfaceRung(".pop {\n  color: red;\n}\n.next { box-shadow: var(--menu-shadow); }", ".pop {").decl).toBeNull();
      expect(floatingSurfaceRung("a\na", "a").count).toBe(2);
    });

    it("the derived positioned leg fails an ambient rung on a floating surface, passes in-flow and menu reads", () => {
      expect(scanPositionedAmbient(".l {\n  position: absolute;\n  box-shadow: var(--pod-shadow);\n}", "x.css")).toHaveLength(1);
      expect(scanPositionedAmbient(".l {\n  position: fixed;\n  box-shadow: var(--menu-shadow);\n}", "x.css")).toEqual([]);
      expect(scanPositionedAmbient(".l {\n  position: sticky;\n  box-shadow: var(--card-shadow-ambient);\n}", "x.css")).toEqual([]);
      expect(scanPositionedAmbient('const s = {\n  position: "absolute",\n  boxShadow: "var(--pod-shadow)",\n};', "x.tsx")).toHaveLength(1);
      expect(scanPositionedAmbient('const s = {\n  position: "relative",\n  boxShadow: "var(--card-shadow-ambient)",\n};', "x.tsx")).toEqual([]);
      expect(scanPositionedAmbient('const s = {\n  position: "fixed",\n  boxShadow: "var(--drag-glow-line)",\n};', "x.tsx")).toEqual([]);
    });

    it("the state leg fails a selected row that lifts, passes a kind switch and a symmetric ternary", () => {
      expect(scanStateKeyedElevation('cls = active\n  ? "bg-surface shadow-[var(--card-shadow-ambient)]"\n  : "bg-transparent";')).toHaveLength(1);
      expect(scanStateKeyedElevation('cls = isHovered ? "" : "shadow-[var(--menu-shadow)]";')).toHaveLength(1);
      expect(scanStateKeyedElevation('cls = isParTitle ? "border" : "border shadow-[var(--card-shadow-ambient)]";')).toEqual([]);
      expect(scanStateKeyedElevation('s = selected ? "var(--menu-shadow), 0 0 0 2px var(--accent)" : "var(--menu-shadow)";')).toEqual([]);
    });
  });
});

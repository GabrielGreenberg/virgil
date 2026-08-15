// Accent-bypass guardrail (task 175) — the CI half of the "a rendered
// component must derive its accent live" contract. Same source-grep-allowlist
// discipline as the keystroke-sanctity / scroll-reposition / pane-drag laws.
//
// THE LAW
// -------
// Several tables in this codebase are `Object.fromEntries` folds over
// `DEFAULT_PANEL_COLORS` evaluated ONCE at module load:
//
//   • `CARD_THEMES`  (components/panel-primitives.tsx) — per-kind card theme
//   • `SCOPE_COLOR`  (lib/search-sources.ts)           — per-search-scope accent
//
// They are **override-blind by construction** — a user color change bumps the
// `panel-theme` store's version, but a frozen object can never re-derive, so any
// component holding one renders the SHIPPED default forever.
//
// The correct read for a rendered component is a version-subscribed hook:
// `useCardTheme(key)` / `usePanelColor(key)` / `useAllPanelColors()`
// (`hooks/usePanelTheme.ts`), each wired through `useSyncExternalStore` to the
// override version counter. These tables stay as the shipped-default SSOT that
// those hooks and the drift-pin tests derive from — they are not deleted, just
// off-limits to rendered components.
//
// The one legitimate exception is a `SYSTEM_THEME_KEYS` accent
// (`aiRequest`/`error`): `setPanelColor`/`loadPanelColors` refuse those keys, so
// there is no override for a frozen read to miss.
//
// WHY THIS EXISTS
// ---------------
// `panels/Todo/TodoRow.tsx` bound `const theme = CARD_THEMES.todo` at MODULE
// scope, making the docked Todo card family the single theme-blind card family
// in the app: setting "Todo color" → Purple re-tinted the todo margin marker,
// the in-text anchor, and the popped-out float (all three resolve through the
// override-aware path) while the docked card kept the shipped stone.
//
// `panels/Search/SearchPanel.tsx` had the SAME bug twice over (`SCOPE_COLOR`
// for the scope dot / result border, `CARD_THEMES[...]` for the result card) —
// and it was missed by the audit that filed this task because the file
// contained raw NUL bytes, which made `grep` treat it as binary and skip it
// silently. THIS test reads files with `readFileSync`, so it sees them anyway.
// That is the point of a guard with teeth: greps lie, allowlists don't.
//
// THE SECOND LAW (task 178) — no per-kind colour vocabulary outside the theme
// ---------------------------------------------------------------------------
// The first law governs a component that READS the wrong table. Task 178 was a
// component that DECLARED one: `AIWindow`'s `KIND_META` carried `chipBg`/
// `chipFg` hex literals per request kind — the second per-kind colour
// vocabulary in the app, agreeing with no panel theme, subscribing to no
// override, and (independent of any override) shipping a straight inversion:
// the Todo chip wore `#15803d`, byte-identical to the NOTE accent, while the
// Note chip wore a blue belonging to no kind at all. A user who has learned the
// colour language of the margin read the inbox wrong.
//
// The first law could not have caught it, because a hand-rolled table reads
// nothing. So the second law is about DECLARATIONS: a record keyed by a KIND
// vocabulary must not carry a colour literal. One accent per kind, in
// `panel-theme`, derived at the point of paint — that is the whole reason a
// single colour picker can retint an entire kind.
//
// Reach, stated honestly, in three parts:
//   • KEY — the detector keys on a `Record<…Kind, …>` type annotation, which is
//     what makes the "this is a KIND vocabulary" claim checkable. A colour table
//     keyed by something else — a STATUS (`AIWindow`'s `STATUS_META`), a
//     collaborator state (`CollabStatusPill`'s `DOT_COLORS`, retired by task
//     315 — that whole class now answers to `status-dot-ssot.test.ts`), a
//     `Record<string, string>` — is invisible to it and is a different question
//     (those are state vocabularies, not kind vocabularies). Type-alias,
//     `satisfies` and interface-typed indirections evade the annotation too;
//     they are bypasses a reviewer must catch, not ones this grep can.
//   • VALUE — `COLOR_LITERAL` covers hex, the `rgb()/hsl()/oklch()` function
//     family, and the Tailwind palette class form. NOT bare CSS colour names:
//     a bare word can't be told from a value that merely reads like one
//     (`severity: "red"`), and a guard that fails a correct file trains people
//     to distrust it.
//   • SILO — both `src/` and `library/` are censused, each with its own
//     allowlist (the library twin deliberately empty), as every sibling law
//     does. A one-silo census is how ungoverned sites accumulate.

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { SYSTEM_THEME_KEYS, type PanelThemeKey } from "@/lib/panel-theme";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../.."); // src/
const LIBRARY = path.resolve(SRC, "../library"); // the library silo

/** The frozen shipped-defaults tables, each mapped to the file that DEFINES it
 *  (exempt by construction — that's where the fold legitimately lives). */
const FROZEN_TABLES: Record<string, string> = {
  CARD_THEMES: "components/panel-primitives.tsx",
  SCOPE_COLOR: "lib/search-sources.ts",
};

// ── The permitted non-hook reader allowlist ────────────────────────────────
// A runtime read of a frozen table from app source is permitted ONLY when the
// key is provably a system accent. Each entry carries its why-safe
// justification — same discipline as the other guardrail allowlists. A new
// entry here must name a `SYSTEM_THEME_KEYS` member; anything else means a
// component is about to ship an override-blind accent.
const PERMITTED_FROZEN_TABLE_READERS: Record<string, string> = {
  "panels/Errors/ErrorCard.tsx":
    "`CARD_THEMES.error` — `error` is a SYSTEM_THEME_KEYS accent (non-overridable), so the frozen fold IS the live value.",
  "panels/Omni/OmniViewPanel.tsx":
    "`CARD_THEMES.error` on the orphaned badge — same system-accent rationale as ErrorCard.",
};

// ── The permitted kind-keyed colour-table allowlist (second law) ───────────
// Keyed `<file>::<declaration>`, one allowlist per silo (the library twin is
// deliberately empty — same shape as every sibling law). An entry must say why
// the colour is not a paint decision that belongs to `panel-theme` — and the
// ONLY such reason so far is "nothing paints from it," which is a fact with an
// expiry date, pinned by its own test below.
// EMPTY, and that is the point. Its one entry was `LINK_REGISTRY.connectorStroke`
// — declared-but-inert stroke colours for a connector component that had already
// been hard-deleted. Task 178 wrote "the moment a connector renderer is built
// this entry must GO, not grow"; task 202 found the whole table was dead and
// deleted it, so the entry went the other way. The test below pins the deletion.
const PERMITTED_KIND_KEYED_COLOR_TABLES: Record<string, string> = {};
const PERMITTED_LIBRARY_KIND_KEYED_COLOR_TABLES: Record<string, string> = {};

/** Colour LITERALS, in every dialect this repo actually paints in: hex,
 *  `rgb()/rgba()`, `hsl()/hsla()`, the modern CSS colour functions, and the
 *  Tailwind palette class form the pre-`panel-theme` `CARD_THEMES` was written
 *  in (`bg-green-700`) — which is the dialect a re-introduction is most likely
 *  to arrive in, since that is the one this table family originally used.
 *
 *  Deliberately NOT here: CSS named colours (`forestgreen`). A bare word cannot
 *  be told from a value that merely reads like one (`severity: "red"`), and a
 *  guard that fails a correct file trains people to distrust it — the lesson
 *  this file's own comment-stripper carries. */
const COLOR_LITERAL =
  /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\s*\(|\b(?:bg|text|border|ring|from|via|to|fill|stroke|decoration|outline|shadow|accent|caret|divide|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/;

/** Index of the `>` matching the `<` at `from`, or -1. `=>` is not a closer. */
function matchAngle(text: string, from: number): number {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === "<") depth++;
    else if (c === ">") {
      if (text[i - 1] === "=") continue; // an arrow inside the generic
      if (--depth === 0) return i;
    }
  }
  return -1;
}

/** The object literal starting at `open`, or null if it doesn't close.
 *
 *  String literals are skipped so a brace inside one can't unbalance the scan —
 *  but a `'` is only treated as a string opener in EXPRESSION position, because
 *  in a `.tsx` body the commonest apostrophe is JSX prose ("don't"), and reading
 *  that as an opener would run the scan to EOF and hand a later declaration's
 *  colours to this one. An unclosed scan returns null rather than the file tail:
 *  a body this can't parse is reported as nothing, never as a violation. */
function balancedObject(text: string, open: number): string | null {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "`" || (c === "'" && /[:,([={|?\s]/.test(text[i - 1] ?? ""))) {
      const quote = c;
      let closed = false;
      for (i++; i < text.length; i++) {
        if (text[i] === "\\") { i++; continue; }
        if (text[i] === quote) { closed = true; break; }
      }
      if (!closed) return null;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return text.slice(open, i + 1);
  }
  return null;
}

/** Every `const NAME: Record<…Kind, …> = { … }` declaration in a file, with its
 *  balanced object-literal body. Comments are already stripped by the caller,
 *  so a hex mentioned in prose is not a hit.
 *
 *  The initializer is ANCHORED to the declaration: the generic is walked to its
 *  matching `>` and the body must begin immediately after it. An earlier version
 *  searched forward for the next `= {` within 400 chars, which slid past a
 *  declaration whose initializer is not an object literal (`Record<CardKind, …>
 *  = Object.fromEntries(…)` — four live instances) and attributed the NEXT
 *  declaration's body to it: a false CI failure naming a table that carries no
 *  colour at all. */
function kindKeyedRecords(text: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  const head = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*:\s*Record\s*</g;
  for (const m of text.matchAll(head)) {
    const lt = m.index! + m[0].length - 1;
    const gt = matchAngle(text, lt);
    if (gt < 0) continue;

    // The KEY type is the generic's first top-level argument. A vocabulary
    // named `…Kind` is what makes "this is a per-kind table" checkable.
    const generic = text.slice(lt + 1, gt);
    let d = 0;
    let cut = generic.length;
    for (let i = 0; i < generic.length; i++) {
      const c = generic[i];
      if (c === "<" || c === "(" || c === "{" || c === "[") d++;
      else if (c === ">" || c === ")" || c === "}" || c === "]") d--;
      else if (c === "," && d === 0) { cut = i; break; }
    }
    if (!/\w*Kind\b/.test(generic.slice(0, cut))) continue;

    const init = /^\s*=\s*\{/.exec(text.slice(gt + 1));
    if (!init) continue; // not an object-literal initializer — nothing to read
    const body = balancedObject(text, gt + init[0].length);
    if (body != null) out.push({ name: m[1], body });
  }
  return out;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".next-")) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__") continue; // tests may pin the frozen tables on purpose
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Strip comments and type-only usage.
 *
 *  Trailing `//` comments are stripped too, not just full-line ones — the
 *  comment a developer writes while DOING this migration is exactly
 *  `useCardTheme("todo"); // was CARD_THEMES.todo`, and failing CI on a
 *  correct file would train people to distrust the guard. The `(?<!:)` guard
 *  keeps `https://` URLs intact.
 *
 *  A type-level `typeof CARD_THEMES` (e.g. `panel-registry.ts`'s `ThemeKey`)
 *  is erased at build and reads no color, so it is not a bypass. */
function runtimeText(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(?<!:)\/\/.*$/gm, "")
    .split("\n")
    .filter((l) => !/^\s*import\s+type\b/.test(l))
    .filter((l) => !/\btypeof\s+(CARD_THEMES|SCOPE_COLOR)\b/.test(l))
    .join("\n");
}

/** Every violation this file commits against one frozen table. */
function violationsFor(rel: string, text: string, table: string): string[] {
  const found: string[] = [];
  if (!new RegExp(`\\b${table}\\b`).test(text)) return found;

  // An ALIASED or re-bound import defeats static key analysis entirely
  // (`import { CARD_THEMES as T }`, `const T = CARD_THEMES`, `const { todo } =
  // CARD_THEMES`). Treat the indirection itself as the violation.
  if (new RegExp(`\\b${table}\\s+as\\s+\\w+`).test(text)) {
    found.push(`${rel}: aliases ${table} on import — the key can't be checked; read the live hook instead`);
  }
  if (new RegExp(`(?:const|let|var)\\s*(?:\\{[^}]*\\}|\\w+)\\s*=\\s*${table}\\s*[;\\n]`).test(text)) {
    found.push(`${rel}: re-binds ${table} to a local — the key can't be checked; read the live hook instead`);
  }

  // Dotted reads: CARD_THEMES.todo
  for (const m of text.matchAll(new RegExp(`\\b${table}\\.([A-Za-z_$][\\w$]*)`, "g"))) {
    const key = m[1] as PanelThemeKey;
    if (!SYSTEM_THEME_KEYS.has(key)) {
      found.push(
        `${rel}: reads ${table}.${key} — '${key}' is user-overridable; use useCardTheme("${key}")`,
      );
    }
  }

  // Computed reads: CARD_THEMES[expr] — the key isn't statically knowable, so
  // it can't be proven system-only. Always a violation.
  if (new RegExp(`\\b${table}\\s*\\[`).test(text)) {
    found.push(
      `${rel}: computed ${table}[...] read — the key can't be proven system-only; use a live hook`,
    );
  }
  return found;
}

describe("accent-bypass guardrail — the frozen colour tables are defaults-only", () => {
  const files = walk(SRC);
  const libraryFiles = walk(LIBRARY);

  it("no rendered app source reads a frozen colour table for a user-overridable kind", () => {
    const violations: string[] = [];

    for (const file of files) {
      const rel = path.relative(SRC, file).split(path.sep).join("/");
      const text = runtimeText(readFileSync(file, "utf8"));
      for (const [table, definingFile] of Object.entries(FROZEN_TABLES)) {
        if (rel === definingFile) continue;
        violations.push(...violationsFor(rel, text, table));
      }
    }

    // `rel` is a POSIX path with no colons, so the first segment IS the file.
    const unlisted = violations.filter(
      (v) => !PERMITTED_FROZEN_TABLE_READERS[v.split(":")[0]],
    );

    expect(
      unlisted,
      "A rendered component is reading an override-blind colour table for a user-overridable kind. " +
        'Swap it for a version-subscribed hook — useCardTheme("<key>") / usePanelColor / useAllPanelColors ' +
        "(src/hooks/usePanelTheme.ts). See the law at the top of this file.",
    ).toEqual([]);
  });

  it("every allowlisted frozen reader still exists and still reads ONLY a system accent", () => {
    for (const [rel, why] of Object.entries(PERMITTED_FROZEN_TABLE_READERS)) {
      const text = runtimeText(readFileSync(path.join(SRC, rel), "utf8"));
      const keys = [...text.matchAll(/\bCARD_THEMES\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);

      expect(keys.length, `${rel} no longer reads a frozen table — drop it from the allowlist`).toBeGreaterThan(0);
      for (const k of keys) {
        expect(
          SYSTEM_THEME_KEYS.has(k as PanelThemeKey),
          `${rel} reads CARD_THEMES.${k}, which is NOT a system accent. Justification on file: ${why}`,
        ).toBe(true);
      }
      // The file-keyed allowlist must not become a blanket pass: a computed
      // read here would be suppressed by test 1, so assert its absence.
      for (const table of Object.keys(FROZEN_TABLES)) {
        expect(
          new RegExp(`\\b${table}\\s*\\[`).test(text),
          `${rel} is allowlisted for a system-accent DOTTED read, but now does a computed ${table}[...] read`,
        ).toBe(false);
      }
    }
  });

  it("the two repaired surfaces derive through the hooks", () => {
    const todo = readFileSync(path.join(SRC, "panels/Todo/TodoRow.tsx"), "utf8");
    expect(todo).toMatch(/useCardTheme\("todo"\)/);
    expect(runtimeText(todo)).not.toMatch(/\bCARD_THEMES\b/);

    const search = readFileSync(path.join(SRC, "panels/Search/SearchPanel.tsx"), "utf8");
    expect(search).toMatch(/useScopeAccent/);
    expect(search).toMatch(/useCardTheme\(SCOPE_TO_CARD_THEME\[/);
    expect(runtimeText(search)).not.toMatch(/\b(CARD_THEMES|SCOPE_COLOR)\b/);
  });

  it("the comment-stripper does not fail a correct file that MENTIONS the table", () => {
    // Regression pin for the guard itself: the migration comment must be safe.
    const correct = [
      'const theme = useCardTheme("todo"); // was CARD_THEMES.todo',
      "// see CARD_THEMES[key] for the shipped default",
      "/* CARD_THEMES.note is the frozen fold */",
    ].join("\n");
    expect(violationsFor("fake.tsx", runtimeText(correct), "CARD_THEMES")).toEqual([]);
  });

  it.each([
    ["src", SRC, files, PERMITTED_KIND_KEYED_COLOR_TABLES],
    ["library", LIBRARY, libraryFiles, PERMITTED_LIBRARY_KIND_KEYED_COLOR_TABLES],
  ] as const)(
    "no kind-keyed record in %s carries a colour literal",
    (_silo, root, siloFiles, allowlist) => {
      const violations: string[] = [];

      for (const file of siloFiles) {
        const rel = path.relative(root, file).split(path.sep).join("/");
        if (rel === "lib/panel-theme.ts") continue; // the SSOT itself
        for (const { name, body } of kindKeyedRecords(runtimeText(readFileSync(file, "utf8")))) {
          if (!COLOR_LITERAL.test(body)) continue;
          const key = `${rel}::${name}`;
          if (allowlist[key]) continue;
          violations.push(
            `${key} maps a kind to a colour literal — that is a second per-kind colour ` +
              `vocabulary. Carry a PanelThemeKey (read off CARD_REGISTRY[...].themeKey) and ` +
              `derive the colour at paint time via useCardTheme / usePanelCardPalette.`,
          );
        }
      }

      // A silo that silently scans nothing is a guard with no teeth (a moved
      // directory would look exactly like compliance).
      expect(siloFiles.length, `the ${_silo} census scanned no files`).toBeGreaterThan(50);
      expect(violations, "See THE SECOND LAW at the top of this file.").toEqual([]);
    },
  );

  it("no connector stroke palette exists to be painted from (task 178 → 202)", () => {
    // 178 allowlisted `LINK_REGISTRY.connectorStroke` on the strength of
    // "nothing paints from it" — a fact about the repo with an expiry date.
    // 202 collected: the table it lived on declared connector styles for a
    // component deleted in 96675ca1, a multiplicity rule nothing enforced, and
    // a card-kind mapping decided elsewhere, so the whole table went. Checked
    // in BOTH silos (`library/` reaches `src/` through the `@/` alias): a
    // connector renderer may absolutely be built, but its colour comes from
    // `useCardTheme(CARD_REGISTRY[cardKind].themeKey)`, never from a per-kind
    // stroke table reinstated here.
    const declarers = [
      ...files.map((f) => ["src", path.relative(SRC, f).split(path.sep).join("/"), f] as const),
      ...libraryFiles.map((f) => ["library", path.relative(LIBRARY, f).split(path.sep).join("/"), f] as const),
    ]
      .filter(([, , full]) => /\bconnectorStroke\b/.test(runtimeText(readFileSync(full, "utf8"))))
      .map(([silo, rel]) => `${silo}/${rel}`);

    expect(
      declarers,
      "`connectorStroke` is back. A connector's colour must derive from " +
        "useCardTheme(CARD_REGISTRY[cardKind].themeKey) at paint time, not from a " +
        "per-kind stroke table — see THE SECOND LAW at the top of this file.",
    ).toEqual([]);

    // And the dead SSOT it hung on stays retired.
    expect(
      existsSync(path.join(SRC, "links/link-registry.ts")),
      "src/links/link-registry.ts is back — it was deleted in task 202 as a " +
        "registry nothing read; the live half is src/links/link-dom-contract.ts.",
    ).toBe(false);
  });

  it("the AI-request inbox declares labels, not colours (task 178)", () => {
    const src = readFileSync(path.join(SRC, "components/AIWindow.tsx"), "utf8");
    const table = src.slice(src.indexOf("const KIND_META"), src.indexOf("const STATUS_META"));

    expect(table, "KIND_META still declares chip colours").not.toMatch(/chip(Bg|Fg)/);
    expect(table, "KIND_META still carries a colour literal").not.toMatch(COLOR_LITERAL);
    // The themeKey is READ off the registry, not restated — so a kind re-themed
    // in CARD_REGISTRY re-tints its chip for free.
    expect(table).toMatch(/themeKey: CARD_REGISTRY/);
    expect(src).toMatch(/usePanelCardPalette\(/);
  });

  /** Does the detector flag this source? (the second law, end to end) */
  function flags(src: string): boolean {
    return kindKeyedRecords(runtimeText(src)).some((r) => COLOR_LITERAL.test(r.body));
  }

  it("the kind-keyed detector catches the colour DIALECTS a re-introduction arrives in", () => {
    // The law is "no colour literal", not "no hex" — the retired table family
    // was originally written in Tailwind classes, so hex-only would have missed
    // its own most likely resurrection.
    for (const value of [
      '"#15803d"',
      '"rgb(21, 128, 61)"',
      '"rgba(21,128,61,.12)"',
      '"hsl(142 72% 29%)"',
      '"oklch(52% .13 150)"',
      '"bg-green-700"',
      '"text-emerald-50"',
    ]) {
      expect(
        flags(`const CHIP: Record<AIRequestKind, { bg: string }> = { "panel-todo": { bg: ${value} } };`),
        `dialect ${value} slipped past the second law`,
      ).toBe(true);
    }
  });

  it("the kind-keyed detector does NOT flag correct code (the false-positive pins)", () => {
    // A kind record with no colour.
    expect(flags(`const M: Record<CardKind, string> = { note: "notes" };`)).toBe(false);
    // A colour in a COMMENT above one.
    expect(flags(`// was #15803d\nconst M: Record<CardKind, string> = { note: "notes" };`)).toBe(false);
    // A colour in the NEXT declaration — the body scan stops at its own brace.
    expect(
      flags(`const M: Record<CardKind, string> = { note: "}{" };\nconst OTHER = { c: "#15803d" };`),
    ).toBe(false);
    // A DERIVED table (`Object.fromEntries`, four live instances in `src/`)
    // followed by an unrelated colour: the initializer is anchored to the
    // declaration, so the later literal is not attributed to it. An earlier
    // version searched forward for the next `= {` and failed CI here, naming a
    // fold that carries no colour at all.
    expect(
      flags(
        `const CARD_TITLE_LABELS: Record<CardKind, string> = Object.fromEntries(\n` +
          `  CARD_KINDS.map((k) => [k, CARD_REGISTRY[k].titleLabel]),\n) as Record<CardKind, string>;\n` +
          `const DOT = { warn: "#d4a843" };`,
      ),
    ).toBe(false);
    // A JSX apostrophe inside a body must not make the string-skip run to EOF
    // and swallow a later declaration's colours.
    expect(
      flags(
        `const R: Record<CardKind, ReactNode> = { note: <span>don't</span> };\n` +
          `const DOT = { warn: "#d4a843" };`,
      ),
    ).toBe(false);
    // A non-kind vocabulary is a different question (stated in the law's reach).
    expect(flags(`const S: Record<AIRequestStatus, string> = { open: "#d97706" };`)).toBe(false);
  });

  it("catches the bypasses it claims to catch", () => {
    const cases: [string, string][] = [
      ["const theme = CARD_THEMES.todo;", "dotted user-overridable read"],
      ["const t = CARD_THEMES[key];", "computed read"],
      ["import { CARD_THEMES as Themes } from '@/components/panel-primitives';", "aliased import"],
      ["const T = CARD_THEMES;", "local re-bind"],
    ];
    for (const [src, label] of cases) {
      expect(
        violationsFor("fake.tsx", runtimeText(src), "CARD_THEMES"),
        `guard missed the ${label} bypass`,
      ).not.toEqual([]);
    }
    // And the system-accent read stays permitted.
    expect(violationsFor("fake.tsx", runtimeText("const t = CARD_THEMES.error;"), "CARD_THEMES")).toEqual([]);
  });
});

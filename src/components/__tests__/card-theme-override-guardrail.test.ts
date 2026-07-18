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

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { SYSTEM_THEME_KEYS, type PanelThemeKey } from "@/lib/panel-theme";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../.."); // src/

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

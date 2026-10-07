// Every command menu names its TRIGGER through the one trigger contract
// (task 992).
//
// THE LAW
//
//   A `<MenuProvider>` whose container is `role="menu"` was opened by
//   something. Unless it is caret-anchored (no trigger exists), that trigger
//   (a) rides the provider's `excludeRefs`, so pressing it again is a TOGGLE —
//   not a capture-phase close followed by a re-open that remounts the menu —
//   and (b) announces `aria-haspopup` / `aria-expanded` through
//   `menu/menu-trigger.ts`, never a hand-spelled copy.
//
// WHY. `AnchoredMenu` states the whole trigger contract once for the button it
// renders; the STYLE_GUIDE says it exists "so a fourth consumer cannot forget".
// But the triggers that cannot BE that button — the ⚡ bolt (a fixed
// pane-overlay portal), the grab handle, the heading lozenge's type chip
// (NodeView DOM) — re-derived it per site, and three of them forgot the
// toggle: the bolt's re-click closed and re-mounted the lightning menu while
// its keyboard twin Cmd+/ toggled it. Nine more spelled the ARIA by hand.
//
// HOW. Population = every provider open tag in either silo whose role is
// "menu" (explicit, or the provider's default when absent). Legs:
//   A. the open tag passes `excludeRefs` (unless TRIGGERLESS);
//   B. some file in its trigger site spells the contract helper (unless
//      TRIGGERLESS / ARIA_EXEMPT);
//   C. no source outside `menu-trigger.ts` hand-spells `aria-haspopup="menu"`;
//   D. every allowlist entry still names a live provider (no stale reasons).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LIBRARY, SRC, stripComments, walkSource } from "./_menu-census";

/** Caret- or pointer-position menus that no element opens. */
const TRIGGERLESS: Record<string, string> = {
  "src/components/SpellSuggestionMenu.tsx":
    "opened by a contextmenu press on a misspelled word at the pointer; no trigger element exists.",
};

/** Where the trigger of a provider rendered in one file actually lives. Default:
 *  the provider's own file. */
const TRIGGER_SITES: Record<string, string[]> = {
  // The ⚡ bolt renders the lightning panel.
  "src/components/ActionsMenuPanel.tsx": ["src/components/SelectionActionsMenu.tsx"],
  // The type chip is painted at NodeView construction and re-painted on
  // open/close by the pane that owns the menu state.
  "src/components/HeadingTypeMenu.tsx": [
    "src/lib/editor-extensions.ts",
    "src/components/EditorPane.tsx",
  ],
};

/** Triggers that owe the toggle (leg A) but not the ARIA (leg B). */
const ARIA_EXEMPT: Record<string, string> = {
  "src/components/DragHandleMenu.tsx":
    "the grab handle is `aria-hidden` pointer-only chrome; its menu's keyboard door is the ⚡ bolt / Cmd+/ (which carries the ARIA).",
};

const CONTRACT = /\b(?:useMenuTrigger|menuTriggerAria|paintMenuTriggerAria)\b/;

/** The JSX open tag starting at `start` (`<MenuProvider`), brace-aware so a
 *  `>` inside an expression (`() => …`) does not end it. */
function openTagAt(source: string, start: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start + 1; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (depth > 0 && (c === '"' || c === "'" || c === "`")) {
      quote = c;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return source.slice(start, i + 1);
  }
  return source.slice(start);
}

function rel(prefix: string, root: string, file: string): string {
  return `${prefix}/${path.relative(root, file).split(path.sep).join("/")}`;
}

function sources(): Array<{ key: string; source: string }> {
  const out: Array<{ key: string; source: string }> = [];
  for (const [prefix, root] of [
    ["src", SRC],
    ["library", LIBRARY],
  ] as const) {
    for (const file of walkSource(root)) {
      out.push({
        key: rel(prefix, root, file),
        source: stripComments(readFileSync(file, "utf8")),
      });
    }
  }
  return out;
}

const ALL = sources();
const BY_KEY = new Map(ALL.map((s) => [s.key, s.source]));

/** Every role="menu" provider open tag, by file. */
function menuProviders(): Array<{ key: string; tag: string }> {
  const hits: Array<{ key: string; tag: string }> = [];
  for (const { key, source } of ALL) {
    if (key.startsWith("src/components/menu/")) continue; // the primitive itself
    for (const m of source.matchAll(/<MenuProvider\b/g)) {
      const tag = openTagAt(source, m.index!);
      const role = /\brole=\{?\s*["']([a-z]+)["']/.exec(tag)?.[1];
      if (role === undefined && /\brole=/.test(tag)) {
        // A computed role: only the literal forms are read; a cast like
        // `{"dialog" as MenuRole}` is matched above by its literal.
        continue;
      }
      if ((role ?? "menu") !== "menu") continue;
      hits.push({ key, tag });
    }
  }
  return hits;
}

describe("menu-trigger census (task 992)", () => {
  const providers = menuProviders();

  it("finds the population (vacuity floor)", () => {
    const keys = new Set(providers.map((p) => p.key));
    for (const k of [
      "src/components/ActionsMenuPanel.tsx",
      "src/components/DragHandleMenu.tsx",
      "src/components/HeadingTypeMenu.tsx",
      "src/components/TabPlusMenu.tsx",
      "src/components/SpellSuggestionMenu.tsx",
    ]) {
      expect(keys, k).toContain(k);
    }
  });

  it("A: every triggered role=menu provider exempts its trigger (a real toggle)", () => {
    const missing = providers
      .filter((p) => !(p.key in TRIGGERLESS))
      .filter((p) => !/\bexcludeRefs=/.test(p.tag))
      .map((p) => p.key);
    expect(
      missing,
      "MISSING excludeRefs: put the element that opens this menu in the provider's " +
        "`excludeRefs` and make its activation `open ? close : open` (see menu/menu-trigger.ts), " +
        "or — if no element opens it — add it to TRIGGERLESS with the reason.",
    ).toEqual([]);
  });

  it("B: every trigger site states its ARIA through menu/menu-trigger.ts", () => {
    const missing: string[] = [];
    for (const { key } of providers) {
      if (key in TRIGGERLESS || key in ARIA_EXEMPT) continue;
      const sites = TRIGGER_SITES[key] ?? [key];
      if (!sites.some((s) => CONTRACT.test(BY_KEY.get(s) ?? ""))) missing.push(key);
    }
    expect(
      missing,
      "Trigger ARIA not from the contract: spread `menuTriggerAria(role, open)` / use " +
        "`useMenuTrigger` (or `paintMenuTriggerAria` for NodeView DOM) on the trigger; " +
        "if the trigger lives in another file, map it in TRIGGER_SITES.",
    ).toEqual([]);
  });

  it('C: nobody hand-spells aria-haspopup="menu"', () => {
    const offenders = ALL.filter(
      ({ key, source }) =>
        key !== "src/components/menu/menu-trigger.ts" &&
        /aria-haspopup=\{?\s*["']menu["']/.test(source),
    ).map((s) => s.key);
    expect(offenders).toEqual([]);
  });

  it("D: every allowlist entry names a live role=menu provider", () => {
    const keys = new Set(providers.map((p) => p.key));
    const stale = [
      ...Object.keys(TRIGGERLESS),
      ...Object.keys(ARIA_EXEMPT),
      ...Object.keys(TRIGGER_SITES),
    ].filter((k) => !keys.has(k));
    expect(stale).toEqual([]);
    for (const sites of Object.values(TRIGGER_SITES)) {
      for (const s of sites) expect(BY_KEY.has(s), s).toBe(true);
    }
  });
});

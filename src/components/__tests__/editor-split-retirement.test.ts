// @vitest-environment jsdom
//
// EDITOR-SPLIT RETIREMENT (task 115) — the guard for a feature whose UI was
// removed while its persisted pref, its toggle and one of its indicators
// stayed live.
//
// The defect: `SplitEditorPanes`' render site was dropped in a refactor, so no
// second pane existed — but the MenuBar kept a "Split editor" button wired to
// a PERSISTED pref (`editorSplit`), and the Outline gated its green "mirror
// pane position" edge bar on that pref alone. With no mirror, the mirror
// section path resolved to Document-start, so ONE click painted a permanent
// green bar on the Outline's title row that survived reloads — clearable only
// by re-clicking a button that did nothing else. Nothing failed: the toggle
// ran, the pref persisted, every test was green.
//
// Gabriel's decision (via the catcher, 2026-08-08): DELETE the button, the
// persisted setting and the stray indicator. Do NOT rebuild the second pane;
// the machinery may stay in the tree, but nothing may surface it.
//
// So this suite pins the three halves that decision has:
//
//   1. BEHAVIOUR — a pre-fix blob carrying `editorSplit: true` loads through
//      the REAL `loadPrefs()` and comes back with the key GONE. This is the
//      leg that catches the original shape: the type deletion alone leaves
//      `{...DEFAULT_PREFS, ...parsed}` carrying an untyped stale value that is
//      re-serialized on every subsequent write, forever.
//   2. SURFACE — no production file in either silo names the retired
//      vocabulary, so the toggle/indicator cannot creep back one prop at a
//      time. A test of the pref alone structurally cannot catch that: the pref
//      was never the part that misbehaved, the surfaces that believed it were.
//   3. PARKED MACHINERY — `SplitEditorPanes` / `EditorMirror` are kept (they
//      are complete and self-contained), and are deliberately unmounted. A new
//      production importer FAILS here, because re-mounting the split is a
//      decision about the toggle, the pref and the Outline indicator TOGETHER,
//      not a wiring detail — the half-restored state is exactly what shipped.
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { commentsStripped } from "@/lib/__tests__/_source-scan";
import defaultPrefsJson from "@/hooks/useViewPrefs.defaults.json";

const WINDOW_ID = "test-window";

vi.mock("@/lib/multi-window/window-id", () => ({ getWindowId: () => WINDOW_ID }));
// `useViewPrefs` transitively pulls `@/lib/storage`, whose runtime
// `require("@/lib/storage-fsa")` vitest's resolver can't alias. `loadPrefs`
// never touches a storage backend (it reads localStorage directly).
vi.mock("@/lib/storage", () => ({ isDevStorage: false }));

import { loadPrefs } from "@/hooks/useViewPrefs";

const GLOBAL_KEY = "virgil-view-prefs/global";
const WINDOW_KEY = `virgil-view-prefs/window/${WINDOW_ID}`;

const REPO = path.resolve(__dirname, "../../..");
const SRC = path.join(REPO, "src");
const LIB = path.join(REPO, "library");

function walkAny(dir: string, ext: RegExp, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkAny(p, ext, out);
    else if (ext.test(e.name)) out.push(p);
  }
  return out;
}
const walk = (dir: string) => walkAny(dir, /\.(ts|tsx)$/);
const rel = (p: string) => path.relative(REPO, p);
const isTest = (p: string) => /__tests__|\.test\.tsx?$/.test(p);
const SELF = path.join(__dirname, "editor-split-retirement.test.ts");
const PROD_FILES = walk(SRC)
  .concat(walk(LIB))
  .filter((f) => f !== SELF && !isTest(f));

/** Comments STRIPPED, string literals KEPT — the retirement is explained in
 *  prose at a dozen sites (that prose is the point), while the one legitimate
 *  surviving mention of the pref names lives inside a string literal
 *  (`RETIRED_PREF_KEYS`). Blanking literals would make the census
 *  unfalsifiable in exactly the place it must be able to see. */
const code = (f: string) => commentsStripped(fs.readFileSync(f, "utf8"));

/** Files whose CODE matches `re`. */
function codeHits(files: string[], re: RegExp): string[] {
  return files.filter((f) => re.test(code(f))).map(rel);
}

describe("editor split: the persisted pref is retired, not merely untyped", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("scrubs a pre-fix `editorSplit: true` out of the loaded prefs", () => {
    // A blob exactly as a user who clicked the toggle before the fix has it.
    localStorage.setItem(
      GLOBAL_KEY,
      JSON.stringify({ editorSplit: true, editorSplitRatio: 0.8, pageWidth: 700 }),
    );
    localStorage.setItem(WINDOW_KEY, JSON.stringify({ editorSplit: true }));

    const prefs = loadPrefs() as unknown as Record<string, unknown>;

    expect("editorSplit" in prefs).toBe(false);
    expect("editorSplitRatio" in prefs).toBe(false);
    // Canary: the same load carries a NON-retired key straight through, so a
    // future loader change that returned `DEFAULT_PREFS` wholesale (which would
    // pass the two assertions above vacuously) fails here.
    expect(prefs.pageWidth).toBe(700);
  });

  it("ships no `editorSplit` default, so a fresh install cannot reintroduce it", () => {
    const json = defaultPrefsJson as unknown as Record<string, unknown>;
    expect("editorSplit" in json).toBe(false);
    expect("editorSplitRatio" in json).toBe(false);
    // Canary — the file really is the shipped defaults blob.
    expect("pageWidth" in json).toBe(true);
  });
});

describe("editor split: no production surface names the retired vocabulary", () => {
  // The pref keys. `useViewPrefs.ts` is the ONE legitimate mention: the
  // `RETIRED_PREF_KEYS` scrub list, which must spell them to delete them.
  it("editorSplit / editorSplitRatio appear only in the scrub list", () => {
    const hits = codeHits(PROD_FILES, /\beditorSplit(Ratio)?\b/);
    expect(hits).toEqual(["src/hooks/useViewPrefs.ts"]);
  });

  // The surfaces that believed the pref. `mirrorSectionPath` survives as a
  // PROP of the parked `SplitEditorPanes` — that is the component's own
  // vocabulary, not a live wiring, and the parked-machinery census below is
  // what keeps it inert.
  it("the toggle / active-pane / mirror-path plumbing is gone", () => {
    expect(codeHits(PROD_FILES, /\btoggleEditorSplit\b/)).toEqual([]);
    expect(codeHits(PROD_FILES, /\bactiveSplitPane\b/)).toEqual([]);
    expect(codeHits(PROD_FILES, /\bmirrorParTitleIndex\b/)).toEqual([]);
    expect(codeHits(PROD_FILES, /\bmirrorSectionPath\b/)).toEqual([
      "src/components/editor-layout/split-editor-panes.tsx",
    ]);
  });

  it("the Outline paints exactly one position selector, with no edge variant", () => {
    const outline = code(path.join(SRC, "panels/Outline/OutlinePanel.tsx"));
    // The mirror indicator was the ONLY caller of the "edge" variant; with the
    // split retired, a second `<PositionHighlight` in this file means someone
    // rebuilt a mirror indicator without rebuilding a mirror.
    expect(outline.match(/<PositionHighlight/g)?.length ?? 0).toBe(1);
    // …and it takes no `variant`: the prop existed only to distinguish the
    // canonical pane's "fill" wash from the mirror's "edge" bar.
    expect(/variant[^\n]*"edge"/.test(outline)).toBe(false);
    expect(/function PositionHighlight\([^)]*variant/.test(outline)).toBe(false);
    // Canary: the selector itself is still there (a deleted component would
    // otherwise satisfy "no edge variant" trivially).
    expect(outline.includes("function PositionHighlight")).toBe(true);
  });

  it("the MenuBar has no Split editor button", () => {
    const menuBar = fs.readFileSync(path.join(SRC, "components/MenuBar.tsx"), "utf8");
    expect(menuBar.includes('data-hint="Split editor"')).toBe(false);
  });
});

describe("editor split: the machinery is parked, and re-mounting is a decision", () => {
  it("nothing in production imports SplitEditorPanes or EditorMirror", () => {
    // The rule this encodes: the split's SURFACE (toggle + pref + Outline
    // indicator) no longer exists, so mounting either component again restores
    // a pane nothing can reach, close or track — the half-state that shipped.
    // If you are here because you are rebuilding the split: good. Restore the
    // surface deliberately (see `split-editor-panes.tsx`'s header for the full
    // list) and then rewrite this suite rather than deleting the assertion.
    //
    // The needle is the MODULE PATH in any string literal, not an `import …
    // from` form: EditorLayout mounts its one other heavy pane as
    // `dynamic(() => import("./CodeEditor"), { ssr: false })`, so a `from`-only
    // regex would be blind to the single most likely way a second editor pane
    // gets re-mounted. Comments are stripped, so prose naming the file (this
    // file's own header, and several in `src/`) does not count.
    expect(codeHits(PROD_FILES, /["'][^"']*split-editor-panes["']/)).toEqual([]);
    expect(codeHits(PROD_FILES, /["'][^"']*\/EditorMirror["']/)).toEqual([
      "src/components/editor-layout/split-editor-panes.tsx",
    ]);
  });

  // The THIRD root (task 255's precedent). The `src/` + `library/` walk above
  // structurally cannot see the surface a future agent is most likely to
  // believe: the AGENTS.md-indexed guides, which are prose, live in `docs/`,
  // and carry a `last-verified` stamp asserting they match the current tree.
  // Every one of them described the toggle as a live MenuBar button after the
  // code deleting it was written — glossary.md even mapped the user's own term
  // "split screen toggle" straight at `MenuBar.tsx`, which is precisely how an
  // agent asked to "fix the split toggle" would reinstate the retired control.
  // Markdown cannot import an SSOT, so the rule is CONTEXTUAL: a live guide may
  // name the toggle only while saying it is retired.
  it("the live agent guides describe the toggle only as retired", () => {
    const GUIDES = [
      "AGENTS.md",
      "src/STYLE_GUIDE.md",
      ...walkAny(path.join(REPO, "docs/agents"), /\.md$/).map((f) => path.relative(REPO, f)),
    ];
    // Historical records are deliberately OUT of scope: `docs/memos/**`,
    // `docs/perf/**` and the dated audits describe what was true when written,
    // and rewriting them would be falsifying the record.
    //
    // The marker must sit NEAR the mention, not merely somewhere on the same
    // line. These guides wrap a whole section into ONE physical line, and three
    // of the stale sites live in paragraphs that say "retired"/"removed" about
    // something else entirely (the detached toolbars, the ActionsStripButton) —
    // a line-scoped exemption passed them all, which is the unfalsifiable-leg
    // mistake this repo has now made twice.
    const NEEDLE = /split[- ](editor|toggle|screen)|editor-split/gi;
    const MARKER = /retire|removed|parked|task 115/i;
    const WINDOW = 160;
    const offenders: string[] = [];
    for (const g of GUIDES) {
      const abs = path.join(REPO, g);
      if (!fs.existsSync(abs)) continue;
      fs.readFileSync(abs, "utf8")
        .split("\n")
        .forEach((line, i) => {
          for (const m of line.matchAll(NEEDLE)) {
            const from = Math.max(0, m.index - WINDOW);
            const near = line.slice(from, m.index + m[0].length + WINDOW);
            if (!MARKER.test(near)) offenders.push(`${g}:${i + 1}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });

  it("the parked components still exist and still build a split", () => {
    // The decision was RETIRE-the-surface, not delete-the-machinery. A future
    // agent reading only the census above must not conclude the components are
    // fair game to remove without asking.
    const panes = fs.readFileSync(
      path.join(SRC, "components/editor-layout/split-editor-panes.tsx"),
      "utf8",
    );
    expect(panes.includes("export function SplitEditorPanes")).toBe(true);
    expect(panes.includes("PARKED")).toBe(true);
    expect(fs.existsSync(path.join(SRC, "components/EditorMirror.tsx"))).toBe(true);
  });
});

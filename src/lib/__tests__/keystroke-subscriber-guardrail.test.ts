// Keystroke-sanctity permitted-subscriber guardrail (task 044) — the CI half of
// the keystroke-sanctity law, the sibling of `scroll-reposition-guardrail.test.ts`.
//
// The law (AGENTS.md, "Keystroke sanctity"): no plugin, hook, or React effect
// may do work proportional to document size on each keystroke. Its most direct
// enforcement point is the set of live `editor.on('update'|'transaction')`
// subscribers on the MAIN editor — each must be O(1) per transaction (a
// debounced timer reset, a counter bump, or a RAF-coalesced layout read) or
// O(edit-size) (consuming the DocStructureObserver diff), never an
// `editor.on('update', () => walkWholeDoc())`.
//
// Until now that set was gated by prose + manual review only (unlike its junior
// sibling, scroll-anchor stability, which task 042 gave a grep-allowlist test).
// This test closes that asymmetry:
//
//   SOURCE-GREP ALLOWLIST — walk `src/`, collect every file that makes a real
//   `editor.on("update"|"transaction", …)` subscription call (comment/docstring
//   mentions of the doctrine stripped first), and assert the flagged set equals
//   `PERMITTED_KEYSTROKE_SUBSCRIBERS`. A new unlisted subscriber FAILS CI.
//
// The grep is a heuristic — O(1)-ness is semantic, not syntactic — so, exactly
// like the keystroke-sanctity prose list and `PERMITTED_SCROLL_REPOSITIONERS`,
// the allowlist + per-entry justification is what makes it robust: a human
// confirms each listed site is genuinely O(1)/O(edit-size); the test only guards
// against a NEW *unlisted* site appearing. The prose list in AGENTS.md and this
// allowlist are cross-references of the same reality — keep them in sync.
//
// Scope notes (mirroring task 042's scoping cautions):
//   • Matches ONLY the `.on("update"|'update'|"transaction"|'transaction'` call
//     form — the real runtime subscription. This sidesteps `onUpdate:` React
//     callback props on panels, float-body `onUpdate({ editor })` config options
//     (separate bounded float editors), and `onUpdate` TipTap options (the
//     useDocument autosaver subscribes that way and is a prose-only entry).
//   • The quote-delimited `"update"` form does NOT match `"selectionUpdate"`
//     (selection is governed separately — the reactor audits), nor `focus`/`blur`.
//   • Scoped to `src/` — the AGENTS.md list is a `src/` list. `library/` owns its
//     own perf doctrine (`library/AGENTS.md`); its Reader subscriber
//     (`library/hooks/usePgmarkPages.ts`, read-only, docChanged-gated) is out of
//     scope here by design.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../.."); // src/

// ── The permitted-subscriber allowlist ──────────────────────────────────────
// Every `src/` file that legitimately makes a main-editor
// `editor.on('update'|'transaction')` subscription. Each entry's value is the
// one-line O(1)/O(edit-size) justification — the SAME facts the AGENTS.md prose
// list carries. Files with more than one subscriber (EditorLayout, EditorPane)
// get one justification covering all of them. Adding a new file here requires a
// justification — same discipline as `PERMITTED_SCROLL_REPOSITIONERS` and the
// AGENTS.md allowlist. If you cannot justify O(1)-ness, the subscriber is the
// bug, not this list.
const PERMITTED_KEYSTROKE_SUBSCRIBERS: Record<string, string> = {
  "components/EditorLayout.tsx":
    "Three O(1) subscribers: activity-presence counter bump (docChanged-gated); section-path recompute main + mirror ('update', the coordsAtPos doc-walk is RAF-coalesced to one frame + perf-flag gated). (The PDF-stale bump was removed in P6 — pdfStale is now owned solely by EditorPane.)",
  "components/EditorMirror.tsx":
    "RAF-deferred mirror replay — the transaction handler only schedules a frame.",
  "components/EditorPane.tsx":
    "Two O(1) subscribers: PDF-stale bump (stamp a timestamp ref, flip pdfStale ≤once per compile cycle); Outline-panel tick (debounced 300 ms timer reset + one counter bump — the doc-walk is deferred into the outlineContent memo, off the keystroke path).",
  "components/Marginalia.tsx":
    "RAF-coalesced host-element notify.",
  "components/PendingChangePill.tsx":
    "Pending-change margin-pill reposition: schedules a RAF (early-returns if one is pending) + placementsEqual bail on the single coordsAtPos placement. Same RAF-coalesced fixed portal recorded on the scroll allowlist.",
  "components/SelectionActionsMenu.tsx":
    "Margin-bolt reposition: suppression check + RAF-already-scheduled bail; the single coordsAtPos placement math is RAF-coalesced and short-circuits on a placement-equality bail.",
  "components/SlashCommandPopup.tsx":
    "Mounted only while the popup is open; RAF-coalesced caret reposition.",
  "components/editor-layout/panels/omni-host.tsx":
    "Fold-aware OmniHost tick: a single getMeta(sectionFoldingPluginKey) check — bumps ONLY on a fold-meta tx, returns immediately on a plain keystroke.",
  "hooks/useEditorUIState.ts":
    "Section-fold persister: gated via the shared transactionTouchesFold predicate (fold-meta or docChanged) — O(1) per tx.",
  "hooks/useWordCount.ts":
    "300 ms debounce, then the full doc walk — the per-keystroke cost is just the timer reset (O(1)).",
  "lib/code-pane-bridge.ts":
    "TipTap→code sync: docChanged-gated + own-write ('syncing') filtered, then a debounced serialize — O(1) per tx.",
  "lib/float-sync.tsx":
    "docChanged-gated + own-write meta filter — O(1) per tx.",
  "text-objects/TextObjectGrabHandle.tsx":
    "docChanged-gated, cheap handle reposition.",
};

/**
 * Strip block + line comments so a docstring that MENTIONS the doctrine
 * (`editor.on('update')` appears in prose all over the perf-critical files)
 * doesn't read as a real subscription. Stripping is conservative — it only
 * removes text, so it can never manufacture a false match; a real `.on("update"`
 * that survives stripping is a genuine call. (A `.on("update"` sitting AFTER a
 * `//` on the same line would be commented-out code — correctly not a live call.)
 */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

/**
 * The guarded class as a machine-detectable form: a real
 * `<receiver>.on("update"|'update'|"transaction"|'transaction', …)` subscription
 * call. File-level on purpose (a per-handler AST scope check would be brittle);
 * the allowlist + justification closes the semantic gap — a listed site is
 * human-verified as O(1)/O(edit-size).
 */
export function detectKeystrokeSubscriber(source: string): boolean {
  return /\.on\(\s*["'](?:update|transaction)["']/.test(stripComments(source));
}

function walkSource(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      // Skip test + fixture trees so the guard never scans itself.
      if (entry === "__tests__" || entry === "__fixtures__") continue;
      out.push(...walkSource(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("keystroke-subscriber guardrail — source allowlist", () => {
  const detected = walkSource(SRC)
    .filter((f) => detectKeystrokeSubscriber(readFileSync(f, "utf8")))
    .map((f) => path.relative(SRC, f).split(path.sep).join("/"))
    .sort();

  it("flags exactly the allowlisted main-editor subscribers — no unlisted new ones", () => {
    // If this fails with an EXTRA file: a new `editor.on('update'|'transaction')`
    // subscriber landed on the main editor. Confirm it is O(1) per transaction
    // (debounced timer reset / counter bump / RAF-coalesced read) or O(edit-size)
    // (consumes the DocStructureObserver diff), then add it to
    // PERMITTED_KEYSTROKE_SUBSCRIBERS with a justification AND to the AGENTS.md
    // prose list — OR rewrite it to stop walking the doc on every keystroke.
    expect(detected).toEqual(Object.keys(PERMITTED_KEYSTROKE_SUBSCRIBERS).sort());
  });

  it("keeps the allowlist free of stale entries (every listed file still exists + still subscribes)", () => {
    for (const rel of Object.keys(PERMITTED_KEYSTROKE_SUBSCRIBERS)) {
      const src = readFileSync(path.join(SRC, rel), "utf8");
      expect(detectKeystrokeSubscriber(src)).toBe(true);
    }
  });

  it("would flag a NEW unlisted subscriber (naive walk-the-doc fixture)", () => {
    // The exact regression this guard exists to catch: a per-transaction
    // subscriber that walks the whole doc on every keystroke, on no allowlist.
    const naiveFixture = `
      function useNaivePlugin(editor) {
        useEffect(() => {
          const onUpdate = () => {
            editor.state.doc.descendants((node) => { recount(node); });
          };
          editor.on("update", onUpdate);
          return () => editor.off("update", onUpdate);
        }, [editor]);
      }
    `;
    expect(detectKeystrokeSubscriber(naiveFixture)).toBe(true);
    expect(
      Object.keys(PERMITTED_KEYSTROKE_SUBSCRIBERS).some((k) =>
        naiveFixture.includes(k),
      ),
    ).toBe(false);
  });

  it("does not flag a file that only MENTIONS the doctrine in comments", () => {
    // The perf-critical files are full of prose like `NOT an editor.on('update')
    // subscriber` — stripping comments first is what keeps those from reading as
    // live subscriptions. This pins that behavior.
    const commentOnly = `
      // This service is NOT an editor.on('update' | 'transaction') subscriber.
      /* It never calls editor.on("update", …) — it polls instead. */
      export function poll() { return 1; }
    `;
    expect(detectKeystrokeSubscriber(commentOnly)).toBe(false);
  });

  it("does not match selectionUpdate / focus / blur (governed by other laws)", () => {
    expect(detectKeystrokeSubscriber(`editor.on("selectionUpdate", fn)`)).toBe(false);
    expect(detectKeystrokeSubscriber(`editor.on('focus', fn)`)).toBe(false);
    expect(detectKeystrokeSubscriber(`editor.on("blur", fn)`)).toBe(false);
  });
});

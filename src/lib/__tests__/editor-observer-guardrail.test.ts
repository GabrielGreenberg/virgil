// Editor-observer stability guardrail — the CI half of the third perf law
// (AGENTS.md "Editor-observer stability"), sibling of
// `keystroke-subscriber-guardrail.test.ts` (keystroke sanctity) and
// `scroll-reposition-guardrail.test.ts` (scroll-anchor stability).
//
// The law: NO deep MutationObserver (subtree/characterData) over editor
// content on the keystroke path — a characterData MO fires as a pre-paint
// microtask on EVERY keystroke, and one that reads layout (scrollHeight /
// getBoundingClientRect) forces a full-document layout right after the text
// mutation; one that then WRITES styles dirties layout again (the exact
// double-forced-layout the old editor-scrollbar MO paid per keystroke —
// measured ~30 ms per full-page relayout at ~320 blocks). ResizeObservers
// are the sanctioned alternative (they deliver post-layout, at most once per
// frame, and only on real geometry change) — but their callbacks must be
// read-before-write and equality-bailed so a var write can't ping-pong the
// observer into a feedback loop.
//
//   SOURCE-GREP ALLOWLISTS — walk `src/`, flag (1) every file constructing a
//   MutationObserver with `subtree: true` or `characterData: true`, and
//   (2) every file constructing a ResizeObserver; assert each flagged set
//   equals its PERMITTED_* allowlist. A new unlisted deep MO or RO FAILS CI.
//
// The grep is a heuristic — stability is semantic, not syntactic — so, as
// with the two sibling guardrails, the allowlist + per-entry justification is
// what makes it robust: a human confirms each listed site is genuinely
// bounded (panel-local / node-local / RAF-coalesced / equality-bailed). The
// runtime companion is `window.__keystrokeStats()` (keystroke-latency-probe):
// its work-attribution channel counts observer fires per keystroke — a
// healthy plain keystroke attributes ZERO fires.
//
// Scope notes:
//   • Attribute-only MutationObservers (e.g. editor-ref.tsx's
//     `{ attributes: true, attributeFilter: ["data-editable"] }`) are
//     deliberately NOT matched — they fire on attribute flips, not typing.
//   • Scoped to `src/` — `library/` owns its own perf doctrine.
//   • This census asks whether an observer is bounded PER FIRE. Whether it
//     may fire at all during a continuous layout gesture (a pane drag or an
//     OS window resize) is the fourth law's question, censused by
//     `window-resize-guardrail.test.ts` (AGENTS.md "Layout-gesture
//     stability"). Several ROs listed below are also parked there; an RO that
//     is bounded per fire and fires 120 times a second is still the bug.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../.."); // src/

// ── Deep-MutationObserver allowlist ─────────────────────────────────────────
// Every `src/` file that legitimately constructs a subtree/characterData
// MutationObserver. The bar for entry is HIGH: the observed root must not be
// editor content, and the callback must be bounded. The editor-scrollbar MUST
// NEVER reappear here — its geometry needs are fully covered by its
// ResizeObserver pass (a mutation that changes no element's size cannot
// change any geometry input).
const PERMITTED_DEEP_MUTATION_OBSERVERS: Record<string, string> = {
  "panels/Outline/OutlinePanel.tsx":
    "Two MOs (childList+subtree, no characterData) on the Outline panel's OWN list DOM — not editor content; mounted only while the panel is open; callbacks are a bounded row measure.",
};

// ── ResizeObserver allowlist ────────────────────────────────────────────────
// Every `src/` file that constructs a ResizeObserver. Each must observe a
// bounded target and keep its callback read-before-write + equality-bailed
// (or RAF-coalesced) so it can neither force mid-frame layout nor feedback-
// loop on its own writes.
const PERMITTED_RESIZE_OBSERVERS: Record<string, string> = {
  "components/FigureBlockNodeView.tsx":
    "Observes the figure block's own box + its column — node-local sizing, RAF-scheduled.",
  // DocumentFolderTab's chrome-measurement RO was deleted by the Library UI
  // refactor P3 — the folder-tab silhouette is layout-driven FolderTabChrome
  // now (src/components/chrome/), zero observers by construction.
  "components/editor-layout/editor-scrollbar.tsx":
    "Observes row/editor-column/page in ONE read-batched, equality-bailed measureAndApply() pass (typing-latency fix 1b): all reads before all writes, CSS vars + React state only on value change — no MutationObserver, no read-after-write, feedback loop self-terminates.",
  "components/editor-layout/split-with-code.tsx":
    "Observes the split container/child for divider sizing — layout chrome, not per-keystroke content.",
  "components/panel-primitives.tsx":
    "Observes a panel header's own box — panel chrome, mounted with the panel; the --pc-header-h var write is equality-bailed (task 317). The bail is load-bearing, not decoration: this RO is per CARD in every open panel, so a window/pane resize fired an unconditional setProperty on each one per frame — a re-dirtied layout per card, and the write→resize→RO loop had nothing to terminate it. The earlier justification stopped at 'panel chrome', which was true and said nothing about the write.",
  "hooks/useFloatingMenuPosition.ts":
    "Observes the floating menu's own element; reposition is RAF-coalesced with a (left,top) equality bail (also on the scroll-reposition allowlist), and parked on the layout-gesture bus. The RAF claim was FALSE until task 317 — `resize` was registered twice, once unconditionally and SYNCHRONOUSLY outside the RAF path, so six live call sites re-solved placement twice per event with one of them off-frame. The RO and the resize now share ONE parked scheduler; a justification that describes only the observer is worth nothing if a second registration bypasses it.",
  "hooks/useInTextPositions.ts":
    "TWO observers — editor.view.dom for wrap-induced reflow, and the pod's own cards for body-size changes — and since task 370 both callbacks do the same O(1) thing: enter the ONE settle-by-convergence door (`settle-convergence.ts`). `request()` coalesces to at most ONE pending pass however many observers fire, so a resize storm (a keep-alive display-flip, a run of wrap-changing keystrokes) costs exactly what the pre-370 RAF-coalesced schedule() cost. The pass itself is bounded twice over: viewport-gated for the card-rect read (NEAR_ZONE) and pos-band classified for the coordsAtPos read (task 327), so it is O(in-band items), never O(doc). What CHANGED is termination, not per-fire cost: the loop now stops on the consumer's own fixed point (two consecutive passes committing nothing past the task-328 hysteresis) under a wall-clock cap, instead of on one frame of unchanged editor scrollHeight — a proxy that fired while inner layout was still moving and left the deck compressed until the user scrolled.",
  "lib/editor-geometry/service.ts":
    "Per-[data-uuid]-block ROs PLUS the editor element + its scroll container (C7: the viewport-frame targets absorbed from the deleted useEditorViewportCache — 4 private ROs per pane collapsed onto this ONE observer); onResize bails when the editor is hidden, routes viewport-element entries into the gesture-parked, full-field-equality-bailed frame refresh, and feeds per-uuid invalidation into a RAF-coalesced, gesture-parked recompute.",
  "panels/Outline/OutlinePanel.tsx":
    "Observes the panel's own scroller/container — panel-local, open-only, bounded row measure.",
};

/** Strip comments so doctrine prose can't read as a live constructor call. */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

/**
 * Detector 1 — the F1 regression class: a MutationObserver whose options
 * include `subtree: true` or `characterData: true` (fires on typing).
 * File-level conjunction on purpose; attribute-only MOs don't match.
 */
export function detectDeepMutationObserver(source: string): boolean {
  const s = stripComments(source);
  return (
    /new MutationObserver/.test(s) &&
    /(subtree|characterData)\s*:\s*true/.test(s)
  );
}

/** Detector 2 — any ResizeObserver construction. */
export function detectResizeObserver(source: string): boolean {
  return /new ResizeObserver/.test(stripComments(source));
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

describe("editor-observer guardrail — deep MutationObservers", () => {
  const detected = walkSource(SRC)
    .filter((f) => detectDeepMutationObserver(readFileSync(f, "utf8")))
    .map((f) => path.relative(SRC, f).split(path.sep).join("/"))
    .sort();

  it("flags exactly the allowlisted deep MOs — no unlisted new ones", () => {
    // If this fails with an EXTRA file: a new subtree/characterData
    // MutationObserver landed. If it can observe editor content, it WILL fire
    // per keystroke as a pre-paint microtask — rewrite it as a ResizeObserver
    // (geometry) or a DocStructureBus consumer (structure) instead. Only a
    // bounded, panel-local observer may be allowlisted, with a justification
    // here AND in the AGENTS.md prose list.
    expect(detected).toEqual(
      Object.keys(PERMITTED_DEEP_MUTATION_OBSERVERS).sort(),
    );
  });

  it("keeps the allowlist free of stale entries", () => {
    for (const rel of Object.keys(PERMITTED_DEEP_MUTATION_OBSERVERS)) {
      const src = readFileSync(path.join(SRC, rel), "utf8");
      expect(detectDeepMutationObserver(src)).toBe(true);
    }
  });

  it("would flag the old scrollbar-style MO (characterData over the scroll row)", () => {
    const regressionFixture = `
      const mo = new MutationObserver(() => { syncRowBoundCss(); refresh(); });
      mo.observe(row, { childList: true, subtree: true, characterData: true });
    `;
    expect(detectDeepMutationObserver(regressionFixture)).toBe(true);
  });

  it("does not flag an attribute-only MO (editor-ref's data-editable watcher)", () => {
    const attrOnly = `
      const obs = new MutationObserver(read);
      obs.observe(dom, { attributes: true, attributeFilter: ["data-editable"] });
    `;
    expect(detectDeepMutationObserver(attrOnly)).toBe(false);
  });

  it("does not flag a file that only MENTIONS the doctrine in comments", () => {
    const commentOnly = `
      // Never add a new MutationObserver with subtree: true here.
      /* The old code used characterData: true — removed in fix 1b. */
      export function noop() {}
    `;
    expect(detectDeepMutationObserver(commentOnly)).toBe(false);
  });
});

describe("editor-observer guardrail — ResizeObservers", () => {
  const detected = walkSource(SRC)
    .filter((f) => detectResizeObserver(readFileSync(f, "utf8")))
    .map((f) => path.relative(SRC, f).split(path.sep).join("/"))
    .sort();

  it("flags exactly the allowlisted ResizeObservers — no unlisted new ones", () => {
    // If this fails with an EXTRA file: a new ResizeObserver landed. Confirm
    // its callback is read-before-write + equality-bailed (or RAF-coalesced)
    // and its target bounded, then allowlist it with a justification — OR
    // restructure it. The runtime check: type in the dev preview and read
    // window.__keystrokeStats().work — a plain keystroke must attribute 0
    // fires to your site.
    expect(detected).toEqual(Object.keys(PERMITTED_RESIZE_OBSERVERS).sort());
  });

  it("keeps the allowlist free of stale entries", () => {
    for (const rel of Object.keys(PERMITTED_RESIZE_OBSERVERS)) {
      const src = readFileSync(path.join(SRC, rel), "utf8");
      expect(detectResizeObserver(src)).toBe(true);
    }
  });

  it("does not flag a file that only MENTIONS ResizeObserver in comments", () => {
    const commentOnly = `
      // A new ResizeObserver here would need the allowlist.
      export function noop() {}
    `;
    expect(detectResizeObserver(commentOnly)).toBe(false);
  });
});

// @vitest-environment jsdom
//
// Scroll-anchor stability guardrail (task 042) — the CI half of the
// scroll-reposition contract. Two layers, mirroring the keystroke-sanctity law
// + the `float-policy.test.ts` z-drift grep:
//
//   1. SOURCE-GREP ALLOWLIST — walk `src/` AND `library/`, flag every file
//      that is a `position:fixed` overlay recomputing its `top` from
//      `coordsAtPos`/`getBoundingClientRect` while listening to `scroll`, and
//      assert the flagged set equals the silo's PERMITTED_ list (the library
//      list is deliberately EMPTY — prose twin: library/AGENTS.md "Perf
//      doctrine" → "Scroll anchors (library edition)"). A new naive
//      fixed-scroll portal that isn't on an allowlist FAILS CI.
//
//   2. RUNTIME PROBE — drive `recordScrollPlacement` through the real probe
//      state machine and assert a stable (one-commit-per-frame) portal reports
//      ≤1 distinct top/frame while a jittery (many-commits-per-frame) one
//      reports >1.
//
// The grep is a heuristic (the risky pattern is semantic, not purely
// syntactic), so — exactly like the keystroke-sanctity permitted-subscriber
// list — the allowlist + per-entry justification is what makes it robust: a
// human confirms each listed site is genuinely pod-relative or RAF-coalesced.

import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  recordScrollPlacement,
  readScrollRepositionStats,
  __resetScrollRepositionProbeForTest,
  __setScrollActiveForTest,
  SCROLL_PORTAL_SELECTION_BOLT,
  SCROLL_PORTAL_PENDING_PILL,
  SCROLL_PORTAL_SLASH_POPUP,
  SCROLL_PORTAL_FLOATING_MENU,
} from "../scroll-reposition-probe";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../.."); // src/
const LIBRARY = path.resolve(HERE, "../../../library"); // the Library silo

// ── The permitted-subscriber allowlist ──────────────────────────────────────
// Every source file that legitimately repositions a `position:fixed` overlay on
// scroll. Each MUST be either pod/host-relative (moves with content, no scroll
// re-solve) or a RAF-coalesced fixed portal with an equality bail. Adding a new
// site here requires a one-line justification — same discipline as the
// keystroke-sanctity allowlist in AGENTS.md.
const PERMITTED_SCROLL_REPOSITIONERS: Record<string, string> = {
  "components/SelectionActionsMenu.tsx":
    "RAF-coalesced + `placementsEqual` bail; suppresses during scroll momentum (scroll-idle).",
  "components/PendingChangePill.tsx":
    "RAF-coalesced + `placementsEqual` bail; shares one scheduler with the trigger effect.",
  "components/SlashCommandPopup.tsx":
    "RAF-coalesced (`scheduleUpdate`) caret re-read; mounted only while the popup is open.",
  "hooks/useFloatingMenuPosition.ts":
    "RAF-coalesced `trackAnchor` scroll re-read + `(left,top)` equality bail.",
  "components/editor-layout/editor-scrollbar.tsx":
    "Custom scrollbar: scroll path reads ONLY `row.scrollTop` behind a prev-identity bail (no rect re-solve); rects/heights are measured in a single read-batched, equality-bailed ResizeObserver pass (editor-observer stability contract — no MutationObserver, no read-after-write).",
};

// ── The library-silo allowlist ──────────────────────────────────────────────
// Deliberately EMPTY: the library has no fixed-portal scroll repositioner —
// its overlays (page lozenge, header pod) are host-relative, and
// usePgmarkPages' scroll listener is a RAF-coalesced scrollTop read with no
// position:fixed overlay. A first entry here needs the same pod-relative /
// RAF+equality-bail justification as the src/ list above.
const PERMITTED_LIBRARY_SCROLL_REPOSITIONERS: Record<string, string> = {};

/**
 * The risky class, as a machine-detectable conjunction: a source file that
 * (a) renders a `position:fixed` element, (b) computes a coordinate from a
 * layout measurement, and (c) listens to `scroll`. File-level on purpose — a
 * per-handler AST scope check would be brittle; the allowlist + justification
 * closes the semantic gap (a listed site is human-verified as coalesced).
 */
export function detectScrollRepositioner(source: string): boolean {
  const listensToScroll =
    /addEventListener\(\s*["']scroll["']/.test(source) ||
    /\bonScroll\b/.test(source);
  const rendersFixed = /position:\s*["']fixed["']/.test(source);
  const measures =
    /coordsAtPos\(/.test(source) || /getBoundingClientRect\(/.test(source);
  return listensToScroll && rendersFixed && measures;
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

describe("scroll-reposition guardrail — source allowlist", () => {
  const detected = walkSource(SRC)
    .filter((f) => detectScrollRepositioner(readFileSync(f, "utf8")))
    .map((f) => path.relative(SRC, f).split(path.sep).join("/"))
    .sort();

  it("flags exactly the allowlisted fixed-scroll portals — no unlisted new ones", () => {
    // If this fails with an EXTRA file: a new `position:fixed` overlay
    // recomputes its top on scroll. Confirm it RAF-coalesces with an equality
    // bail (or is pod-relative), then add it to PERMITTED_SCROLL_REPOSITIONERS
    // with a justification — OR fix it to stop jittering.
    expect(detected).toEqual(Object.keys(PERMITTED_SCROLL_REPOSITIONERS).sort());
  });

  it("keeps the allowlist free of stale entries (every listed file still exists + still matches)", () => {
    for (const rel of Object.keys(PERMITTED_SCROLL_REPOSITIONERS)) {
      const src = readFileSync(path.join(SRC, rel), "utf8");
      expect(detectScrollRepositioner(src)).toBe(true);
    }
  });

  it("would flag a NEW unlisted fixed-scroll portal (jittery fixture)", () => {
    // A `position:fixed` overlay that re-solves `top` from getBoundingClientRect
    // on every scroll event with NO RAF gate + NO equality bail — the exact
    // regression this guard exists to catch. Adding this under src/ would make
    // the allowlist assertion above fail until it's fixed or justified.
    const jitteryFixture = `
      function JitteryOverlay() {
        const [top, setTop] = useState(0);
        useEffect(() => {
          const onScroll = () => {
            const r = anchorEl.getBoundingClientRect();
            setTop(r.top); // re-solved synchronously on EVERY scroll event
          };
          window.addEventListener("scroll", onScroll, true);
          return () => window.removeEventListener("scroll", onScroll, true);
        }, []);
        return <div style={{ position: "fixed", top }} />;
      }
    `;
    expect(detectScrollRepositioner(jitteryFixture)).toBe(true);
    expect(
      Object.keys(PERMITTED_SCROLL_REPOSITIONERS).some((k) =>
        jitteryFixture.includes(k),
      ),
    ).toBe(false);
  });

  it("does not flag benign source (a fixed element with no scroll re-solve)", () => {
    const staticFixed = `
      function Banner() {
        return <div style={{ position: "fixed", top: 0 }}>hi</div>;
      }
    `;
    expect(detectScrollRepositioner(staticFixed)).toBe(false);
  });
});

describe("scroll-reposition guardrail — library silo", () => {
  const detected = walkSource(LIBRARY)
    .filter((f) => detectScrollRepositioner(readFileSync(f, "utf8")))
    .map((f) => path.relative(LIBRARY, f).split(path.sep).join("/"))
    .sort();

  it("flags exactly the allowlisted library portals (currently: none)", () => {
    // If this fails with an EXTRA file: a new fixed-scroll portal landed in
    // the library silo. Same escape hatch as src/: make it pod-relative or
    // RAF-coalesced with an equality bail, then justify it in
    // PERMITTED_LIBRARY_SCROLL_REPOSITIONERS AND the library/AGENTS.md prose.
    expect(detected).toEqual(
      Object.keys(PERMITTED_LIBRARY_SCROLL_REPOSITIONERS).sort(),
    );
  });

  it("keeps the library allowlist free of stale entries", () => {
    for (const rel of Object.keys(PERMITTED_LIBRARY_SCROLL_REPOSITIONERS)) {
      const src = readFileSync(path.join(LIBRARY, rel), "utf8");
      expect(detectScrollRepositioner(src)).toBe(true);
    }
  });
});

// ── Runtime probe: distinct-tops-per-frame discriminates stable vs jittery ───

describe("scroll-reposition guardrail — runtime probe", () => {
  // Control the animation frame deterministically: capture scheduled callbacks
  // and only fire them when the test says a frame elapsed. This exercises the
  // REAL `scheduleFrameFlush` → rAF → `flushFrame` path.
  let rafQueue: FrameRequestCallback[] = [];
  const realRaf = globalThis.requestAnimationFrame;
  const realCaf = globalThis.cancelAnimationFrame;

  beforeAll(() => {
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    }) as typeof globalThis.requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => {}) as typeof globalThis.cancelAnimationFrame;
  });
  afterAll(() => {
    globalThis.requestAnimationFrame = realRaf;
    globalThis.cancelAnimationFrame = realCaf;
  });

  /** Simulate one animation-frame boundary by draining the RAF queue. */
  function frame() {
    const q = rafQueue;
    rafQueue = [];
    for (const cb of q) cb(0);
  }

  beforeEach(() => {
    rafQueue = [];
    __resetScrollRepositionProbeForTest();
    __setScrollActiveForTest(true);
  });

  it("reports ≤1 distinct top/frame for a STABLE portal (one commit per frame)", () => {
    // A RAF-coalesced portal commits once per frame; the top legitimately moves
    // BETWEEN frames as content scrolls, never twice WITHIN a frame.
    for (const top of [500, 480, 460, 440]) {
      recordScrollPlacement(SCROLL_PORTAL_SELECTION_BOLT, top);
      frame(); // frame boundary between each commit
    }
    const stats = readScrollRepositionStats();
    expect(stats[SCROLL_PORTAL_SELECTION_BOLT].distinctTopsThisScroll).toBeLessThanOrEqual(1);
    expect(stats[SCROLL_PORTAL_SELECTION_BOLT].commitsThisScroll).toBe(4);
    expect(stats[SCROLL_PORTAL_SELECTION_BOLT].total).toBe(4);
  });

  it("reports >1 distinct top/frame for a JITTERY portal (many commits per frame)", () => {
    // Several DIFFERENT tops committed within one frame (no frame boundary
    // between them) — the per-frame jitter a raw per-scroll-event re-solve
    // produces.
    recordScrollPlacement(SCROLL_PORTAL_PENDING_PILL, 500);
    recordScrollPlacement(SCROLL_PORTAL_PENDING_PILL, 490);
    recordScrollPlacement(SCROLL_PORTAL_PENDING_PILL, 480);
    // read BEFORE the frame boundary — the in-flight frame is included
    const stats = readScrollRepositionStats();
    expect(stats[SCROLL_PORTAL_PENDING_PILL].distinctTopsThisScroll).toBeGreaterThan(1);
    expect(stats[SCROLL_PORTAL_PENDING_PILL].distinctTopsThisScroll).toBe(3);
  });

  it("collapses repeated identical tops within a frame to a single distinct value", () => {
    // A portal re-evaluating to the SAME top (equality-bail territory) is not
    // jitter — distinct tops, not raw commits, is the discriminator.
    recordScrollPlacement(SCROLL_PORTAL_SLASH_POPUP, 300);
    recordScrollPlacement(SCROLL_PORTAL_SLASH_POPUP, 300);
    recordScrollPlacement(SCROLL_PORTAL_SLASH_POPUP, 300);
    const stats = readScrollRepositionStats();
    expect(stats[SCROLL_PORTAL_SLASH_POPUP].distinctTopsThisScroll).toBe(1);
  });

  it("does not count commits made while no scroll gesture is active", () => {
    __setScrollActiveForTest(false);
    recordScrollPlacement(SCROLL_PORTAL_FLOATING_MENU, 100);
    recordScrollPlacement(SCROLL_PORTAL_FLOATING_MENU, 200);
    const stats = readScrollRepositionStats();
    expect(stats[SCROLL_PORTAL_FLOATING_MENU].total).toBe(2); // lifetime still counts
    expect(stats[SCROLL_PORTAL_FLOATING_MENU].commitsThisScroll).toBe(0);
    expect(stats[SCROLL_PORTAL_FLOATING_MENU].distinctTopsThisScroll).toBe(0);
  });

  it("resets per-scroll counters on scroll-idle but keeps the lifetime total", () => {
    recordScrollPlacement(SCROLL_PORTAL_SELECTION_BOLT, 700);
    frame();
    __setScrollActiveForTest(false); // scroll-idle
    const stats = readScrollRepositionStats();
    expect(stats[SCROLL_PORTAL_SELECTION_BOLT].total).toBe(1);
    expect(stats[SCROLL_PORTAL_SELECTION_BOLT].commitsThisScroll).toBe(0);
    expect(stats[SCROLL_PORTAL_SELECTION_BOLT].distinctTopsThisScroll).toBe(0);
  });
});

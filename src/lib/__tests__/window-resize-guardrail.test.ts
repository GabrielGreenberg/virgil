// Window-resize guardrail — the FOURTH grep-allowlist sibling (after
// keystroke-subscriber, scroll-reposition, and pane-drag), covering the
// continuous-layout-gesture class from task 317 (doctrine: AGENTS.md
// "Layout-gesture stability").
//
// The law: *a continuous layout gesture — a pane-divider drag or an OS window
// resize — costs O(1) settles, not O(frames) recomputes.* Every geometry
// follower either PARKS (`parkDuringLayoutGesture`: stash the call, replay
// exactly once on the gesture's end edge) or SUPPRESSES (`useLayoutGestureActive`
// / `isLayoutGestureActive` / `onLayoutGestureChange`: hide for the gesture,
// restore on the end edge). Nothing re-solves per frame.
//
// Why this census exists at all, and why it is the guard that catches the
// ORIGINAL shape: the parking doctrine had been in the repo for a release and
// was STRUCTURALLY UNREACHABLE for the gesture that needs it most. `activeDrag`
// had exactly one writer repo-wide — `beginPaneDrag` inside the engine's
// `onPointerDown` — and an OS window drag delivers no pointer events to the
// page at all, so every park took its immediate-`run()` branch and PaneFreeze
// never locked. Meanwhile **eighteen** `addEventListener("resize")` sites had
// accumulated, several of them un-coalesced, each re-solving geometry every
// frame of a live PWA window drag (the flicker Gabriel reported, worst on the
// left edge). Neither of the three existing censuses greps a resize listener —
// keystroke greps `editor.on(...)`, scroll greps `scroll` + `position:fixed`,
// pane-drag greps pointer moves + drag chrome — and that gap is exactly how
// eighteen ungoverned sites accumulated without one CI failure.
//
// Two legs, both file-level (the allowlist + per-entry justification is what
// closes the semantic gap — same discipline as the three siblings):
//
//   1. CENSUS — every file in `src/` and `library/` that registers a resize
//      handler in ANY form must be on `PERMITTED_RESIZE_LISTENERS` with a
//      justification naming which half of the law it obeys.
//   2. DOCTRINE PARTICIPATION — every censused file must actually reference
//      the layout-gesture API (park or suppress), UNLESS it is on
//      `PERMITTED_LIVE_RESIZE_HANDLERS` with a why-live justification. This is
//      the leg with teeth: a new `window.addEventListener("resize", …)` in a
//      file that has never heard of the bus fails CI even if someone adds it
//      to leg 1's list, because leg 1 alone only proves *someone looked*.
//
// The runtime half is `window.__layoutGestureStats()`
// ([src/lib/layout-gesture-probe.ts](../layout-gesture-probe.ts)): during a
// continuous drag every parked site reports `settles === 0`, exactly 1 settle
// per site after release, and a one-shot resize reports `gestures === 0`.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../.."); // src/
const LIBRARY = path.resolve(HERE, "../../../library"); // the Library silo

// ── Leg 1: the census ───────────────────────────────────────────────────────
// Repo-relative keys (silo prefix included — one list spans both silos).
// Every entry names WHICH half of the law the site obeys and why that choice
// is right for this follower. The rule of thumb the sweep earned:
//
//   PARK a follower that MEASURES the resizing content from outside (nothing
//   user-visible depends on its value mid-gesture — it settles once and is
//   correct); SUPPRESS a text-anchored overlay (parking one leaves it visibly
//   DETACHED from the text it points at, which is worse than the flicker);
//   stay LIVE only where the frame itself is the obligation.
const PERMITTED_RESIZE_LISTENERS: Record<string, string> = {
  "library/components/RightDetail.tsx":
    "PARK — the textPodRect header↔pod measure. BOTH triggers (its ResizeObserver and this window listener) route through the same `parkDuringLayoutGesture`; the split between them was task 317's own signature, since PaneFreeze cannot freeze an OS window resize and the raw path was therefore the live one for the whole gesture.",
  "src/components/EditorLayout.tsx":
    "PARK ×3 — the Help-menu anchor rect (left-anchored Virgil-bar chrome, displaced ~0.001·delta by a width drag, so a gesture-stale anchor cannot visibly detach the popover) and the main + mirror section-path breadcrumb walks (each O(headings) `coordsAtPos`, ProseMirror's most expensive forced-layout call). The RESIZE path parks; the scroll path stays live, because a breadcrumb must follow the scroll it describes.",
  "src/components/PendingChangePill.tsx":
    "SUPPRESS — a text-anchored fixed portal; `update()` returns early while a gesture is live and the render gate hides the pill, settling on the end edge. Parking would leave the pill floating beside the wrong line.",
  "src/components/SelectionActionsMenu.tsx":
    "SUPPRESS — the margin bolt, same shape as the pending pill (a third source feeding its existing suppress/settle predicate). The raw listener is deliberate: a ONE-SHOT resize (maximize, zoom, DPR change) must still reposition immediately, and during a continuous gesture `update()` hits the suppression and returns before scheduling a RAF.",
  "src/components/SlashCommandPopup.tsx":
    "SUPPRESS — a caret-anchored fixed portal; `scheduleUpdate` bails on `isLayoutGestureActive()` and the popup hides for the gesture rather than parking half-detached from its slash.",
  "src/components/editor-layout/editor-scrollbar.tsx":
    "PARK + SUPPRESS — the measure pass parks (a full-document layout read → 3 CSS-var writes that re-dirty layout; its read-before-write held within a call and never across calls), and the thumb itself suppresses on the bus edges. This is the single most visible right-side artifact: the thumb is right-anchored on a column with `flex: 1000 1 0`, so it otherwise chases the moving edge a commit behind.",
  "src/components/editor-layout/reader-view-prefs.ts":
    "PARK — the third copy of the breadcrumb walk (main pane, mirror pane, Reader), same O(headings) `coordsAtPos` cost and the same resize-parks/scroll-stays-live split as EditorLayout's two.",
  "src/components/stack/StackIcon.tsx":
    "PARK — publishes the stack icon's viewport rect for the FloatingPanel hit-test. Bottom-left-anchored, and the only consumer is a hit-test that cannot fire mid-gesture (an OS window drag delivers no pointer events to the page).",
  "src/components/stack/StackStrip.tsx":
    "PARK — bottom-left-anchored chrome whose only width input is `innerWidth`; a settled value one gesture late is invisible, whereas a live one re-renders the whole strip per frame.",
  "src/hooks/useEditorViewportCache.ts":
    "PARK (both triggers — window + its own RO) — the highest-leverage park in the app: `refresh()` is a `getComputedStyle` + 4× `getBoundingClientRect` + two `closest()` walks + a `getComputedStyle`-per-ancestor scroll-parent walk; its equality bail structurally cannot hold mid-gesture; and the hook is mounted ×4 live. Its consumers are precisely the overlays that suppress, so nothing user-visible reads the cache mid-gesture.",
  "src/hooks/useFloatingMenuPosition.ts":
    "PARK — ONE RAF-coalesced scheduler shared by the resize, RO and scroll paths (it replaced a genuine double registration: `resize` was bound unconditionally-and-synchronously here AND again behind a RAF in the `trackAnchor` effect, so six live call sites re-solved placement twice per event). The menu's anchor is chrome, which a gesture displaces sub-pixel, so parking cannot visibly detach it.",
  "src/hooks/useInTextPositions.ts":
    "PARK — the in-text marker deck re-measures every tracked position; both geometry triggers (window + the editor-dom RO) park, while the structural-bus and font-ready paths stay live because they aren't gesture-driven.",
  "src/lib/editor-geometry/service.ts":
    "PARK the MEASURE PASS, never the accumulation (the marginalia engine, moved verbatim from useMarginaliaRegistry into the editor-attached geometry service — wave 2 C4) — the highest FIRE-COUNT follower during a horizontal drag (a width change rewraps every paragraph, so the per-block RO delivers one entry per near-zone block per frame). `pendingRecompute` keeps collecting across the gesture (that set IS the work list); only the RAF measure pass defers, so the gesture costs ONE flush over the union. Mid-gesture the per-entry `invalidateFromUuid` — O(docOrder) per entry, i.e. O(blocks²) per frame at 300+ blocks — collapses to one O(observed) all-dirty mark.",
  "src/hooks/useWindowChrome.ts":
    "LIVE, deliberately — see PERMITTED_LIVE_RESIZE_HANDLERS.",
  "src/lib/pane-resize/layout-gesture-bus.ts":
    "LIVE by definition — this listener IS the window publisher's detector. See PERMITTED_LIVE_RESIZE_HANDLERS.",
  "src/text-objects/TextObjectGrabHandle.tsx":
    "PARK — the grab handle's resize-driven placement re-solve rides the shared park; the handle is left-anchored chrome (`handle-layout.ts`), which a width drag displaces sub-pixel.",
};

// ── Leg 2: the stay-live allowlist ──────────────────────────────────────────
// A follower may stay live through a gesture only where the FRAME ITSELF is
// the obligation. Two entries, and both are structural rather than a judgment
// call about cost.
const PERMITTED_LIVE_RESIZE_HANDLERS: Record<string, string> = {
  "src/hooks/useWindowChrome.ts":
    "The Window Controls Overlay strip is native window chrome with a per-frame visual obligation: parking it would leave the strip's inset stale against the moving system buttons. What it does NOT get to be is un-coalesced — `_onChange` notifies through `useSyncExternalStore` at the app ROOT, and `insets.right` mixes two independently-updated sources (`getTitlebarAreaRect()` and `window.innerWidth`), so a one-frame lag between them makes `right` oscillate and defeats its own `_equal` bail. The resize path is RAF-coalesced to at most one root render per frame; the discrete `geometrychange` / display-mode paths stay synchronous.",
  "src/lib/pane-resize/layout-gesture-bus.ts":
    "The window publisher itself — the detector that infers the gesture's begin/end edges from the resize burst (there is no `resizestart`). It cannot park on the bus it publishes to. Cost per event: one timestamp compare + one timer reset; it measures nothing and renders nothing.",
};

/** The API surface that constitutes obeying the law. A censused file must
 *  reference at least one of these (or be on the stay-live list). */
const DOCTRINE_API =
  /\b(?:parkDuringLayoutGesture|isLayoutGestureActive|useLayoutGestureActive|onLayoutGestureChange)\b/;

/** Strip comments so doctrine prose (this repo documents the guarded call
 *  forms heavily — including in this very file) can't read as a live
 *  registration. Conservative: only removes text, never manufactures a
 *  match. */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/**
 * The guarded class: ANY registration of a resize handler, on any receiver.
 *
 * Deliberately wider than the shape that actually exists today (`window
 * .addEventListener("resize", …)`, ×17). `window.visualViewport
 * .addEventListener("resize", …)` and `window.onresize = …` are the same
 * per-frame follower as far as the law is concerned, and both are the natural
 * next thing an author reaches for — a census narrower than its doctrine is
 * how the pane-drag guardrail's first version let a `document.body` listener
 * and a `touchmove` divider through (task 187). The receiver is unanchored on
 * purpose: an element-scoped resize listener is just as capable of re-solving
 * geometry per frame, and there is no legitimate reason for one to dodge the
 * census.
 */
export function detectResizeListener(source: string): boolean {
  const src = stripComments(source);
  return (
    /addEventListener\(\s*["']resize["']/.test(src) ||
    /\.onresize\s*=/.test(src)
  );
}

/** Does this file participate in the layout-gesture doctrine at all? */
export function referencesLayoutGestureApi(source: string): boolean {
  return DOCTRINE_API.test(stripComments(source));
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

/** Both silos, keyed repo-relative ("src/…" / "library/…"). */
function walkBothSilos(): Array<{ rel: string; source: string }> {
  const files: Array<{ rel: string; source: string }> = [];
  for (const [prefix, root] of [
    ["src", SRC],
    ["library", LIBRARY],
  ] as const) {
    for (const f of walkSource(root)) {
      files.push({
        rel: `${prefix}/${path.relative(root, f).split(path.sep).join("/")}`,
        source: readFileSync(f, "utf8"),
      });
    }
  }
  return files;
}

describe("window-resize guardrail — the census (both silos)", () => {
  const files = walkBothSilos();
  const detected = files
    .filter((f) => detectResizeListener(f.source))
    .map((f) => f.rel)
    .sort();

  it("flags exactly the allowlisted resize-handler sites — no unlisted new ones", () => {
    // If this fails with an EXTRA file: a new resize handler landed. Before
    // listing it, make it obey the law — `parkDuringLayoutGesture(run, siteId)`
    // if it measures the resizing content from outside, or the
    // suppress/settle pattern if it is a text-anchored overlay (parking one
    // leaves it detached from its text, which is worse than the flicker).
    // "Stay live" is a last resort and belongs on the other allowlist with a
    // per-frame-obligation argument.
    expect(detected).toEqual(Object.keys(PERMITTED_RESIZE_LISTENERS).sort());
  });

  it("keeps the census free of stale entries (every listed file still exists + still registers one)", () => {
    const byRel = new Map(files.map((f) => [f.rel, f.source]));
    for (const rel of Object.keys(PERMITTED_RESIZE_LISTENERS)) {
      const source = byRel.get(rel);
      expect(source, `${rel} missing from the walk`).toBeDefined();
      expect(
        detectResizeListener(source as string),
        `${rel} no longer registers a resize handler — drop its census entry`,
      ).toBe(true);
    }
  });

  it("every stay-live entry is also on the census (the two lists cannot drift apart)", () => {
    for (const rel of Object.keys(PERMITTED_LIVE_RESIZE_HANDLERS)) {
      expect(
        Object.prototype.hasOwnProperty.call(PERMITTED_RESIZE_LISTENERS, rel),
        `${rel} claims to stay live but is not on the census`,
      ).toBe(true);
    }
  });
});

describe("window-resize guardrail — doctrine participation", () => {
  const files = walkBothSilos();

  it("every censused site parks or suppresses — unless it is an allowlisted stay-live handler", () => {
    // The leg with teeth. Leg 1 only proves someone looked at the file; this
    // one proves the follower actually reached for the bus. A resize listener
    // in a file that has never heard of `parkDuringLayoutGesture` is the
    // pre-317 shape, whatever its census justification claims.
    const offenders: string[] = [];
    for (const f of files) {
      if (!detectResizeListener(f.source)) continue;
      if (Object.prototype.hasOwnProperty.call(PERMITTED_LIVE_RESIZE_HANDLERS, f.rel))
        continue;
      if (!referencesLayoutGestureApi(f.source)) offenders.push(f.rel);
    }
    expect(offenders).toEqual([]);
  });
});

describe("window-resize guardrail — detector fixtures", () => {
  it("flags the plain shape a new follower would be written in", () => {
    const naive = `
      useEffect(() => {
        const onResize = () => setRect(el.getBoundingClientRect());
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
      }, []);
    `;
    expect(detectResizeListener(naive)).toBe(true);
    expect(referencesLayoutGestureApi(naive)).toBe(false);
  });

  it("flags the visualViewport form (a census narrower than its doctrine is the task-187 hole)", () => {
    const vv = `
      window.visualViewport?.addEventListener('resize', schedule);
    `;
    expect(detectResizeListener(vv)).toBe(true);
  });

  it("flags the `onresize` assignment form", () => {
    const assigned = `window.onresize = () => measureEverything();`;
    expect(detectResizeListener(assigned)).toBe(true);
  });

  it("does not flag a file that only MENTIONS the pattern in comments", () => {
    const commentOnly = `
      // Never window.addEventListener("resize", measure) without a park —
      // see AGENTS.md "Layout-gesture stability".
      export function ok() { return 1; }
    `;
    expect(detectResizeListener(commentOnly)).toBe(false);
  });

  it("does not flag an unrelated listener", () => {
    const other = `window.addEventListener("scroll", onScroll, { passive: true });`;
    expect(detectResizeListener(other)).toBe(false);
  });

  it("recognises both halves of the law as participation", () => {
    expect(
      referencesLayoutGestureApi(`const park = parkDuringLayoutGesture(run, "x");`),
    ).toBe(true);
    expect(
      referencesLayoutGestureApi(`if (isLayoutGestureActive()) return;`),
    ).toBe(true);
    expect(
      referencesLayoutGestureApi(`const active = useLayoutGestureActive();`),
    ).toBe(true);
    expect(
      referencesLayoutGestureApi(`onLayoutGestureChange((a) => setSuppress(a));`),
    ).toBe(true);
  });
});

// Scroll-listener guardrail — the FIFTH grep-allowlist sibling (after
// keystroke-subscriber, scroll-reposition, pane-drag and window-resize),
// closing the gap task 416 found in the continuous-layout-gesture law
// (doctrine: AGENTS.md "Layout-gesture stability").
//
// The law: *a continuous layout gesture — a pane-divider drag, an OS window
// resize, OR a content drag (drop-mode session) — costs O(1) settles, not
// O(frames) recomputes. Every geometry follower either PARKS or SUPPRESSES.*
//
// Why a SCROLL census, and why the resize one structurally cannot stand in
// for it. A pane drag and a window resize scroll nothing, so for those two
// families a scroll listener is not a follower at all — which is exactly the
// reasoning that left every scroll path outside the doctrine. The third
// publisher breaks it: a CONTENT drag scrolls the document *itself*
// ([auto-scroll.ts](../../components/drop-mode/auto-scroll.ts) writes
// `scrollTop` once per RAF for the whole of a long drag), so during that
// gesture the scroll listeners ARE the per-frame followers, precisely as the
// resize listeners are a window drag's. The content publisher has been on the
// bus since perf Wave 2 and reached none of them: two breadcrumb walks, a
// forced-layout `offsetHeight` read per event, and a hover-placement re-solve
// under a lift ghost all ran per auto-scroll frame with CI green, because
// `window-resize-guardrail` greps `resize` and the three older censuses grep
// `editor.on(...)`, `position:fixed` + `coordsAtPos`, and pointer moves + drag
// chrome. None of them can see a scroll listener.
//
// A user scroll is NOT a layout gesture, so a park here is a no-op for the
// ordinary case: nothing about normal scroll-tracking chrome changes.
//
// Two legs, both file-level — the per-entry justification is what closes the
// semantic gap, same discipline as the four siblings:
//
//   1. CENSUS — every file in `src/` and `library/` that registers a scroll
//      handler in any form must be on `PERMITTED_SCROLL_LISTENERS` with a
//      justification naming which half of the law its SCROLL path obeys.
//   2. DOCTRINE PARTICIPATION — every censused file must actually reference
//      the layout-gesture API, UNLESS it is on
//      `PERMITTED_LIVE_SCROLL_HANDLERS` with a why-live justification. Leg 1
//      alone only proves *someone looked*.
//
// Stated limit, inherited from the resize sibling: leg 2 is per FILE, so a
// file that parks one path and runs a second live still passes it. That is
// why every leg-1 justification is written about the SCROLL path specifically
// — `editor-scrollbar.tsx` is the live example (its resize path parks, its
// thumb suppresses, and its scroll path is deliberately live).
//
// The runtime half is `window.__layoutGestureStats()`
// ([src/lib/layout-gesture-probe.ts](../layout-gesture-probe.ts)): during a
// drag with auto-scroll every parked site reports `settles === 0`, and
// exactly 1 settle per site after release.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../.."); // src/
const LIBRARY = path.resolve(HERE, "../../../library"); // the Library silo

// ── Leg 1: the census ───────────────────────────────────────────────────────
// Repo-relative keys (silo prefix included — one list spans both silos). The
// rule of thumb this sweep earned, and it is NOT the resize one:
//
//   PARK a follower that MEASURES (a breadcrumb walk, a placement re-solve, a
//   scroll-position capture) — mid-gesture its value is either irrelevant or
//   about to be invalidated by the drop, and a user scroll never enters the
//   park at all. SUPPRESS an overlay anchored to the text that is sliding
//   (parking one leaves it beside the wrong line). Stay LIVE only where the
//   scroll ITSELF is what the listener is feedback for — a scrollbar thumb, a
//   page lozenge, a hint that must vanish.
const PERMITTED_SCROLL_LISTENERS: Record<string, string> = {
  "library/components/PageScrollLozenge.tsx":
    "LIVE — see PERMITTED_LIVE_SCROLL_HANDLERS. The Library reader's page lozenge; the handler is one `scheduleFade()` timer reset and the lozenge IS the scroll's feedback.",
  "library/components/LeftList.tsx":
    "LIVE — see PERMITTED_LIVE_SCROLL_HANDLERS. A React `onScroll` prop (the JSX form of the same follower): the Library list's virtual-window driver.",
  "library/components/PaperRender.tsx":
    "LIVE — see PERMITTED_LIVE_SCROLL_HANDLERS. A React `onScroll` prop; the Library Reader's scroll-position persist.",
  "library/hooks/usePgmarkPages.ts":
    "LIVE — the reader's current-page tracker, RAF-coalesced to one `scrollTop`/`clientHeight` read per frame. The page number is what the scroll is FOR, so parking it would freeze the readout mid-scroll; the file participates in the doctrine through its ResizeObserver park.",
  "src/components/EditorLayout.tsx":
    "PARK ×2 + LIVE ×1 — the Help-menu anchor rect parks (task 317) and the section-path breadcrumb walk now parks on BOTH its geometry paths (task 416: a content drag's auto-scroll re-ran an O(headings) `coordsAtPos` walk per frame; a user scroll is not a gesture, so the breadcrumb still follows it). The third is the paragraph-nav recorder's `debouncedCheck`, deliberately live: per event it is ONE `clearTimeout` + `setTimeout`, and its 1000 ms callback cannot fire during a continuous scroll at all.",
  "src/components/EditorPane.tsx":
    "PARK — the scroll-position persist. `el.offsetHeight` is a FORCED-LAYOUT read and it ran once per scroll event, i.e. once per auto-scroll frame, interleaved with the drop indicator's own React `top` write (the write → read → write thrash task 330 names). Parking is also semantically right: the captured value is 'where the reader left the document', and mid-gesture there is no such position — the end edge re-reads the settled one once.",
  "src/components/HintLayer.tsx":
    "LIVE — see PERMITTED_LIVE_SCROLL_HANDLERS. `onScroll = () => hide()`: the suppress half in its purest form, and it must not park.",
  "src/components/PendingChangePill.tsx":
    "SUPPRESS — a text-anchored fixed portal; `update()` returns early while a gesture is live and the render gate hides the pill, settling on the end edge.",
  "src/components/SelectionActionsMenu.tsx":
    "SUPPRESS — the margin bolt, same shape as the pending pill; `update()` hits the suppression and returns before scheduling a RAF.",
  "src/components/SlashCommandPopup.tsx":
    "SUPPRESS — a caret-anchored fixed portal; `scheduleUpdate` bails on `isLayoutGestureActive()`.",
  "src/components/editor-layout/editor-scrollbar.tsx":
    "LIVE scroll path (the measure path parks and the thumb suppresses on the RESIZE family only) — see PERMITTED_LIVE_SCROLL_HANDLERS.",
  "src/components/editor-layout/reader-view-prefs.ts":
    "PARK + LIVE — the Reader's twin of EditorLayout's pair: the breadcrumb walk parks on both geometry paths (task 416, kept byte-for-byte in step with the main-pane copy), and the paragraph-nav `debouncedCheck` stays live for the same O(1)-timer-reset reason.",
  "src/hooks/useFloatingMenuPosition.ts":
    "PARK — the optional scroll re-anchor rides the SHARED RAF scheduler, which is itself `park.fire()`, so the scroll, resize and RO paths all settle once per gesture. The menu's anchor is chrome, which a gesture displaces sub-pixel, so parking cannot visibly detach it.",
  "src/hooks/useInTextPositions.ts":
    "LIVE but gesture-CHECKED — the scroll-idle refinement (wave-2b C5) is debounced to 150 ms of scroll IDLE, which a continuous auto-scroll never reaches, and its callback returns early on `isLayoutGestureActive()`. Pod-relative tops are scroll-invariant, so the deck deliberately has no per-frame scroll path at all.",
  "src/hooks/useScrollActivityTracker.ts":
    "LIVE — see PERMITTED_LIVE_SCROLL_HANDLERS.",
  "src/lib/scroll-reposition-probe.ts":
    "LIVE by definition — see PERMITTED_LIVE_SCROLL_HANDLERS.",
  "src/text-objects/TextObjectGrabHandle.tsx":
    "PARK — the grab handle's placement re-solve. Task 317 parked its resize path and argued the scroll path could stay live because 'an OS window drag delivers no pointer events to the page'; a CONTENT drag delivers them, so task 336's modality gate reads POINTER and the hover branch re-ran `blocksAtY` plus one `computePlacement` per containing level for the whole of a long drag — under a lift ghost, on chrome `globals.css` has already made `pointer-events: none` for the session.",
};

// ── Leg 2: the stay-live allowlist ──────────────────────────────────────────
// A scroll follower may stay live only where the SCROLL ITSELF is what the
// listener exists to give feedback for, or where it is the instrument that
// measures scroll behaviour. Everything here must also be O(1) per event with
// no doc walk — "live" buys a per-frame OBLIGATION, never a per-frame cost.
const PERMITTED_LIVE_SCROLL_HANDLERS: Record<string, string> = {
  "library/components/PageScrollLozenge.tsx":
    "The Library reader's page lozenge reveals ON scroll and fades after idle — parking it would blank the very affordance the scroll is supposed to summon. Per event: one `clearTimeout` + `setTimeout` + an already-true `setVisible`. It measures nothing.",
  "library/components/LeftList.tsx":
    "The Library list's virtual window: RAF-coalesced to one `scrollTop` + one `clientHeight` read per frame, and that pair IS the window's input — parking it would freeze the rendered range mid-scroll, i.e. blank rows. No layout gesture scrolls this container in any case (the content drag's auto-scroll targets an EDITOR's scroller), so the park would be unreachable.",
  "library/components/PaperRender.tsx":
    "The Library Reader's scroll-position persist, RAF-coalesced to one `scrollTop` read whose only consumer is a QUIET session-store write (no subscriber re-render; the store's own 250 ms debounce owns the disk cadence). This one IS reachable by a content drag — the Reader mounts an EditorPane inside this scroller — and stays live because the read is a value the browser already holds and the write is off the frame: a park would buy nothing measurable and would drop the reader's last position if a gesture ever wedged.",
  "library/hooks/usePgmarkPages.ts":
    "The reader's current-page readout. RAF-coalesced to one `scrollTop` + one `clientHeight` read per frame, which is the value being displayed; a parked page number is a wrong page number for the length of the gesture. The Library reader is not scrolled by the main editor's auto-scroll in any case.",
  "src/components/HintLayer.tsx":
    "`onScroll = () => hide()` — an anchored hint whose anchor has moved must vanish, and it must vanish on the frame the scroll happens. This IS the suppress half; there is nothing to defer.",
  "src/components/editor-layout/editor-scrollbar.tsx":
    "The thumb tracks the scroll it describes, and its suppress is deliberately kind-filtered to the RESIZE family so a content drag's auto-scroll keeps it VISIBLE (a drag past the fold is exactly when the reader wants to see where they are). Per event: one `scrollTop` read, one equality-bailed `setScroll`, one timer reset — no forced layout of its own, and scroll events are already delivered at most once per frame. Its MEASURE pass (a full-document layout read → 3 CSS-var writes) is on the resize path and parks.",
  "src/hooks/useScrollActivityTracker.ts":
    "Global auto-hide scrollbars: the visible thumb IS the scroll's feedback, so parking it would blank the scrollbar for the whole of a drag's auto-scroll. Per event: one `hasAttribute` test, an idempotence-gated `setAttribute` (task 416 — re-setting an attribute to its current value still invalidates style in Blink, and this fires every frame of a continuous scroll), and a timer reset. It measures nothing and renders nothing.",
  "src/lib/scroll-reposition-probe.ts":
    "The probe that MEASURES per-scroll-frame reposition behaviour (`window.__scrollRepositionStats()`). It cannot park on the gestures it is instrumenting without blinding the instrument — the same argument the window publisher's own resize listener makes one census over.",
};

/** The API surface that constitutes obeying the law. Wider than the resize
 *  sibling's by the two KIND-filtered channels, because a scroll follower has
 *  a legitimate reason to filter (`editor-scrollbar`'s thumb suppresses for
 *  the resize family and stays visible for a content drag). */
const DOCTRINE_API =
  /\b(?:parkDuringLayoutGesture|isLayoutGestureActive|useLayoutGestureActive|onLayoutGestureChange|hasActiveLayoutGesture|onLayoutGestureSetChange)\b/;

/** Strip comments so doctrine prose (this repo documents the guarded call
 *  forms heavily — including in this very file) can't read as a live
 *  registration. Conservative: only removes text, never manufactures a
 *  match. */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/**
 * The guarded class: ANY registration of a scroll handler, on any receiver.
 *
 * Deliberately wider than the shapes that exist today (`addEventListener`
 * on an element, on `window` in the capture phase, on `document`): a census
 * narrower than its doctrine is how the pane-drag guardrail's first version
 * let a `document.body` listener through (task 187). The `onscroll =`
 * assignment form is the natural next thing an author reaches for, and the
 * React `onScroll={…}` prop is the same follower wearing JSX.
 *
 * Stated residual: a listener registered through a HELPER that takes the
 * event name as a parameter, or a computed event name, would evade this. No
 * such shape exists in either silo today — and the two censused JSX props
 * were found by asking the QUESTION rather than by trusting the regex, which
 * is the only thing that ever widens a census.
 */
export function detectScrollListener(source: string): boolean {
  const src = stripComments(source);
  return (
    /addEventListener\(\s*["']scroll["']/.test(src) ||
    /\.onscroll\s*=/.test(src) ||
    // The JSX prop form. React's `onScroll` is the SAME follower — it
    // registers a listener on the element and fires once per scroll frame —
    // and the Library silo uses it for two real geometry followers, both of
    // which the first cut of this census missed. That is precisely the
    // "narrower than its doctrine" hole task 187 records.
    /\bonScroll\s*=\s*\{/.test(src)
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

describe("scroll-listener guardrail — the census (both silos)", () => {
  const files = walkBothSilos();
  const detected = files
    .filter((f) => detectScrollListener(f.source))
    .map((f) => f.rel)
    .sort();

  it("flags exactly the allowlisted scroll-handler sites — no unlisted new ones", () => {
    // If this fails with an EXTRA file: a new scroll handler landed. Before
    // listing it, ask what it does during a CONTENT drag's auto-scroll —
    // `parkDuringLayoutGesture(run, siteId)` if it measures, the
    // suppress/settle pattern if it is a text-anchored overlay. "Stay live"
    // belongs on the other allowlist and needs an argument that the scroll
    // ITSELF is what the listener is feedback for.
    expect(detected).toEqual(Object.keys(PERMITTED_SCROLL_LISTENERS).sort());
  });

  it("keeps the census free of stale entries (every listed file still exists + still registers one)", () => {
    const byRel = new Map(files.map((f) => [f.rel, f.source]));
    for (const rel of Object.keys(PERMITTED_SCROLL_LISTENERS)) {
      const source = byRel.get(rel);
      expect(source, `${rel} missing from the walk`).toBeDefined();
      expect(
        detectScrollListener(source as string),
        `${rel} no longer registers a scroll handler — drop its census entry`,
      ).toBe(true);
    }
  });

  it("every stay-live entry is also on the census (the two lists cannot drift apart)", () => {
    for (const rel of Object.keys(PERMITTED_LIVE_SCROLL_HANDLERS)) {
      expect(
        Object.prototype.hasOwnProperty.call(PERMITTED_SCROLL_LISTENERS, rel),
        `${rel} claims to stay live but is not on the census`,
      ).toBe(true);
    }
  });
});

describe("scroll-listener guardrail — doctrine participation", () => {
  const files = walkBothSilos();

  it("every censused site parks or suppresses — unless it is an allowlisted stay-live handler", () => {
    // The leg with teeth. Leg 1 only proves someone looked at the file; this
    // one proves the follower actually reached for the bus. A scroll listener
    // in a file that has never heard of `parkDuringLayoutGesture` is the
    // pre-416 shape, whatever its census justification claims.
    const offenders: string[] = [];
    for (const f of files) {
      if (!detectScrollListener(f.source)) continue;
      if (
        Object.prototype.hasOwnProperty.call(PERMITTED_LIVE_SCROLL_HANDLERS, f.rel)
      )
        continue;
      if (!referencesLayoutGestureApi(f.source)) offenders.push(f.rel);
    }
    expect(offenders).toEqual([]);
  });
});

describe("scroll-listener guardrail — the sites task 416 converted stay converted", () => {
  const read = (rel: string) =>
    stripComments(readFileSync(path.resolve(SRC, "..", rel), "utf8"));

  it("both breadcrumb copies route their SCROLL registration through the park", () => {
    // The pre-416 shape registered the raw `schedule` for scroll and a
    // separate `onWindowResize` wrapper for resize — so a park existed in the
    // file (leg 2 green) while the heavier path ran live. This is the pin leg
    // 2 structurally cannot make.
    for (const rel of [
      "src/components/EditorLayout.tsx",
      "src/components/editor-layout/reader-view-prefs.ts",
    ]) {
      const src = read(rel);
      expect(
        /addEventListener\(\s*"scroll",\s*schedule\b/.test(src),
        `${rel} registers the raw scheduler for scroll — route it through the park`,
      ).toBe(false);
      expect(src.includes("onGeometryEvent")).toBe(true);
    }
  });

  it("the grab handle's scroll path fires the park rather than the raw scheduler", () => {
    const src = read("src/text-objects/TextObjectGrabHandle.tsx");
    // `onScroll` must reach `gesturePark.fire()`; the pre-416 body called
    // `scheduleRaf()` directly.
    const body = src.slice(src.indexOf("const onScroll = () => {"));
    const end = body.indexOf("};");
    expect(body.slice(0, end)).toContain("gesturePark.fire()");
  });

  it("the scroll-persist capture is parked, not raw", () => {
    const src = read("src/components/EditorPane.tsx");
    expect(src).toContain("LAYOUT_SITE_SCROLL_PERSIST");
    expect(/addEventListener\(\s*"scroll",\s*onScroll/.test(src)).toBe(true);
    expect(src).toContain("scrollPark.fire()");
  });

  it("the scroll-activity attribute write is idempotence-gated", () => {
    const src = read("src/hooks/useScrollActivityTracker.ts");
    expect(src).toContain('hasAttribute("data-scroll-active")');
  });
});

describe("scroll-listener guardrail — detector fixtures", () => {
  it("flags the plain shape a new follower would be written in", () => {
    const naive = `
      useEffect(() => {
        const onScroll = () => setTop(el.getBoundingClientRect().top);
        scrollEl.addEventListener("scroll", onScroll, { passive: true });
        return () => scrollEl.removeEventListener("scroll", onScroll);
      }, []);
    `;
    expect(detectScrollListener(naive)).toBe(true);
    expect(referencesLayoutGestureApi(naive)).toBe(false);
  });

  it("flags the capture-phase window form", () => {
    expect(
      detectScrollListener(`window.addEventListener('scroll', onScroll, true);`),
    ).toBe(true);
  });

  it("flags the `onscroll` assignment form", () => {
    expect(detectScrollListener(`el.onscroll = () => measure();`)).toBe(true);
  });

  it("flags the React `onScroll` prop (the form the first cut missed)", () => {
    expect(detectScrollListener(`<div onScroll={handleRowsScroll} />`)).toBe(true);
    // …and does not confuse an ordinary handler DECLARATION for a
    // registration: `const onScroll = () => {}` is not a listener.
    expect(detectScrollListener(`const onScroll = () => hide();`)).toBe(false);
  });

  it("does not flag a file that only MENTIONS the pattern in comments", () => {
    const commentOnly = `
      // Never scrollEl.addEventListener("scroll", measure) without a park —
      // see AGENTS.md "Layout-gesture stability".
      export function ok() { return 1; }
    `;
    expect(detectScrollListener(commentOnly)).toBe(false);
  });

  it("does not flag an unrelated listener", () => {
    expect(
      detectScrollListener(`window.addEventListener("resize", onResize);`),
    ).toBe(false);
  });

  it("recognises the kind-filtered channels as participation", () => {
    expect(
      referencesLayoutGestureApi(`if (hasActiveLayoutGesture(["window"])) return;`),
    ).toBe(true);
    expect(
      referencesLayoutGestureApi(`onLayoutGestureSetChange(() => resync());`),
    ).toBe(true);
  });
});

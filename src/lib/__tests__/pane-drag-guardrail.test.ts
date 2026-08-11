// Pane-drag guardrail — the third grep-allowlist sibling (after
// keystroke-subscriber-guardrail + scroll-reposition-guardrail), covering the
// divider-gesture class from the library-UI refactor
// (MEMO_LIBRARY_UI_REFACTOR_2026_07_11 §P5; doctrine: AGENTS.md "Pane-drag
// stability" + library/AGENTS.md "Perf doctrine").
//
// The law: every pane/divider resize gesture runs on the ONE engine at
// `src/lib/pane-resize/` (`usePaneResizeHandle`) — pointer capture on the
// handle, element-scoped listeners, button gates, missed-release failsafe,
// drag shield, RAF-coalesced imperative apply(), commit-once persistence,
// edge-only LayoutGestureBus. The failure class this kills: a bespoke
// window-listener drag handler that loses its pointerup to an iframe
// (hang + ghost-resume + spurious commit), thrashes per-frame React
// state/store/localStorage, or wedges a park flag forever.
//
//   1. SOURCE-GREP ALLOWLIST — walk BOTH silos (`src/` + `library/`), flag
//      every file that pairs a WINDOW/DOCUMENT-level (incl. `document.body` /
//      `document.documentElement`) `pointermove`/`mousemove`/`touchmove`
//      listener with drag-gesture chrome (a `body.style.cursor` write or any
//      CSS resize cursor token), and assert the flagged set equals
//      `PERMITTED_WINDOW_DRAG_GESTURES`. The engine directory itself is
//      excluded (it is the one sanctioned owner of divider gestures — and its
//      listeners are element-scoped under pointer capture anyway, exactly what
//      this grep is steering new code toward).
//   2. RETIRED PRIMITIVES STAY DEAD — the pre-engine gesture plumbing
//      (library/lib/gutter-drag.ts, src/hooks/useDragGap.ts, the
//      `virgil:drag-gap-start/end` window CustomEvents) was deleted; assert no
//      live code references it again.
//
//   3. LIBRARY RESIZEOBSERVER CENSUS — every `new ResizeObserver` under the
//      library silo (`library/` + `src/components/library/`) must be on
//      `PERMITTED_LIBRARY_RESIZE_OBSERVERS` with a why-safe justification.
//      This is the CI teeth for library/AGENTS.md's census: the unparked-RO
//      class (an RO outside the PaneFreeze subtree fires per drag frame →
//      re-renders the Library tree per frame — R4/task-090) and the
//      measured-chrome class (RO → setState → SVG d-string loop) both need a
//      new RO to land, and none of the other greps sees one.
//
// Like its siblings, the grep is a heuristic — "is this gesture safe" is
// semantic — so the allowlist + per-entry justification is what makes it
// robust: a listed site is human-verified as NOT a pane divider (or as
// engine-conformant: snapshot-at-start geometry, RAF-coalesced transient
// writes, commit-once on release). A NEW unlisted window-listener drag
// gesture FAILS CI; so does a new divider that bypasses the engine, since a
// divider needs the cursor chrome OR the shared `.drag-gap`/`.band-grip`
// handle classes this grep keys on (STYLE_GUIDE's documented authoring path).

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../.."); // src/
const LIBRARY = path.resolve(HERE, "../../../library"); // the Library silo
const ENGINE_DIR = path.resolve(SRC, "lib/pane-resize"); // the ONE gesture owner

// ── The permitted window-drag-gesture allowlist ─────────────────────────────
// Repo-relative keys (silo prefix included — one list spans both silos).
// Every entry is human-verified: either it is NOT a pane divider (floats,
// modes, band selection) or its gesture already follows the engine's
// contract (geometry snapshotted at drag start, RAF-coalesced transient
// writes, ONE commit on release, cursor set/cleared on the edges, AND a
// missed-release end edge — capture, a `buttons` bit-test bail, or a blur
// failsafe — so an iframe/focus-loss can't eat the mouseup and ghost-resume
// the gesture). The library silo has NO entries — keep it that way
// (library/AGENTS.md).
const PERMITTED_WINDOW_DRAG_GESTURES: Record<string, string> = {
  "src/components/FloatingPanel.tsx":
    "Floating-window move/edge-resize — a position:fixed float, not a layout pane: per-move setPos re-renders one small float subtree (no layout-pane resize, no store write), onChange persists once on mouseup; body cursor set at gesture edges only.",
  "src/components/drop-mode/controller.ts":
    "Drop-a-card placement mode — not a resize gesture: crosshair/none body cursor stamped on mode edges; the mousemove hit-tests the hovered block for the placement caret (throttled by hit-test bail), commits once on click.",
  "src/components/panel-primitives.tsx":
    "File-level conjunction of three non-divider pieces: clearStaleHover's one-shot self-removing pointermove; the card-lift threshold detector (distance check, then hands off to FloatWindow and removes itself); and the band handle's static cursor-row-resize hit-target className — the band GESTURE itself runs on usePaneResizeHandle.",
  "src/hooks/useDragPosition.ts":
    "Floating-panel drag positioner — RAF-coalesced setPosition (≤1 per frame) on one small fixed panel; body cursor set/cleared on the edges; no persistence (position IS the session state).",
  "src/hooks/useMarginEdit.ts":
    "Margin-edit guides — engine-conformant by hand: frame rect snapshotted at drag start, RAF-coalesced CSS-var writes on the editor column per frame, ONE setLiveMargins commit on release, body cursor on the edges, primary-button start gate + (buttons & 1)===0 mid-move bail + window-blur failsafe closing the missed-release end edge (a release over the compiled-PDF iframe must not ghost-resume or wedge the cursor). Pre-dates the engine; its 4-side axis tables + opposite-side snap live outside the single-value PaneResizeSpec shape.",
  "src/panels/Outline/focus-band-drag.ts":
    "Focus-band edge drag (snap-to-row selection, not a pane resize): row geometry snapshotted at drag start (offsetTop reads, none per frame), RAF-coalesced transient band paint, ONE onSnapBoundary commit on the end edge; body cursor on the edges. Since task 185 it also closes the missed-release end edge the way the engine does — it shares the engine's own predicates (lib/pane-resize/pointer-invariants): primary-button start gate + an isMissedRelease(e) mid-move bail that ends before reading the stray coordinate, plus a teardown end path so unmount can't leave the stamp. Extracted out of OutlinePanel.tsx so the gesture is a testable unit.",
};

// ── The library ResizeObserver census ────────────────────────────────────────
// CI teeth for the census in library/AGENTS.md "Pane-drag doctrine": every
// `new ResizeObserver` under the library silo (`library/` +
// `src/components/library/`) is listed here with its why-safe justification,
// and the same facts live as a comment at the site. This is what keeps the
// unparked-RO class (R4/task-090: an RO outside the PaneFreeze subtree firing
// per drag frame → per-frame Library re-renders) and the measured-chrome
// class (RO → setState → SVG re-path) dead — neither can land without a new
// RO, and no other guardrail grep sees one. A new RO must either park via
// `parkDuringLayoutGesture` (when it could fire mid-gesture) or carry an
// equality-bail justification, in BOTH places.
const PERMITTED_LIBRARY_RESIZE_OBSERVERS: Record<string, string> = {
  "library/components/panel-tabs/PanelTabStrip.tsx":
    "Flush-right tuck measure — the ONE surviving chrome RO (whether the active tab sits flush with the body's right edge is a cross-subtree sum CSS can't express); RAF-coalesced, equality-bailed boolean, parked via parkDuringLayoutGesture.",
  "library/components/LeftList.tsx":
    "Rows-viewport measure — virtualization window height; equality-bailed setState (a horizontal gutter drag doesn't change the height, so mid-drag fires bail to the same state).",
  "library/components/RightDetail.tsx":
    "textPodRect header↔pod pinning — RAF-coalesced, ±0.5px equality gate, parked via parkDuringLayoutGesture (defense-in-depth behind the PaneFreeze width lock).",
  "library/components/PaperHeader.tsx":
    "Narrow flag — boolean threshold from borderBoxSize; React bails unless the 560px line is crossed mid-gesture.",
  "library/hooks/usePgmarkPages.ts":
    "\\pgmark chip re-scan — RAF-coalesced, parked via parkDuringLayoutGesture, and the `pages` array is identity-gated (label+docY) so consumer memos (PaperRender → EditorPane) hold.",
};

// ── The unchromed-resizer allowlist (task 189) ───────────────────────────────
// The POSITIVE half of the class leg above: that leg helps DETECT a bespoke
// gesture, and is structurally blind to the opposite defect — a correct engine
// gesture wearing a hand-rolled LOOK. `usePaneResizeHandle` returns
// `{ onPointerDown, style, aria-hidden, data-pane-resize-* }` and nothing
// visual, so every consumer must put `drag-gap drag-gap-{h,v} band-grip` on the
// element itself (STYLE_GUIDE "Resize gutters", and the engine's own docblock).
// A consumer that genuinely is NOT a pane gutter may wear different chrome —
// but it says so HERE, with why, and it still takes the divider family's tokens
// (`--edge-hover` / `--drag-highlight`), never a one-off accent.
const PERMITTED_UNCHROMED_RESIZERS: Record<string, string> = {
  "library/components/LeftList.tsx":
    "List-COLUMN boundary in the header row's own grid track, not a pane divider: the shared pill is 28px growing to 44px on drag and the header row is content-height (~24-28px), so `band-grip` would overflow and clip. Wears `.list-col-resizer` (library.css) — a full-track bar on the gutter family's OWN tokens (transparent → --edge-hover on :hover → --drag-highlight on the engine's .dragging class), CSS-driven, no JS hover. Adopting `band-grip` here would first require making the shared pill length-aware (clamp its long axis to the strip's extent), which is a change to chrome shared by the other nine sites and its own task.",
};

// ── The announced-separator allowlist (task 189) ─────────────────────────────
// Empty, and that is the statement: Virgil does not yet commit to keyboard /
// screen-reader operation of its dividers (STYLE_GUIDE "Resize gutters" —
// "Accessibility posture"), so no divider may ANNOUNCE itself as one. Four
// library gutters used to carry `role="separator"` + `aria-orientation` +
// `aria-label="Resize …"` — a NAMED, valueless, non-operable splitter: an AT
// user was told a resizer existed in 4 of 10 places, told nothing in the other
// 6, and could operate none of the 15 (10 engine + 5 FloatingPanel edges). The
// half-pattern is worse than silence, so the engine emits `aria-hidden` and the
// hand-rolled roles are gone. An entry here must be a genuinely STATIC,
// non-interactive divider (the structural ARIA role) — never a resize handle;
// a resize handle earns a role by becoming focusable and arrow-operable with
// `aria-valuenow/min/max` wired from its clamp, which is the deferred half.
const PERMITTED_ANNOUNCED_SEPARATORS: Record<string, string> = {};

/** Strip comments so doctrine prose (this repo documents the banned call
 *  forms heavily) can't read as a live gesture. Conservative — only removes
 *  text, never manufactures a match. */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/**
 * The guarded class as a machine-detectable conjunction: a file that
 * (a) attaches a WINDOW- or DOCUMENT-level `pointermove`/`mousemove`/`touchmove`
 * listener — including on `document.body` / `document.documentElement`, which
 * are window-level in every way that matters to the law (the engine owns its
 * pointer via capture with ELEMENT-scoped listeners on the handle instead) —
 * and (b) carries drag-gesture chrome: a `document.body`/`documentElement`
 * cursor write, ANY CSS resize cursor token (`col`/`row`/`ns`/`ew`/`n`/`e`/`s`/
 * `w`/`ne`/`nw`/`se`/`sw`/`nesw`/`nwse`-resize), OR the shared divider handle
 * classes (`.drag-gap[-v|-h]` / `.band-grip`). The class leg is load-bearing:
 * the repo's divider cursors live in those CSS classes (globals.css) and
 * STYLE_GUIDE tells authors to style a divider with them — a bespoke divider
 * written the documented way carries no cursor token of its own, and only
 * this leg catches it. File-level on purpose — the allowlist + justification
 * closes the semantic gap.
 *
 * Each alternation is deliberately as wide as the behavior it stands for — a
 * `document.body` listener, a touch-driven divider, or a corner-resize cursor
 * are all the same class as far as the law is concerned, and a narrower regex
 * would let those idioms pass CI silently (task 187 — the same guard-narrower-
 * than-its-doctrine shape as task 169's `check-radius-tokens.mjs`).
 */
/** A file that spreads a real engine handle onto an element it renders. */
export function detectEngineConsumer(source: string): boolean {
  return /\busePaneResizeHandle\s*\(/.test(stripComments(source));
}

/** The shared divider chrome, as the class the CSS actually keys on. */
export function detectSharedGripChrome(source: string): boolean {
  return /\bband-grip\b/.test(stripComments(source));
}

/**
 * A divider that ANNOUNCES itself — `role="separator"` in any JSX spelling
 * (bare string, braced string). The needle is the ROLE, not `aria-label`,
 * because a label is legitimate on the many real controls these same files
 * render; the role is what turns a decorative strip into a promised widget.
 */
export function detectAnnouncedSeparator(source: string): boolean {
  return /\brole\s*=\s*\{?\s*["']separator["']/.test(stripComments(source));
}

/**
 * The bespoke twin of the same defect: a `data-resize-edge` hit-zone (the
 * FloatingPanel family — 5 divs with mousedown handlers and no engine) carrying
 * an `aria-label`. A bare `<div>`'s implicit role is `generic`, which ARIA
 * prohibits from being named, so such a label is INERT — an attribute that
 * reads as an a11y contract while announcing nothing. Returns the offending
 * tags. Scope is honest: `data-resize-edge` is this repo's own marker for a
 * bespoke resize hit-zone, so a future one that invents a different marker is
 * outside this needle (it would still be caught by the role census above if it
 * announced a role).
 */
export function findLabeledResizeEdges(source: string): string[] {
  const tags = stripComments(source).match(/<[A-Za-z][^>]*data-resize-edge[^>]*>/g) ?? [];
  return tags.filter((t) => /\baria-label\s*=/.test(t));
}

export function detectWindowDragGesture(source: string): boolean {
  const src = stripComments(source);
  const windowLevelMove =
    /(?:window|document)(?:\.body|\.documentElement)?\.addEventListener\(\s*["'](?:pointermove|mousemove|touchmove)["']/.test(
      src,
    );
  const dragChrome =
    /(?:body|documentElement)\.style\.cursor\s*=/.test(src) ||
    // The complete set of CSS resize cursors — `-resize\b`-anchored so a
    // token only matches as a whole cursor keyword (multi-char alternatives
    // first so backtracking never leaves e.g. `nesw` half-matched as `ne`).
    /\b(?:col|row|nesw|nwse|ne|nw|se|sw|ns|ew|n|e|s|w)-resize\b/.test(src) ||
    /\bdrag-gap(?:-v|-h)?\b|\bband-grip\b/.test(src);
  return windowLevelMove && dragChrome;
}

function walkSource(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      // Skip test + fixture trees so the guard never scans itself, and the
      // engine directory — the one sanctioned gesture owner.
      if (entry === "__tests__" || entry === "__fixtures__") continue;
      if (full === ENGINE_DIR) continue;
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

describe("pane-drag guardrail — source allowlist (both silos)", () => {
  const files = walkBothSilos();
  const detected = files
    .filter((f) => detectWindowDragGesture(f.source))
    .map((f) => f.rel)
    .sort();

  it("flags exactly the allowlisted window-drag gestures — no unlisted new ones", () => {
    // If this fails with an EXTRA file: a new window-listener drag gesture
    // landed. If it resizes a pane/divider, it MUST move onto
    // `usePaneResizeHandle` (src/lib/pane-resize) — do not allowlist a bespoke
    // divider. If it is genuinely not a divider (float drag, selection band,
    // placement mode), verify snapshot-at-start + RAF-coalesced writes +
    // commit-once, then add it here with that justification.
    expect(detected).toEqual(Object.keys(PERMITTED_WINDOW_DRAG_GESTURES).sort());
  });

  it("keeps the allowlist free of stale entries (every listed file still exists + still matches)", () => {
    const byRel = new Map(files.map((f) => [f.rel, f.source]));
    for (const rel of Object.keys(PERMITTED_WINDOW_DRAG_GESTURES)) {
      const source = byRel.get(rel);
      expect(source, `${rel} missing from the walk`).toBeDefined();
      expect(detectWindowDragGesture(source as string)).toBe(true);
    }
  });

  it("would flag a NEW unlisted bespoke divider (naive window-listener fixture)", () => {
    // The exact pre-refactor shape (LibraryView's makeResizeHandler / the
    // deleted useDragGap): window listeners + body col-resize cursor, no
    // capture, per-move work.
    const naiveDivider = `
      function makeResizeHandler(apply) {
        return (e) => {
          document.body.style.cursor = "col-resize";
          const onMove = (ev) => apply(ev.clientX);
          const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
          };
          window.addEventListener("pointermove", onMove);
          window.addEventListener("pointerup", onUp);
        };
      }
    `;
    expect(detectWindowDragGesture(naiveDivider)).toBe(true);
    expect(
      Object.keys(PERMITTED_WINDOW_DRAG_GESTURES).some((k) =>
        naiveDivider.includes(k),
      ),
    ).toBe(false);
  });

  it("would flag a class-styled bespoke divider (the documented .drag-gap/band-grip chrome, no cursor write of its own)", () => {
    // The most natural bypass path: copy STYLE_GUIDE's visual convention
    // ("put band-grip on a .drag-gap-{h,v} element") without the engine —
    // the cursor lives in the CSS classes, so the body-cursor/resize-token
    // legs never fire; only the handle-class leg catches this.
    const classStyledDivider = `
      export function BespokeGutter({ onResize }) {
        const onPointerDown = () => {
          const onMove = (ev) => onResize(ev.clientX);
          const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
          };
          window.addEventListener("pointermove", onMove);
          window.addEventListener("pointerup", onUp);
        };
        return h("div", {
          className: "drag-gap drag-gap-v band-grip",
          onPointerDown,
        });
      }
    `;
    expect(detectWindowDragGesture(classStyledDivider)).toBe(true);
  });

  it("would flag a document.body / documentElement listener divider (task 187 hole 1)", () => {
    // `document.body.addEventListener("pointermove", …)` and
    // `document.documentElement.addEventListener(…)` are window-level in every
    // way that matters to the law — the pre-widening regex anchored the root
    // object immediately before `.addEventListener` and missed both.
    const bodyListenerDivider = `
      export function BodyGutter({ apply }) {
        const onPointerDown = () => {
          document.body.style.cursor = "col-resize";
          document.body.addEventListener("pointermove", (ev) => apply(ev.clientX));
        };
        return h("div", { onPointerDown });
      }
    `;
    const docElDivider = `
      export function DocElGutter({ apply }) {
        const onPointerDown = () => {
          document.documentElement.addEventListener("mousemove", (ev) => apply(ev.clientX));
          document.documentElement.style.cursor = "row-resize";
        };
        return h("div", { onPointerDown });
      }
    `;
    expect(detectWindowDragGesture(bodyListenerDivider)).toBe(true);
    expect(detectWindowDragGesture(docElDivider)).toBe(true);
  });

  it("would flag a touch-driven divider (task 187 hole 2)", () => {
    // A `touchmove`-only divider was undetectable pre-widening (the move
    // alternation listed only pointermove|mousemove).
    const touchDivider = `
      export function TouchGutter({ apply }) {
        const onPointerDown = () => {
          document.body.style.cursor = "col-resize";
          window.addEventListener("touchmove", (ev) => apply(ev.touches[0].clientX));
        };
        return h("div", { onPointerDown });
      }
    `;
    expect(detectWindowDragGesture(touchDivider)).toBe(true);
  });

  it("would flag a corner-resize-cursor divider (task 187 hole 3)", () => {
    // Any CSS resize cursor is drag chrome — the pre-widening set enumerated
    // only col/row/ew/ns-resize, so a divider whose cursor was a diagonal or
    // single-axis keyword (e.g. nwse-resize) carried no recognized token.
    const cornerDivider = `
      export function CornerGutter({ apply }) {
        const onPointerDown = () => {
          const onMove = (ev) => apply(ev.clientX);
          window.addEventListener("pointermove", onMove);
        };
        return h("div", { className: "grip", style: { cursor: "nwse-resize" }, onPointerDown });
      }
    `;
    expect(detectWindowDragGesture(cornerDivider)).toBe(true);
  });

  it("does not flag the engine's own shape (element-scoped listeners under capture)", () => {
    const engineShape = `
      el.setPointerCapture(e.pointerId);
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onEnd);
      mountDragShield(axis === "x" ? "col-resize" : "row-resize");
    `;
    expect(detectWindowDragGesture(engineShape)).toBe(false);
  });

  it("does not flag a file that only MENTIONS the pattern in comments", () => {
    const commentOnly = `
      // Never window.addEventListener("pointermove", …) with a
      // document.body.style.cursor = "col-resize" write — use the engine.
      export function ok() { return 1; }
    `;
    expect(detectWindowDragGesture(commentOnly)).toBe(false);
  });
});

describe("pane-drag guardrail — retired primitives stay dead", () => {
  const files = walkBothSilos();

  it("the pre-engine gesture modules stay deleted", () => {
    // library/lib/gutter-drag.ts (the module-level park flag whose single-
    // caller end edge wedged all tab-chrome observers) and
    // src/hooks/useDragGap.ts (the editor's window-listener divider family).
    expect(existsSync(path.join(LIBRARY, "lib/gutter-drag.ts"))).toBe(false);
    expect(existsSync(path.join(SRC, "hooks/useDragGap.ts"))).toBe(false);
  });

  it("no live code references the retired gutter-drag / useDragGap modules", () => {
    for (const f of files) {
      const src = stripComments(f.source);
      expect(/\bgutter-drag\b/.test(src), `${f.rel} references gutter-drag`).toBe(
        false,
      );
      expect(/\buseDragGap\b/.test(src), `${f.rel} references useDragGap`).toBe(
        false,
      );
    }
  });

  it("no live code dispatches or listens for the retired virgil:drag-gap events", () => {
    // Replaced by the LayoutGestureBus (edge-only, engine-internal begin/end).
    for (const f of files) {
      const src = stripComments(f.source);
      expect(
        /virgil:drag-gap-(?:start|end)/.test(src),
        `${f.rel} references virgil:drag-gap-start/end`,
      ).toBe(false);
    }
  });
});

describe("pane-drag guardrail — library ResizeObserver census", () => {
  const files = walkBothSilos().filter(
    (f) =>
      f.rel.startsWith("library/") ||
      f.rel.startsWith("src/components/library/"),
  );
  const detected = files
    .filter((f) => /\bnew\s+ResizeObserver\b/.test(stripComments(f.source)))
    .map((f) => f.rel)
    .sort();

  it("every ResizeObserver in the library silo is on the census allowlist — no unlisted new ones", () => {
    // If this fails with an EXTRA file: a new ResizeObserver landed in the
    // library silo. First ask whether layout can express the relationship
    // (container query, constant caps + stretchable middle — the
    // FolderTabChrome pattern); if it genuinely needs an RO, park it via
    // `parkDuringLayoutGesture` when it could fire mid-gesture, equality-bail its
    // setState, and add it here + to the library/AGENTS.md census with the
    // same justification.
    expect(detected).toEqual(
      Object.keys(PERMITTED_LIBRARY_RESIZE_OBSERVERS).sort(),
    );
  });

  it("keeps the census free of stale entries (every listed file still exists + still constructs an RO)", () => {
    const byRel = new Map(files.map((f) => [f.rel, f.source]));
    for (const rel of Object.keys(PERMITTED_LIBRARY_RESIZE_OBSERVERS)) {
      const source = byRel.get(rel);
      expect(source, `${rel} missing from the walk`).toBeDefined();
      expect(
        /\bnew\s+ResizeObserver\b/.test(stripComments(source as string)),
        `${rel} no longer constructs a ResizeObserver — drop its census entry`,
      ).toBe(true);
    }
  });
});

// ── Task 189: the engine owns the gesture, the .dragging hook and the a11y
// semantics; the CONSUMER owns the look. Both halves of that split need a
// census, because the pre-existing legs above are structurally blind to them:
// they detect a bespoke GESTURE, and a hand-rolled LOOK (or a hand-rolled
// ROLE) on a perfectly correct gesture matches none of their needles. That is
// exactly how one of ten consumers drifted onto `--accent` with JS hover and an
// inert `.dragging` class, and how four of ten grew a half-implemented ARIA
// splitter, with CI green throughout.
describe("pane-drag guardrail — engine-consumer chrome census (task 189)", () => {
  const files = walkBothSilos();
  const consumers = files.filter((f) => detectEngineConsumer(f.source));

  it("finds every engine consumer in both silos (the census can see)", () => {
    // Anchored on a count rather than a list so ordinary refactors don't churn
    // it, but low enough that a walk which stopped working can't pass.
    expect(consumers.length).toBeGreaterThanOrEqual(6);
  });

  it("every engine consumer wears the shared band-grip chrome, or is an explicitly justified exception", () => {
    // EXTRA file here = a divider that spreads the engine's props and paints
    // its own look. Put `drag-gap drag-gap-{h,v} band-grip` on the element
    // (STYLE_GUIDE "Resize gutters"); allowlist ONLY a control that genuinely
    // is not a pane gutter, and even then keep it on --edge-hover /
    // --drag-highlight and let the engine's `.dragging` class drive the active
    // state, so hover and drag stay distinguishable.
    const unchromed = consumers
      .filter((f) => !detectSharedGripChrome(f.source))
      .map((f) => f.rel)
      .sort();
    expect(unchromed).toEqual(Object.keys(PERMITTED_UNCHROMED_RESIZERS).sort());
  });

  it("keeps the unchromed allowlist free of stale entries (still a consumer, still unchromed)", () => {
    const byRel = new Map(files.map((f) => [f.rel, f.source]));
    for (const rel of Object.keys(PERMITTED_UNCHROMED_RESIZERS)) {
      const source = byRel.get(rel);
      expect(source, `${rel} missing from the walk`).toBeDefined();
      expect(
        detectEngineConsumer(source as string),
        `${rel} no longer consumes the engine — drop its allowlist entry`,
      ).toBe(true);
      expect(
        detectSharedGripChrome(source as string),
        `${rel} now wears band-grip — drop its allowlist entry`,
      ).toBe(false);
    }
  });

  it("the one allowlisted exception still takes the divider family's tokens, not a one-off accent", () => {
    // The allowlist buys a different SHAPE, never a different palette. Read
    // from the stylesheet that paints it, since the chrome moved out of the
    // component when it stopped being hand-rolled in JS.
    const css = readFileSync(
      path.resolve(LIBRARY, "styles/library.css"),
      "utf8",
    );
    const rule = css.slice(css.indexOf(".list-col-resizer"));
    expect(rule).toContain("var(--edge-hover)");
    expect(rule).toContain("var(--drag-highlight)");
    // The pre-189 look: `--accent` (#7c5e3c) driven from React mouseenter,
    // with the engine's `.dragging` class unused so hover === active drag.
    expect(/\.list-col-resizer[^}]*var\(--accent\)/.test(rule)).toBe(false);
    expect(rule).toContain(".list-col-resizer.dragging");
    const leftList = readFileSync(
      path.resolve(LIBRARY, "components/LeftList.tsx"),
      "utf8",
    );
    expect(stripComments(leftList)).not.toMatch(/onMouseEnter|onMouseLeave/);
  });

  it("would flag a new consumer that hand-rolls its look (fixture)", () => {
    const handRolled = `
      export function DriftingGutter() {
        const handle = usePaneResizeHandle({ id: "x", axis: "x" });
        return h("div", { ...handle, style: { background: "var(--accent)" } });
      }
    `;
    expect(detectEngineConsumer(handRolled)).toBe(true);
    expect(detectSharedGripChrome(handRolled)).toBe(false);
  });
});

describe("pane-drag guardrail — divider a11y-announcement census (task 189)", () => {
  const files = walkBothSilos();

  it("no divider announces itself as an operable separator while none is operable", () => {
    // Virgil's recorded posture (STYLE_GUIDE "Resize gutters" →
    // "Accessibility posture"): dividers are pointer-only, so they say NOTHING
    // rather than claiming a splitter role they cannot honor. The engine emits
    // `aria-hidden` for all ten gutters — a consumer that adds a role back
    // overrides it and reinstates the half-pattern.
    const announced = files
      .filter((f) => detectAnnouncedSeparator(f.source))
      .map((f) => f.rel)
      .sort();
    expect(announced).toEqual(Object.keys(PERMITTED_ANNOUNCED_SEPARATORS).sort());
  });

  it("no bespoke resize hit-zone carries an inert aria-label (a bare div is role=generic, which ARIA forbids naming)", () => {
    for (const f of files) {
      expect(
        findLabeledResizeEdges(f.source),
        `${f.rel} labels a data-resize-edge hit-zone — the label is inert; use aria-hidden and keep the identity on data-resize-edge`,
      ).toEqual([]);
    }
  });

  it("the FloatingPanel edges are hidden rather than merely unlabeled (the census can see)", () => {
    // Anchors the leg above on the real file, so it can't pass because the
    // edges were deleted or renamed out from under it.
    const source = readFileSync(
      path.resolve(SRC, "components/FloatingPanel.tsx"),
      "utf8",
    );
    const tags =
      stripComments(source).match(/<[A-Za-z][^>]*data-resize-edge[^>]*>/g) ?? [];
    expect(tags).toHaveLength(5);
    for (const t of tags) expect(t).toMatch(/\baria-hidden\b/);
  });

  it("would flag a hand-rolled announced separator and an inert edge label (fixtures)", () => {
    expect(
      detectAnnouncedSeparator(`h("div", { role: "separator" })`),
    ).toBe(false); // object form is not the JSX attribute this guards
    expect(detectAnnouncedSeparator(`<div role="separator" {...handle} />`)).toBe(
      true,
    );
    expect(detectAnnouncedSeparator(`<div role={"separator"} {...handle} />`)).toBe(
      true,
    );
    expect(
      findLabeledResizeEdges(
        `<div data-resize-edge="left" aria-label="Resize left edge" />`,
      ),
    ).toHaveLength(1);
    expect(
      findLabeledResizeEdges(`<div data-resize-edge="left" aria-hidden />`),
    ).toHaveLength(0);
  });
});

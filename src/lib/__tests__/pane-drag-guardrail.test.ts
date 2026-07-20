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
// edge-only PaneDragBus. The failure class this kills: a bespoke
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
// `parkDuringPaneDrag` (when it could fire mid-gesture) or carry an
// equality-bail justification, in BOTH places.
const PERMITTED_LIBRARY_RESIZE_OBSERVERS: Record<string, string> = {
  "library/components/panel-tabs/PanelTabStrip.tsx":
    "Flush-right tuck measure — the ONE surviving chrome RO (whether the active tab sits flush with the body's right edge is a cross-subtree sum CSS can't express); RAF-coalesced, equality-bailed boolean, parked via parkDuringPaneDrag.",
  "library/components/LeftList.tsx":
    "Rows-viewport measure — virtualization window height; equality-bailed setState (a horizontal gutter drag doesn't change the height, so mid-drag fires bail to the same state).",
  "library/components/RightDetail.tsx":
    "textPodRect header↔pod pinning — RAF-coalesced, ±0.5px equality gate, parked via parkDuringPaneDrag (defense-in-depth behind the PaneFreeze width lock).",
  "library/components/PaperHeader.tsx":
    "Narrow flag — boolean threshold from borderBoxSize; React bails unless the 560px line is crossed mid-gesture.",
  "library/hooks/usePgmarkPages.ts":
    "\\pgmark chip re-scan — RAF-coalesced, parked via parkDuringPaneDrag, and the `pages` array is identity-gated (label+docY) so consumer memos (PaperRender → EditorPane) hold.",
};

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
    // Replaced by the PaneDragBus (edge-only, engine-internal begin/end).
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
    // `parkDuringPaneDrag` when it could fire mid-gesture, equality-bail its
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

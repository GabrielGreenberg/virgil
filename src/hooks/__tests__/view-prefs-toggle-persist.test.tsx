// @vitest-environment jsdom
//
// Toggle→persist regression guard.
//
// The registry round-trip test (`view-prefs-registry-roundtrip.test.ts`)
// exercises only the `loadPrefs()` READ path. THIS test drives the live
// toggle → `update` → `persist` WRITE path through React, where a real bug
// lived: `update` ran `persist` (which writes localStorage AND fires
// `notifySameWindow` → `rereadGlobal` → a re-entrant `setPrefs`) INSIDE the
// `setPrefs` updater. React invokes a state updater more than once per dispatch
// (the eager bail-out computation at dispatch + the render-phase replay, and
// again under StrictMode), so the re-entrant `setPrefs` corrupted the update
// queue and a boolean toggle was applied twice, reverting to its original
// value — "the toggle won't stick / resets on reload".
//
// Reproducing it needs the REAL conditions: a component rendered in
// <StrictMode> and a real DOM click (a bare `renderHook(...).toggle()` call
// does NOT take React's eager-dispatch path, so it can't surface the revert —
// which is exactly why earlier unit tests missed this). A global toggle must
// flip ONCE and persist; it must not bounce back.
import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from "vitest";

const WINDOW_ID = "test-window";
vi.mock("@/lib/multi-window/window-id", () => ({ getWindowId: () => WINDOW_ID }));
// useViewPrefs transitively pulls `@/lib/storage` (require("@/lib/storage-fsa")
// can't be aliased by vitest — see vitest_extension_barrel_storage_mock memo).
vi.mock("@/lib/storage", () => ({ isDevStorage: false }));
// The cross-window bus uses BroadcastChannel (absent in jsdom). Stub it — the
// revert came from the SAME-window `notifySameWindow` path (internal to the
// hook), not the bus, so the regression still reproduces without it.
vi.mock("@/lib/multi-window/bus", () => ({
  publish: () => {},
  subscribe: () => () => {},
}));

import { StrictMode } from "react";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { useViewPrefs } from "../useViewPrefs";

const GLOBAL_KEY = "virgil-view-prefs/global";
const persistedGlobal = () =>
  JSON.parse(localStorage.getItem(GLOBAL_KEY) || "{}");

// The project's jsdom env doesn't ship a full Storage; install minimal
// in-memory shims (mirrors view-prefs-registry-roundtrip.test.ts).
function installStorageShim(name: "localStorage" | "sessionStorage") {
  const store = new Map<string, string>();
  Object.defineProperty(window, name, {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  });
}

/** A button bound to a view toggle; its label is the current value, so the
 *  rendered text doubles as the live React-state assertion. */
function Toggle({
  pick,
  onClick,
  testId,
}: {
  // `pick` reads the live toggle state, which lives on the `prefs` slice of
  // the hook return (NOT the return root). `onClick` gets the full return so
  // it can call the `toggle*` setters.
  pick: (prefs: ReturnType<typeof useViewPrefs>["prefs"]) => boolean;
  onClick: (vp: ReturnType<typeof useViewPrefs>) => void;
  testId: string;
}) {
  const vp = useViewPrefs();
  return (
    <button data-testid={testId} onClick={() => onClick(vp)}>
      {String(pick(vp.prefs))}
    </button>
  );
}

describe("useViewPrefs — global toggles persist through a real click (no revert)", () => {
  beforeAll(() => {
    installStorageShim("localStorage");
    installStorageShim("sessionStorage");
  });

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    cleanup(); // unmount between renders (no auto-cleanup configured here)
  });

  // NOTE ON THE SHIPPED DEFAULT: each toggle's default is owned by
  // `useViewPrefs.defaults.json` and is REWRITTEN by the promote-personal-prefs
  // pipeline (e.g. `showParTitles` flipped false→true in the 2026-07-04 promote).
  // These tests guard the toggle→persist→no-revert BEHAVIOR, which is independent
  // of that value — so read the live default from the rendered button rather than
  // hard-coding it, and assert the flip relative to it. The persisted value must
  // equal the flipped React state; the revert bug wrote its opposite.

  it("Paragraph titles: click flips state AND persists the flipped value (no revert)", () => {
    const { getByTestId } = render(
      <StrictMode>
        <Toggle
          testId="par"
          pick={(p) => p.showParTitles}
          onClick={(vp) => vp.toggleParTitles()}
        />
      </StrictMode>,
    );
    const btn = getByTestId("par");
    const start = btn.textContent === "true"; // shipped default (promoted; not asserted)

    fireEvent.click(btn);

    // React state flipped...
    expect(btn.textContent).toBe(String(!start));
    // ...AND it actually landed in the global blob. The bug wrote the flipped
    // value then immediately re-wrote the original, so a reload read the original.
    expect(persistedGlobal().showParTitles).toBe(!start);
  });

  it("Paragraph titles: a second click toggles back and persists the round-trip", () => {
    const { getByTestId } = render(
      <StrictMode>
        <Toggle
          testId="par"
          pick={(p) => p.showParTitles}
          onClick={(vp) => vp.toggleParTitles()}
        />
      </StrictMode>,
    );
    const btn = getByTestId("par");
    const start = btn.textContent === "true";
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(btn.textContent).toBe(String(start));
    expect(persistedGlobal().showParTitles).toBe(start);
  });

  it("% comments twin persists (no revert)", () => {
    const { getByTestId } = render(
      <StrictMode>
        <Toggle
          testId="lc"
          pick={(p) => p.showLatexComments}
          onClick={(vp) => vp.toggleLatexComments()}
        />
      </StrictMode>,
    );
    const btn = getByTestId("lc");
    const start = btn.textContent === "true";
    fireEvent.click(btn);
    expect(btn.textContent).toBe(String(!start));
    expect(persistedGlobal().showLatexComments).toBe(!start);
  });

  it("a generic registry toggle (heading labels) persists (no revert)", () => {
    const { getByTestId } = render(
      <StrictMode>
        <Toggle
          testId="hl"
          pick={(p) => p.showHeadingLabels}
          onClick={(vp) => vp.toggleViewPref("showHeadingLabels")}
        />
      </StrictMode>,
    );
    const btn = getByTestId("hl");
    const start = btn.textContent === "true";
    fireEvent.click(btn);
    expect(btn.textContent).toBe(String(!start));
    expect(persistedGlobal().showHeadingLabels).toBe(!start);
  });
});

// @vitest-environment jsdom
//
// Task 674 — ONE FAULT DOMAIN PER STORED BLOB.
//
// View prefs live in two independent localStorage blobs of very different
// value to the user:
//
//   `virgil-view-prefs/window/<id>`  the LAYOUT — disposable, any session
//                                    rebuilds it.
//   `virgil-view-prefs/global`       the durable PREFERENCES — page width,
//                                    the four editor margins, print options,
//                                    divider + marginalia config. Tuned once,
//                                    expected to last.
//
// `loadPrefs` read and repaired both inside ONE try/catch, so their failure
// modes were fused: a single truncated per-window blob threw, the whole load
// fell back to `DEFAULT_PREFS`, and the user's very next gesture ran
// `persist`, which serializes the WHOLE global slice from that defaults
// object over the still-perfectly-valid global blob. The durable preferences
// were then gone from disk — silently, with no notice and no recoverable
// copy. The disposable blob could destroy the durable one.
//
// Every `expect` marked "(defect leg)" fails on the pre-674 loader.
import { describe, it, expect, beforeEach, vi } from "vitest";

const WINDOW_ID = "test-window";
vi.mock("@/lib/multi-window/window-id", () => ({ getWindowId: () => WINDOW_ID }));
vi.mock("@/lib/storage", () => ({ isDevStorage: false }));

import { loadPrefs } from "../useViewPrefs";

const GLOBAL_KEY = "virgil-view-prefs/global";
const WINDOW_KEY = `virgil-view-prefs/window/${WINDOW_ID}`;

/** Non-default durable preferences — the things a user tunes once. */
const TUNED_GLOBAL = {
  pageWidth: 1234,
  editorLeftMargin: 211,
  dividerWidth: "mid",
};
/** Non-default per-window layout. */
const TUNED_WINDOW = {
  panelWidths: { left: 321 },
  panelModes: { notes: "expanded" },
};

beforeEach(() => localStorage.clear());

describe("loadPrefs — a corrupt blob costs only ITS OWN store", () => {
  it.each([
    ["truncated JSON", "{oh no"],
    // `JSON.parse("null")` succeeds, so the pre-674 loader sailed past the
    // parse and threw one line later on `Object.keys(windowParsed)`.
    ["the literal null", "null"],
    ["an array", "[1,2,3]"],
    ["a bare number", "42"],
  ])("a %s WINDOW blob leaves every global preference intact", (_label, raw) => {
    localStorage.setItem(WINDOW_KEY, raw);
    localStorage.setItem(GLOBAL_KEY, JSON.stringify(TUNED_GLOBAL));

    const prefs = loadPrefs();

    // (defect leg) — pre-674 these were the shipped defaults 880 / 155 / "text".
    expect(prefs.pageWidth).toBe(1234);
    expect(prefs.editorLeftMargin).toBe(211);
    expect(prefs.dividerWidth).toBe("mid");
  });

  it.each([
    ["truncated JSON", "{oh no"],
    ["the literal null", "null"],
    ["an array", "[1,2,3]"],
  ])("a %s GLOBAL blob leaves the per-window layout intact", (_label, raw) => {
    localStorage.setItem(WINDOW_KEY, JSON.stringify(TUNED_WINDOW));
    localStorage.setItem(GLOBAL_KEY, raw);

    const prefs = loadPrefs();

    // (defect leg) — pre-674 the layout was discarded along with the prefs.
    expect(prefs.panelWidths).toEqual({ left: 321 });
    expect(prefs.panelModes).toEqual({ notes: "expanded" });
    // …and the preferences DO fall back, which is the honest half.
    expect(prefs.pageWidth).toBe(880);
  });

  it("only the corrupt blob's OWN fields fall back", () => {
    localStorage.setItem(WINDOW_KEY, "{oh no");
    localStorage.setItem(GLOBAL_KEY, JSON.stringify(TUNED_GLOBAL));

    const prefs = loadPrefs();

    expect(prefs.pageWidth).toBe(1234); // kept
    expect(prefs.panelWidths).toEqual({}); // defaulted
  });
});

describe("loadPrefs — an unreadable blob is QUARANTINED, not overwritten", () => {
  it("copies the raw bytes aside before any write can replace them", () => {
    localStorage.setItem(WINDOW_KEY, "{oh no");
    loadPrefs();
    // (defect leg) — pre-674 nothing was kept, so the next `persist` was the
    // last moment the bytes existed anywhere.
    expect(localStorage.getItem(`${WINDOW_KEY}.corrupt`)).toBe("{oh no");
  });

  it("quarantines the global blob under its own key", () => {
    localStorage.setItem(GLOBAL_KEY, "}{");
    loadPrefs();
    expect(localStorage.getItem(`${GLOBAL_KEY}.corrupt`)).toBe("}{");
  });

  it("keeps the FIRST copy — a repeated failure cannot churn over it", () => {
    localStorage.setItem(WINDOW_KEY, "{oh no");
    loadPrefs();
    // A later session writes a fresh (also-corrupt) blob over the bad one;
    // the original quarantine must survive, since it is the recoverable one.
    localStorage.setItem(WINDOW_KEY, "###");
    loadPrefs();
    expect(localStorage.getItem(`${WINDOW_KEY}.corrupt`)).toBe("{oh no");
  });

  it("does not quarantine a blob that reads fine", () => {
    localStorage.setItem(WINDOW_KEY, JSON.stringify(TUNED_WINDOW));
    localStorage.setItem(GLOBAL_KEY, JSON.stringify(TUNED_GLOBAL));
    loadPrefs();
    expect(localStorage.getItem(`${WINDOW_KEY}.corrupt`)).toBeNull();
    expect(localStorage.getItem(`${GLOBAL_KEY}.corrupt`)).toBeNull();
  });

});

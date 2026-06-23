// @vitest-environment jsdom
//
// Ephemeral-mode regression guard (the Library-Reader-refactor safety property).
//
// `useViewPrefs({ persistence: "ephemeral" })` runs the SAME view-state engine
// as the main app — every setter and the stacked dock engine still mutate the
// in-memory `prefs` — but the three persistence touch-points are gated OFF:
//   (a) the initial-load-from-localStorage effect,
//   (b) the cross-window / same-window global-pref bus subscription, and
//   (c) the `persist` tail (`localStorage.setItem` + peer `publish`/notify).
//
// This guards the CORE invariant of the refactor: the Library Reader (which
// mounts the hook ephemerally) must NEVER clobber the user's real, persisted
// editor layout. If a future edit re-wires a setter to persist in ephemeral
// mode, the localStorage spy here fails loudly.
//
// We assert all three legs:
//   1. ephemeral: a setter (`setEditorLeftMargin`) + a dockStack mutation
//      (`openPanelDocked`) DO change the in-memory `prefs`, but
//   2. ephemeral: NOTHING is written to the view-pref localStorage keys, and
//   3. global (default / no-arg): the SAME setter DOES persist (contrast).
import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from "vitest";

const WINDOW_ID = "test-window";
vi.mock("@/lib/multi-window/window-id", () => ({ getWindowId: () => WINDOW_ID }));
// useViewPrefs transitively pulls `@/lib/storage` (require("@/lib/storage-fsa")
// can't be aliased by vitest — see vitest_extension_barrel_storage_mock memo).
vi.mock("@/lib/storage", () => ({ isDevStorage: false }));
// The cross-window bus uses BroadcastChannel (absent in jsdom). Stub publish so
// the global-mode contrast case can persist without throwing, and capture it so
// we can assert ephemeral mode never fans out to peers.
const publishSpy = vi.fn();
vi.mock("@/lib/multi-window/bus", () => ({
  publish: (...args: unknown[]) => publishSpy(...args),
  subscribe: () => () => {},
}));

import { render, fireEvent, cleanup } from "@testing-library/react";
import { useViewPrefs } from "../useViewPrefs";

const GLOBAL_KEY = "virgil-view-prefs/global";
const WINDOW_KEY = `virgil-view-prefs/window/${WINDOW_ID}`;

// The project's jsdom env doesn't ship a full Storage; install minimal
// in-memory shims (mirrors view-prefs-registry-roundtrip.test.ts). We keep a
// handle on the live `setItem` so the test can spy on it.
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

/** A harness that exposes the hook return so a click can drive setters, and
 *  renders the live margin value so the rendered text doubles as the in-memory
 *  state assertion. */
function Harness({
  persistence,
  onClick,
  read,
}: {
  persistence?: "global" | "ephemeral";
  onClick: (vp: ReturnType<typeof useViewPrefs>) => void;
  read: (vp: ReturnType<typeof useViewPrefs>) => string;
}) {
  const vp = useViewPrefs(persistence ? { persistence } : undefined);
  return (
    <button data-testid="btn" onClick={() => onClick(vp)}>
      {read(vp)}
    </button>
  );
}

describe("useViewPrefs — ephemeral mode mutates memory but never persists", () => {
  beforeAll(() => {
    installStorageShim("localStorage");
    installStorageShim("sessionStorage");
  });

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    publishSpy.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("(a) ephemeral: a setter DOES change the in-memory prefs", () => {
    const { getByTestId } = render(
      <Harness
        persistence="ephemeral"
        onClick={(vp) => vp.setEditorLeftMargin(123)}
        read={(vp) => String(vp.prefs.editorLeftMargin)}
      />,
    );
    const btn = getByTestId("btn");
    const before = btn.textContent;
    fireEvent.click(btn);
    // In-memory state advanced (123 is within the [72,240] clamp).
    expect(btn.textContent).toBe("123");
    expect(btn.textContent).not.toBe(before);
  });

  it("(a) ephemeral: a dockStack mutation (openPanelDocked) DOES change prefs", () => {
    const { getByTestId } = render(
      <Harness
        persistence="ephemeral"
        onClick={(vp) => vp.openPanelDocked("notes", "left")}
        read={(vp) => vp.prefs.dockStack.left.join(",")}
      />,
    );
    const btn = getByTestId("btn");
    expect(btn.textContent).toBe(""); // empty stack to start
    fireEvent.click(btn);
    expect(btn.textContent).toBe("notes"); // engine ran in-memory
  });

  it("(b) ephemeral: NOTHING is written to the view-pref localStorage keys", () => {
    const setItemSpy = vi.spyOn(window.localStorage, "setItem");
    const { getByTestId } = render(
      <Harness
        persistence="ephemeral"
        onClick={(vp) => {
          vp.setEditorLeftMargin(123);
          vp.openPanelDocked("notes", "left");
        }}
        read={(vp) => String(vp.prefs.editorLeftMargin)}
      />,
    );
    fireEvent.click(getByTestId("btn"));

    // Not a single setItem for either view-pref blob...
    const touchedKeys = setItemSpy.mock.calls.map((c) => c[0]);
    expect(touchedKeys).not.toContain(GLOBAL_KEY);
    expect(touchedKeys).not.toContain(WINDOW_KEY);
    // ...and the keys genuinely never materialized.
    expect(localStorage.getItem(GLOBAL_KEY)).toBeNull();
    expect(localStorage.getItem(WINDOW_KEY)).toBeNull();
    // ...and ephemeral mode never fans a global-pref change out to peers.
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it("(c) global (default / no-arg): the SAME setter DOES persist — contrast", () => {
    const { getByTestId } = render(
      <Harness
        // no `persistence` → global mode (byte-identical to the prior behavior)
        onClick={(vp) => vp.setEditorLeftMargin(123)}
        read={(vp) => String(vp.prefs.editorLeftMargin)}
      />,
    );
    fireEvent.click(getByTestId("btn"));

    // In-memory advanced AND it landed on disk (editorLeftMargin is a GLOBAL
    // key, so it persists into the global blob).
    expect(getByTestId("btn").textContent).toBe("123");
    const globalBlob = JSON.parse(localStorage.getItem(GLOBAL_KEY) ?? "{}");
    expect(globalBlob.editorLeftMargin).toBe(123);
  });
});

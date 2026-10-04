// @vitest-environment jsdom
//
// Task 899 — "band follows icon" at EVERY door that changes a panel's side.
//
// `placements` change side through three doors: `movePanel` (a drag), the
// load-time one-shot side migrations (`reports-right`), and a peer window's
// sync. Only the drag used to relocate the panel's open band, so after the
// other two the strip icon sat on one side while the band rendered in the
// opposite column. All three now end in `reconcileDockStackToPlacements`.
//
// Plus the Reader seed: `seedEphemeralPrefs` used to read RAW placements (no
// renames, no side migrations), so a legacy id was dropped and Reports showed
// on its pre-migration side.
//
// Defect legs: every `expect` marked "(defect leg)" fails on the pre-899 hook.
import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from "vitest";

const WINDOW_ID = "test-window";
vi.mock("@/lib/multi-window/window-id", () => ({ getWindowId: () => WINDOW_ID }));
vi.mock("@/lib/storage", () => ({ isDevStorage: false }));
vi.mock("@/lib/multi-window/bus", () => ({
  publish: () => {},
  subscribe: () => () => {},
}));

import { render, cleanup, act } from "@testing-library/react";
import { loadPrefs, useViewPrefs, type ViewPrefs } from "../useViewPrefs";
import { reconcileDockStackToPlacements, redockAt } from "../view-prefs-dock";
import { PANEL_SIDE_MIGRATIONS } from "../panel-side-migrations";

const GLOBAL_KEY = "virgil-view-prefs/global";
const WINDOW_KEY = `virgil-view-prefs/window/${WINDOW_ID}`;
const ALL_MIGRATIONS = PANEL_SIDE_MIGRATIONS.map((m) => m.id);

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

const sideOf = (p: ViewPrefs, id: string) => p.placements.find((x) => x.id === id)?.side;

let live: ViewPrefs | null = null;
function Probe({ persistence }: { persistence?: "ephemeral" }) {
  const vp = useViewPrefs(persistence ? { persistence } : undefined);
  live = vp.prefs;
  return null;
}

beforeAll(() => {
  installStorageShim("localStorage");
  installStorageShim("sessionStorage");
});
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  live = null;
});
afterEach(() => cleanup());

describe("reconcileDockStackToPlacements — the pure enforcer", () => {
  it("moves a band docked on the wrong side to its placement's side", () => {
    const p: ViewPrefs = {
      ...loadPrefs(),
      placements: [{ id: "notes", side: "left" }, { id: "outline", side: "left" }],
      dockStack: { left: ["outline"], right: ["notes"] },
    };
    const out = reconcileDockStackToPlacements(p);
    expect(out.dockStack.left).toEqual(["outline", "notes"]);
    expect(out.dockStack.right).toEqual([]);
  });

  it("returns a consistent snapshot by identity", () => {
    const p: ViewPrefs = {
      ...loadPrefs(),
      placements: [{ id: "notes", side: "right" }],
      dockStack: { left: [], right: ["notes"] },
    };
    expect(reconcileDockStackToPlacements(p)).toBe(p);
  });
});

describe("the load door — a side migration carries the docked band", () => {
  it("Reports docked LEFT under reports-right → band on the right (defect leg)", () => {
    localStorage.setItem(GLOBAL_KEY, JSON.stringify({ placements: [{ id: "reports", side: "left" }] }));
    localStorage.setItem(WINDOW_KEY, JSON.stringify({ dockStack: { left: ["reports"], right: [] } }));
    const p = loadPrefs();
    expect(sideOf(p, "reports")).toBe("right");
    expect(p.dockStack.left).not.toContain("reports");
    expect(p.dockStack.right).toContain("reports");
  });
});

describe("the peer-sync door — a peer's drag carries this window's band", () => {
  it("a peer moving a docked panel across → band follows (defect leg)", () => {
    localStorage.setItem(
      GLOBAL_KEY,
      JSON.stringify({
        placements: [{ id: "notes", side: "right" }],
        appliedPrefMigrations: ALL_MIGRATIONS,
      }),
    );
    localStorage.setItem(WINDOW_KEY, JSON.stringify({ dockStack: { left: [], right: ["notes"] } }));
    render(<Probe />);
    expect(live!.dockStack.right).toContain("notes");

    localStorage.setItem(
      GLOBAL_KEY,
      JSON.stringify({
        placements: [{ id: "notes", side: "left" }],
        appliedPrefMigrations: ALL_MIGRATIONS,
      }),
    );
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: GLOBAL_KEY }));
    });
    expect(sideOf(live!, "notes")).toBe("left");
    expect(live!.dockStack.left).toContain("notes");
    expect(live!.dockStack.right).not.toContain("notes");
  });
});

describe("the Reader seed reads the repaired placements", () => {
  it("a legacy `suggestions` placement is RENAMED, keeping the user's side (defect leg)", () => {
    localStorage.setItem(
      GLOBAL_KEY,
      JSON.stringify({
        placements: [{ id: "suggestions", side: "left" }],
        appliedPrefMigrations: ALL_MIGRATIONS,
      }),
    );
    render(<Probe persistence="ephemeral" />);
    expect(sideOf(live!, "revisions")).toBe("left");
  });

  it("a pre-migration Reports placement shows on its migrated side (defect leg)", () => {
    localStorage.setItem(GLOBAL_KEY, JSON.stringify({ placements: [{ id: "reports", side: "left" }] }));
    render(<Probe persistence="ephemeral" />);
    expect(sideOf(live!, "reports")).toBe("right");
  });
});

// Task 928 — the fourth door. `redockPanel` wrote the band on the DROP side
// and never touched `placements`, so a float dropped on the other column sat
// opposite its icon until the next reconcile yanked it home.
describe("the redock door — a cross-side drop moves the icon with the band", () => {
  it("pure: same-side redock leaves placements alone", () => {
    const p: ViewPrefs = {
      ...loadPrefs(),
      placements: [{ id: "notes", side: "left" }, { id: "outline", side: "left" }],
      dockStack: { left: ["outline"], right: [] },
      poppedOutPanels: ["notes"],
    };
    const out = redockAt(p, "notes", "left", 0);
    expect(out.placements).toBe(p.placements);
    expect(out.dockStack.left).toEqual(["notes", "outline"]);
    expect(out.poppedOutPanels).not.toContain("notes");
  });

  it("pure: cross-side redock moves the placement, and reconcile leaves it put (defect leg)", () => {
    const p: ViewPrefs = {
      ...loadPrefs(),
      placements: [{ id: "notes", side: "left" }, { id: "outline", side: "right" }],
      dockStack: { left: [], right: ["outline"] },
      poppedOutPanels: ["notes"],
    };
    const out = redockAt(p, "notes", "right", 0);
    expect(sideOf(out, "notes")).toBe("right");
    expect(out.dockStack.right).toEqual(["notes", "outline"]);
    expect(reconcileDockStackToPlacements(out)).toBe(out);
  });

  it("hook: cross-side redock survives a later movePanel of an unrelated icon (defect leg)", () => {
    localStorage.setItem(
      GLOBAL_KEY,
      JSON.stringify({
        placements: [
          { id: "notes", side: "left" },
          { id: "outline", side: "left" },
          { id: "todo", side: "right" },
        ],
        appliedPrefMigrations: ALL_MIGRATIONS,
      }),
    );
    let vp: ReturnType<typeof useViewPrefs> | null = null;
    function Driver() {
      vp = useViewPrefs();
      live = vp.prefs;
      return null;
    }
    render(<Driver />);
    act(() => vp!.redockPanel("notes", "right", 0));
    expect(sideOf(live!, "notes")).toBe("right");
    expect(live!.dockStack.right).toContain("notes");
    act(() => vp!.movePanel("outline", "right"));
    expect(live!.dockStack.right).toContain("notes");
    expect(live!.dockStack.left).not.toContain("notes");
  });
});

describe("reconcile is two-phase — a swap evicts nothing when the net fits", () => {
  it("left=[A] placed right, right=[B,C,D] with B placed left → no eviction (defect leg)", () => {
    const p: ViewPrefs = {
      ...loadPrefs(),
      placements: [
        { id: "notes", side: "right" },
        { id: "outline", side: "left" },
        { id: "todo", side: "right" },
        { id: "reports", side: "right" },
      ],
      dockStack: { left: ["notes"], right: ["outline", "todo", "reports"] },
      panelMRU: { left: [], right: [] },
    };
    const out = reconcileDockStackToPlacements(p);
    expect(out.dockStack.left).toEqual(["outline"]);
    expect([...out.dockStack.right].sort()).toEqual(["notes", "reports", "todo"]);
  });
});

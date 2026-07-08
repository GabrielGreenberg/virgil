// @vitest-environment jsdom
//
// PANE-FILL CONTRACT (task 085): every Library *pre-load* state — Loading… /
// folder-picker splash / permission gate — must GROW to fill its pane, exactly
// like the loaded LibraryView already does. The Library tab mounts as a flex-ROW
// child in Virgil's nested flex tree; a state that declares only `height:100%`
// (no `flex`/`width`) shrinks to its intrinsic CONTENT width on the row's main
// axis and pins LEFT, so its internally-centered content sits in a narrow box
// at the pane's left edge with a dead band on the right (Gabriel: "not centered,
// but weirdly smooshed to the left").
//
// The fix routes all four states through ONE shared `LibraryPaneFill` wrapper
// (flex:1 / minWidth:0 / minHeight:0 / width:100%), the SSOT sibling of task
// 054's RightDetail pane-fill. jsdom has no layout engine, so this test asserts
// the declared inline style on each state's root — the durable, worktree-safe
// proof. A live preview eyeball is owed (these render before any FSA grant, so
// they ARE previewable, unlike the FSA-masked classes).

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

/** True when the element is declared to GROW to fill a flex parent, however
 *  jsdom's CSSOM stored the `flex:1` shorthand. Mirrors RightDetail's helper. */
function fillsGrow(el: HTMLElement): boolean {
  return el.style.flexGrow === "1" || /(^|\s)1(\s|$)/.test(el.style.flex) || el.style.flex === "1";
}

/** The full pane-fill contract on a root element. */
function expectFillsPane(root: HTMLElement) {
  expect(fillsGrow(root)).toBe(true);
  expect(root.style.minWidth).toBe("0px");
  expect(root.style.width).toBe("100%");
  expect(root.style.minHeight).toBe("0px");
}

afterEach(() => cleanup());

// The loading branch lives in LibraryApp behind the FSA handle state machine —
// stub the hook to force `state.kind === "loading"`, and stub the heavy view so
// the module graph stays light. Only the loading root's geometry is under test.
vi.mock("@library/hooks/useLibraryHandle", () => ({
  useLibraryHandle: () => ({
    state: { kind: "loading" },
    pick: () => {},
    grant: () => {},
    reset: () => {},
    lastSync: null,
    pickerError: null,
    syncError: null,
    resyncSkills: () => {},
    dismissSyncError: () => {},
  }),
}));
vi.mock("../LibraryView", () => ({ default: () => <div data-testid="view" /> }));

import LibraryApp from "../LibraryApp";
import LibraryFolderPicker from "../LibraryFolderPicker";
import LibraryPaneFill from "../LibraryPaneFill";
import LibraryPermissionGate from "../LibraryPermissionGate";

describe("Library pane-fill (task 085: pre-load states fill the pane, don't shrink-left)", () => {
  it("LibraryPaneFill SSOT declares the full fill + centers when asked", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(
        <LibraryPaneFill center>
          <span>x</span>
        </LibraryPaneFill>,
      ));
    });
    const root = container.firstChild as HTMLElement;
    expectFillsPane(root);
    expect(root.style.display).toBe("flex");
    expect(root.style.alignItems).toBe("center");
    expect(root.style.justifyContent).toBe("center");
  });

  it("Loading… state root fills the pane", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<LibraryApp />));
    });
    const root = container.firstChild as HTMLElement;
    expect(root.textContent).toContain("Loading");
    expectFillsPane(root);
  });

  it("folder-picker splash root fills the pane", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<LibraryFolderPicker onPick={() => {}} />));
    });
    const root = container.firstChild as HTMLElement;
    expect(root.textContent).toContain("Virgil Library");
    expectFillsPane(root);
  });

  it("permission-gate root fills the pane", () => {
    let container!: HTMLElement;
    act(() => {
      ({ container } = render(<LibraryPermissionGate onGrant={() => {}} onReset={() => {}} />));
    });
    const root = container.firstChild as HTMLElement;
    expect(root.textContent).toContain("Permission needed");
    expectFillsPane(root);
  });
});

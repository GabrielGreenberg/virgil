/**
 * Task 1400 — popped floats are OWNED BY A DOCUMENT.
 *
 * The popout list used to be one window-wide slot handed to every keep-alive
 * pane: a text object popped in doc B rendered (and closed) over doc A, Cmd-W
 * closed an off-screen float of another doc, and a bib float keyed by a shared
 * citekey was the same float in every paper. These pin the owner-keyed store,
 * the one pane projection (`scopePaneViewPrefs`), the Cmd-W target rule and
 * the pre-1400 legacy fold.
 */
import { describe, expect, it, vi } from "vitest";
import {
  LEGACY_FLOAT_OWNER,
  adoptLegacyCardFloats,
  closeAllCardFloats,
  closeCardFloat,
  frontmostOnScreen,
  legacyFlatToCardFloats,
  migrateCardFloats,
  setCardFloatRect,
  sliceOf,
  toggleCardFloat,
  type CardFloats,
} from "../owner-floats";
import { scopePaneViewPrefs } from "@/components/editor-layout/build-editor-pane-view-prefs";
import type { EditorPaneWindowViewPrefs } from "@/components/EditorPane";
import type { ViewPrefs } from "@/hooks/useViewPrefs";
import { normalizeWindowPrefValue, STRUCTURAL_WINDOW_PREFS } from "@/lib/view-prefs/structural-window";

const RECT = { x: 10, y: 20, width: 300, height: 200 };
const PARA = "float:textobject:paragraph:u-1";
const BIB = "float:card:bib:smith2020";

function windowBundle(cardFloats: CardFloats) {
  const ops = {
    toggleCardPopout: vi.fn(),
    closeCardPopout: vi.fn(),
    setCardFloatPosition: vi.fn(),
    remapCardPopKey: vi.fn(),
    focusFloating: vi.fn(),
    cardFloatZIndex: vi.fn((_owner: string, _key: string) => 7),
  };
  const win = {
    ...ops,
    prefs: { cardFloats, poppedOutPanels: [] } as unknown as ViewPrefs,
  } as unknown as EditorPaneWindowViewPrefs;
  return { win, ops };
}

describe("owner-keyed float store (task 1400)", () => {
  it("a float popped in doc B is absent from doc A's slice", () => {
    const floats = toggleCardFloat({}, "B", PARA);
    expect(sliceOf(floats, "B").keys).toEqual([PARA]);
    expect(sliceOf(floats, "A").keys).toEqual([]);
  });

  it("closing from doc A cannot touch doc B's float", () => {
    const floats = toggleCardFloat({}, "B", PARA);
    expect(closeCardFloat(floats, "A", PARA)).toBe(floats);
    expect(sliceOf(closeCardFloat(floats, "B", PARA), "B").keys).toEqual([]);
  });

  it("the same bib citekey in two docs is two independent floats (position + close)", () => {
    let floats = toggleCardFloat({}, "A", BIB);
    floats = setCardFloatRect(floats, "A", BIB, RECT);
    // Popped in B? No — B never opened it.
    expect(sliceOf(floats, "B").keys).toEqual([]);
    floats = toggleCardFloat(floats, "B", BIB);
    floats = setCardFloatRect(floats, "B", BIB, { ...RECT, x: 999 });
    expect(sliceOf(floats, "A").positions[BIB]).toEqual(RECT);
    floats = closeCardFloat(floats, "B", BIB);
    expect(sliceOf(floats, "A").keys).toEqual([BIB]);
    expect(sliceOf(floats, "A").positions[BIB]).toEqual(RECT);
  });

  it("an emptied slice leaves no residue; toggle-off forgets the rect", () => {
    let floats = toggleCardFloat({}, "A", PARA);
    floats = setCardFloatRect(floats, "A", PARA, RECT);
    floats = toggleCardFloat(floats, "A", PARA);
    expect(floats).toEqual({});
  });

  it("migration over one owner leaves the other doc's keys alone", () => {
    const floats: CardFloats = {
      A: { keys: ["old"], positions: { old: RECT } },
      B: { keys: ["old"], positions: {} },
    };
    const next = migrateCardFloats(floats, (k) => (k === "old" ? "new" : k), "A");
    expect(next.A).toEqual({ keys: ["new"], positions: { new: RECT } });
    expect(next.B).toBe(floats.B);
    expect(migrateCardFloats(floats, (k) => k, "A")).toBe(floats);
  });

  it("close-all for one doc closes only that doc's floats", () => {
    const floats: CardFloats = {
      A: { keys: [PARA], positions: { [PARA]: RECT } },
      B: { keys: [BIB], positions: {} },
    };
    const next = closeAllCardFloats(floats, "A");
    expect(next.A).toBeUndefined();
    expect(next.B).toBe(floats.B);
    expect(closeAllCardFloats(floats)).toEqual({});
  });
});

describe("scopePaneViewPrefs — the one pane projection", () => {
  const floats: CardFloats = {
    A: { keys: [BIB], positions: { [BIB]: RECT } },
    B: { keys: [PARA, BIB], positions: {} },
  };

  it("a pane sees only its own doc's floats — other docs are absent, not filtered late", () => {
    const { win } = windowBundle(floats);
    const a = scopePaneViewPrefs(win, "A");
    expect(a.prefs.poppedOutCards).toEqual([BIB]);
    expect(a.prefs.cardFloatPositions).toEqual({ [BIB]: RECT });
    expect(Object.keys(a.prefs.cardFloats)).toEqual(["A"]);
    const c = scopePaneViewPrefs(win, "C");
    expect(c.prefs.poppedOutCards).toEqual([]);
    expect(c.prefs.cardFloats).toEqual({});
  });

  it("every float op is bound to the pane's own doc", () => {
    const { win, ops } = windowBundle(floats);
    const a = scopePaneViewPrefs(win, "A");
    a.toggleCardPopout(PARA);
    a.closeCardPopout(BIB);
    a.setCardFloatPosition(BIB, RECT);
    a.remapCardPopKey("x", "y");
    a.focusFloating({ kind: "card", key: BIB });
    a.focusFloating({ kind: "panel", id: "notes" as never });
    expect(a.cardFloatZIndex?.(BIB)).toBe(7);
    expect(ops.toggleCardPopout).toHaveBeenCalledWith("A", PARA);
    expect(ops.closeCardPopout).toHaveBeenCalledWith("A", BIB);
    expect(ops.setCardFloatPosition).toHaveBeenCalledWith("A", BIB, RECT);
    expect(ops.remapCardPopKey).toHaveBeenCalledWith("A", "x", "y");
    expect(ops.focusFloating).toHaveBeenCalledWith({ kind: "card", owner: "A", key: BIB });
    expect(ops.focusFloating).toHaveBeenCalledWith({ kind: "panel", id: "notes" });
    expect(ops.cardFloatZIndex).toHaveBeenCalledWith("A", BIB);
  });
});

describe("Cmd-W target — frontmostOnScreen", () => {
  type Ref = { kind: "panel"; id: string } | { kind: "card"; owner: string; key: string };
  const fa: Ref = { kind: "card", owner: "A", key: "F" };
  const nb: Ref = { kind: "card", owner: "B", key: "N" };

  it("a hidden doc's most-recent float is skipped for the active doc's", () => {
    expect(frontmostOnScreen([fa, nb], "A")).toBe(fa);
  });

  it("passes through (undefined) when only another doc's floats are open", () => {
    expect(frontmostOnScreen([nb], "A")).toBeUndefined();
    expect(frontmostOnScreen([fa], null)).toBeUndefined();
  });

  it("panel floats are window-wide across docs while a doc pane is showing", () => {
    const p: Ref = { kind: "panel", id: "outline" };
    expect(frontmostOnScreen([fa, p, nb], "A")).toBe(p);
    expect(frontmostOnScreen([p, nb], "B")).toBe(nb);
    expect(frontmostOnScreen([p], "B")).toBe(p);
  });

  it("a panel float is not the target when no doc pane is showing (task 1567)", () => {
    const p: Ref = { kind: "panel", id: "outline" };
    expect(frontmostOnScreen([p], null)).toBeUndefined();
    expect(frontmostOnScreen([fa, p], null)).toBeUndefined();
  });
});

describe("legacy flat popout list (pre-1400)", () => {
  it("folds into the unowned slot, rendered by no pane, until adopted", () => {
    const legacy = legacyFlatToCardFloats([PARA, 3], { [PARA]: RECT, bad: { x: 1 } });
    expect(legacy).toEqual({ [LEGACY_FLOAT_OWNER]: { keys: [PARA], positions: { [PARA]: RECT } } });
    expect(sliceOf(legacy!, "A").keys).toEqual([]);
    const adopted = adoptLegacyCardFloats(legacy!, "A");
    expect(adopted).toEqual({ A: { keys: [PARA], positions: { [PARA]: RECT } } });
    expect(adoptLegacyCardFloats(adopted, "B")).toBe(adopted);
  });

  it("absent flat pair → nothing to fold", () => {
    expect(legacyFlatToCardFloats(undefined, undefined)).toBeUndefined();
  });

  it("the window door validates the stored owner-keyed shape", () => {
    const def = STRUCTURAL_WINDOW_PREFS.cardFloats;
    expect(normalizeWindowPrefValue(def, ["x"])).toBeUndefined();
    expect(
      normalizeWindowPrefValue(def, {
        A: { keys: [PARA, PARA, 1], positions: { [PARA]: RECT, z: "no" } },
        B: "junk",
      }),
    ).toEqual({ A: { keys: [PARA], positions: { [PARA]: RECT } } });
  });
});

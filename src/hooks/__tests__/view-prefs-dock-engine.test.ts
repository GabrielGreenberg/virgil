/**
 * The dock-stack engine contract (task 273) — `src/hooks/view-prefs-dock.ts`.
 *
 * `dockOpen` was extracted as *the* shared docked-open helper and the
 * consolidation then stalled: `redockPanel` re-implemented insertion inline
 * (and until task 272 silently dropped the collapse/blank sentinel clear, so
 * redocking onto a collapsed side rendered nothing), five setters re-derived
 * the close branch, three re-derived the mode-dispatch/float-open branch, and
 * `clampStack` carried its own `max = 3` beside `MAX_STACK`. Every one of
 * those failure modes is silent, and none of them is a type error.
 *
 * So this suite has two halves, and the SECOND is the one with teeth:
 *
 *  1. The engine's own behavior — insertion, eviction, MRU coupling, the
 *     sentinel clear, the float side. Pinned directly, because the engine is
 *     now a pure React-free leaf: no `renderHook`, no jsdom, and none of the
 *     storage / BroadcastChannel mocks the hook suites need. That testability
 *     IS the refactor's point, so exercising it here is not incidental.
 *  2. The HOOK-BODY CENSUS — no setter in `useViewPrefs` may spell
 *     `dockStack:` / `panelMRU:` / `poppedOutPanels:` itself. A test of the
 *     engine alone structurally cannot catch the original shape, because the
 *     engine was never the part that misbehaved: the part that misbehaved was
 *     a sibling path that re-derived the insertion and forgot one invariant.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { codeOnly, commentsStripped } from "@/lib/__tests__/_source-scan";
import { clampStack } from "../dropUnknownPanelIds";
import * as engine from "../view-prefs-dock";
import {
  MAX_STACK,
  MIN_BAND_PX,
  closeAllPanels,
  closePanel,
  floatOpen,
  isPanelOpen,
  notePanelUse,
  openInMode,
  placeInStack,
  removeFromStack,
  undockToFloat,
} from "../view-prefs-dock";
import type { PanelId, ViewPrefs } from "../useViewPrefs";

/* Four real, dockable PANEL_REGISTRY ids (same cast as the eviction suite). */
const A = "footnotes" as PanelId;
const B = "citations" as PanelId;
const C = "reports" as PanelId;
const D = "examples" as PanelId;

/** A ViewPrefs fixture carrying only what the dock engine reads. The engine
 *  is a pure transformer over that slice, so the rest is genuinely absent
 *  rather than stubbed. */
function prefs(over: Partial<ViewPrefs> = {}): ViewPrefs {
  return {
    placements: [],
    dockStack: { left: [], right: [] },
    panelMRU: { left: [], right: [] },
    poppedOutPanels: [],
    poppedOutOrigins: {},
    poppedOutCards: [],
    floatPositions: {},
    panelModes: {},
    collapsedLeft: false,
    collapsedRight: false,
    blankLeft: false,
    blankRight: false,
    ...over,
  } as unknown as ViewPrefs;
}

const RECT = { x: 1, y: 2, width: 3, height: 4 };

describe("placeInStack — THE insertion SSOT", () => {
  it("appends at the bottom, marks the panel docked, and bumps its MRU", () => {
    const p = placeInStack(prefs({ dockStack: { left: [A], right: [] } }), B, "left");
    expect(p.dockStack.left).toEqual([A, B]);
    expect(p.panelModes[B]).toBe("docked");
    expect(p.panelMRU.left).toEqual([B]);
  });

  it("clears the collapse AND blank sentinel of the target side only (task 272)", () => {
    // The invariant every inline copy is apt to drop: a docked band's
    // `[data-dock-slot]` portal target only exists in an expanded, non-blank
    // column, so a placement onto a collapsed side must expand it or the
    // panel renders nothing. Owning it HERE is what retires the class —
    // redock gets it for free rather than re-deriving it.
    const base = prefs({
      collapsedLeft: true,
      collapsedRight: true,
      blankLeft: true,
      blankRight: true,
    });
    const left = placeInStack(base, A, "left");
    expect([left.collapsedLeft, left.blankLeft]).toEqual([false, false]);
    expect([left.collapsedRight, left.blankRight]).toEqual([true, true]);

    const right = placeInStack(base, A, "right");
    expect([right.collapsedRight, right.blankRight]).toEqual([false, false]);
    expect([right.collapsedLeft, right.blankLeft]).toEqual([true, true]);
  });

  it("splices at an explicit index and clamps one out of range", () => {
    const base = prefs({ dockStack: { left: [A, B], right: [] } });
    expect(placeInStack(base, C, "left", { index: 0 }).dockStack.left).toEqual([C, A, B]);
    expect(placeInStack(base, C, "left", { index: 1 }).dockStack.left).toEqual([A, C, B]);
    expect(placeInStack(base, C, "left", { index: 99 }).dockStack.left).toEqual([A, B, C]);
    expect(placeInStack(base, C, "left", { index: -5 }).dockStack.left).toEqual([C, A, B]);
  });

  it("evicts the least-recently-used band at the cap, and prunes its recency", () => {
    const full = prefs({
      dockStack: { left: [A, B, C], right: [] },
      panelMRU: { left: [C, B, A], right: [] },
    });
    expect(full.dockStack.left.length).toBe(MAX_STACK);
    // A is the MRU tail under full coverage → the victim (task 251's policy,
    // asserted THROUGH the insertion rather than off an exported selector).
    const p = placeInStack(full, D, "left");
    expect(p.dockStack.left).toEqual([B, C, D]);
    expect(p.panelMRU.left).toEqual([D, C, B]);
  });

  it("applies the breathing-room fit check ONLY when the caller measured it", () => {
    const room = prefs({
      dockStack: { left: [A, B], right: [] },
      panelMRU: { left: [B, A], right: [] },
    });
    // Measured and tight → displace the stalest band rather than squeeze in.
    expect(placeInStack(room, D, "left", { freeSpacePx: MIN_BAND_PX - 1 }).dockStack.left)
      .toEqual([B, D]);
    // Measured and roomy → plain append.
    expect(placeInStack(room, D, "left", { freeSpacePx: MIN_BAND_PX }).dockStack.left)
      .toEqual([A, B, D]);
    // NOT measured → assume it fits. This is the redock fork (task 273 Q1):
    // a drag-drop has no measurement, and a deliberate user drop must not
    // cost a DIFFERENT band its slot. Only the hard cap evicts.
    expect(placeInStack(room, D, "left", { index: 0 }).dockStack.left).toEqual([D, A, B]);
  });

  it("relocates: one live band, no stale recency on the old side", () => {
    const p = placeInStack(
      prefs({
        dockStack: { left: [A, B], right: [] },
        panelMRU: { left: [A, B], right: [] },
      }),
      A,
      "right",
    );
    expect(p.dockStack.left).toEqual([B]);
    expect(p.dockStack.right).toEqual([A]);
    expect(p.panelMRU.left).toEqual([B]);
    expect(p.panelMRU.right).toEqual([A]);
  });

  it("drops a prior float of the same panel (docking is not a second copy)", () => {
    const p = placeInStack(
      prefs({ poppedOutPanels: [A], panelModes: { [A]: "floating" }, floatPositions: { [A]: RECT } }),
      A,
      "left",
    );
    expect(p.poppedOutPanels).toEqual([]);
    expect(p.dockStack.left).toEqual([A]);
    expect(p.panelModes[A]).toBe("docked");
    // The pinned float size survives, so a later undock restores it.
    expect(p.floatPositions[A]).toEqual(RECT);
  });

  it("never nominates the placed panel as its own eviction victim", () => {
    // `id` leaves the target stack before the victim is chosen, so a re-place
    // at a new slot on a FULL side must not evict `id` and land it anyway.
    const p = placeInStack(
      prefs({
        dockStack: { left: [A, B, C], right: [] },
        panelMRU: { left: [A, B, C], right: [] },
      }),
      A,
      "left",
      { index: 2 },
    );
    expect(p.dockStack.left).toEqual([B, C, A]);
    expect(p.dockStack.left.filter((x) => x === A)).toHaveLength(1);
  });
});

describe("removeFromStack / closePanel — THE removal SSOTs", () => {
  it("removeFromStack sheds the band and both recency lists, and KEEPS the float", () => {
    const p = removeFromStack(
      prefs({
        dockStack: { left: [A, B], right: [] },
        panelMRU: { left: [A, B], right: [A] },
        poppedOutPanels: [A],
      }),
      A,
    );
    expect(p.dockStack.left).toEqual([B]);
    expect(p.panelMRU).toEqual({ left: [B], right: [] });
    expect(p.poppedOutPanels).toEqual([A]);
  });

  it("closePanel closes BOTH worlds but preserves the size/mode preference", () => {
    const p = closePanel(
      prefs({
        dockStack: { left: [A], right: [] },
        panelMRU: { left: [A], right: [] },
        poppedOutPanels: [A, B],
        floatPositions: { [A]: RECT },
        panelModes: { [A]: "floating" },
      }),
      A,
    );
    expect(p.dockStack.left).toEqual([]);
    expect(p.panelMRU.left).toEqual([]);
    expect(p.poppedOutPanels).toEqual([B]);
    expect(p.floatPositions[A]).toEqual(RECT);
    expect(p.panelModes[A]).toBe("floating");
    expect(isPanelOpen(p, A)).toBe(false);
  });

  it("closeAllPanels clears every panel carrier and leaves the columns alone", () => {
    const p = closeAllPanels(
      prefs({
        dockStack: { left: [A], right: [B] },
        panelMRU: { left: [A], right: [B] },
        poppedOutPanels: [C],
        poppedOutOrigins: { [C]: "top" },
        poppedOutCards: ["note:1"],
        collapsedLeft: true,
        blankRight: true,
      }),
    );
    expect(p.dockStack).toEqual({ left: [], right: [] });
    expect(p.panelMRU).toEqual({ left: [], right: [] });
    expect(p.poppedOutPanels).toEqual([]);
    expect(p.poppedOutOrigins).toEqual({});
    // Card floats are a different axis; the sides keep their sentinels.
    expect(p.poppedOutCards).toEqual(["note:1"]);
    expect([p.collapsedLeft, p.blankRight]).toEqual([true, true]);
  });
});

describe("the float side + mode dispatch", () => {
  it("floatOpen reuses the saved rect and is idempotent", () => {
    const p = floatOpen(prefs({ floatPositions: { [A]: RECT } }), A, "left");
    expect(p.poppedOutPanels).toEqual([A]);
    expect(p.floatPositions[A]).toEqual(RECT);
    expect(floatOpen(p, A, "left").poppedOutPanels).toEqual([A]);
  });

  it("openInMode routes by the panel's remembered mode", () => {
    expect(openInMode(prefs(), A, "left").dockStack.left).toEqual([A]);
    const floating = openInMode(prefs({ panelModes: { [A]: "floating" } }), A, "left");
    expect(floating.dockStack.left).toEqual([]);
    expect(floating.poppedOutPanels).toEqual([A]);
  });

  it("notePanelUse bumps recency only for a panel really docked on that side", () => {
    const base = prefs({
      dockStack: { left: [A, B], right: [C] },
      panelMRU: { left: [A, B], right: [] },
    });
    expect(notePanelUse(base, "left", B).panelMRU.left).toEqual([B, A]);
    // Wrong side, and not docked at all → the SAME object, so `update`'s
    // identity bail keeps a stray note from arming a persist.
    expect(notePanelUse(base, "left", C)).toBe(base);
    expect(notePanelUse(base, "left", D)).toBe(base);
  });

  it("undockToFloat sheds the band, records the mode, and seeds the rect", () => {
    const p = undockToFloat(
      prefs({ dockStack: { left: [A, B], right: [] }, panelMRU: { left: [A, B], right: [] } }),
      A,
      RECT,
    );
    expect(p.dockStack.left).toEqual([B]);
    expect(p.panelMRU.left).toEqual([B]);
    expect(p.poppedOutPanels).toEqual([A]);
    expect(p.panelModes[A]).toBe("floating");
    expect(p.floatPositions[A]).toEqual(RECT);
  });
});

describe("the stack ceiling is ONE fact (task 273 member 2)", () => {
  it("clampStack takes the ceiling as a REQUIRED argument", () => {
    // A defaulted `max = 3` beside `MAX_STACK` is two facts that must agree
    // with nothing forcing equality — and the sole caller passed nothing, so
    // the LOADER silently owned a second ceiling. `Function.length` counts
    // parameters before the first defaulted one, so this proves at runtime
    // that a `= 3` default is gone.
    expect(clampStack.length).toBe(2);
    // …but NOT that the parameter is required: `max?: number` erases at emit
    // and reports the same arity, while `out.length >= undefined` is always
    // false — no ceiling at all, i.e. a WORSE regression than the drifting
    // second one. Only the source can say "you must not have made it
    // optional", so pin the signature.
    const src = codeOnly(read("src/hooks/dropUnknownPanelIds.ts"));
    expect(src).toMatch(/export function clampStack\(\s*stack: unknown,\s*max: number,?\s*\)/);
  });

  it("truncates a persisted over-deep stack to exactly the ceiling it is given", () => {
    const deep = { left: [A, B, C, D], right: [] };
    expect(clampStack(deep, MAX_STACK).left).toHaveLength(MAX_STACK);
    // Honors the ARGUMENT rather than an internal literal — the leg that
    // fails if a future `MAX_STACK` bump leaves a hardcoded 3 behind.
    expect(clampStack(deep, 4).left).toEqual([A, B, C, D]);
    expect(clampStack(deep, 1).left).toEqual([A]);
  });

  it("the loader reads the engine's ceiling, not a literal of its own", () => {
    // Tolerant of how the result is consumed (a cast today, a typed const
    // tomorrow) — what it pins is that the ARGUMENT is the shared const.
    expect(codeOnly(read("src/hooks/useViewPrefs.ts"))).toMatch(
      /clampStack\([^;]*MAX_STACK/,
    );
  });

  it("the ceiling is declared exactly once in the whole repo", () => {
    // Replaces a pin on the literal `MAX_STACK = 3`, which would have failed
    // on the very ceiling bump its sibling leg advertises as the thing being
    // protected. What matters is UNIQUENESS, not the value.
    const decls = sourceFiles().filter((f) =>
      /(export\s+)?const\s+MAX_STACK\s*=/.test(codeOnly(read(f))),
    );
    expect(decls).toEqual(["src/hooks/view-prefs-dock.ts"]);
  });
});

/* ── The census: no setter re-derives dock mutation ───────────────────── */

function read(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf8");
}

/** Every `.ts`/`.tsx` under the two silos, repo-relative. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(resolve(process.cwd(), dir), { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.tsx?$/.test(e.name)) out.push(rel);
    }
  };
  walk("src");
  walk("library");
  return out;
}

/** The three carriers of dock state. Censused as BARE NAMES, not as
 *  `dockStack:` object-literal keys: the colon form is defeated by ES
 *  shorthand (`{ ...p, poppedOutPanels }` — the realistic accident, since
 *  shorthand is idiomatic and reads as a normal setter in review), by
 *  assignment (`next.dockStack = …`), by in-place mutation, and by a computed
 *  key. The bare name catches every one, and costs nothing here because the
 *  censused region references none of them outside comments. */
const DOCK_CARRIERS = ["dockStack", "panelMRU", "poppedOutPanels"] as const;

describe("hook-body census — dock state is mutated only through the engine", () => {
  // Comments stripped, STRING LITERALS KEPT — so a computed `p["dockStack"]`
  // is still visible (blanking literals would erase the very needle).
  const src = commentsStripped(read("src/hooks/useViewPrefs.ts"));
  // Split BELOW `loadPrefs`, not at the hook entry: the ViewPrefs
  // declaration, DEFAULT_PREFS and the loader legitimately name the carriers,
  // but everything after them — including any module-scope helper a future
  // agent hoists out of the hook (a zero-behavior-change cleanup that would
  // otherwise walk straight out of the guard) — is covered.
  const split = src.indexOf("function seedEphemeralPrefs");
  const declarations = src.slice(0, split);
  const censused = src.slice(split);

  it("can see what it is looking for (canary)", () => {
    // The needles are real: they all appear ABOVE the split, legitimately. A
    // census that matched nothing anywhere would pass vacuously.
    expect(split).toBeGreaterThan(0);
    for (const needle of DOCK_CARRIERS) expect(declarations).toContain(needle);
    // …and the stripper did not swallow the file.
    expect(censused.length).toBeGreaterThan(10_000);
    expect(censused).toContain("placeInStack(");
  });

  for (const needle of DOCK_CARRIERS) {
    it(`nothing below the loader touches \`${needle}\` directly`, () => {
      // A setter that names one of these is re-deriving insertion, eviction
      // or the MRU coupling by hand — exactly how `redockPanel` came to omit
      // the sentinel clear while every test stayed green. Route it through
      // `placeInStack` / `removeFromStack` / `closePanel` / `openInMode` /
      // `notePanelUse`, or add the capability to the engine.
      expect(censused).not.toContain(needle);
    });
  }

  it("the engine publishes whole OPERATIONS, never the pieces", () => {
    // The census greps names, so it cannot see a setter that assembles an
    // insertion out of `withStack` + `bumpMRU` — those spell no carrier at
    // the call site. The structural answer is that they aren't reachable:
    // the engine's public surface is operations only. A new export here is a
    // deliberate decision, and this list is where it gets made.
    expect(Object.keys(engine).sort()).toEqual([
      "MAX_STACK",
      "MIN_BAND_PX",
      "closeAllPanels",
      "closePanel",
      "floatOpen",
      "isPanelOpen",
      "notePanelUse",
      "openInMode",
      "placeInStack",
      "removeFromStack",
      "undockToFloat",
    ]);
  });

  it("the cap lives in the engine, not in the hook", () => {
    expect(censused).not.toContain("MAX_STACK");
  });
});

/* KNOWN LIMITS, stated rather than papered over. (1) The region ABOVE the
 * split — the `ViewPrefs` interface, `DEFAULT_PREFS`, `loadPrefs` — is exempt
 * by construction and the canary depends on it; a hoist above `loadPrefs`
 * escapes. (2) The float half's other carriers (`panelModes` /
 * `floatPositions`) are NOT censused, because `setFloatPosition` and the
 * mode setters write them legitimately; a setter that calls `removeFromStack`
 * and then re-derives the mode-record + rect-seed halves of `undockToFloat`
 * by hand would pass. Both are grep limits, not claims. */

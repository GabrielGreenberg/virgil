// @vitest-environment jsdom
/**
 * Task 493 — **an open card float follows a live panel-colour override.**
 *
 * A card kind's accent is painted by FIVE renderers. Four of them re-derive the
 * moment the user picks a new colour in a panel's picker — the docked card
 * (`useCardTheme` → `useSyncExternalStore`), the margin marker, the in-text
 * anchor, and the highlight band (pure CSS off the anchor accent var). The
 * fifth, a popped-out card float, had a LIVE READ and NO SUBSCRIPTION:
 * `cardFloatable` computed `headerTint`/`accentTint` with
 * `themeFromAccent(getPanelColor(...))` at resolve time and baked the hexes
 * onto the `Floatable`, and nothing in
 * `FloatHost → FloatWindow → FloatChrome → FloatingPanel` subscribed to the
 * store. `EditorPane` is `memo()`'d with no prop derived from panel colours, so
 * a swatch click caused no render anywhere in that subtree: the float kept the
 * old header strip and the old window ring while every other surface re-tinted
 * — two colours for one card in one window, healed only by an unrelated
 * re-render.
 *
 * The fix moves the colour OFF the value object: a `Floatable` declares a
 * `themeKey` and `FloatWindow` resolves the pair live through `useFloatAccent`.
 *
 * **No pre-493 suite could see this.** `card-floatable-header-tint` asks the
 * BUILDER for its hex (which was always live — rebuilding the floatable after
 * an override yields the new colour), and every chrome suite hands
 * `FloatChrome` a hand-supplied `headerTint`. The defect is only visible when a
 * RENDERED float is asked to follow a store change, which is what these legs do.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { commentsStripped } from "@/lib/__tests__/_source-scan";
import { fileURLToPath } from "node:url";
import path from "node:path";

// The card factory graph transitively pulls `@/lib/storage`, whose
// `require("@/lib/storage-fsa")` vitest's resolver can't alias (the known
// barrel gotcha). No-op every export — nothing here reads or writes a sidecar.
vi.mock("@/lib/storage", () => {
  const noop = () => undefined;
  return new Proxy(
    {},
    {
      get: (_t, prop) =>
        prop === "__esModule" ? true : prop === "then" ? undefined : noop,
    },
  );
});

vi.mock("@/components/card-lift", () => ({
  consumeCardLiftHandoff: () => null,
}));

// jsdom has no ResizeObserver; `panel-primitives` mounts one per card header.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { render, act, cleanup } from "@testing-library/react";

// Registers every poppable card kind's `toFloatable` builder (side effect).
import "@/cards/floats";
import { FloatHost } from "@/floats/FloatHost";
import type { CardFloatCtx } from "@/cards/card-float-ctx";
import {
  PoppedCardsContext,
  type PoppedCardsValue,
} from "@/hooks/usePoppedCards";
import {
  CARD_THEMES,
} from "@/components/panel-primitives";
import {
  clearPanelColor,
  setPanelColor,
  themeFromAccent,
  getPanelColor,
} from "@/lib/panel-theme";
import { useCardKindTheme } from "@/cards/use-card-kind-theme";
import type { UserNote } from "@/lib/types";

const PURPLE = "#9333ea";
const NOTE_KEY = "float:card:note:n1";

const note: UserNote = {
  kind: "note",
  id: "n1",
  title: "",
  content: { type: "doc", content: [] },
  createdAt: "2026-01-01T00:00:00.000Z",
  aiRequest: false,
  links: [],
};

function cardCtx(): CardFloatCtx {
  return {
    editorRef: { current: null },
    notes: [note],
    highlights: [],
    todoItems: [],
    selectedNoteId: null,
    selectedTodoId: null,
    toggleTodo: () => {},
    convertNotesCard: () => {},
  } as unknown as CardFloatCtx;
}

function poppedValue(): PoppedCardsValue {
  return {
    poppedKeys: [NOTE_KEY],
    isPopped: (k) => k === NOTE_KEY,
    toggle: () => {},
    toggleAtAnchor: () => {},
    popOutAtRect: () => {},
    close: () => {},
    getFloatPosition: () => undefined,
    setFloatPosition: () => {},
  };
}

/** Every background colour painted anywhere in the document. `FloatingPanel`
 *  PORTALS to `document.body`, so RTL's `container` is empty here — a leg that
 *  read it would pass vacuously (the trap the audit's own first draft hit). */
function paintedBackgrounds(): string[] {
  return [...document.body.querySelectorAll<HTMLElement>("*")]
    .map((el) => el.style.backgroundColor)
    .filter((c) => c && c !== "transparent");
}

/** The float root's `--link-anchor-color` — what `FloatingPanel` stamps from
 *  `accentTint` so the `:has()` window-ring rules resolve the kind accent
 *  (bug #34). This is M2, one field over from the header strip. */
function windowRingAccent(): string | null {
  const root = document.body.querySelector<HTMLElement>(
    '[data-floating-panel="true"]',
  );
  return root?.style.getPropertyValue("--link-anchor-color").trim() || null;
}

function hexToRgb(hex: string): string {
  const h = hex.replace("#", "");
  const n = parseInt(h, 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

afterEach(() => {
  cleanup();
  clearPanelColor("note");
});

beforeEach(() => {
  clearPanelColor("note");
});

describe("an OPEN card float follows a live panel-colour override (M1 + M2)", () => {
  it("re-tints its header strip and its window ring, with no other render", () => {
    render(
      <PoppedCardsContext.Provider value={poppedValue()}>
        <FloatHost keys={[NOTE_KEY]} cardCtx={cardCtx()} />
      </PoppedCardsContext.Provider>,
    );

    // The float really rendered — never a vacuous leg.
    expect(document.body.textContent).toContain("Note");
    expect(windowRingAccent()).not.toBeNull();

    const before = paintedBackgrounds();
    const defaultStrip = hexToRgb(CARD_THEMES.note.headerDefault);
    expect(before).toContain(defaultStrip);
    expect(windowRingAccent()).toBe(CARD_THEMES.note.accent);

    // The ONLY thing that happens: the store bumps. No keystroke, no click, no
    // unrelated re-render — which is exactly what the pre-493 float needed.
    act(() => setPanelColor("note", PURPLE));

    const overridden = themeFromAccent(getPanelColor("note"));
    expect(overridden.headerDefault).not.toBe(CARD_THEMES.note.headerDefault);

    // M1 — the header strip moved.
    const after = paintedBackgrounds();
    expect(after).toContain(hexToRgb(overridden.headerDefault));
    expect(after).not.toContain(defaultStrip);

    // M2 — the window ring accent moved with it.
    expect(windowRingAccent()).toBe(overridden.accent);
  });

  it("CONTROL: a docked `useCardKindTheme` reader re-renders in the same harness", () => {
    let renders = 0;
    function DockedProbe() {
      renders++;
      const theme = useCardKindTheme("note");
      return <div data-testid="docked" style={{ backgroundColor: theme.headerDefault }} />;
    }
    const { getByTestId } = render(<DockedProbe />);

    expect(renders).toBe(1);
    expect(getByTestId("docked").style.backgroundColor).toBe(
      hexToRgb(CARD_THEMES.note.headerDefault),
    );

    act(() => setPanelColor("note", PURPLE));

    expect(renders).toBeGreaterThan(1);
    expect(getByTestId("docked").style.backgroundColor).toBe(
      hexToRgb(themeFromAccent(PURPLE).headerDefault),
    );
  });

  it("CONTROL: an override on ANOTHER kind leaves this float alone", () => {
    render(
      <PoppedCardsContext.Provider value={poppedValue()}>
        <FloatHost keys={[NOTE_KEY]} cardCtx={cardCtx()} />
      </PoppedCardsContext.Provider>,
    );
    const defaultStrip = hexToRgb(CARD_THEMES.note.headerDefault);
    expect(paintedBackgrounds()).toContain(defaultStrip);

    act(() => setPanelColor("todo", PURPLE));
    clearPanelColor("todo");

    expect(paintedBackgrounds()).toContain(defaultStrip);
  });
});

// ── The leg with teeth ─────────────────────────────────────────────────────
//
// The hook was never the part that could misbehave. What can is a chain that
// stops asking it — a `Floatable` that carries a resolved hex again, or a float
// surface that reads `getPanelColor` directly with no subscription, both of
// which type-check perfectly and are invisible to every behavioural leg above
// once the pre-fix shape is restored one layer down.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../..");
const LIBRARY = path.resolve(SRC, "../library");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".next")) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function rel(file: string): string {
  return path.relative(path.resolve(SRC, ".."), file).split(path.sep).join("/");
}

const PRODUCTION_FILES = [...walk(SRC), ...walk(LIBRARY)];

describe("census — the accent is resolved at PAINT time, by the ONE door", () => {
  it("`resolveFloatAccent` has exactly one production reader: its own hook", () => {
    const readers = PRODUCTION_FILES.filter(
      (f) =>
        /\bresolveFloatAccent\b/.test(readFileSync(f, "utf8")) &&
        !f.endsWith(path.join("floats", "use-float-accent.ts")),
    ).map(rel);
    // Non-empty would mean a live READ with no subscription — the pre-493
    // defect, restored under a new name.
    expect(readers).toEqual([]);
  });

  it("the `Floatable` contract carries a KEY, never a resolved colour", () => {
    const types = readFileSync(path.join(SRC, "floats/types.ts"), "utf8");
    expect(types).toMatch(/themeKey\?:\s*PanelThemeKey/);
    // The retired fields stay retired: a hex on the value object is a value
    // resolved once per float-map rebuild, which is the whole defect.
    expect(types).not.toMatch(/^\s*headerTint\?:/m);
    expect(types).not.toMatch(/^\s*accentTint\?:/m);
  });

  it("`FloatWindow` resolves the accent through the subscribing hook", () => {
    const src = readFileSync(path.join(SRC, "floats/FloatWindow.tsx"), "utf8");
    expect(src).toMatch(/useFloatAccent\(floatable\.themeKey\)/);
    // …and never reads the store itself.
    expect(src).not.toMatch(/\bgetPanelColor\b/);
  });

  it("no float-chain file reads the colour store without subscribing", () => {
    const chain = [
      "floats/FloatHost.tsx",
      "floats/FloatWindow.tsx",
      "floats/FloatChrome.tsx",
      "cards/floats/index.tsx",
    ];
    const offenders = chain.filter((f) =>
      /\b(getPanelColor|themeFromAccent)\b/.test(
        readFileSync(path.join(SRC, f), "utf8"),
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("no card component hands the theme hook a literal theme key (M3)", () => {
    // A card's accent binding is `CARD_REGISTRY[kind].themeKey`, so a docked
    // card asks `useCardKindTheme(<kind>)`. A literal THEME KEY at the call
    // site is the second table this task retires: re-theme a kind in the
    // registry and the float would follow while the docked card did not.
    // Comments stripped, string literals KEPT: the needle IS a quoted literal,
    // and the two files that merely NAME the retired shape do so in prose (this
    // module's own docstring, and a `panel-primitives` note about a future
    // migration). A raw-source grep indicts both — which is how a census that
    // reads prose trains people to distrust it.
    const offenders: string[] = [];
    for (const f of PRODUCTION_FILES) {
      const src = commentsStripped(readFileSync(f, "utf8"));
      for (const m of src.matchAll(
        /\b(useCardTheme|usePanelColor|usePanelCardPalette|usePanelMarkerPalette|useIsPanelColorOverridden)\(\s*["'`]/g,
      )) {
        offenders.push(`${rel(f)}: ${m[1]}("…") — read the key from the registry`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the census can SEE the shape it forbids (canary)", () => {
    const fixture = `const t = useCardTheme("note");`;
    expect(
      /\buseCardTheme\(\s*["'`]/.test(fixture),
    ).toBe(true);
  });
});

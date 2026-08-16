// @vitest-environment jsdom
//
// Task 277 — **the lift grip paints iff the lift can land.**
//
// `CardDragHandle` (`cursor-grab`, `data-hint="Drag to pop out"`) is the ONLY
// visual promise the header drag-lift makes, and it painted on every unified
// header regardless of whether the gesture could run. Two production surfaces
// were offering a drag that died at the handler's first gate, silently: the
// ORPHANED footnote card (no `cardKey` — its float builder has no source to
// resolve it from) and every ErrorCard (`error` is the ratified non-poppable
// kind, so `isPoppable` refuses).
//
// The contract asserted here is an EQUIVALENCE rather than a list of "no grip
// here" cases, and that shape is the point: it re-derives nothing from the
// implementation, so a future gate added to `canLift` (or removed from it)
// keeps affordance and mechanism in step by construction. Each row renders a
// real `PanelCard`, reads whether the grip painted, then drives the REAL press
// + drag and asserts the pop-out fired exactly when the grip was there.
//
// The pre-277 tree fails every non-liftable row: the grip is present and the
// drag does nothing.

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// panel-primitives transitively pulls `@/lib/storage` (the known barrel/
// storage gotcha) — stub it; nothing here touches a sidecar.
vi.mock("@/lib/storage", () => {
  const noop = () => undefined;
  const names = [
    "isDevStorage", "readSidecar", "readSidecarIfExists", "writeSidecar",
    "readTex", "writeTex", "readDocBundle", "writeDocBundle", "readBib",
    "writeBib", "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
    "registerDocInFolder", "openExistingDocFromPicker", "listDocs", "renameDoc",
    "deleteDocFromIndex", "flushDoc", "drainDoc", "detectBibPackage",
    "readPaperFolder", "getTexFilename", "writePdf", "readPdf", "getPdfFilename",
    "pdfFilenameFromTex", "readFigureSource", "readFigureRaster",
    "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  return Object.fromEntries(names.map((n) => [n, noop]));
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { ComponentProps } from "react";
import { PanelCard, CARD_THEMES } from "@/components/panel-primitives";
import { PoppedCardsContext, type PoppedCardsValue } from "@/hooks/usePoppedCards";
import { cardPopKey } from "@/panels/panel-registry";
import { codeOnly } from "@/lib/__tests__/_source-scan";

afterEach(cleanup);

type PanelCardProps = ComponentProps<typeof PanelCard>;

const NOTE_KEY = cardPopKey("note", "n1");

/** A popped-cards context whose `popOutAtRect` records the lift. `poppedNow`
 *  models the docked RESIDUE of an already-popped card (see
 *  `usePoppedCards`'s own note: the docked render stays live beside the
 *  float). */
function makePopped(poppedNow: readonly string[] = []) {
  const popOutAtRect = vi.fn();
  const value: PoppedCardsValue = {
    poppedKeys: [...poppedNow],
    isPopped: (k) => poppedNow.includes(k),
    toggle: vi.fn(),
    toggleAtAnchor: vi.fn(),
    popOutAtRect,
    close: vi.fn(),
    getFloatPosition: () => undefined,
    setFloatPosition: vi.fn(),
  };
  return { value, popOutAtRect };
}

function renderCase(
  overrides: Partial<PanelCardProps>,
  ctx: PoppedCardsValue | null,
) {
  const props: PanelCardProps = {
    theme: CARD_THEMES.note,
    selected: false,
    kind: "note",
    isCollapsed: true,
    onToggleExpanded: vi.fn(),
    onHeaderActivate: vi.fn(),
    children: <div data-testid="body">body</div>,
    ...overrides,
  };
  const utils = render(
    ctx
      ? (
          <PoppedCardsContext.Provider value={ctx}>
            <PanelCard {...props} />
          </PoppedCardsContext.Provider>
        )
      : <PanelCard {...props} />,
  );
  return utils;
}

/** Press on the header and drag past the 5px lift threshold. */
function dragHeader(container: HTMLElement) {
  const header = container.querySelector('[data-card-header="1"]') as HTMLElement;
  expect(header).toBeTruthy();
  fireEvent.mouseDown(header, { button: 0, clientX: 10, clientY: 10 });
  // `buttons: 1` is load-bearing since task 333: the detector now bails on a
  // move that arrives with the primary button up (jsdom's default), which is
  // exactly how a swallowed mouseup used to leave it armed. A held drag says so.
  fireEvent(window, new MouseEvent("mousemove", { bubbles: true, clientX: 60, clientY: 60, buttons: 1 }));
  fireEvent(window, new MouseEvent("mouseup", { bubbles: true }));
}

const gripCount = (container: HTMLElement) =>
  container.querySelectorAll(".card-drag-handle").length;

/* ── The equivalence ────────────────────────────────────────────────── */

interface Row {
  name: string;
  liftable: boolean;
  props: Partial<PanelCardProps>;
  /** Popped keys in the context; `null` mounts NO provider at all. */
  popped: readonly string[] | null;
}

const ROWS: Row[] = [
  {
    name: "a poppable kind with a card key (the anchored-footnote shape)",
    liftable: true,
    props: { cardKey: NOTE_KEY },
    popped: [],
  },
  {
    name: "no card key — the ORPHANED footnote card's shape",
    liftable: false,
    props: {},
    popped: [],
  },
  {
    name: "a non-poppable kind — every ErrorCard",
    liftable: false,
    props: { kind: "error", theme: CARD_THEMES.error, cardKey: cardPopKey("error", "e1") },
    popped: [],
  },
  {
    name: "the docked residue of an already-popped card",
    liftable: false,
    props: { cardKey: NOTE_KEY },
    popped: [NOTE_KEY],
  },
  {
    name: "no pop-out door at all (no provider, no onTogglePopout)",
    liftable: false,
    props: { cardKey: NOTE_KEY },
    popped: null,
  },
  {
    name: "the fallback door: onTogglePopout with no provider",
    liftable: true,
    props: { cardKey: NOTE_KEY, onTogglePopout: vi.fn() },
    popped: null,
  },
];

describe("the lift grip paints iff the lift can land (task 277)", () => {
  for (const row of ROWS) {
    it(`${row.liftable ? "offers" : "refuses"}: ${row.name}`, () => {
      const popped = row.popped ? makePopped(row.popped) : null;
      const onTogglePopout = row.props.onTogglePopout as ReturnType<typeof vi.fn> | undefined;
      const { container } = renderCase(row.props, popped?.value ?? null);

      const painted = gripCount(container) > 0;
      dragHeader(container);
      const fired =
        (popped?.popOutAtRect.mock.calls.length ?? 0) > 0 ||
        (onTogglePopout?.mock.calls.length ?? 0) > 0;

      // The one assertion that matters: the promise and the mechanism agree.
      expect(painted).toBe(fired);
      // …and each row's absolute expectation, so a build where NOTHING lifts
      // can't satisfy the equivalence vacuously.
      expect(painted).toBe(row.liftable);
    });
  }

  it("a floating (popped-out) card shows no in-card grip — FloatChrome moves it", () => {
    // `chromeless` popped cards delegate the header entirely; a non-chromeless
    // one still renders the unified header, and its grip could never lift
    // (`isPoppedOut` bails).
    const { value } = makePopped();
    const { container } = renderCase(
      { cardKey: NOTE_KEY, isPoppedOut: true, onTogglePopout: vi.fn() },
      value,
    );
    expect(gripCount(container)).toBe(0);
  });

  it("the grip is the ONLY thing that changes — badge, label and controls stay", () => {
    // A refused lift must not cost the card its header. (The grip's own
    // 10px slot goes with it; nothing else does.)
    const { value } = makePopped();
    const { container } = renderCase(
      { footnoteBadge: <span data-testid="badge">7</span> },
      value,
    );
    expect(gripCount(container)).toBe(0);
    expect(screen.getByTestId("badge")).toBeTruthy();
    expect(screen.getByLabelText("Expand card")).toBeTruthy();
  });

  it("a refused header still clicks (select + toggle), it just cannot be dragged", () => {
    const onHeaderActivate = vi.fn();
    const { value } = makePopped();
    const { container } = renderCase({ onHeaderActivate }, value);
    fireEvent.click(container.querySelector('[data-card-header="1"]') as HTMLElement);
    expect(onHeaderActivate).toHaveBeenCalledTimes(1);
  });
});

/* ── The census: the grip has ONE render site, and it asks ──────────── */

// The leg with teeth. `canLift` was never the part that could misbehave — a
// second render site that doesn't consult it is, and no rendered-DOM test can
// see one that no suite happens to mount. Same discipline as the repo's other
// call-site censuses (keystroke subscribers, scroll repositioners, …).
//
// Stated limits, rather than implied: the needle is the literal JSX tag, so a
// render through an alias (`const G = CardDragHandle; <G />`) or a hand-rolled
// copy of the glyph passes — neither is an idiom this repo uses, and the second
// is the `bib-entry-chrome.tsx` case, which is a DIFFERENT gesture ("Drag to a
// library") with its own honest affordance. And the gate is matched on the
// render LINE, so wrapping the same expression across two lines would need this
// needle widened rather than the rule relaxed.

const ROOT = join(__dirname, "..", "..", "..");

function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* sourceFiles(p);
    else if (/\.tsx?$/.test(name)) yield p;
  }
}

describe("census: every CardDragHandle render site asks canLift", () => {
  it("has exactly one render site, and it is gated", () => {
    const sites: Array<{ file: string; line: string }> = [];
    for (const root of [join(ROOT, "src"), join(ROOT, "library")]) {
      for (const file of sourceFiles(root)) {
        if (file.includes("__tests__")) continue;
        const src = readFileSync(file, "utf8");
        if (!src.includes("<CardDragHandle")) continue;
        for (const line of codeOnly(src).split("\n")) {
          if (line.includes("<CardDragHandle")) {
            sites.push({ file: file.slice(ROOT.length + 1), line: line.trim() });
          }
        }
      }
    }
    expect(sites.map((s) => s.file)).toEqual(["src/components/panel-primitives.tsx"]);
    // The gate lives on the same JSX line as the render (`{canLift && <…/>}`),
    // which is what makes this readable as one declaration.
    expect(sites[0].line).toContain("canLift &&");
  });

  it("the canLift derivation still reads every gate the handler would", () => {
    // Not a restatement of the predicate — a check that the render-time
    // facts the gesture depends on are named in ONE expression, so a future
    // gate cannot be added to the handler alone.
    const src = codeOnly(
      readFileSync(join(ROOT, "src/components/panel-primitives.tsx"), "utf8"),
    );
    const decl = src.slice(src.indexOf("const canLift ="));
    const body = decl.slice(0, decl.indexOf(";"));
    for (const needle of ["cardKey", "isPoppedOut", "isPopped", "isPoppable", "popOutAtRect", "onTogglePopout"]) {
      expect(body).toContain(needle);
    }
    // And the handler defers to it rather than re-deriving.
    const handler = src.slice(src.indexOf("const onWrapperMouseDown"));
    expect(handler.slice(0, handler.indexOf("e.button"))).toContain("!canLift");
  });
});

// @vitest-environment jsdom
//
// Task 508 — the card DROP-TARGET HALO has exactly ONE speller.
//
// A `PanelCard` root's `box-shadow` is written INLINE by `themedCardStyle`, so
// it is the only thing entitled to say anything about that property. The halo
// used to be a class (`ring-2 ring-drag-target ring-offset-0`) handed in
// through `extraCardClass` — Tailwind's `ring-*` IS a `box-shadow`, and an
// inline declaration beats every stylesheet rule, so the amber "you may drop a
// bib entry here" cue **had never painted** on a docked card. The affordance
// was correct and invisible.
//
// **No pre-508 suite could see any of this.** `citation-drop-symmetry` asserted
// `container.querySelector(".ring-drag-target")` — the CLASS, which was present
// the whole time — so it passed on an implementation that painted nothing. A
// leg that reads the class is a leg about a class; the thing the user can see
// is the resolved `box-shadow`, which is what every leg here reads.
//
// The legs with teeth are the CENSUSES at the bottom: the primitive was never
// the part that could misbehave — a caller that re-forks the halo as a class,
// or a second file that spells the token itself, is. Both allowlists EMPTY.

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

vi.mock("@/components/RichTextField", () => ({
  default: () => <div data-testid="rtf" />,
}));
vi.mock("@/components/BorrowedMainText", () => ({
  BorrowedMainText: () => <div data-testid="borrowed" />,
  default: () => <div data-testid="borrowed" />,
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { ComponentProps } from "react";
import {
  CARD_THEMES,
  PanelCard,
  themedCardStyle,
} from "@/components/panel-primitives";
import {
  REPO_ROOT,
  commentsStripped,
  cssCommentsStripped,
  trackedFiles,
} from "@/lib/__tests__/_source-scan";

afterEach(cleanup);

const theme = CARD_THEMES.citation;
const AMBIENT = "var(--card-shadow-ambient)";
const RING = "var(--ring-drag-target)";

/* ── Leg 1: the pure composition ─────────────────────────────────── */

describe("themedCardStyle composes the drop halo with the ambient lift", () => {
  it("docked + dropTarget → BOTH the ring and the ambient lift, ring first", () => {
    const shadow = String(themedCardStyle(theme, false, { dropTarget: true }).boxShadow);
    // Both facts, in one declaration. The ring is a transient state ABOUT the
    // card, never a replacement for its elevation — a card being hovered by a
    // droppable payload keeps sitting on the canvas.
    expect(shadow).toContain(RING);
    expect(shadow).toContain(AMBIENT);
    expect(shadow.indexOf(RING)).toBeLessThan(shadow.indexOf(AMBIENT));
  });

  it("docked + no dropTarget → the ambient lift ALONE (byte-identical to pre-508)", () => {
    expect(themedCardStyle(theme, false).boxShadow).toBe(AMBIENT);
    expect(themedCardStyle(theme, true, { isPoppedOut: false }).boxShadow).toBe(AMBIENT);
  });

  it("popped out + dropTarget → the ring ALONE (that branch carries no ambient)", () => {
    const style = themedCardStyle(theme, false, { isPoppedOut: true, dropTarget: true });
    expect(String(style.boxShadow)).toContain(RING);
    expect(String(style.boxShadow)).not.toContain(AMBIENT);
    // The borderless pop-out treatment is untouched — FloatingPanel still owns
    // the chrome.
    expect(style.borderRadius).toBe(0);
    expect(style.borderWidth).toBe(0);
  });

  it("popped out + no dropTarget → NO box-shadow at all (pre-508 behaviour)", () => {
    const style = themedCardStyle(theme, false, { isPoppedOut: true });
    expect(style.boxShadow).toBeUndefined();
  });
});

/* ── Leg 2: through the REAL primitive ───────────────────────────── */

type PanelCardProps = ComponentProps<typeof PanelCard>;

function renderPanelCard(overrides: Partial<PanelCardProps> = {}) {
  const props: PanelCardProps = {
    theme,
    selected: false,
    kind: "citation",
    cardKey: "float:card:citation:c1",
    isCollapsed: true,
    children: <div data-testid="body">body</div>,
    ...overrides,
  };
  const { container } = render(<PanelCard {...props} />);
  return container.querySelector("[data-card]") as HTMLElement;
}

describe("PanelCard paints the halo from isDropTarget", () => {
  it("isDropTarget → the ROOT's inline box-shadow carries the ring AND the lift", () => {
    const el = renderPanelCard({ isDropTarget: true });
    expect(el.style.boxShadow).toContain(RING);
    expect(el.style.boxShadow).toContain(AMBIENT);
  });

  it("no isDropTarget → the lift alone, with no ring anywhere", () => {
    const el = renderPanelCard();
    expect(el.style.boxShadow).toBe(AMBIENT);
  });

  it("an extraCardClass ring can never be the mechanism (the retired shape)", () => {
    // Accepting control for the whole task: hand PanelCard the exact class
    // string that shipped before 508 and observe that the element's resolved
    // box-shadow is STILL just the ambient lift. The class is present; the
    // property is not its. This is why the pre-508 legs passed.
    const el = renderPanelCard({ extraCardClass: "ring-2 ring-drag-target ring-offset-0" });
    expect(el.className).toContain("ring-drag-target");
    expect(el.style.boxShadow).toBe(AMBIENT);
  });
});

/* ── Leg 3: the censuses (the legs with teeth) ───────────────────── */

const PRODUCTION = [
  ...trackedFiles("src", /\.(ts|tsx)$/),
  ...trackedFiles("library", /\.(ts|tsx)$/),
].filter((p) => !/__tests__|\.test\./.test(p));

const rel = (abs: string) => path.relative(REPO_ROOT, abs);

describe("the drop halo has ONE speller", () => {
  it("no production file spells `ring-drag-target` as a class utility", () => {
    // Allowlist EMPTY, and there is no shape that would earn one: on a
    // PanelCard root the class cannot win the property, and off one there is
    // no drop halo to paint. A hit is THREAD-THE-PROP, never an entry here.
    const hits = PRODUCTION.filter((abs) =>
      /(?:^|[\s"'`:])(?:\w+:)*ring-drag-target\b/.test(commentsStripped(readFileSync(abs, "utf8"))),
    ).map(rel);
    expect(hits).toEqual([]);
  });

  it("only the primitive reads `--ring-drag-target` (globals.css DEFINES it)", () => {
    // The token itself is fine — what must not recur is a SECOND file deciding
    // what the halo looks like. `CARD_DROP_TARGET_RING` in panel-primitives is
    // the one reader; globals.css owns the value.
    const readers = PRODUCTION.filter((abs) =>
      commentsStripped(readFileSync(abs, "utf8")).includes("--ring-drag-target"),
    ).map(rel);
    expect(readers).toEqual(["src/components/panel-primitives.tsx"]);
  });

  it("CAN SEE both shapes (synthetic canary)", () => {
    // Neither needle may stand on a line the fix drained, so both fixtures are
    // synthetic — a canary that reads a real surviving site would evaporate the
    // moment that site moved.
    const fixture = `const a = "ring-2 ring-drag-target ring-offset-0";\nconst b = "0 0 0 2px var(--ring-drag-target)";`;
    expect(/(?:^|[\s"'`:])(?:\w+:)*ring-drag-target\b/.test(fixture)).toBe(true);
    expect(fixture.includes("--ring-drag-target")).toBe(true);
    // …and it does NOT fire on the token DEFINITION shape alone.
    expect(/(?:^|[\s"'`:])(?:\w+:)*ring-drag-target\b/.test("--color-x: var(--ring-drag-target);")).toBe(
      false,
    );
    // The biconditional's UTILITY half sees a real class and not the token.
    const util = new RegExp(
      "(?<![-\\w])(?:(?:hover|focus|focus-visible|active|group-hover|disabled):)*" +
        "(?:text|bg|border|ring|fill|stroke|outline)-drag-target(?!-)\\b",
    );
    expect(util.test('className="ring-2 ring-drag-target"')).toBe(true);
    expect(util.test("0 0 0 2px var(--ring-drag-target)")).toBe(false);
  });

  it("mints a Tailwind alias iff something spells the utility", () => {
    // globals.css states this law beside the `--color-danger-strong` and
    // `--color-positive` rows and `affirmative-green-tokens` pins it for the
    // affirmative family: a rung spelled as a utility gets an alias, a rung
    // read only through `var(--token)` does not. Task 508 drained the one
    // `ring-drag-target` utility, so its alias went with it — and this leg
    // refuses one minted ahead of a future consumer just as firmly.
    const globals = cssCommentsStripped(
      readFileSync(path.join(REPO_ROOT, "src/app/globals.css"), "utf8"),
    );
    const usedAsUtility = PRODUCTION.some((abs) =>
      // `(?<![-\w])` rather than a bare `\b`: the TOKEN is spelled
        // `--ring-drag-target`, so a word boundary alone reads the `ring-`
        // prefix of the token's own name as the `ring-*` utility and the
        // biconditional demands an alias nothing spells (measured — this leg's
        // own first cut failed exactly that way).
      new RegExp(
        "(?<![-\\w])(?:(?:hover|focus|focus-visible|active|group-hover|disabled):)*" +
          "(?:text|bg|border|ring|fill|stroke|outline)-drag-target(?!-)\\b",
      ).test(commentsStripped(readFileSync(abs, "utf8"))),
    );
    const aliased = /--color-ring-drag-target:\s*var\(--ring-drag-target\)/.test(globals);
    expect(
      aliased,
      `ring-drag-target: utility=${usedAsUtility} alias=${aliased} — the two must agree`,
    ).toBe(usedAsUtility);
    // The token itself survives: it is read as an inline value now.
    expect(globals).toContain("--ring-drag-target:");
  });
});

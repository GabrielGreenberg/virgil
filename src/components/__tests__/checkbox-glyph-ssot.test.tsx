// @vitest-environment jsdom
//
// Task 2026-08-02-287 — the checkbox glyph has ONE author.
//
// Before this, the Todo done-toggle and the shared `AiRequestCheckbox` each
// drew the same 14×14 rounded square and the same tick path, in two files, from
// five raw hex literals between them — `#b5b0aa` three times, which is a
// verbatim re-spelling of `--muted-light` (a token STYLE_GUIDE locks to
// `--scrollbar-hover`, so a retone would have moved the scrollbar and left both
// checkbox borders behind).
//
// Three kinds of leg, and the ORDER of their importance is the reverse of the
// order they read in:
//
//  1. PARITY — the shipped `CheckSquare` renders what the two pre-fix glyphs
//     rendered, modulo three stated substitutions/normalizations, each of them
//     self-checked so no leg can pass vacuously. This is what makes the change
//     a tokenization rather than a restyle.
//  2. DERIVATION — the AI tick comes from the `aiRequest` panel-theme accent
//     (which had ZERO readers before this call), not from a literal.
//  3. The CENSUS is the leg with teeth. The primitive was never the part that
//     could misbehave — a call site that re-authors the square beside it is,
//     which is exactly what shipped. So the geometry literals must occur ONCE
//     in production source, and the real `TodoRow` must render the primitive's
//     own output rather than a copy that merely looks like it.
//
// The colour half is guarded by `panel-chrome-palette-guardrail`, whose
// `PERMITTED_RAW_VALUE_LITERALS` this task drained to empty; the two suites are
// complementary — that one forbids a literal, this one pins what replaced it.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

// panel-primitives transitively pulls `@/lib/storage` (the known barrel/storage
// gotcha) — stub it; nothing here touches a sidecar.
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

import { render, cleanup } from "@testing-library/react";
import { CheckSquare, AiRequestCheckbox } from "@/components/panel-primitives";
import { TodoRow } from "@/panels/Todo/TodoRow";
import { accentInk, getPanelColor, DEFAULT_PANEL_COLORS } from "@/lib/panel-theme";
import { defaultCardStore as cardStore } from "@/links/_shared/anchored-card-store";
import type { TodoItem } from "@/lib/types";

afterEach(cleanup);

const ROOT = path.resolve(__dirname, "..", "..", "..");

/* ── The pre-287 glyphs, verbatim ──────────────────────────────────
 *
 * Copied byte-for-byte off the two components as they stood at `88cb484b`. They
 * are the fixture the shipped primitive is measured against; the substitution
 * map below is the ONLY licensed difference. */
function PreFixDoneGlyph({ done }: { done: boolean }) {
  return done ? (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <rect x="1" y="1" width="14" height="14" rx="3" fill="#ece9e4" stroke="#b5b0aa" strokeWidth="1.5" />
      <path d="M4.5 8l2.5 2.5 4.5-5" stroke="#1c1917" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <rect x="1" y="1" width="14" height="14" rx="3" stroke="#b5b0aa" strokeWidth="1.5" />
    </svg>
  );
}

function PreFixAiGlyph({ checked }: { checked: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="shrink-0">
      <rect x="1" y="1" width="14" height="14" rx="3" stroke="#b5b0aa" strokeWidth="1.5" fill="none" />
      {checked && (
        <path d="M4.5 8l2.5 2.5 4.5-5" stroke="#0369a1" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      )}
    </svg>
  );
}

/**
 * The retired literal → what the shipped glyph reads instead. The AI tick's
 * replacement is COMPUTED here from the same registry the primitive asks, so
 * this table states a coupling rather than a second hex.
 */
const SUBSTITUTIONS: Record<string, string> = {
  "#b5b0aa": "var(--muted-light)",
  "#ece9e4": "var(--checkbox-fill)",
  "#1c1917": "var(--checkbox-mark)",
  "#0369a1": accentInk(getPanelColor("aiRequest")),
};

/**
 * Canonical form of an SVG subtree: tag + attributes sorted by name, recursive.
 *
 * Three normalizations, each a decision rather than a convenience:
 *
 *  - **Attribute ORDER is not a rendering fact.** The primitive composes its
 *    `<rect>` in a different order than the two twins spelled it; nothing about
 *    what paints depends on that.
 *  - **A missing `fill` INHERITS.** The pre-fix unchecked `done` rect carried no
 *    `fill` at all and took the `fill="none"` off its own `<svg>`; the shipped
 *    one says `fill="none"` explicitly. That is the same paint, so the
 *    canonicalizer resolves the inheritance instead of pretending the two
 *    strings match.
 *  - **The root's `class` is dropped**, and only the root's. The shipped glyph
 *    carries `shrink-0` for both variants (the AI twin already did; the Todo
 *    one did not, and it is inert there — its `<button>` is not a flex
 *    container). Everything inside is compared including `class`, and the
 *    falsifiability leg below proves the normalizer still catches a changed
 *    geometry or colour attribute.
 */
function canonical(el: Element, inheritedFill: string | null = null, isRoot = true): string {
  const fill = el.getAttribute("fill") ?? inheritedFill;
  const attrs: string[] = [];
  for (const a of [...el.attributes]) {
    if (isRoot && a.name === "class") continue;
    if (a.name === "fill") continue;
    attrs.push(`${a.name}=${a.value}`);
  }
  if (fill != null) attrs.push(`fill=${fill}`);
  attrs.sort();
  const kids = [...el.children].map((c) => canonical(c, fill, false)).join("");
  return `<${el.tagName}|${attrs.join("|")}>${kids}</${el.tagName}>`;
}

/** Canonical form with every retired literal rewritten to its replacement. */
function canonicalSubstituted(el: Element): { text: string; fired: string[] } {
  let text = canonical(el);
  const fired: string[] = [];
  for (const [literal, replacement] of Object.entries(SUBSTITUTIONS)) {
    if (text.includes(literal)) {
      fired.push(literal);
      text = text.split(literal).join(replacement);
    }
  }
  return { text, fired };
}

function svgOf(container: HTMLElement): SVGElement {
  const svg = container.querySelector("svg");
  if (!svg) throw new Error("no <svg> rendered");
  return svg as SVGElement;
}

describe("CheckSquare parity with the two pre-287 glyphs", () => {
  it.each([true, false])("the `done` variant renders the pre-fix glyph (checked=%s)", (checked) => {
    const before = render(<PreFixDoneGlyph done={checked} />);
    const expected = canonicalSubstituted(svgOf(before.container));
    cleanup();
    const after = render(<CheckSquare variant="done" checked={checked} />);
    expect(canonical(svgOf(after.container))).toBe(expected.text);
    // The substitution must actually have fired, or this leg would pass on a
    // fixture that never carried the literals it exists to license.
    expect(expected.fired.sort()).toEqual(
      checked ? ["#1c1917", "#b5b0aa", "#ece9e4"] : ["#b5b0aa"],
    );
  });

  it.each([true, false])("the `ai-request` variant renders the pre-fix glyph (checked=%s)", (checked) => {
    const before = render(<PreFixAiGlyph checked={checked} />);
    const expected = canonicalSubstituted(svgOf(before.container));
    cleanup();
    const after = render(<CheckSquare variant="ai-request" checked={checked} />);
    expect(canonical(svgOf(after.container))).toBe(expected.text);
    expect(expected.fired.sort()).toEqual(
      checked ? ["#0369a1", "#b5b0aa"] : ["#b5b0aa"],
    );
  });

  it("the AiRequestCheckbox button still draws that glyph and keeps its label", () => {
    const { container } = render(<AiRequestCheckbox checked onToggle={() => {}} />);
    cleanup();
    const glyph = render(<CheckSquare variant="ai-request" checked />);
    // Re-render the button after cleanup so both trees exist independently.
    const glyphText = canonical(svgOf(glyph.container));
    cleanup();
    const again = render(<AiRequestCheckbox checked onToggle={() => {}} />);
    expect(canonical(svgOf(again.container))).toBe(glyphText);
    expect(again.container.textContent).toContain("AI request");
    void container;
  });

  it("the normalizer still catches a real difference (falsifiability)", () => {
    // Same shape, one geometry attribute moved. If `canonical` were lenient
    // enough to hide this, every parity leg above would be decoration.
    const a = render(<CheckSquare variant="done" checked />);
    const canonA = canonical(svgOf(a.container));
    cleanup();
    const b = render(
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0">
        <rect x="1" y="1" width="14" height="14" rx="4" fill="var(--checkbox-fill)" stroke="var(--muted-light)" strokeWidth="1.5" />
        <path d="M4.5 8l2.5 2.5 4.5-5" stroke="var(--checkbox-mark)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>,
    );
    expect(canonical(svgOf(b.container))).not.toBe(canonA);
  });
});

describe("the two variants share one geometry", () => {
  it("same square and same tick path, whatever the palette", () => {
    const done = render(<CheckSquare variant="done" checked />);
    const doneRect = svgOf(done.container).querySelector("rect")!;
    const donePath = svgOf(done.container).querySelector("path")!;
    const geom = (r: Element) =>
      ["x", "y", "width", "height", "rx", "stroke-width"].map((a) => r.getAttribute(a)).join("|");
    const doneGeom = geom(doneRect);
    const doneD = donePath.getAttribute("d");
    cleanup();
    const ai = render(<CheckSquare variant="ai-request" checked />);
    expect(geom(svgOf(ai.container).querySelector("rect")!)).toBe(doneGeom);
    expect(svgOf(ai.container).querySelector("path")!.getAttribute("d")).toBe(doneD);
  });

  it("both variants take the box edge from --muted-light", () => {
    for (const variant of ["done", "ai-request"] as const) {
      const { container } = render(<CheckSquare variant={variant} checked />);
      expect(svgOf(container).querySelector("rect")!.getAttribute("stroke")).toBe(
        "var(--muted-light)",
      );
      cleanup();
    }
  });
});

describe("the palette comes from the SSOTs, not from this file", () => {
  it("globals.css defines the two checkbox tokens at the values they replaced", () => {
    const globals = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
    expect(globals).toMatch(/--checkbox-fill:\s*#ece9e4\s*;/);
    expect(globals).toMatch(/--checkbox-mark:\s*#1c1917\s*;/);
  });

  it("the `done` variant reads those tokens", () => {
    const { container } = render(<CheckSquare variant="done" checked />);
    expect(svgOf(container).querySelector("rect")!.getAttribute("fill")).toBe(
      "var(--checkbox-fill)",
    );
    expect(svgOf(container).querySelector("path")!.getAttribute("stroke")).toBe(
      "var(--checkbox-mark)",
    );
  });

  it("the AI tick is the aiRequest accent's INK, giving that theme key its first reader", () => {
    const { container } = render(<CheckSquare variant="ai-request" checked />);
    const stroke = svgOf(container).querySelector("path")!.getAttribute("stroke");
    expect(stroke).toBe(accentInk(getPanelColor("aiRequest")));
    // …the ink, not the raw accent. Without this the leg above would also pass
    // for a glyph that painted the undarkened #0ea5e9.
    expect(stroke).not.toBe(DEFAULT_PANEL_COLORS.aiRequest);
  });

  it("the primitive spells the derivation, so a value equal to today's ink is still a regression", () => {
    // The equality leg above cannot tell `accentInk(getPanelColor(…))` from a
    // hardcoded copy of what it currently returns. `panel-chrome-palette-
    // guardrail` would flag the hex — this names the coupling directly.
    const src = readFileSync(path.join(ROOT, "src/components/panel-primitives.tsx"), "utf8");
    expect(src).toContain('accentInk(getPanelColor("aiRequest"))');
  });
});

/* ── The census ────────────────────────────────────────────────────
 *
 * Production source only: this file embeds the pre-fix markup on purpose, and a
 * census that scanned its own fixtures would indict the proof. */
function productionFiles(): string[] {
  const out: string[] = [];
  const walk = (abs: string) => {
    for (const name of readdirSync(abs)) {
      const child = path.join(abs, name);
      if (statSync(child).isDirectory()) {
        if (name === "__tests__") continue;
        walk(child);
      } else if (/\.tsx?$/.test(name)) {
        out.push(path.relative(ROOT, child).split(path.sep).join("/"));
      }
    }
  };
  walk(path.join(ROOT, "src"));
  walk(path.join(ROOT, "library"));
  return out.sort();
}

describe("nobody re-authors the glyph (the leg with teeth)", () => {
  const files = productionFiles();
  const hits = (needle: string) =>
    files.filter((rel) => readFileSync(path.join(ROOT, rel), "utf8").includes(needle));
  /** Whitespace-blind, so a re-author that merely reformats the attributes onto
   *  their own lines — which is exactly how the shipped primitive spells them —
   *  cannot walk out of the census. */
  const squashedHits = (needle: string) =>
    files.filter((rel) =>
      readFileSync(path.join(ROOT, rel), "utf8").replace(/\s+/g, "").includes(needle),
    );

  it("the checkbox SQUARE is spelled in exactly one production file", () => {
    expect(squashedHits('width="14"height="14"rx="3"')).toEqual([
      "src/components/panel-primitives.tsx",
    ]);
  });

  it("the TICK path is spelled in exactly one production file", () => {
    expect(hits("M4.5 8l2.5 2.5 4.5-5")).toEqual([
      "src/components/panel-primitives.tsx",
    ]);
  });

  it("none of the five retired literals survives in either glyph's file", () => {
    for (const rel of ["src/components/panel-primitives.tsx", "src/panels/Todo/TodoRow.tsx"]) {
      const src = readFileSync(path.join(ROOT, rel), "utf8");
      // Comments are NOT stripped here on purpose: the explanatory prose in both
      // files names what it retired, so a bare `includes` would indict the
      // explanation. The needle is therefore the ATTRIBUTE form — the only
      // spelling that paints.
      for (const literal of Object.keys(SUBSTITUTIONS)) {
        expect(src, `${rel} :: ${literal}`).not.toContain(`"${literal}"`);
      }
    }
  });

  it("the census can see a needle that is really there (canary)", () => {
    // Anchored on the primitive itself, which cannot be retired — never on a
    // line this task drained, since such a canary evaporates with the fix.
    expect(hits("export function CheckSquare")).toEqual([
      "src/components/panel-primitives.tsx",
    ]);
    expect(files.length).toBeGreaterThan(300);
    expect(files.some((f) => f.includes("__tests__"))).toBe(false);
  });
});

/* ── The real call site ────────────────────────────────────────────
 *
 * A source census proves the literals are gone; only a render proves the panel
 * shows the shared glyph. The original defect was a call site that drew its own
 * square — indistinguishable, from the outside, from one that asks. */
const REF = { kind: "todo" as const, id: "t1" };

function makeTodo(overrides: Partial<TodoItem> = {}): TodoItem {
  return {
    id: "t1",
    text: "walk the dog",
    titleAuto: true,
    notes: "",
    done: false,
    aiRequest: false,
    createdAt: "2026-08-14T00:00:00.000Z",
    links: [],
    ...overrides,
  } as TodoItem;
}

describe("TodoRow renders the shared glyph", () => {
  beforeEach(() => {
    cardStore.collapse(REF);
    cardStore.clearSelection();
  });

  it.each([true, false])("its done-toggle IS CheckSquare (done=%s)", (done) => {
    const glyph = render(<CheckSquare variant="done" checked={done} />);
    const expected = canonical(svgOf(glyph.container));
    cleanup();
    const row = render(
      <TodoRow
        item={makeTodo({ done })}
        selected={false}
        onToggle={() => {}}
        onUpdate={() => {}}
        onUpdateNotes={() => {}}
        onSetAiRequest={() => {}}
        onDelete={() => {}}
        onSelect={() => {}}
        isAnchored={false}
      />,
    );
    const toggle = row.container.querySelector('[aria-label="Mark done"], [aria-label="Undo done"]');
    expect(toggle, "the done-toggle button is not rendered").toBeTruthy();
    expect(canonical(toggle!.querySelector("svg")!)).toBe(expected);
  });
});

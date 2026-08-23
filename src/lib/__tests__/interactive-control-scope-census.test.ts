// @vitest-environment jsdom
//
// Task 423 — the scoping rule for the interactive-control pass-through, stated
// ONCE in the `drag-blocklist` leaf, plus the CENSUS that keeps it there.
//
// The selector was always shared (`INTERACTIVE_CONTROL_SELECTOR`). What was
// hand-written per site was the SCOPING — whether the `closest()` hit had to be
// a strict descendant of the gesture's own container — and it had been got
// right once (PanelCard's card lift, the delete-key guard) and wrong once (the
// omni pin-on-touch, written as a "mirror" of the lift blocker). Because
// `[draggable='true']` is in the selector and a card ROOT is draggable for
// cross-editor anchor drags, the unscoped copy answered "interactive" for a
// press ANYWHERE on a citation card: `holdOmniCard` never ran, and the card
// and every card below it jumped on each collapse/expand.
//
// The door was never the part that could misbehave; a site spelling the bare
// `closest(SELECTOR)` is. No behavioural test of either blocker can see a third
// such site, so the census is the leg with teeth. Allowlist EMPTY — a hit is
// MIGRATE-it.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { codeOnly, commentsStripped } from "@/lib/__tests__/_source-scan";
import {
  pressFromInteractiveControl,
  cardShellWithin,
  INTERACTIVE_CONTROL_SELECTOR,
  WINDOW_DRAG_BLOCK_SELECTOR,
} from "@/lib/drag-blocklist";

const ROOT = join(__dirname, "..", "..", "..");
const LEAF = join(ROOT, "src", "lib", "drag-blocklist.ts");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

const PRODUCTION = [...walk(join(ROOT, "src")), ...walk(join(ROOT, "library"))];

// ---------------------------------------------------------------------------
// The predicate's contract
// ---------------------------------------------------------------------------

/** A card shell whose ROOT is draggable (the CitationCard shape), holding a
 *  header button, a prose span, and a contenteditable body. */
function buildCard() {
  document.body.innerHTML = `
    <div id="outer">
      <div id="card" data-card="1" draggable="true">
        <div id="header"><span id="title">Title</span><button id="trash">x</button></div>
        <div id="body"><span id="prose">prose</span></div>
        <div id="editor" contenteditable="true"><span id="in-editor">text</span></div>
      </div>
    </div>`;
  const q = (id: string) => document.getElementById(id)!;
  return { card: q("card"), header: q("header"), title: q("title"), trash: q("trash"), prose: q("prose"), editor: q("editor"), inEditor: q("in-editor"), outer: q("outer") };
}

describe("pressFromInteractiveControl — strict-descendant scoping", () => {
  it("a press on plain prose inside a DRAGGABLE card root is NOT interactive (the task-423 defect)", () => {
    const { card, prose, title } = buildCard();
    expect(pressFromInteractiveControl(prose, card)).toBe(false);
    expect(pressFromInteractiveControl(title, card)).toBe(false);
    // …and the unscoped form is exactly the wrong answer the pin blocker gave.
    expect(prose.closest(INTERACTIVE_CONTROL_SELECTOR)).toBe(card);
  });

  it("a press on a nested control IS interactive", () => {
    const { card, trash, inEditor } = buildCard();
    expect(pressFromInteractiveControl(trash, card)).toBe(true);
    // The contenteditable body is a deliberate member (stated at the omni site).
    expect(pressFromInteractiveControl(inEditor, card)).toBe(true);
  });

  it("the container itself, and anything above it, never counts", () => {
    const { card, prose, header } = buildCard();
    expect(pressFromInteractiveControl(card, card)).toBe(false);
    // Scoped to the HEADER (the card-lift shape): a control outside the
    // header — the draggable root above it — is not the header's business.
    expect(pressFromInteractiveControl(prose, header)).toBe(false);
    expect(pressFromInteractiveControl(header, header)).toBe(false);
  });

  it("accepts a wider selector (the float window-drag's `[data-card]` extension)", () => {
    document.body.innerHTML = `<div id="float"><div data-card="1"><span id="s">s</span></div><span id="gap">gap</span></div>`;
    const float = document.getElementById("float")!;
    expect(pressFromInteractiveControl(document.getElementById("s"), float, WINDOW_DRAG_BLOCK_SELECTOR)).toBe(true);
    expect(pressFromInteractiveControl(document.getElementById("gap"), float, WINDOW_DRAG_BLOCK_SELECTOR)).toBe(false);
  });

  it("a wrapper OUTSIDE the shell must resolve the shell first — scoping to the wrapper is the defect in a second costume", () => {
    const { card, prose, outer, trash } = buildCard();
    // Asked of the wrapper, the draggable card root IS a strict descendant
    // and the press reads as interactive — the trap the omni site fell into.
    expect(pressFromInteractiveControl(prose, outer)).toBe(true);
    // Resolved to the shell, the same press is plain prose…
    expect(cardShellWithin(prose, outer)).toBe(card);
    expect(pressFromInteractiveControl(prose, cardShellWithin(prose, outer))).toBe(false);
    // …and a real control inside the shell still answers true.
    expect(pressFromInteractiveControl(trash, cardShellWithin(trash, outer))).toBe(true);
    // A shell OUTSIDE the wrapper is not the wrapper's card.
    expect(cardShellWithin(prose, document.getElementById("header"))).toBeNull();
  });

  it("null / non-element inputs answer false (never throw)", () => {
    const { card } = buildCard();
    expect(pressFromInteractiveControl(null, card)).toBe(false);
    expect(pressFromInteractiveControl(card, null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The census
// ---------------------------------------------------------------------------

/** A hand-rolled `closest()` over either shared selector — the shape that
 *  dropped the scoping once already. */
const BARE_CLOSEST = /\.closest\(\s*(?:INTERACTIVE_CONTROL_SELECTOR|WINDOW_DRAG_BLOCK_SELECTOR)\b/;

describe("census — no production site spells closest(<shared selector>) itself", () => {
  it("every such query enters pressFromInteractiveControl (allowlist EMPTY)", () => {
    const hits: string[] = [];
    for (const file of PRODUCTION) {
      if (file === LEAF) continue;
      const src = codeOnly(readFileSync(file, "utf8"));
      if (BARE_CLOSEST.test(src)) hits.push(relative(ROOT, file));
    }
    expect(hits).toEqual([]);
  });

  it("the leaf is the only file that spells the bare query (the needle can see)", () => {
    // A needle that matches nothing anywhere would pass the leg above for the
    // wrong reason; the leaf itself must register exactly one hit.
    const src = codeOnly(readFileSync(LEAF, "utf8"));
    expect(/\.closest\(\s*selector\s*\)/.test(src)).toBe(true);
    // Synthetic canary, not one standing on a drained production line.
    expect(BARE_CLOSEST.test("const b = target.closest(INTERACTIVE_CONTROL_SELECTOR);")).toBe(true);
    expect(BARE_CLOSEST.test("if (target.closest( WINDOW_DRAG_BLOCK_SELECTOR )) return;")).toBe(true);
  });

  it("every production importer of a shared SELECTOR enters the door", () => {
    // Membership DISCOVERED from the import clause, never hand-listed: a file
    // that imports one of the selector constants holds a string it can only
    // use by querying — and the only sanctioned query is the door. A file
    // that takes only the keyboard twin (`isEditableEventTarget`) owes
    // nothing here.
    const importers: string[] = [];
    for (const f of PRODUCTION) {
      if (f === LEAF) continue;
      // Comments stripped, literals KEPT — the needle is a quoted path.
      const src = commentsStripped(readFileSync(f, "utf8"));
      const m = src.match(/import\s*\{([^}]*)\}\s*from\s*["']@\/lib\/drag-blocklist["']/);
      if (!m) continue;
      if (/INTERACTIVE_CONTROL_SELECTOR|WINDOW_DRAG_BLOCK_SELECTOR/.test(m[1])) {
        importers.push(relative(ROOT, f));
        expect(src, relative(ROOT, f)).toMatch(/pressFromInteractiveControl\(/);
      }
    }
    // The population is non-empty (the float's wider selector is passed
    // through the door), so the leg cannot pass vacuously.
    expect(importers).toContain("src/components/FloatingPanel.tsx");
  });
});

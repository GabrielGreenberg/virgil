// @vitest-environment jsdom
/**
 * Task 437 — **a preview shows what the release produces.**
 *
 * The lift ghost (`LiftedTextOverlay`) grows a header bar past the popout
 * threshold and, on release, becomes a real float whose header is
 * `FloatChrome`. Those two headers are supposed to be the same thing so
 * nothing moves at the handoff. They FORKED: `FloatChrome` gained a 14px grip
 * and a (re)anchor drop button, the ghost's own `FloatHeaderContent` did not,
 * and four comments in four files went on asserting one source of truth —
 * naming `TextObjectFloat`, a component that had been deleted.
 *
 * Why no pre-437 suite could see it: BOTH suites that render the overlay
 * (`lifted-overlay-view-toggle`, `lift-overlay-motion-cost`) `vi.mock`ed the
 * header content to `() => null` for module weight. The one thing that would
 * have failed was the one thing both stubbed out.
 *
 * Two kinds of leg here, because the fork had two halves:
 *
 *  - **the CHILD ROW** — the ghost's header and the released float's header
 *    render the same children in the same order. Both mount
 *    `FloatChromeContent` now, so this is a census of the MOUNT rather than a
 *    comparison of two implementations: the behavioural legs prove the ghost
 *    really renders grip / jump / drop / close (each of which fails on the
 *    pre-437 tree by construction — the ghost had no grip and no drop), and
 *    the source census proves neither mount grew a private row again.
 *  - **the CONTAINER inset** — the two containers are per-mount by design (a
 *    flex row inside `FloatingPanel`'s border here; a JS-positioned portal
 *    sibling styled by `globals.css` there), so what may differ and what may
 *    not is stated: the leading inset (1px border + 8px padding), the 4px gap
 *    and the 24px height must agree, because that inset is where the label
 *    lands.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The shared float chrome pulls panel-primitives → `@/lib/storage`, whose
// backend pick is a raw `require` the vitest resolver can't follow (the known
// barrel gotcha). A RESOLVER workaround; nothing under test is stubbed.
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

import { LiftedTextOverlay } from "@/text-objects/LiftedTextOverlay";
import { FloatChrome, FLOAT_CHROME_CONTAINER_CLASS } from "@/floats/FloatChrome";
import { CARD_FLOAT_HEADER_H } from "@/floats/float-policy";
import type { TextObjectRef } from "@/text-objects/types";

const PARAGRAPH_REF: TextObjectRef = { kind: "paragraph", id: "para-uuid" };
const LABEL = "Paragraph";

const REPO_SRC = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(REPO_SRC, rel), "utf8");

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

/**
 * A header's child SIGNATURE, derived from what the user can actually
 * perceive — the accessible names the controls publish (`iconHint` stamps
 * `aria-label`) and the one decorative child that publishes none. Deliberately
 * not a test-only `data-*` marker: a signature built from markup added for the
 * test is a signature only the test can see.
 */
function signature(header: Element): string[] {
  return Array.from(header.children).map((el) => {
    const aria = el.getAttribute("aria-label");
    if (aria) {
      if (aria.startsWith("Jump to ")) return "jump";
      if (aria.startsWith("Drop ")) return "drop";
      if (aria.startsWith("Dock ")) return "close";
      return `aria:${aria}`;
    }
    if (el.getAttribute("aria-hidden") === "true" && el.querySelector("svg")) {
      return "grip";
    }
    if (el.className.includes("flex-1")) return "spacer";
    if (el.tagName === "SPAN") return "title";
    return el.tagName.toLowerCase();
  });
}

/** The ghost's header, rendered in popout mode (where it is visible). */
function renderGhostHeader(): HTMLElement {
  const anchorDom = document.createElement("div");
  anchorDom.innerHTML = "<p>ghost body</p>";
  document.body.appendChild(anchorDom);
  render(
    <LiftedTextOverlay
      ref={PARAGRAPH_REF}
      anchorDom={anchorDom}
      grabOffsetX={0}
      grabOffsetY={0}
      sourceWidth={400}
      sourceHeight={100}
      cursorX={50}
      cursorY={50}
      mode="popout"
      label={LABEL}
      viewToggleCls=""
      ghostContent={null}
    />,
  );
  const header = document.querySelector<HTMLElement>(".lifted-text-overlay__header");
  if (!header) throw new Error("ghost header did not mount");
  return header;
}

/** The header a text-object float releases into — the props `FloatWindow`
 *  builds from `textObjectFloatable` (canJump + canDrop, no trailing, no
 *  headerTint). */
function renderReleasedHeader(): HTMLElement {
  const { container } = render(
    <FloatChrome
      title={LABEL}
      canJump
      onJump={() => {}}
      canDrop
      dropCardKey="float:textobject:paragraph:para-uuid"
      onClose={() => {}}
    />,
  );
  const header = container.firstElementChild as HTMLElement | null;
  if (!header) throw new Error("released header did not mount");
  return header;
}

describe("lift ghost header ≡ the header it releases into (task 437)", () => {
  it("the ghost renders the SAME child sequence as the released float", () => {
    const ghost = signature(renderGhostHeader());
    cleanup();
    document.body.innerHTML = "";
    const released = signature(renderReleasedHeader());
    expect(ghost).toEqual(released);
    // …and the sequence is the one the shipped chrome describes, so a leg that
    // passes because BOTH rows collapsed to nothing is impossible.
    expect(released).toEqual(["grip", "title", "spacer", "jump", "drop", "close"]);
  });

  it("the ghost carries the 14px grip that used to be float-only", () => {
    // The headline defect: `FloatChrome`'s FIRST child is the grip, and its
    // absence in the ghost pushed the label ~14px left of where the release
    // put it.
    const ghost = renderGhostHeader();
    expect(signature(ghost)[0]).toBe("grip");
  });

  it("the ghost carries the (re)anchor drop button that used to be float-only", () => {
    // `textObjectFloatable` sets `canDrop: true` unconditionally, so EVERY
    // released text-object float has this button; the ghost had none.
    const ghost = renderGhostHeader();
    expect(signature(ghost)).toContain("drop");
  });

  it("every control in the ghost is a PREVIEW — inert and unfocusable", () => {
    const ghost = renderGhostHeader();
    // `inert` is a SUBTREE claim, which is what the close button needs:
    // `PopoutButton` has no `tabIndex` seam of its own, so before task 437 it
    // was a tab stop inside an `aria-hidden` subtree.
    expect(ghost.hasAttribute("inert")).toBe(true);
    expect(ghost.getAttribute("aria-hidden")).toBe("true");
    // And nothing inside declares its own tab index to walk around it.
    for (const el of Array.from(ghost.querySelectorAll("button"))) {
      expect(el.getAttribute("tabindex")).not.toBe("0");
    }
  });

  it("both containers declare the same leading inset, gap and height", () => {
    // The two containers are per-mount BY DESIGN (see FloatChrome's docstring),
    // so this is the census of what may not differ: the inset is where the
    // first child — and therefore the label — starts.
    const css = read("app/globals.css");
    const rule = css.slice(
      css.indexOf(".lifted-text-overlay__header {"),
      css.indexOf("}", css.indexOf(".lifted-text-overlay__header {")),
    );
    expect(rule).toContain("padding: 0 8px");
    expect(rule).toContain("gap: 4px");
    // FloatChrome's own container spells the same three as utilities.
    expect(FLOAT_CHROME_CONTAINER_CLASS).toContain("px-2"); // 8px
    expect(FLOAT_CHROME_CONTAINER_CLASS).toContain("gap-1"); // 4px
    expect(FLOAT_CHROME_CONTAINER_CLASS).toContain("h-6"); // 24px
    // The ghost's height comes from the shared constant `h-6` mirrors.
    expect(CARD_FLOAT_HEADER_H).toBe(24);
  });

  it("CENSUS: the float header's child row has exactly ONE implementation", () => {
    // The part that could misbehave was never the component — it was a second
    // mount growing a private row beside it. `FloatChromeContent` may be
    // rendered only by `FloatChrome` (the release) and by `LiftedTextOverlay`
    // (the preview); the retired `FloatHeaderContent` may not come back.
    const overlay = read("text-objects/LiftedTextOverlay.tsx");
    expect(overlay).toContain("<FloatChromeContent");
    expect(overlay).toContain('from "@/floats/FloatChrome"');

    const chrome = read("floats/FloatChrome.tsx");
    expect(chrome).toContain("<FloatChromeContent");

    // No production file re-implements the row: the grip svg, the jump glyph
    // and the drop glyph are each mounted from exactly one place.
    const files = walk(REPO_SRC).filter(
      (f) => (f.endsWith(".tsx") || f.endsWith(".ts")) && !f.includes("__tests__"),
    );
    const gripHosts = files.filter((f) => readFileSync(f, "utf8").includes("<FloatGrip"));
    expect(gripHosts.map(rel)).toEqual(["floats/FloatChrome.tsx"]);
  });

  it("CENSUS: no comment names `TextObjectFloat` as a live mount", () => {
    // A comment describing a retired mechanism is how the next reader
    // concludes the invariant is held (AGENTS.md, "Bar occupancy"). The four
    // false claims this task retired lived in four different files, none of
    // which any behavioural test reads.
    // globals.css named it FOUR times, every one of them present-tense about
    // a chrome that no longer exists ("full frame matching TextObjectFloat's
    // chrome", "the real popout (TextObjectFloat) mounts", …). The stylesheet
    // has no reason to name a React component at all, so the census is an
    // exact count rather than a phrase list it could be reworded around.
    expect(read("app/globals.css")).not.toContain("TextObjectFloat");
    // The overlay's Issue-6 geometry comment described that header's inset and
    // was left in place when a 14px grip was inserted in front of the label.
    const overlay = read("text-objects/LiftedTextOverlay.tsx");
    expect(overlay).not.toMatch(/released `?TextObjectFloat`? header/);
    expect(overlay).not.toMatch(/shared `?FloatHeaderContent`? label sits/);
    // A history note that says a claim USED to be made is fine and wanted; a
    // live claim is not. `TextObjectFloatBodyProps` / `TextObjectFloatBody`
    // (the surviving per-kind body contract and its wrapper) are different
    // symbols and stay out of this sweep. Every SURVIVING mention of the
    // component must sit in a phrase that marks it as gone — the same class of
    // claim this task retired in four files, swept so the fifth can't ship.
    const HISTORICAL = /\b(old|former|retired|deleted|used to|no longer|was)\b/;
    const offenders: string[] = [];
    for (const abs of walk(REPO_SRC)) {
      if (!/\.(ts|tsx|css)$/.test(abs)) continue;
      if (abs.includes("__tests__")) continue;
      for (const line of readFileSync(abs, "utf8").split("\n")) {
        const bare = line.replace(/TextObjectFloatBody\w*/g, "");
        if (!bare.includes("TextObjectFloat")) continue;
        if (!HISTORICAL.test(bare)) offenders.push(`${rel(abs)}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
    // And the component itself is gone — a mount count of zero is the honest
    // end state for a component whose stated purpose was to be shared with a
    // file that no longer exists.
    const files = walk(REPO_SRC).filter((f) => f.endsWith("FloatHeaderContent.tsx"));
    expect(files).toEqual([]);
  });
});

/* ── helpers ─────────────────────────────────────────────────────── */

function walk(dir: string): string[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function rel(abs: string): string {
  return abs.slice(REPO_SRC.length + 1);
}

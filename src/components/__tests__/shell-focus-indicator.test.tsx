// @vitest-environment jsdom
/**
 * A SHELL SUPPLIES ITS FOCUSABLE ELEMENT'S INDICATOR — the behavioural half
 * (tasks 2026-08-31-507, 2026-09-03-554).
 *
 * The census one file over (`icon-button-a11y-guardrail.test.ts` → "a SHELL
 * that owns a focusable element supplies its indicator") is the leg with
 * teeth: a shell that stops appending, or one that `??`-replaces, type-checks
 * and renders perfectly for whatever caller it happens to have. THIS file is
 * the other half — it drives each member for real and reads what lands on the
 * element — because the census reads SOURCE and cannot see a resolver that
 * silently returns the wrong string.
 *
 * The harness is task 507's, from `anchored-menu.test.tsx`: render the shell
 * both ways a caller uses it (spelling no class, and spelling one), Tab the
 * element into focus, and read the indicator off `className`.
 *
 * **Why the assertion is a CLASS and not a computed style.** jsdom resolves no
 * stylesheet, so `getComputedStyle(el).boxShadow` is empty for a correct
 * implementation and for a broken one alike — the trap `jsdom_no_css_var_
 * resolution` records. What the class MEANS is pinned in the census, against
 * `globals.css` itself: that `.focus-ring` and the four `.iconbtn-*` share one
 * declaration block (so composing them is ONE ring, not two), and that
 * `.focus-outline`'s `:focus-visible` restore comes after its `:focus` strip
 * (so the restore wins at equal specificity). Between the two files the whole
 * contract is covered; neither could carry it alone.
 */

import { describe, it, expect, vi } from "vitest";

// `panel-primitives` pulls the card stack, which reaches `@/lib/storage` and
// its FSA backend — the recorded vitest gotcha. Nothing here touches disk.
vi.mock("@/lib/storage", () => {
  const noop = () => undefined;
  const names = [
    "isDevStorage", "readSidecar", "readSidecarIfExists", "writeSidecar",
    "readTex", "writeTex", "readDocBundle", "writeDocBundle", "readBib",
    "mutateBib", "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
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

import { render, fireEvent } from "@testing-library/react";
import {
  FOCUS_OUTLINE_CLASS,
  FOCUS_RING_CLASS,
  withFocusIndicator,
} from "../focus-indicator";
import {
  AiRequestCheckbox,
  Button,
  CARD_THEMES,
  PanelCard,
  PopoutButton,
  POPOUT_BUTTON_CLASS,
} from "../panel-primitives";
import { Input, Select, Textarea, fieldChrome } from "../field-primitives";
import { HexColorField } from "../HexColorField";
import { OpenEntryLink } from "../library/open-library-entry";

const classes = (el: Element) => el.className.split(/\s+/).filter(Boolean);

/** Tab the element into focus the way a keyboard user reaches it. jsdom has no
 *  `:focus-visible` matching, so what a leg can observe is that the element
 *  IS the focus target and carries the class the sheet scopes to that state. */
function tabTo(el: HTMLElement) {
  el.focus();
  expect(document.activeElement).toBe(el);
}

/* ── The door ──────────────────────────────────────────────────────── */

describe("withFocusIndicator — append, never replace", () => {
  it("appends to a caller's classes rather than replacing them", () => {
    expect(withFocusIndicator("iconbtn-xs")).toBe(`iconbtn-xs ${FOCUS_RING_CLASS}`);
  });

  it("is the whole class when the caller spells none", () => {
    expect(withFocusIndicator(undefined)).toBe(FOCUS_RING_CLASS);
    expect(withFocusIndicator("")).toBe(FOCUS_RING_CLASS);
  });

  it("hands out the OUTLINE member when asked", () => {
    // The member for an element whose `box-shadow` is taken by an inline
    // style — `PanelCard`'s ambient lift. Two classes, one edge.
    expect(withFocusIndicator("px-2", FOCUS_OUTLINE_CLASS)).toBe(
      `px-2 ${FOCUS_OUTLINE_CLASS}`,
    );
    expect(FOCUS_RING_CLASS).not.toBe(FOCUS_OUTLINE_CLASS);
  });
});

/* ── The `??` members: a caller's class must not delete the indicator ── */

describe("PopoutButton (task 554 — the `??` shape whose default IS the ring)", () => {
  const props = { isPoppedOut: false, onClick: () => {} };

  it("keeps the indicator for a caller that spells NO class", () => {
    const { container } = render(<PopoutButton {...props} />);
    const btn = container.querySelector("button")!;
    tabTo(btn);
    // The default geometry AND the indicator — `iconbtn-sm` bakes the same
    // ring in, and the census pins that composing the two is ONE ring.
    expect(classes(btn)).toContain(POPOUT_BUTTON_CLASS);
    expect(classes(btn)).toContain(FOCUS_RING_CLASS);
  });

  it("keeps it for a caller that REPLACES the geometry (the live caller's shape)", () => {
    // `FloatChrome` passes `iconbtn-xs`. Pre-554 `className ?? DEFAULT` handed
    // the whole class over, so the shell's own default — which was the only
    // thing carrying an indicator — was dropped; this caller survived only
    // because the class it happened to pass bakes one in too. A caller passing
    // a class with NO indicator (the shape below) had none at all.
    const { container } = render(<PopoutButton {...props} className="iconbtn-xs" />);
    const btn = container.querySelector("button")!;
    tabTo(btn);
    expect(classes(btn)).toContain("iconbtn-xs");
    expect(classes(btn)).not.toContain(POPOUT_BUTTON_CLASS); // geometry REPLACED …
    expect(classes(btn)).toContain(FOCUS_RING_CLASS); // … indicator KEPT
  });

  it("keeps it for a caller whose class carries no indicator of its own", () => {
    const { container } = render(<PopoutButton {...props} className="px-1 opacity-70" />);
    const btn = container.querySelector("button")!;
    tabTo(btn);
    expect(classes(btn)).toEqual(["px-1", "opacity-70", FOCUS_RING_CLASS]);
  });
});

describe("OpenEntryLink (task 554 — the `??` shape whose default had none either)", () => {
  it("supplies one where BOTH branches used to be bare", () => {
    const { container } = render(<OpenEntryLink citekey="smith2020" />);
    const btn = container.querySelector("button")!;
    tabTo(btn);
    expect(classes(btn)).toContain(FOCUS_RING_CLASS);
    // …and the default's own layout survives beside it.
    expect(classes(btn)).toContain("inline-flex");
  });

  it("keeps it for the class-passing caller (CitationCard's shape)", () => {
    const { container } = render(
      <OpenEntryLink citekey="smith2020" className="text-[10px] text-ink-muted" />,
    );
    const btn = container.querySelector("button")!;
    tabTo(btn);
    expect(classes(btn)).toContain("text-ink-muted");
    expect(classes(btn)).toContain(FOCUS_RING_CLASS);
    expect(classes(btn)).not.toContain("inline-flex"); // the default IS replaced
  });
});

describe("HexColorField's swatch (task 554 — a default PARAMETER is the same shape)", () => {
  it("rings the native colour swatch", () => {
    // `TextInputType` deliberately excludes `color`, so the swatch takes no
    // field chrome and its whole class is the prop — a default parameter,
    // which replaces exactly as `??` does.
    const { container } = render(<HexColorField value="#112233" onChange={() => {}} />);
    const swatch = container.querySelector('input[type="color"]') as HTMLInputElement;
    tabTo(swatch);
    expect(classes(swatch)).toContain(FOCUS_RING_CLASS);
  });

  it("keeps it when a caller sizes the swatch", () => {
    const { container } = render(
      <HexColorField value="#112233" onChange={() => {}} swatchClassName="w-4 h-4" />,
    );
    const swatch = container.querySelector('input[type="color"]') as HTMLInputElement;
    tabTo(swatch);
    expect(classes(swatch)).toEqual(["w-4", "h-4", FOCUS_RING_CLASS]);
  });
});

/* ── The appended-to-a-bare-base member ────────────────────────────── */

describe("AiRequestCheckbox (task 554 — seven callers, no indicator at all)", () => {
  it("carries the app ring on the button every card panel renders", () => {
    // Its base is `bg-transparent p-0`: no geometry utility, so no indicator
    // came with it, and this control is a tab stop in every card panel.
    const { container } = render(
      <AiRequestCheckbox checked={false} onToggle={() => {}} />,
    );
    const btn = container.querySelector("button")!;
    tabTo(btn);
    expect(classes(btn)).toContain(FOCUS_RING_CLASS);
    expect(classes(btn)).toContain("bg-transparent");
  });

  it("keeps the caller's spacing class beside it", () => {
    const { container } = render(
      <AiRequestCheckbox checked onToggle={() => {}} className="mt-1" />,
    );
    const btn = container.querySelector("button")!;
    expect(classes(btn)).toContain("mt-1");
    expect(classes(btn)).toContain(FOCUS_RING_CLASS);
  });

  it("still toggles — the indicator changes no behaviour", () => {
    let got: boolean | null = null;
    const { container } = render(
      <AiRequestCheckbox checked={false} onToggle={(n) => (got = n)} />,
    );
    fireEvent.click(container.querySelector("button")!);
    expect(got).toBe(true);
  });
});

/* ── The card wrapper: the OUTLINE member ──────────────────────────── */

describe("PanelCard's root — the keyboard-only edge (task 554)", () => {
  const theme = CARD_THEMES.note;

  function card(props: Record<string, unknown> = {}) {
    return render(
      <PanelCard theme={theme} selected={false} {...props}>
        <div>body</div>
      </PanelCard>,
    );
  }

  it("takes the OUTLINE member, not the ring", () => {
    // Its ambient lift is an inline `box-shadow` written by `themedCardStyle`,
    // and inline beats every stylesheet rule — so `.focus-ring` would land its
    // `outline: none` and then fail to paint. That is the `StackIcon` caveat
    // read on the one surface that was ALSO stripping the UA outline, so it
    // kept nothing at all.
    const { container } = card();
    const root = container.querySelector("[data-card]") as HTMLElement;
    expect(classes(root)).toContain(FOCUS_OUTLINE_CLASS);
    expect(classes(root)).not.toContain(FOCUS_RING_CLASS);
    // …and the inline shadow that forces the choice is really there.
    expect(root.style.boxShadow).toBeTruthy();
  });

  it("is reachable from the keyboard, which is why it owes one", () => {
    // `EditableCard` and four panels thread `tabIndex={selected ? 0 : -1}`
    // through `{...rest}`; a selected card is a tab stop.
    const { container } = card({ tabIndex: 0 });
    const root = container.querySelector("[data-card]") as HTMLElement;
    tabTo(root);
    expect(classes(root)).toContain(FOCUS_OUTLINE_CLASS);
  });

  it("keeps the caller's own classes beside it", () => {
    const { container } = card({ className: "mb-2" });
    const cls = classes(container.querySelector("[data-card]")!);
    expect(cls).toContain("mb-2");
    expect(cls).toContain(FOCUS_OUTLINE_CLASS);
  });

  it("no card wrapper spells the bare strip any more", () => {
    // The six callers hand-spelled `focus:outline-none`, which fires on
    // `:focus-visible` too — each was spelling the HALF of an indicator that
    // deletes one. The strip is inside `.focus-outline` now, where the
    // `:focus-visible` rule below it restores the edge.
    const { container } = card({ className: "mb-2" });
    const cls = classes(container.querySelector("[data-card]")!);
    expect(cls).not.toContain("focus:outline-none");
  });
});

/* ── The exemplar, now on the door ─────────────────────────────────── */

describe("Button — the shape the two `??` members were measured against", () => {
  it("appends the indicator AFTER the caller's classes", () => {
    const { container } = render(<Button className="w-full">Save</Button>);
    const btn = container.querySelector("button")!;
    tabTo(btn);
    const cls = classes(btn);
    expect(cls).toContain("w-full");
    expect(cls).toContain(FOCUS_RING_CLASS);
    // Exactly one — the door appends, so a variant change cannot double it.
    expect(cls.filter((c) => c === FOCUS_RING_CLASS)).toHaveLength(1);
  });
});

/* ── The field family: a STATED POSTURE rather than the door ───────── */

describe("Input / Textarea / Select — the border IS the indicator", () => {
  it("thickens on :focus-visible, never on a bare :focus (task 554)", () => {
    // The move is a CONSISTENCY fix, not a visual one: a browser answers
    // `:focus-visible` for a focused text input however focus arrived. What it
    // buys is that no future member of this chrome inherits a mouse-focus
    // indicator by accident.
    const c = fieldChrome();
    expect(c).toContain("focus-visible:border-edge-strong");
    expect(c).not.toMatch(/(?<!-visible)\bfocus:border-/);
  });

  it("puts it on every member of the family", () => {
    const { container } = render(
      <>
        <Input />
        <Textarea />
        <Select>
          <option>a</option>
        </Select>
      </>,
    );
    for (const sel of ["input", "textarea", "select"] as const) {
      const el = container.querySelector(sel)!;
      tabTo(el as HTMLElement);
      expect(classes(el)).toContain("focus-visible:border-edge-strong");
      // …and NOT a ring: two edges around a bordered box is what the posture
      // exists to refuse.
      expect(classes(el)).not.toContain(FOCUS_RING_CLASS);
    }
  });

  it("keeps the UA outline stripped UNSCOPED, so a mouse click paints neither", () => {
    // `outline-none` is deliberately not `:focus`-scoped: it removes the ring
    // the border replaces, and a `:focus`-only strip would leave the UA ring
    // painting on a mouse click beside a border that had not thickened.
    expect(fieldChrome()).toContain("outline-none");
  });
});

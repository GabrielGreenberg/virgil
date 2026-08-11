// @vitest-environment jsdom
//
// Task 190 — the field-chrome primitive's own contract.
//
// The census in `src/lib/__tests__/field-chrome-guardrail.test.ts` is the leg
// with teeth (the primitive was never the part that could misbehave — ~50 call
// sites spelling their own chrome were). This one pins what the primitive
// PROMISES, so a future edit can't quietly drop a spec token that every call
// site now inherits: `src/STYLE_GUIDE.md` "Inputs" states bg-surface,
// border-edge-subtle, focus THICKENS to edge-strong, and NO RING.
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { createRef } from "react";
import {
  Input,
  Select,
  Textarea,
  fieldChrome,
} from "../field-primitives";

describe("fieldChrome — the STYLE_GUIDE §Inputs spec, spelled once", () => {
  it("carries every resting-state token the spec names", () => {
    const c = fieldChrome();
    expect(c).toContain("bg-surface");
    expect(c).toContain("border-edge-subtle");
    expect(c).toContain("text-ink-body");
    expect(c).toContain("placeholder:text-ink-muted");
  });

  it("focus THICKENS the border to edge-strong and adds NO ring", () => {
    const c = fieldChrome();
    expect(c).toContain("focus:border-edge-strong");
    // The two drift shapes the census forbids at call sites, forbidden here
    // too — a primitive that grew either would push it to every consumer at
    // once, and no call-site census could see it.
    expect(c).not.toMatch(/focus:ring/);
    expect(c).not.toMatch(/focus:border-(\[var\(--accent\)\]|accent)/);
  });

  it("puts each density on the radius-scale rung STYLE_GUIDE files it under", () => {
    // "primary CONTROL radius: Button, inputs" = 6px …
    expect(fieldChrome({ density: "control" })).toContain("rounded-md");
    expect(fieldChrome({ density: "control" })).not.toContain("rounded-sm");
    // … "small controls & inner rows: form inputs inside a popover" = 4px.
    expect(fieldChrome({ density: "dense" })).toContain("rounded-sm");
    expect(fieldChrome({ density: "dense" })).not.toContain("rounded-md");
  });

  it("emits EXACTLY ONE background, text color and border color, in every combination", () => {
    // The reason `tone` / `ink` / `invalid` are props rather than things a
    // caller appends: two utilities setting one property are resolved by
    // STYLESHEET order, not class order, so an appended "override" is a coin
    // flip. That guarantee is worth nothing if the primitive itself can emit
    // two, so sweep the whole product rather than spot-check.
    const one = (c: string, re: RegExp) => (c.split(" ").filter((x) => re.test(x)) ?? []).length;
    for (const tone of ["surface", "muted", "transparent"] as const) {
      for (const ink of ["body", "subtle", "strong"] as const) {
        for (const invalid of [false, true]) {
          for (const density of ["control", "dense"] as const) {
            const c = fieldChrome({ tone, ink, invalid, density });
            const where = `${tone}/${ink}/${invalid}/${density}`;
            expect(one(c, /^bg-/), where).toBe(1);
            expect(one(c, /^text-/), where).toBe(1);
            expect(one(c, /^border-(?:edge|danger)/), where).toBe(1);
            expect(one(c, /^rounded/), where).toBe(1);
          }
        }
      }
    }
  });

  it("maps each ink to its token", () => {
    expect(fieldChrome({ ink: "body" })).toContain("text-ink-body");
    expect(fieldChrome({ ink: "subtle" })).toContain("text-ink-subtle");
    expect(fieldChrome({ ink: "strong" })).toContain("text-ink-strong");
  });

  it("reports an invalid field on the --danger token, never a raw red", () => {
    const c = fieldChrome({ invalid: true, ink: "subtle" });
    expect(c).toContain("border-danger");
    expect(c).toContain("text-danger");
    expect(c).not.toMatch(/border-red-\d/);
    // invalid REPLACES rather than adds — the ink it was given is gone, not
    // sitting beside `text-danger` waiting on stylesheet order.
    expect(c).not.toContain("text-ink-subtle");
    expect(fieldChrome({ invalid: false })).not.toContain("border-danger");
  });
});

describe("Input / Select / Textarea", () => {
  it("wear the chrome and APPEND the caller's className (box stays the caller's)", () => {
    const { container } = render(<Input className="w-full px-3 py-1.5 text-sm" />);
    const el = container.querySelector("input")!;
    expect(el.className).toContain("border-edge-subtle");
    expect(el.className).toContain("focus:border-edge-strong");
    expect(el.className).toContain("w-full px-3 py-1.5 text-sm");
  });

  it("defaults to a text input and forwards an explicit text-ish type", () => {
    const { container } = render(
      <>
        <Input />
        <Input type="number" />
      </>,
    );
    const [a, b] = Array.from(container.querySelectorAll("input"));
    expect(a.getAttribute("type")).toBe("text");
    expect(b.getAttribute("type")).toBe("number");
  });

  it("refuses a non-text native control at COMPILE time", () => {
    // A checkbox / radio / color swatch / range slider is a different control
    // that happens to share the tag name; bordered-field chrome is meaningless
    // on it. `TextInputType` makes that a type error rather than a review note
    // — which is also what keeps the census's `type=` exclusion honest.
    // @ts-expect-error - "color" is not a TextInputType
    const bad = <Input type="color" />;
    expect(bad).toBeTruthy();
  });

  it("forwards refs on all three surfaces", () => {
    const i = createRef<HTMLInputElement>();
    const s = createRef<HTMLSelectElement>();
    const t = createRef<HTMLTextAreaElement>();
    render(
      <>
        <Input ref={i} />
        <Select ref={s} />
        <Textarea ref={t} />
      </>,
    );
    expect(i.current).toBeInstanceOf(HTMLInputElement);
    expect(s.current).toBeInstanceOf(HTMLSelectElement);
    expect(t.current).toBeInstanceOf(HTMLTextAreaElement);
  });

  it("gives the select and the textarea the SAME chrome as the input", () => {
    // The drift the census found was not input-only: ~7 of the accent-focus
    // sites were `<select>`s. One chrome, three tags.
    const { container } = render(
      <>
        <Input density="dense" />
        <Select density="dense" />
        <Textarea density="dense" />
      </>,
    );
    const classes = ["input", "select", "textarea"].map(
      (tag) => container.querySelector(tag)!.className,
    );
    expect(new Set(classes).size).toBe(1);
  });
});

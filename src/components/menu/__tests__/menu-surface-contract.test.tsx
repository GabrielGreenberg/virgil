// @vitest-environment jsdom
//
// The BEHAVIOURAL half of task 295's menu-surface law — what the grep census in
// `menu-surface-guardrail.test.ts` structurally cannot see: that the primitive
// actually stamps the surface, and that a caller's own classes still land.
//
// Contracts:
//   1. `MenuProvider` stamps `.menu-surface` on its container by default —
//      the whole mechanism the census's "no consumer writes chrome" leg
//      presupposes. Without this leg, deleting the stamp leaves every censused
//      site clean and every menu unstyled, with CI green.
//   2. `AnchoredMenu` inherits it, so the ~9 shells behind `ItemMenu` and the
//      panel kebabs get the surface without naming it.
//   3. The surface class comes FIRST and the caller's classes survive
//      alongside it — order is load-bearing (a caller's `min-w-…` and
//      `.menu-surface` are both single-class selectors, so a same-specificity
//      tie resolves by stylesheet order, and the primitive must not be the one
//      writing the later rule).
//   4. `surface="none"` opts out COMPLETELY, which is what makes
//      `LabelRefPopover`'s amber identity expressible rather than a fight
//      between two same-specificity rules.

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";

import { MenuProvider } from "../MenuProvider";
import { AnchoredMenu } from "../AnchoredMenu";

afterEach(() => cleanup());

const RECT = { left: 10, top: 10, right: 30, bottom: 30, width: 20, height: 20 };
const PLACEMENTS = [{ side: "below", align: "start" }] as const;

function openMenu(props: Partial<React.ComponentProps<typeof MenuProvider>> = {}) {
  render(
    <MenuProvider
      id="surface-test"
      layout="list"
      role="menu"
      anchorRect={RECT}
      placements={[...PLACEMENTS]}
      onClose={() => {}}
      ariaLabel="Test menu"
      {...props}
    >
      <div>row</div>
    </MenuProvider>,
  );
  return document.body.querySelector('[role="menu"]') as HTMLElement;
}

describe("MenuProvider — the container surface", () => {
  it("stamps .menu-surface by default", () => {
    expect(openMenu().classList.contains("menu-surface")).toBe(true);
  });

  it("keeps the caller's own layout classes, with the surface class first", () => {
    const el = openMenu({ containerClassName: "min-w-[160px] py-1" });
    const classes = [...el.classList];
    expect(classes).toContain("min-w-[160px]");
    expect(classes).toContain("py-1");
    expect(el.className.indexOf("menu-surface")).toBe(0);
  });

  it('surface="none" stamps nothing, leaving the caller sole author', () => {
    const el = openMenu({
      surface: "none",
      containerClassName: "label-ref-popover",
    });
    expect(el.classList.contains("menu-surface")).toBe(false);
    expect(el.classList.contains("label-ref-popover")).toBe(true);
  });

  it('surface="none" with no className leaves the container class-free', () => {
    const el = openMenu({ surface: "none" });
    expect(el.className).toBe("");
  });

  it("writes no inline chrome — the surface is the class, not a style", () => {
    // The inline dialect is what six of the twelve pre-295 consumers used, and
    // an inline write here would beat `.menu-surface` by specificity for every
    // future theming attempt. Positioning + z-tier are the primitive's own and
    // stay inline.
    const style = openMenu().getAttribute("style") ?? "";
    expect(style).not.toMatch(/background|border|box-shadow|border-radius/);
  });

  it("AnchoredMenu's open menu inherits the same surface", async () => {
    const { container } = render(
      <AnchoredMenu ariaLabel="Kebab" trigger={() => <span>⋯</span>}>
        <div>row</div>
      </AnchoredMenu>,
    );
    const trigger = container.querySelector(
      '[aria-haspopup="menu"]',
    ) as HTMLButtonElement;
    fireEvent.click(trigger);
    const el = document.body.querySelector('[role="menu"]') as HTMLElement;
    expect(el).not.toBeNull();
    expect(el.classList.contains("menu-surface")).toBe(true);
    // …and still carries the shell's body padding, which is layout the shell
    // legitimately owns (see MENU_BODY_PAD_CLASS).
    expect(el.classList.contains("py-1")).toBe(true);
  });
});

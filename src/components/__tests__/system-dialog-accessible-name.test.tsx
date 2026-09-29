// @vitest-environment jsdom
//
// Task 832 — **a titled dialog is NAMED by its title without the caller's help.**
//
// The shell rendered `role="dialog"` with `aria-labelledby={labelledBy}`, so the
// frame had an accessible name only when the caller remembered the prop — while
// `SystemDialogHeader` minted its OWN `<h2>` id the frame never learned. Nine
// titled dialogs shipped nameless to a screen reader. The name is now a SHELL
// fact: a header that renders a title registers its id with the shell, which
// points `aria-labelledby` at it. An explicit `labelledBy` still wins (a custom
// header strip names its own element); a dialog with no titled header points at
// nothing rather than at a missing id.
//
// Two halves: BEHAVIOUR (the shell wires what the header renders, both
// variants) and a SOURCE census over the shared dialog population — every
// production `<SystemDialog>` is named by a titled `SystemDialogHeader` or says
// who names it (`labelledBy` / `aria-label`), so a custom-header dialog added
// tomorrow cannot ship nameless either.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("@/lib/storage", () => ({ isDevStorage: true }));

import SystemDialog, {
  SystemDialogHeader,
  SystemDialogBody,
} from "../system-dialog";
import { elementsNamed } from "@/lib/__tests__/_source-scan";
import { dialogElements } from "./_dialog-sites";

afterEach(cleanup);

/** The accessible name as `aria-labelledby` resolves it (jsdom has no AT). */
function accessibleName(dialog: HTMLElement): string | null {
  const ids = dialog.getAttribute("aria-labelledby");
  if (!ids) return null;
  return ids
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ")
    .trim();
}

describe("SystemDialog accessible name (task 832)", () => {
  it.each(["modal", "draggable"] as const)(
    "%s: a titled header names the dialog with no labelledBy prop",
    (variant) => {
      render(
        <SystemDialog open onClose={() => {}} variant={variant}>
          <SystemDialogHeader title="Move footnote?" subtitle="Not the name" />
          <SystemDialogBody>body</SystemDialogBody>
        </SystemDialog>,
      );
      expect(accessibleName(screen.getByRole("dialog"))).toBe("Move footnote?");
    },
  );

  it("a dialog with no titled header points aria-labelledby at nothing", () => {
    render(
      <SystemDialog open onClose={() => {}}>
        <SystemDialogHeader />
        <SystemDialogBody>body</SystemDialogBody>
      </SystemDialog>,
    );
    expect(screen.getByRole("dialog").hasAttribute("aria-labelledby")).toBe(
      false,
    );
  });

  it("an explicit labelledBy wins (a custom header strip names itself)", () => {
    render(
      <SystemDialog open onClose={() => {}} labelledBy="custom-title">
        <div>
          <span id="custom-title">Preferences</span>
        </div>
      </SystemDialog>,
    );
    expect(accessibleName(screen.getByRole("dialog"))).toBe("Preferences");
  });

  it("a header's titleId override is the id the frame is named by", () => {
    render(
      <SystemDialog open onClose={() => {}}>
        <SystemDialogHeader title="Print" titleId="print-title" />
      </SystemDialog>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-labelledby")).toBe("print-title");
    expect(accessibleName(dialog)).toBe("Print");
  });

  it("the name follows the title in and out across re-renders", () => {
    const { rerender } = render(
      <SystemDialog open onClose={() => {}}>
        <SystemDialogHeader />
      </SystemDialog>,
    );
    expect(screen.getByRole("dialog").hasAttribute("aria-labelledby")).toBe(
      false,
    );
    rerender(
      <SystemDialog open onClose={() => {}}>
        <SystemDialogHeader title="Now titled" />
      </SystemDialog>,
    );
    expect(accessibleName(screen.getByRole("dialog"))).toBe("Now titled");
    rerender(
      <SystemDialog open onClose={() => {}}>
        <SystemDialogHeader />
      </SystemDialog>,
    );
    expect(screen.getByRole("dialog").hasAttribute("aria-labelledby")).toBe(
      false,
    );
  });
});

describe("census: every production dialog says who names it (task 832)", () => {
  const sites = dialogElements();

  it("discovers the dialog population", () => {
    expect(sites.length).toBeGreaterThan(10);
  });

  it("each site has a titled SystemDialogHeader, labelledBy, or aria-label", () => {
    const nameless = sites
      .filter(({ tag, subtree }) => {
        if (/\blabelledBy=|\baria-label=/.test(tag)) return false;
        return !elementsNamed(subtree, "SystemDialogHeader").some((h) =>
          /\btitle=/.test(h.tag),
        );
      })
      .map((s) => s.rel);
    expect(nameless).toEqual([]);
  });

  it("no site restates the default by pairing labelledBy with a header titleId", () => {
    // The pre-832 spelling: mint an id, hand it to BOTH the shell and the
    // header. The header now reports its id itself, so the pair is dead weight
    // that invites the two halves to drift apart.
    const restated = sites
      .filter(({ tag, subtree }) => {
        if (!/\blabelledBy=/.test(tag)) return false;
        return elementsNamed(subtree, "SystemDialogHeader").some((h) =>
          /\btitleId=/.test(h.tag),
        );
      })
      .map((s) => s.rel);
    expect(restated).toEqual([]);
  });
});

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
//
// Task 1609 — the source census was VACUOUS for the doors: `title={title}`
// matched `/\btitle=/` while the value was undefined, so the app's most common
// confirm ("This item has text. Delete it?") shipped nameless. Now `title` is
// REQUIRED on every door, the message is the frame's DESCRIPTION through
// `SystemDialogMessage`, and a RUNTIME census renders each door and reads the
// resolved name + description. The source census excuses a bare passthrough
// (`title={x}`) only for a door the runtime census renders, or a component
// that destructures `x` with a string default.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { useEffect, type ReactNode } from "react";

vi.mock("@/lib/storage", () => ({ isDevStorage: true }));

import SystemDialog, {
  SystemDialogHeader,
  SystemDialogBody,
  SystemDialogMessage,
} from "../system-dialog";
import ConfirmDialog, { useConfirmDialog } from "../ConfirmDialog";
import {
  SystemDialogProvider,
  useSystemDialog,
  type SystemDialogApi,
} from "../system-dialog-host";
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

/** The description as `aria-describedby` resolves it. */
function accessibleDescription(dialog: HTMLElement): string | null {
  const ids = dialog.getAttribute("aria-describedby");
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
      .filter(({ tag, subtree, abs, rel }) => {
        if (/\blabelledBy=|\baria-label=/.test(tag)) return false;
        return !elementsNamed(subtree, "SystemDialogHeader").some((h) => {
          if (!/\btitle=/.test(h.tag)) return false;
          // A bare passthrough (`title={x}`) names nothing unless the value is
          // guaranteed (task 1609): a door the runtime census renders, a prop
          // destructured with a string default, or one typed a REQUIRED string.
          const pass = /\btitle=\{\s*([A-Za-z_$][\w$]*)\s*\}/.exec(h.tag);
          if (!pass) return true;
          if (RUNTIME_DOORS.includes(rel)) return true;
          const file = readFileSync(abs, "utf8");
          return (
            new RegExp(`\\b${pass[1]}\\s*=\\s*["'\`]`).test(file) ||
            new RegExp(`\\b${pass[1]}\\s*:\\s*string\\s*[;,]`).test(file)
          );
        });
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

describe("SystemDialog description (task 1609)", () => {
  it.each(["modal", "draggable"] as const)(
    "%s: a SystemDialogMessage describes the dialog with no describedBy prop",
    (variant) => {
      render(
        <SystemDialog open onClose={() => {}} variant={variant}>
          <SystemDialogHeader title="Delete item?" />
          <SystemDialogBody>
            <SystemDialogMessage>This item has text.</SystemDialogMessage>
          </SystemDialogBody>
        </SystemDialog>,
      );
      expect(accessibleDescription(screen.getByRole("dialog"))).toBe(
        "This item has text.",
      );
    },
  );

  it("a dialog with no message points aria-describedby at nothing", () => {
    render(
      <SystemDialog open onClose={() => {}}>
        <SystemDialogHeader title="Print" />
        <SystemDialogBody>form</SystemDialogBody>
      </SystemDialog>,
    );
    expect(screen.getByRole("dialog").hasAttribute("aria-describedby")).toBe(
      false,
    );
  });

  it("an explicit describedBy wins", () => {
    render(
      <SystemDialog open onClose={() => {}} describedBy="custom-desc">
        <span id="custom-desc">Custom</span>
        <SystemDialogMessage>Registered</SystemDialogMessage>
      </SystemDialog>,
    );
    expect(accessibleDescription(screen.getByRole("dialog"))).toBe("Custom");
  });
});

/* ── RUNTIME census: every confirm/alert door, rendered ─────────────── */

function expectNamedAndDescribed(name: string, description: string) {
  const dialog = screen.getByRole("dialog");
  expect(accessibleName(dialog)).toBe(name);
  expect(accessibleDescription(dialog)).toBe(description);
}

function ImperativeConfirmHost({
  run,
}: {
  run: (c: ReturnType<typeof useConfirmDialog>) => void;
}) {
  const api = useConfirmDialog();
  useEffect(() => {
    run(api);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <>{api.dialog}</>;
}

function SystemApiProbe({ grab }: { grab: (api: SystemDialogApi) => void }) {
  grab(useSystemDialog());
  return null;
}

function withProvider(children: ReactNode) {
  return <SystemDialogProvider>{children}</SystemDialogProvider>;
}

/** The doors the source census excuses for a passthrough `title={title}` —
 *  each is rendered below, so the excuse is earned at runtime. */
const RUNTIME_DOORS = [
  "components/ConfirmDialog.tsx",
  "components/system-dialog-host.tsx",
];

describe("runtime census: every confirm/alert door is named AND described (task 1609)", () => {
  it("<ConfirmDialog>", () => {
    render(
      <ConfirmDialog
        open
        title="Delete item?"
        message="This item has text. Delete it?"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expectNamedAndDescribed("Delete item?", "This item has text. Delete it?");
  });

  it("useConfirmDialog().confirm()", () => {
    render(
      <ImperativeConfirmHost
        run={(c) => void c.confirm({ title: "Archive note?", message: "It moves." })}
      />,
    );
    expectNamedAndDescribed("Archive note?", "It moves.");
  });

  it("useConfirmDialog().choose()", () => {
    render(
      <ImperativeConfirmHost
        run={(c) =>
          void c.choose({
            title: "Applied change",
            message: "Keep or revert?",
            secondaryLabel: "Revert",
          })
        }
      />,
    );
    expectNamedAndDescribed("Applied change", "Keep or revert?");
  });

  it.each(["confirm", "alert"] as const)("useSystemDialog().%s()", (door) => {
    let api!: SystemDialogApi;
    render(withProvider(<SystemApiProbe grab={(a) => (api = a)} />));
    act(() => {
      void api[door]({ title: "Reset document?", message: "No undo." });
    });
    expectNamedAndDescribed("Reset document?", "No undo.");
  });
});

describe("single-object confirms open beside their object (task 1609)", () => {
  // STYLE_GUIDE "Placement follows the SCOPE": a confirm about ONE block / row
  // passes `anchorRef`. These two were the guide's named centered debt.
  it.each([
    ["components/SourcePodNodeView.tsx", "wrapperRef"],
    ["components/AIWindow.tsx", "rowRef"],
  ])("%s's <ConfirmDialog> anchors to %s", (rel, ref) => {
    const src = readFileSync(`${__dirname}/../../${rel}`, "utf8");
    const confirms = elementsNamed(src, "ConfirmDialog");
    expect(confirms.length).toBeGreaterThan(0);
    for (const c of confirms) {
      expect(c.tag).toMatch(new RegExp(`\\banchorRef=\\{${ref}\\}`));
    }
  });
});

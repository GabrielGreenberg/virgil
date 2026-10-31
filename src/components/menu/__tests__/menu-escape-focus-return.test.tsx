// @vitest-environment jsdom
//
// Task 1388 — Escape returns focus to where the keyboard user stood, BY
// DEFAULT. Task 1011 gave `MenuProvider` a `returnFocusOnCancel`, but it was
// opt-in and only `AnchoredMenu` opted in: Escape from the View menu, the
// block-type dropdown, Help, ⚡, the bar kebabs… unmounted the row that held
// focus and dropped it on `<body>`. The default is now the menu's
// activedescendant host, resolved once at open; a menu with no host names its
// trigger explicitly or declares `false`. The census below holds every direct
// `<MenuProvider` caller to that.

import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { MenuProvider } from "../MenuProvider";
import { useMenuItem } from "../useMenuItem";
import { REPO_ROOT, codeOnly, tagEnd, trackedFiles } from "@/lib/__tests__/_source-scan";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

const RECT = { left: 100, top: 100, right: 120, bottom: 140, width: 20, height: 40 };
const PLACEMENTS = [{ side: "below" as const, align: "start" as const }];

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function Row() {
  const { getItemProps } = useMenuItem({ id: "row", run: () => {} });
  return (
    <button type="button" data-testid="row" {...getItemProps()}>
      Row
    </button>
  );
}

type Props = {
  host?: () => HTMLElement | null;
  ret?: (() => HTMLElement | null) | false;
};

function Harness({ host, ret }: Props) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" data-testid="trigger">
        trigger
      </button>
      <div data-testid="editable" contentEditable suppressContentEditableWarning />
      {open && (
        <MenuProvider
          id="m"
          layout="list"
          anchorRect={RECT}
          placements={PLACEMENTS}
          getActiveDescendantHost={host}
          returnFocusOnCancel={ret}
          onClose={() => setOpen(false)}
        >
          <Row />
        </MenuProvider>
      )}
    </>
  );
}

const byId = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement;

describe("Escape's focus return defaults from the activedescendant host (task 1388)", () => {
  it("a host and no explicit target: Escape from a focused row lands on the host", () => {
    render(<Harness host={() => byId("trigger")} />);
    byId("row").focus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(byId("row")).toBeNull();
    expect(document.activeElement).toBe(byId("trigger"));
  });

  it("focus that already fell to <body> is returned too", () => {
    render(<Harness host={() => byId("trigger")} />);
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.activeElement).toBe(byId("trigger"));
  });

  it("a caret host is resolved at OPEN, not at Escape (live focus has moved to a row by then)", () => {
    // Mirrors `caretEditableHost`: answers whatever editable is focused NOW
    // (attribute check — jsdom implements no `isContentEditable`).
    const liveCaretHost = () => {
      const el = document.activeElement;
      return el instanceof HTMLElement && el.getAttribute("contenteditable") === "true" ? el : null;
    };
    // Focus the editable BEFORE the menu mounts (the open moment).
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.tabIndex = 0; // jsdom: focusable
    document.body.appendChild(editable);
    editable.focus();
    render(<Harness host={liveCaretHost} />);
    byId("row").focus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.activeElement).toBe(editable);
  });

  it("an explicit target overrides the host", () => {
    render(<Harness host={() => byId("editable")} ret={() => byId("trigger")} />);
    byId("row").focus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.activeElement).toBe(byId("trigger"));
  });

  it("`false` is an exemption: no return", () => {
    render(<Harness host={() => byId("trigger")} ret={false} />);
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.activeElement).toBe(document.body);
  });

  it("never steals: focus held outside the menu stays put", () => {
    render(<Harness host={() => byId("trigger")} />);
    const elsewhere = document.createElement("input");
    document.body.appendChild(elsewhere);
    elsewhere.focus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.activeElement).toBe(elsewhere);
  });

  it("a host INSIDE the menu (a combobox's own input) is no target", () => {
    render(<Harness host={() => byId("row")} />);
    byId("row").focus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(byId("row")).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });
});

// ── Census: every direct `<MenuProvider` caller resolves a return target ──
function openingTags(code: string): string[] {
  const tags: string[] = [];
  const re = /<MenuProvider\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const end = tagEnd(code, m.index);
    if (end > 0) tags.push(code.slice(m.index, end + 1));
  }
  return tags;
}

describe("CENSUS: every <MenuProvider> resolves an Escape focus-return target (task 1388)", () => {
  const files = trackedFiles("src", /\.tsx$/).filter(
    (f) => !f.includes("/__tests__/") && !f.endsWith("menu/MenuProvider.tsx"),
  );
  const calls = files.flatMap((f) =>
    // `codeOnly` blanks comments/strings so a prose `<MenuProvider>` is no call.
    openingTags(codeOnly(readFileSync(f, "utf8"))).map((tag) => ({
      file: relative(REPO_ROOT, f),
      tag,
    })),
  );

  it("finds the callers (the census is not vacuous)", () => {
    expect(calls.length).toBeGreaterThanOrEqual(12);
  });

  it.each(calls.map((c, i) => [`${c.file}#${i}`, c] as const))("%s", (_name, { tag }) => {
    expect(
      /\bgetActiveDescendantHost=/.test(tag) || /\breturnFocusOnCancel=/.test(tag),
      "a MenuProvider with no activedescendant host must name its trigger via returnFocusOnCancel, or declare returnFocusOnCancel={false}",
    ).toBe(true);
  });
});

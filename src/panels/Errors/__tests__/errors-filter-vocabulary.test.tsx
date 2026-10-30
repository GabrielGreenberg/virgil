// @vitest-environment jsdom
//
// Task 1377 — the Errors panel's filter finds every word the error card SHOWS.
//
// The card's text and the filter's haystack used to be two hand-picked field
// lists: the filter searched message/detail/remedy/ruleId while the card's bold
// title came from the rule vocabulary (983) and its location named the file
// (1208). Typing the card's own headline emptied the list. Both now read ONE
// derivation, `errorDisplayText` (src/panels/Errors/error-display.ts).

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import ErrorsPanel from "@/panels/Errors";
import { ErrorCard } from "@/panels/Errors/ErrorCard";
import {
  errorDisplayText,
  errorSearchText,
  errorTitle,
} from "@/panels/Errors/error-display";
import { diagnosticLocationLabel, type LatexError } from "@/lib/latex-errors";

afterEach(cleanup);

const BRACE: LatexError = {
  id: "lint:3:1:brace",
  source: "lint",
  severity: "error",
  line: 3,
  column: 1,
  message: "Unmatched opening brace `{`",
  ruleId: "brace-unmatched-open",
};
const CITE: LatexError = {
  id: "lint:9:4:cite",
  source: "lint",
  severity: "error",
  line: 9,
  column: 4,
  message: "\\citep{foo} → key not in bibliography",
  ruleId: "citep-undefined",
};
const CROSS: LatexError = {
  id: "compile:12:x",
  source: "compile",
  severity: "error",
  line: 12,
  file: "chapter2.tex",
  message: "Undefined control sequence",
  ruleId: "tex-error",
};
const WARN: LatexError = {
  id: "lint:20:1:warn",
  source: "lint",
  severity: "warning",
  line: 20,
  message: "Old-style font command \\bf",
  ruleId: "no-tex-font-shaping-commands",
  remedy: "Use \\textbf{…} instead.",
};
const ALL = [BRACE, CITE, CROSS, WARN];
const SNIPPETS = new Map([[BRACE.id, "\\emph{dangling"]]);

function renderPanel() {
  return render(
    <ErrorsPanel
      errors={ALL}
      selectedId={null}
      onSelect={vi.fn()}
      jump={{ mode: "line", jump: vi.fn() }}
      snippets={SNIPPETS}
      dismissedIds={new Set()}
      onDismiss={vi.fn()}
      expandedIds={new Set()}
      onExpand={vi.fn()}
      onToggleExpanded={vi.fn()}
    />,
  );
}

function shownIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("[data-card]")).map(
    (el) => el.getAttribute("data-card-id") ?? el.getAttribute("data-card") ?? "",
  );
}

function filterTo(q: string) {
  fireEvent.change(screen.getByPlaceholderText("Filter errors…"), {
    target: { value: q },
  });
}

describe("ErrorsPanel filter — searches what the card shows (task 1377)", () => {
  const cases: Array<[string, LatexError[]]> = [
    ["unbalanced", [BRACE]], // curated title, not in the message
    ["Missing citation", [CITE]], // curated title
    ["chapter2", [CROSS]], // cross-file location label
    ["warning", [WARN]], // severity word
    ["compile", [CROSS]], // source word
    ["dangling", [BRACE]], // the quoted snippet
    ["textbf", [WARN]], // remedy (already searched — kept)
  ];
  it.each(cases)("%s finds exactly its card", (q, expected) => {
    const { container } = renderPanel();
    filterTo(q);
    expect(container.querySelectorAll("[data-card]").length).toBe(expected.length);
    for (const e of expected) {
      expect(container.textContent).toContain(errorTitle(e));
    }
    expect(shownIds(container).length).toBe(expected.length);
  });

  it("a query matching nothing still says so", () => {
    const { container } = renderPanel();
    filterTo("zzz-no-such-text");
    expect(container.querySelectorAll("[data-card]").length).toBe(0);
    expect(screen.getByText("No errors match the filter.")).toBeTruthy();
  });
});

describe("CENSUS — the card's text and the filter's haystack are ONE derivation", () => {
  it.each(ALL.map((e) => [e.id, e] as const))(
    "%s: every displayed field is rendered by the card AND searchable",
    (_id, err) => {
      const snippet = SNIPPETS.get(err.id);
      const hay = errorSearchText(err, snippet);
      expect(hay).toContain(errorTitle(err).toLowerCase());
      const loc = diagnosticLocationLabel(err);
      if (loc) expect(hay).toContain(loc.toLowerCase());

      const { container } = render(
        <ErrorCard
          err={err}
          snippet={snippet}
          selected={false}
          expanded
          onExpand={() => {}}
          onToggleExpanded={() => {}}
          hasAnchor={false}
          jumpMode="line"
          onSelect={() => {}}
          onDismiss={() => {}}
        />,
      );
      const shown = container.textContent ?? "";
      for (const value of Object.values(errorDisplayText(err, snippet))) {
        if (!value) continue;
        expect(shown).toContain(value);
        expect(hay).toContain(value.toLowerCase());
      }
      cleanup();
    },
  );

  it("ErrorCard prints no raw `err.<field>` text outside the derivation", () => {
    const src = readFileSync(
      join(__dirname, "..", "ErrorCard.tsx"),
      "utf8",
    );
    // A JSX text child read straight off the error (`{err.message}`) would be
    // displayed text the filter never learns about. Attribute uses
    // (`err.id`, `severity={err.severity}`) are not text and stay allowed.
    expect(src.match(/>\s*\{\s*err\.\w+\s*\}/g) ?? []).toEqual([]);
  });
});

// @vitest-environment jsdom
//
// Task 982 — an error's fix-it instruction is PROSE on its own field
// (`LatexError.remedy`), never the mono `detail` context slot, and an EXPANDED
// card renders every text it carries whole (no `truncate`). Before: the
// compile producers put "Connect to the internet and compile once…" in
// `detail`, which the expanded card rendered as one ellipsized 10px mono line.

import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);
vi.mock("@/components/system-dialog-host", () => ({
  useSystemDialog: () => ({ alert: vi.fn(), confirm: vi.fn() }),
}));
vi.mock("@/lib/compile/compile-service", () => ({
  compileService: { compile: vi.fn() },
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { render, cleanup } from "@testing-library/react";
import ErrorsPanel from "@/panels/Errors";
import type { LatexError } from "@/lib/latex-errors";
import type { CompileResult } from "@/lib/compile/compile-types";
import { downloadFailureErrors, offlineMissErrors } from "@/hooks/useLatexCompile";

afterEach(cleanup);

const REMEDY =
  "The TeX package mirror did not return this file (HTTP 503). Check your network connection and compile again — packages already downloaded are cached, so a retry resumes where this one stopped.";

const ERR: LatexError = {
  id: "compile:0:x",
  source: "compile",
  severity: "error",
  line: 0,
  message: "Could not download package tikz",
  remedy: REMEDY,
  detail: "l.42 \\usetikzlibrary{arrows.meta,decorations.pathreplacing,calligraphy}",
  ruleId: "package-download-failed",
};

function renderExpanded(err: LatexError) {
  return render(
    <ErrorsPanel
      errors={[err]}
      selectedId={null}
      onSelect={vi.fn()}
      jump={{ mode: "line", jump: vi.fn() }}
      dismissedIds={new Set<string>()}
      onDismiss={vi.fn()}
      expandedIds={new Set([err.id])}
      onExpand={vi.fn()}
      onToggleExpanded={vi.fn()}
    />,
  );
}

describe("expanded error card renders remedy + detail whole (task 982)", () => {
  it("shows the full remedy sentence as wrapping prose", () => {
    const { container } = renderExpanded(ERR);
    const el = container.querySelector("[data-error-remedy]") as HTMLElement;
    expect(el).not.toBeNull();
    expect(el.textContent).toBe(REMEDY);
    expect(el.className).not.toMatch(/\btruncate\b/);
    expect(el.className).not.toMatch(/card-mono/);
  });

  it("keeps detail mono but wrapping, not truncated", () => {
    const { container } = renderExpanded(ERR);
    const el = container.querySelector("[data-error-detail]") as HTMLElement;
    expect(el.textContent).toBe(ERR.detail);
    expect(el.className).toMatch(/card-mono/);
    expect(el.className).not.toMatch(/\btruncate\b/);
  });

  it("no expanded text slot carries `truncate`", () => {
    const { container } = renderExpanded(ERR);
    const body = container.querySelector("[data-error-remedy]")!.parentElement!;
    expect(body.querySelectorAll(".truncate")).toHaveLength(0);
  });
});

describe("compile producers put the instruction on `remedy` (task 982)", () => {
  const base = { status: "error", log: "" } as unknown as CompileResult;

  it("offline miss → remedy, no detail", () => {
    const [e] = offlineMissErrors({ ...base, offlineMisses: ["tikz.sty"] }, "s");
    expect(e.remedy).toMatch(/Connect to the internet and compile once/);
    expect(e.detail).toBeUndefined();
  });

  it("download failure → remedy carries the reason, no detail", () => {
    const [e] = downloadFailureErrors(
      { ...base, downloadFailures: [{ name: "pgf.sty", reason: "HTTP 503" }] },
      "s",
    );
    expect(e.remedy).toMatch(/HTTP 503/);
    expect(e.remedy).toMatch(/compile again/);
    expect(e.detail).toBeUndefined();
  });
});

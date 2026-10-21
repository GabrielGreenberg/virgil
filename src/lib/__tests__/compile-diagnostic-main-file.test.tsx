// @vitest-environment jsdom
//
// Task 1208 — "is this diagnostic about the file the editor shows?" has ONE
// answer: `file == null` ⇔ the main file, established by the PRODUCER
// (`parseTexLog`) however the log spelled the main file. Every consumer that
// maps a diagnostic onto the main source (dedup, paragraph, snippet, line
// jump, card location) reads it. Records here are LOG-DERIVED — the old merge
// test passed only because its hand-built compile records omitted `file`.

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { renderHook, render, cleanup } from "@testing-library/react";

(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

import { parseTexLog, sameLogFile } from "@/lib/parse-tex-log";
import {
  diagnosticLocationLabel,
  isMainFileDiagnostic,
  mainFileLine,
  makeErrorId,
  mergeLatexErrors,
  type LatexError,
} from "@/lib/latex-errors";
import { canJumpToError } from "@/panels/Errors/error-jump";

let MOCK_LINT: LatexError[] = [];
vi.mock("@/hooks/useLatexLint", () => ({ useLatexLint: () => MOCK_LINT }));
vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);
vi.mock("@/components/system-dialog-host", () => ({
  useSystemDialog: () => ({ alert: vi.fn(), confirm: vi.fn() }),
}));

import { useDiagnostics } from "@/hooks/useDiagnostics";
import { ErrorCard } from "@/panels/Errors/ErrorCard";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const load = (name: string) =>
  readFileSync(path.join(HERE, "__fixtures__", "tex-logs", name), "utf8");

const firstError = (log: string, opts?: { mainFile?: string }) =>
  parseTexLog(log, 1, opts).find((e) => e.severity === "error")!;

function lintAt(line: number, message: string): LatexError {
  return {
    id: makeErrorId({ source: "lint", line, message }),
    source: "lint",
    severity: "warning",
    line,
    message,
  };
}

afterEach(() => {
  cleanup();
  MOCK_LINT = [];
});

describe("producer: a main-file diagnostic carries no `file`", () => {
  it("emergency-stop.log (`(./main.tex`) → main-file, inferred from the outermost file", () => {
    const err = firstError(load("emergency-stop.log"));
    expect(err.line).toBe(310);
    expect(err.file).toBeUndefined();
    expect(isMainFileDiagnostic(err)).toBe(true);
  });

  it("…and with the caller's mainFile, in every spelling the log may use", () => {
    const log = load("emergency-stop.log");
    expect(firstError(log, { mainFile: "main.tex" }).file).toBeUndefined();
    const abs = log.replace("(./main.tex", "(/work/main.tex");
    expect(firstError(abs, { mainFile: "main.tex" }).file).toBeUndefined();
    expect(firstError(abs).file).toBeUndefined();
  });

  it("multi-file-error.log: the intro error stays cross-file", () => {
    const err = firstError(load("multi-file-error.log"), { mainFile: "main.tex" });
    expect(err.file).toBe("chapters/intro.tex");
    expect(isMainFileDiagnostic(err)).toBe(false);
    expect(mainFileLine(err)).toBe(0);
  });

  it("sameLogFile never matches on a bare basename", () => {
    expect(sameLogFile("./main.tex", "main.tex")).toBe(true);
    expect(sameLogFile("/work/main.tex", "main.tex")).toBe(true);
    expect(sameLogFile("chapters/main.tex", "main.tex")).toBe(false);
  });

  it("a nested file that merely ENDS like the main file is still cross-file", () => {
    const log = [
      "(/work/main.tex",
      "(/work/chapters/main.tex",
      "! Undefined control sequence.",
      "l.7 \\bad",
      ")",
      ")",
    ].join("\n");
    expect(firstError(log, { mainFile: "main.tex" }).file).toBe("/work/chapters/main.tex");
  });
});

describe("merge: the compiler is authoritative on a MAIN-file line only", () => {
  it("a log-derived main-file record drops the lint guess on its line", () => {
    const compile = parseTexLog(load("emergency-stop.log"), 1, { mainFile: "main.tex" });
    const merged = mergeLatexErrors([lintAt(310, "lint guess")], compile);
    expect(merged.some((e) => e.message === "lint guess")).toBe(false);
  });

  it("a log-derived cross-file record does NOT (task 123 survives)", () => {
    const compile = parseTexLog(load("multi-file-error.log"), 1, { mainFile: "main.tex" });
    const merged = mergeLatexErrors([lintAt(42, "main-file lint")], compile);
    expect(merged.some((e) => e.message === "main-file lint")).toBe(true);
  });
});

describe("consumers ask the one predicate", () => {
  const SOURCE = Array.from({ length: 50 }, (_, i) =>
    i === 41 ? "Main line forty-two %!v:abcd" : `main line ${i + 1}`,
  ).join("\n");

  it("useDiagnostics: a cross-file error gets no main-file paragraph or snippet", () => {
    const cross = firstError(load("multi-file-error.log"), { mainFile: "main.tex" });
    const main: LatexError = { ...cross, id: "main42", file: undefined };
    const { result } = renderHook(() =>
      useDiagnostics({
        editor: null,
        editorHandleRef: { current: null },
        sourceText: SOURCE,
        compileErrors: [cross, main],
        knownBibKeys: [],
      }),
    );
    expect(result.current.paragraphByErrorId.has(cross.id)).toBe(false);
    expect(result.current.errorSnippets.has(cross.id)).toBe(false);
    expect(result.current.paragraphByErrorId.get("main42")).toBe("abcd");
    expect(result.current.errorSnippets.get("main42")).toContain("forty-two");
  });

  it("errorJumpable (line mode) refuses a cross-file line", () => {
    const cross = firstError(load("multi-file-error.log"), { mainFile: "main.tex" });
    expect(canJumpToError(cross, "line", false)).toBe(false);
    expect(canJumpToError({ ...cross, file: undefined }, "line", false)).toBe(true);
  });

  it("the card names the file instead of a bare line", () => {
    const cross = firstError(load("multi-file-error.log"), { mainFile: "main.tex" });
    expect(diagnosticLocationLabel(cross)).toBe("chapters/intro.tex · line 42");
    expect(diagnosticLocationLabel({ line: 42, column: 3 })).toBe("line 42:3");
    expect(diagnosticLocationLabel({ line: 0 })).toBeNull();
    const { container } = render(
      <ErrorCard
        err={cross}
        title="Undefined control sequence"
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
    expect(container.querySelector("[data-error-location]")?.textContent).toBe(
      "chapters/intro.tex · line 42",
    );
  });
});

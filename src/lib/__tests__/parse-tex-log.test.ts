import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseTexLog } from "@/lib/parse-tex-log";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, "__fixtures__", "tex-logs");

function load(name: string): string {
  return readFileSync(path.join(FIX, name), "utf8");
}

describe("parseTexLog — state machine (P5)", () => {
  it("recovers line N + the full message from a 79-col-wrapped warning", () => {
    const out = parseTexLog(load("79col-wrapped-warning.log"), 0);
    const warn = out.find((e) => e.severity === "warning");
    expect(warn).toBeTruthy();
    // The `on input line 214` tail was split across the 79-col wrap; the
    // reconstruction must recover BOTH the line number and the whole message.
    expect(warn!.line).toBe(214);
    expect(warn!.message).toContain("Reference");
    expect(warn!.message).toContain("sec:intro-overview-and-scope-section");
    // The "on input line N" clause is consumed into the line number, not left
    // dangling in the message.
    expect(warn!.message).not.toContain("on input line");
  });

  it("folds a `(pkgname)` continuation into one warning message", () => {
    const out = parseTexLog(load("pkgname-fold-warning.log"), 0);
    const warn = out.find((e) => e.severity === "warning");
    expect(warn).toBeTruthy();
    // Both the first line and the folded `(hyperref)` continuation are present.
    expect(warn!.message).toContain("Token not allowed in a PDF string");
    expect(warn!.message).toContain("removing");
    expect(warn!.line).toBe(88);
    // The fold produced ONE card, not two.
    expect(out.filter((e) => e.severity === "warning")).toHaveLength(1);
  });

  it("tags an error inside `(./chapters/intro.tex ...)` with its file", () => {
    const out = parseTexLog(load("multi-file-error.log"), 1);
    const err = out.find((e) => e.severity === "error");
    expect(err).toBeTruthy();
    expect(err!.message).toContain("Undefined control sequence");
    expect(err!.line).toBe(42);
    expect(err!.file).toBe("chapters/intro.tex");
  });

  it("does NOT treat a bare `!` / `!!` in prose as an error", () => {
    const out = parseTexLog(load("bang-in-prose.log"), 0);
    expect(out.filter((e) => e.severity === "error")).toHaveLength(0);
  });

  it("folds Emergency-stop / Fatal-error into the preceding error (no duplicate cards)", () => {
    const out = parseTexLog(load("emergency-stop.log"), 1);
    const errors = out.filter((e) => e.severity === "error");
    // Exactly ONE real error (the \end{itemize} mismatch). Emergency stop +
    // Fatal error are summary trailers, not their own cards.
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("ended by");
    expect(errors[0].line).toBe(310);
    expect(
      out.some((e) => /Emergency stop/i.test(e.message)),
    ).toBe(false);
    expect(
      out.some((e) => /Fatal error occurred/i.test(e.message)),
    ).toBe(false);
  });

  it("synthesizes exactly one fallback when status != 0 and 0 records parsed", () => {
    const log = load("abort-empty-diagnostics.log");
    // status 0 → no records, no fallback.
    expect(parseTexLog(log, 0)).toHaveLength(0);
    // status 1 → exactly one synthetic compile-abort card.
    const out = parseTexLog(log, 1);
    expect(out).toHaveLength(1);
    expect(out[0].ruleId).toBe("compile-abort");
    expect(out[0].line).toBe(0);
    expect(out[0].severity).toBe("error");
    expect(out[0].message).toContain("status 1");
    // Keyed off the log tail so the user gets a hint.
    expect(out[0].message).toContain("engine aborted");
  });

  it("does not synthesize a fallback when records WERE parsed on a failure", () => {
    const out = parseTexLog(load("multi-file-error.log"), 1);
    expect(out.some((e) => e.ruleId === "compile-abort")).toBe(false);
  });

  it("mints distinct ids for two records at line 0 (collision guard)", () => {
    // Two undefined-control-sequence errors with no recoverable line → both
    // land at line 0 with identical messages; ordinals must keep ids distinct.
    const log = [
      "(./main.tex",
      "! Undefined control sequence.",
      "! Undefined control sequence.",
      ")",
    ].join("\n");
    const out = parseTexLog(log, 1);
    const errs = out.filter((e) => e.severity === "error");
    expect(errs.length).toBeGreaterThanOrEqual(2);
    const ids = new Set(errs.map((e) => e.id));
    expect(ids.size).toBe(errs.length);
  });
});

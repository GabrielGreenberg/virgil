// Task 761: a lint error's id is its CONTENT, not its position — an edit that
// does not touch the error (a new error above it, a newline above it) must
// leave its id unchanged, because dismissal / selection / expansion key on it.
import { describe, it, expect } from "vitest";
import { runLint } from "@/lib/workers/latex-lint-core";
import { assignContentIds, type LatexError } from "@/lib/latex-errors";

const KEYS = ["known"];

function idOf(errors: LatexError[], ruleId: string, message: string): string {
  const hit = errors.filter((e) => e.ruleId === ruleId && e.message === message);
  expect(hit).toHaveLength(1);
  return hit[0].id;
}

describe("runLint — lint ids are content ids (task 761)", () => {
  const B_MSG = "\\cite{bbb} → key not in bibliography";
  const base = ["Intro \\cite{aaa}.", "", "Body text.", "Later \\cite{bbb}."].join("\n");

  it("B's id survives a new error above it and a newline above it", async () => {
    const before = await runLint(base, KEYS);
    const idB = idOf(before, "cite-undefined", B_MSG);

    // A NEW error appears earlier in the list (a pass-wide ordinal shifted B).
    const withNewError = base.replace("Body text.", "Body \\cite{zzz} text.");
    const afterNewError = await runLint(withNewError, KEYS);
    expect(afterNewError.length).toBe(before.length + 1);
    expect(idOf(afterNewError, "cite-undefined", B_MSG)).toBe(idB);

    // A blank line at the top moves B down a line (the line was in the id).
    const afterNewline = await runLint("\n" + base, KEYS);
    expect(idOf(afterNewline, "cite-undefined", B_MSG)).toBe(idB);
  });

  it("editing the error's own line re-keys it", async () => {
    const before = await runLint(base, KEYS);
    const edited = await runLint(base.replace("Later", "Much later"), KEYS);
    expect(idOf(edited, "cite-undefined", B_MSG)).not.toBe(
      idOf(before, "cite-undefined", B_MSG),
    );
  });

  it("every id in a pass is unique, including identical twins on one line", async () => {
    const errors = await runLint("Twice \\cite{bbb} and \\cite{bbb}.", KEYS);
    const twins = errors.filter((e) => e.message === B_MSG);
    expect(twins).toHaveLength(2);
    expect(twins[0].id).not.toBe(twins[1].id);
    expect(new Set(errors.map((e) => e.id)).size).toBe(errors.length);
  });
});

describe("assignContentIds", () => {
  const rec = (line: number, message: string, ruleId = "r"): LatexError => ({
    id: "positional",
    source: "lint",
    severity: "error",
    line,
    message,
    ruleId,
  });

  it("a line number quoted inside the message is not identity", () => {
    const text = "a\n\\end{x}";
    const moved = "\n\na\n\\end{x}";
    const [one] = assignContentIds([rec(2, "does not match on line 1")], text);
    const [two] = assignContentIds([rec(4, "does not match on line 3")], moved);
    expect(one.id).toBe(two.id);
  });

  it("line-0 twins get distinct ids; order is preserved", () => {
    const out = assignContentIds([rec(0, "boom"), rec(0, "boom"), rec(1, "x")], "t");
    expect(out.map((e) => e.message)).toEqual(["boom", "boom", "x"]);
    expect(new Set(out.map((e) => e.id)).size).toBe(3);
  });
});

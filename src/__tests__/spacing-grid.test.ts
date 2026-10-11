import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Spacing-grid contract (task 2026-09-28-821).
 *
 * STYLE_GUIDE.md "Spacing & icons": spacing comes from the 4px scale; the one
 * exception — aligning to a non-grid asset — must SAY what it aligns to. The
 * guard (`scripts/check-spacing-grid.mjs`, the radius guard's sibling) makes
 * that rule machine-checked: an arbitrary Tailwind spacing utility passes only
 * as a `var(--token)` or with an `aligns:` note. These tests lock
 *   1. the tree is clean, and
 *   2. the guard's reach — it rejects what it must and waves through what it may.
 */
const ROOT = path.resolve(__dirname, "..", "..");

describe("spacing-grid guard", () => {
  it("finds no unannotated arbitrary spacing in the tree", () => {
    expect(() =>
      execFileSync("node", ["scripts/check-spacing-grid.mjs"], { cwd: ROOT, stdio: "pipe" }),
    ).not.toThrow();
  });

  it("is wired as `npm run check:spacing`", () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
    expect(pkg.scripts["check:spacing"]).toBe("node scripts/check-spacing-grid.mjs");
  });
});

describe("spacing-grid guard reach", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "virgil-spacing-guard-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function scan(source: string, ext = "tsx"): { ok: boolean; report: string } {
    const fixture = path.join(dir, `fixture.${ext}`);
    writeFileSync(fixture, source, "utf8");
    try {
      execFileSync("node", ["scripts/check-spacing-grid.mjs", fixture], { cwd: ROOT, stdio: "pipe" });
      return { ok: true, report: "" };
    } catch (err) {
      const e = err as { stderr?: Buffer; stdout?: Buffer };
      return { ok: false, report: String(e.stderr ?? "") + String(e.stdout ?? "") };
    }
  }

  it.each([
    ["padding", `<div className="p-[5px]" />`, "p-[5px]"],
    ["a side margin", `<div className="flex mt-[7px]" />`, "mt-[7px]"],
    ["a negative margin", `<div className="-mb-[3px]" />`, "-mb-[3px]"],
    ["a gap", `<div className="gap-[7px]" />`, "gap-[7px]"],
    ["an axis gap", `<div className="gap-x-[7px]" />`, "gap-x-[7px]"],
    ["space-between", `<div className="space-y-[7px]" />`, "space-y-[7px]"],
    ["an inset", `<div className="absolute inset-x-[18px]" />`, "inset-x-[18px]"],
    ["an offset", `<div className="absolute right-[3.125rem]" />`, "right-[3.125rem]"],
    ["a variant-prefixed value", `<div className="md:pl-[18px]" />`, "pl-[18px]"],
    ["the SECOND arbitrary value on a line", `<div className="pl-[var(--x)] pr-[26px]" />`, "pr-[26px]"],
    ["a note that is not directly above", `// aligns: something\nconst a = 1;\n<div className="p-[5px]" />`, "p-[5px]"],
  ])("flags %s", (_label, source, expected) => {
    const { ok, report } = scan(source);
    expect(ok, `guard passed arbitrary spacing in: ${source}`).toBe(false);
    expect(report).toContain(expected);
  });

  // The other spellings of the same prohibition (task 2026-10-11-1060):
  // literal px, judged on the value.
  it.each([
    ["a CSS padding", "css", `.chip {\n  padding: 0 3px;\n}`, "padding: 0 3px"],
    ["a CSS gap", "css", `.row { gap: 5px; }`, "gap: 5px"],
    ["a CSS negative offset", "css", `.halo::before {\n  left: -5px;\n}`, "left: -5px"],
    ["a CSS fractional margin", "css", `.x { margin-top: 2.5px; }`, "margin-top: 2.5px"],
    ["a var() fallback in CSS", "css", `.x { padding: var(--pad, 5px); }`, "var(--pad, 5px)"],
    ["a numeric style key", "tsx", `<span style={{ paddingRight: 5 }} />`, "paddingRight: 5"],
    ["a negative style margin", "tsx", `<i style={{ marginLeft: -7 }} />`, "marginLeft: -7"],
    ["a px-string style key", "tsx", `const box = { padding: "5px 8px" };`, `padding: "5px 8px"`],
    ["a px-string style offset", "tsx", `<i style={{ top: "-3px" }} />`, `top: "-3px"`],
    ["a cssText string", "tsx", `el.style.cssText = "position:absolute;top:-7px;right:-7px;";`, "top:-7px"],
    ["a Tailwind arbitrary property", "tsx", `<div className="[padding:5px]" />`, "padding:5px"],
  ])("flags %s", (_label, ext, source, expected) => {
    const { ok, report } = scan(source, ext);
    expect(ok, `guard passed off-grid spacing in: ${source}`).toBe(false);
    expect(report).toContain(expected);
  });

  it.each([
    ["on-grid CSS", "css", `.x {\n  padding: 4px 6px;\n  gap: 2px;\n  margin: 0 1px;\n  left: -8px;\n}`],
    ["typographic em rhythm in CSS", "css", `.x { margin: 0.75em 0; padding: 0.3rem; }`],
    ["an annotated CSS value", "css", `/* aligns: + the 1px border = the base chip */\n.x { padding: 0 5px; }`],
    ["a CSS comment quoting a value", "css", `/* was padding: 5px */\n.x { padding: 4px; }`],
    ["on-grid style keys", "tsx", `<div style={{ gap: 4, paddingRight: 6, margin: "4px 8px" }} />`],
    ["a numeric rect offset", "tsx", `const r = { top: 3, left: 5 };`],
    ["a derived style binding", "tsx", `<i style={{ marginLeft: -SIZE / 2, top: y - 5 }} />`],
    ["non-spacing style keys", "tsx", `<i style={{ fontSize: 13, lineHeight: 1.5, width: 5 }} />`],
  ])("passes %s", (_label, ext, source) => {
    const { ok, report } = scan(source, ext);
    expect(ok, `guard flagged legitimate spacing: ${source}\n${report}`).toBe(true);
  });

  it.each([
    ["scale utilities", `<div className="p-1.5 gap-px mt-0.5 -mb-1 right-7" />`],
    ["a token value", `<div className="self-end mb-[var(--bar-seam-lift)]" />`],
    ["a same-line note", `<div className="pl-[14px]" /> // aligns: the bullet glyph`],
    ["a note in the comment block above", `<div\n  // aligns: the folder silhouette's\n  // content inset + pl-3.5\n  className="pl-[26px]"\n/>`],
    ["prose in a comment", `// the old \`mb-[3px]\` lift\nconst a = 1;`],
    ["non-spacing arbitrary utilities", `<div className="text-[13px] max-w-[220px] w-[18px] rounded-[var(--pod-radius)] border-[var(--x)]" />`],
  ])("passes %s", (_label, source) => {
    const { ok, report } = scan(source);
    expect(ok, `guard flagged legitimate spacing: ${source}\n${report}`).toBe(true);
  });
});

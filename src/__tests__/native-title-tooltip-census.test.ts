/**
 * NATIVE `title=` TOOLTIP CENSUS (task 2026-10-22-1236).
 *
 * > Virgil has ONE hover/focus affordance, rendered app-wide by `HintLayer`.
 * > **Don't** use `title=""` for tooltips — add hint attributes and let the
 * > single controller do the rest. (STYLE_GUIDE → "Hints, tooltips &
 * > keyboard shortcuts")
 *
 * The rule had no guard, and the audit that opened this task found 34 raw
 * `title=` sites across both silos — the whole Library silo carried not one
 * `data-hint` — plus two fresh ones from task 1195 sitting beside sibling
 * card actions that already used `iconHint`. A native tooltip is not merely a
 * second style: it has its own delay, ignores Helper mode, never shows on
 * keyboard focus, and can't be dismissed with Escape.
 *
 * What it flags: a `title=` ATTRIBUTE on
 *  - any lowercase JSX intrinsic (`<button>`, `<span>`, `<div>` …), and
 *  - the shared primitives that spread their props onto the DOM
 *    ({@link DOM_FORWARDING}), whose `title` therefore becomes a native
 *    tooltip one hop away.
 *
 * What it does NOT flag:
 *  - a component's own `title` PROP (`<SystemDialogHeader title=…>`,
 *    `<Pill title=…>`) — those are names in the component's API; where one
 *    reaches the DOM it does so through an intrinsic this census reads;
 *  - an SVG `<title>` CHILD — an element, not an attribute;
 *  - {@link EXEMPT_TAGS}: an `<iframe>`'s `title` is its accessible NAME
 *    (WCAG 4.1.2), not a tooltip.
 *
 * The disabled-button nuance the task raised is settled by `Button.tsx`:
 * disabled Buttons keep pointer events (`disabled:pointer-events-none` was
 * removed precisely so the hint saying WHY still shows), so a refusal reason
 * is `data-hint={reason}` like any other hint — no exemption needed.
 *
 * Reads markup through the shared scanner (`_source-scan.ts`); comments are
 * stripped, so prose mentioning `title="…"` is not a hit.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  REPO_ROOT,
  strip,
  tagAround,
  trackedFiles,
} from "@/lib/__tests__/_source-scan";

/** Intrinsics whose `title` is an accessible name, not a tooltip. */
const EXEMPT_TAGS: ReadonlySet<string> = new Set(["iframe"]);

/**
 * Shared primitives that forward unknown props to a DOM element, keyed by
 * name → the file that defines them. The self-check below keeps the list
 * honest: each must still spread `...rest` onto what it renders.
 */
const DOM_FORWARDING: Readonly<Record<string, string>> = {
  Button: "src/components/Button.tsx",
  SystemDialogButton: "src/components/system-dialog.tsx",
  Input: "src/components/field-primitives.tsx",
  Textarea: "src/components/field-primitives.tsx",
  Select: "src/components/field-primitives.tsx",
};

interface Hit {
  line: number;
  tag: string;
}

/** Every tooltip-shaped `title=` attribute in one source text. */
export function nativeTitleHits(source: string): Hit[] {
  const code = strip(source, true, true);
  const out: Hit[] = [];
  for (const m of code.matchAll(/(?<![\w$.-])title=/g)) {
    const at = m.index ?? 0;
    const tag = tagAround(code, at);
    if (!tag) continue;
    const name = /^<([A-Za-z][\w.-]*)/.exec(tag)?.[1] ?? "";
    const intrinsic = /^[a-z]/.test(name) && !EXEMPT_TAGS.has(name);
    if (intrinsic || name in DOM_FORWARDING) {
      out.push({ line: code.slice(0, at).split("\n").length, tag: name });
    }
  }
  return out;
}

const productionTsx = (): string[] =>
  [...trackedFiles("src", /\.tsx$/), ...trackedFiles("library", /\.tsx$/)].filter(
    (f) => !/(^|\/)__tests__\//.test(f) && !/\.(test|stories)\.tsx$/.test(f),
  );

describe("native title= tooltip CENSUS", () => {
  it("no production element carries a tooltip `title=` (use data-hint / iconHint)", () => {
    const files = productionTsx();
    expect(files.length).toBeGreaterThan(100);
    const offenders: string[] = [];
    for (const f of files) {
      for (const h of nativeTitleHits(fs.readFileSync(f, "utf8"))) {
        offenders.push(`${path.relative(REPO_ROOT, f)}:${h.line} <${h.tag} title=…>`);
      }
    }
    expect(
      offenders,
      "A native `title=` tooltip bypasses HintLayer. Use `data-hint={…}` " +
        "(text-bearing control) or `{...iconHint({ label })}` (icon-only " +
        "control) — STYLE_GUIDE → Hints.",
    ).toEqual([]);
  });

  it("is red on a reintroduced tooltip `title=` and quiet on the exempt shapes", () => {
    const fixture = [
      `<button type="button" title="Close">x</button>`,
      `<span\n  className="x"\n  title={label}\n>{label}</span>`,
      `<Button size="sm" title={reason}>Save</Button>`,
      `<iframe title="Compiled PDF" />`,
      `<SystemDialogHeader title="Print" />`,
      `<svg><title>Icon</title></svg>`,
      `// <button title="in a comment">`,
      `<div data-hint={title} />`,
    ].join("\n");
    expect(nativeTitleHits(fixture).map((h) => h.tag)).toEqual([
      "button",
      "span",
      "Button",
    ]);
  });

  it("every DOM_FORWARDING primitive still spreads its props onto the DOM", () => {
    for (const [name, rel] of Object.entries(DOM_FORWARDING)) {
      const src = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
      expect(src, `${name} is no longer defined in ${rel}`).toMatch(
        new RegExp(`\\b(?:function|const)\\s+${name}\\b`),
      );
      expect(src, `${rel} no longer spreads props (\`...rest\`)`).toMatch(/\{\s*\.\.\.rest\s*\}/);
    }
  });
});

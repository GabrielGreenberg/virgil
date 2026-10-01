// @vitest-environment jsdom
/**
 * Task 881 — the PRINT ELEMENT toggles are ONE registry (`PRINT_ELEMENTS` in
 * src/lib/print.ts), and the CSS that implements them is census-held to it.
 *
 * Before 881 the nine `data-print-e-*` toggles were three hand-synced lists —
 * the `PrintElementKey` union, the PrintDialog rows, and the selectors in
 * globals.css — with nothing binding a row's LABEL to the element its rule
 * hides. "Title / author" hid `.par-title-wrapper`, the NodeView wrapper of
 * EVERY ordinary paragraph, so unticking it printed a paper with its body
 * prose gone while the real title block (`.title-field-wrapper`) still printed.
 *
 * CSS cannot import TS (the `print-view-only-posture` precedent), so this suite
 * reads globals.css and asserts:
 *   1. every `html[data-print-e-*="false"] …` rule belongs to a registry key,
 *      and its selectors are EXACTLY that key's `selectors`;
 *   2. every registry key has its rule;
 *   3. no toggle names a universal block wrapper;
 *   4. (jsdom) with Title / author OFF, a paragraph is matched by no hide
 *      selector and every titleField is.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cssCommentsStripped, REPO_ROOT } from "./_source-scan";
import {
  PRINT_ELEMENTS,
  PRINT_ELEMENT_ORDER,
  DEFAULT_PRINT_OPTIONS,
  printElementAttr,
  type PrintElementKey,
} from "@/lib/print";

const CSS = cssCommentsStripped(readFileSync(join(REPO_ROOT, "src/app/globals.css"), "utf8"));

/** Wrappers that enclose ordinary document prose — a print ELEMENT toggle
 *  hiding one of these would hide the paper's body, whatever its label says. */
const UNIVERSAL_BLOCK_WRAPPERS = [".par-title-wrapper", ".par-body-container", ".tiptap", ".ProseMirror", "p"];

const RULE_HEAD = /html\[data-print-e-([a-z-]+)="false"\]\s+([^,{]+)/g;

/** attr suffix → selectors (the part after the html stamp), across all rules. */
function cssToggleSelectors(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  // Only selector heads: text between a rule boundary and its `{`.
  for (const m of CSS.matchAll(/(^|[{}])([^{}]*)\{/g)) {
    const head = m[2];
    for (const s of head.matchAll(RULE_HEAD)) {
      const list = out.get(s[1]) ?? [];
      list.push(s[2].trim());
      out.set(s[1], list);
    }
  }
  return out;
}

const suffix = (k: PrintElementKey) => printElementAttr(k).replace(/^data-print-e-/, "");

describe("print element toggles — registry ↔ globals.css census (task 881)", () => {
  const css = cssToggleSelectors();

  it("every data-print-e-* rule in globals.css belongs to a registry key", () => {
    const known = new Set(PRINT_ELEMENT_ORDER.map(suffix));
    const unknown = [...css.keys()].filter((s) => !known.has(s));
    expect(unknown, `rules keyed on attrs no PRINT_ELEMENTS entry stamps: ${unknown.join(", ")}`).toEqual([]);
  });

  it.each(PRINT_ELEMENT_ORDER)("%s: its rule names exactly the registry's selectors", (key) => {
    const got = css.get(suffix(key));
    expect(got, `no html[${printElementAttr(key)}="false"] rule in globals.css`).toBeDefined();
    expect([...got!].sort()).toEqual([...PRINT_ELEMENTS[key].selectors].sort());
  });

  it("no toggle targets a universal block wrapper", () => {
    for (const key of PRINT_ELEMENT_ORDER) {
      for (const sel of PRINT_ELEMENTS[key].selectors) {
        const bare = sel.replace(/::?[a-z-]+$/, "");
        expect(UNIVERSAL_BLOCK_WRAPPERS, `${key} → ${sel}`).not.toContain(bare);
      }
    }
  });

  it("the shipped defaults name exactly the registry's keys", () => {
    expect(Object.keys(DEFAULT_PRINT_OPTIONS.elements).sort()).toEqual([...PRINT_ELEMENT_ORDER].sort());
  });

  it("Title / author OFF hides the titleField block, never an ordinary paragraph", () => {
    document.documentElement.setAttribute(printElementAttr("title"), "false");
    document.body.innerHTML = `
      <div class="tiptap">
        <div class="title-field-wrapper" id="t"><div class="title-field-content title-field-title">A Title</div></div>
        <div class="title-field-wrapper" id="a"><div class="title-field-content">An Author</div></div>
        <div class="maketitle-marker" data-type="maketitle-marker"></div>
        <div class="par-title-wrapper" id="p"><div class="par-body-container"><p>Body prose.</p></div></div>
      </div>`;
    const hidden = new Set<Element>();
    for (const head of css.get(suffix("title")) ?? []) {
      for (const el of document.querySelectorAll(`html[${printElementAttr("title")}="false"] ${head}`)) {
        hidden.add(el);
      }
    }
    expect(hidden.has(document.getElementById("t")!)).toBe(true);
    expect(hidden.has(document.getElementById("a")!)).toBe(true);
    const para = document.getElementById("p")!;
    for (const el of hidden) expect(el.contains(para) || para.contains(el)).toBe(false);
    document.documentElement.removeAttribute(printElementAttr("title"));
  });
});

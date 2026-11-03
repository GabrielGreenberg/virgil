// @vitest-environment jsdom
/**
 * Task 1442 — a NodeView that KEEPS itself across node changes must re-stamp
 * its `data-uuid` when the uuid changes.
 *
 * `stampTextObjectAttrs` (uuid-attr.ts) is how an anchorable NodeView exposes
 * `data-uuid` + `data-text-object-kind` — the attributes
 * `useMarginaliaRegistry`, the geometry service and the grab handle resolve
 * blocks by. The BlockUuidBackfill mint and a paste/undo re-mint arrive as
 * AttrSteps, and an AttrStep reaches a view through `update()`, not a remount.
 * So the contract has two halves, chosen by whether the view declares
 * `update`:
 *
 *   - NO `update()` → ProseMirror recreates the view on every node change, and
 *     the construction-time stamp is always fresh (`maketitleMarker`,
 *     `latexComment`).
 *   - an `update()` that returns `true` → the view is KEPT, so the stamp must
 *     be re-applied there when `attrs.uuid` changed (expex, math, the
 *     editor-extensions block views — and, since this task, `titleField`,
 *     whose `update()` repainted only its annotation and left a `\title`
 *     loaded without a sidecar uuid with none in the DOM).
 *
 * The behavioural leg mounts the real main editor and drives the AttrStep; the
 * CENSUS leg makes the contract structural over the whole NodeView population
 * (`_nodeview-census.ts`), with a negative fixture proving the rule can fail.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor, type Content } from "@tiptap/core";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import {
  nodeViewPopulation,
  nodeViewRegions,
  updateBodies,
  type Region,
} from "./_nodeview-census";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
}

function mountDoc(content: Content) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const editor = new Editor({ element: el, extensions: buildEditorExtensions(mainCtx()), content });
  return { editor, el };
}

function titleDoc(uuid: string | null): Content {
  return {
    type: "doc",
    content: [
      {
        type: "titleField",
        attrs: { field: "title", uuid },
        content: [{ type: "text", text: "On Annotation" }],
      },
      { type: "paragraph", content: [{ type: "text", text: "Body." }] },
    ],
  };
}

describe("titleField re-stamps data-uuid through update() (task 1442)", () => {
  it("a uuid minted after mount (backfill AttrStep) reaches the wrapper", () => {
    const { editor, el } = mountDoc(titleDoc(null));
    try {
      const wrapper = el.querySelector<HTMLElement>(".title-field-wrapper")!;
      expect(wrapper).not.toBeNull();
      expect(wrapper.hasAttribute("data-uuid")).toBe(false);
      editor.view.dispatch(editor.state.tr.setNodeAttribute(0, "uuid", "MINTED"));
      // Same element — the view was KEPT, which is the whole point.
      expect(el.querySelector(".title-field-wrapper")).toBe(wrapper);
      expect(wrapper.getAttribute("data-uuid")).toBe("MINTED");
      expect(wrapper.getAttribute("data-text-object-kind")).toBe("titleField");
    } finally {
      editor.destroy();
    }
  });

  it("a re-mint replaces the OLD uuid rather than leaving it in the DOM", () => {
    const { editor, el } = mountDoc(titleDoc("OLD"));
    try {
      expect(el.querySelector('[data-uuid="OLD"]')).not.toBeNull();
      editor.view.dispatch(editor.state.tr.setNodeAttribute(0, "uuid", "NEW"));
      expect(el.querySelector('[data-uuid="OLD"]')).toBeNull();
      expect(el.querySelector('[data-uuid="NEW"]')?.classList.contains("title-field-wrapper")).toBe(
        true,
      );
    } finally {
      editor.destroy();
    }
  });
});

// ── Census ──────────────────────────────────────────────────────────────

const STAMP = /\bstampTextObjectAttrs\s*\(/;

/** The violation for one NodeView region, or null: a region that stamps and
 *  declares a per-transaction method (`update` / `paint`) must stamp inside
 *  one of them too — otherwise the view is KEPT across an AttrStep with the
 *  construction-time uuid frozen on its DOM. */
function restampViolation(region: Region): string | null {
  if (!STAMP.test(region.text)) return null;
  const bodies = updateBodies(region);
  if (bodies.length === 0) return null; // remounts on change — always fresh
  if (bodies.some((b) => STAMP.test(b))) return null;
  return `${region.label}: stamps data-uuid at construction and declares update(), but never re-stamps in it`;
}

describe("CENSUS — every kept NodeView that stamps data-uuid re-stamps it in update()", () => {
  it("the population is non-vacuous (stamping views with and without update are both seen)", () => {
    const stamping = nodeViewPopulation()
      .flatMap((f) => nodeViewRegions(f))
      .filter((r) => STAMP.test(r.text));
    expect(stamping.some((r) => updateBodies(r).length > 0)).toBe(true);
    expect(stamping.some((r) => updateBodies(r).length === 0)).toBe(true);
    expect(stamping.some((r) => r.file.endsWith("tiptap/title.ts"))).toBe(true);
  });

  it("no violations", () => {
    const violations = nodeViewPopulation()
      .flatMap((f) => nodeViewRegions(f))
      .map(restampViolation)
      .filter((v): v is string => v !== null);
    expect(violations).toEqual([]);
  });

  it("NEGATIVE: a stamp-at-construction-only view that declares update() is caught", () => {
    const bad: Region = {
      file: "fixture.ts",
      label: "fixture.ts#addNodeView[1]",
      text: `{ return ({ node }) => { const w = document.createElement("div");
        stampTextObjectAttrs(w, node, null);
        return { dom: w, update(n) { if (n.type !== node.type) return false; return true; } }; }; }`,
    };
    expect(restampViolation(bad)).toMatch(/never re-stamps/);
    const remounting: Region = { ...bad, text: `{ stampTextObjectAttrs(w, node, null); return { dom: w }; }` };
    expect(restampViolation(remounting)).toBeNull();
  });
});

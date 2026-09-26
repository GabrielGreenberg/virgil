// @vitest-environment jsdom
/**
 * Task 776 — the container-fit WRAP vocabulary is READ from the registry.
 *
 * `fitNodeInContainer` tries each wrapper in `WRAP_TARGET_KINDS`; that list is
 * derived from the text-object registry's `parentKinds` facet (the one place
 * the child→parent relation lives), and `buildWrap` is the construction half.
 * These legs pin the two halves together: every derived kind is one
 * `buildWrap` can build, and no kind `buildWrap` builds is missing from the
 * derivation — so a sub-object added to the registry either works as a wrapper
 * or fails here, never silently refuses a pull-out.
 *
 * Real editor schema, so `buildWrap`'s per-kind construction is the authentic
 * one. (`@/lib/storage` stubbed wholesale — see container-fit.test.ts.)
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useStack", () => ({ readStackItem: vi.fn() }));
vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { getSchema } from "@tiptap/core";
import type { Schema } from "@tiptap/pm/model";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { WRAP_TARGET_KINDS } from "../container-fit";
import { buildWrap } from "../drop-adapters";
import { TEXT_OBJECT_REGISTRY } from "../text-object-registry";
import type { TextObjectKind } from "../types";

const schema: Schema = getSchema(
  buildEditorExtensions({
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  } as unknown as EditorExtensionsCtx),
);

/** Does `buildWrap` have a CASE for this kind? (A case may still refuse a
 *  probe it cannot hold — that throws a different error.) */
function buildWrapKnows(kind: TextObjectKind): boolean {
  const probe = schema.nodes.paragraph.create();
  try {
    buildWrap(schema, probe, kind);
    return true;
  } catch (e) {
    return !/is not a wrap target/.test(String(e));
  }
}

const ALL_KINDS = Object.keys(TEXT_OBJECT_REGISTRY) as TextObjectKind[];

describe("WRAP_TARGET_KINDS ↔ registry parentKinds ↔ buildWrap (task 776)", () => {
  it("is exactly the sub-object kinds plus their declared parents, items first", () => {
    const items = ALL_KINDS.filter((k) => TEXT_OBJECT_REGISTRY[k].parentKinds?.length);
    const parents = [
      ...new Set(items.flatMap((k) => TEXT_OBJECT_REGISTRY[k].parentKinds ?? [])),
    ];
    expect(WRAP_TARGET_KINDS.slice(0, items.length)).toEqual(items);
    expect([...WRAP_TARGET_KINDS.slice(items.length)].sort()).toEqual(
      parents.filter((p) => !items.includes(p)).sort(),
    );
  });

  it("today's vocabulary (a registry edit that changes it must update this pin)", () => {
    expect(WRAP_TARGET_KINDS).toEqual([
      "listItem",
      "exampleItem",
      "bulletList",
      "orderedList",
      "exampleBlock",
    ]);
  });

  it("every derived wrap kind is one buildWrap can construct", () => {
    for (const kind of WRAP_TARGET_KINDS) {
      expect(buildWrapKnows(kind), kind).toBe(true);
    }
  });

  it("buildWrap constructs no kind the registry does not declare", () => {
    for (const kind of ALL_KINDS) {
      if (WRAP_TARGET_KINDS.includes(kind)) continue;
      expect(buildWrapKnows(kind), kind).toBe(false);
    }
  });
});

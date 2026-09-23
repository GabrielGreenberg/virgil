// @vitest-environment jsdom
//
// Task 732 — the annotation-vs-lifecycle range split has ONE owner
// (`@/text-objects/action-scope`), and the registry's per-kind scope hooks are
// read KIND-AGNOSTICALLY rather than from inside an `if (kind === "heading")`.
//
// WHAT IS PROVEN HERE (the `action-registry.ts` / lightning-surface half):
//   1. a NON-heading kind that declares `collectAnnotationRange` has it
//      honoured by `resolveScope` — before this task the hook was unreachable
//      for any kind but `heading`, which is exactly the extension `types.ts`
//      advertises ("exampleBlock annotating its intro line");
//   2. the same for `collectMoveSource` on the lifecycle side;
//   3. a declared hook that cannot locate its object is a BAIL (null), not a
//      silent fallback to the range the kind has said is the wrong one;
//   4. the lifecycle-action membership every card row resolves under is the
//      canonical `LIFECYCLE_ACTION_IDS` set, action for action — the parity
//      pin over what used to be two hand-copied sets. Planted in the
//      falsifying direction: it walks EVERY card id and asserts both
//      directions of the iff.
//
// The sibling `action-scope-kind-agnostic.test.tsx` under
// `components/editor-layout/card-actions/__tests__/` proves the same for the
// grab-bar dispatcher, so "BOTH resolvers" is covered end to end.
import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { getSchema, type JSONContent } from "@tiptap/core";
import { Node as PMNode } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  VIRGIL_ACTION_REGISTRY,
  type ActionContext,
  type ActionId,
  type ActionRef,
} from "@/lib/actions/action-registry";
import { CARD_ACTION_ORDER } from "@/lib/actions/action-icons";
import { TEXT_OBJECT_REGISTRY } from "@/text-objects/text-object-registry";
import type { MoveSource } from "@/text-objects/types";
import {
  LIFECYCLE_ACTION_IDS,
  isLifecycleAction,
  actionScopeClass,
  collectScopeOverride,
} from "@/text-objects/action-scope";

const mainCtx = (): EditorExtensionsCtx => ({
  surface: "main",
  editable: true,
  cardContext: true,
  callbacks: {},
  docIdRef: null,
  host: { getMainEditor: () => null },
});

const schema = getSchema(buildEditorExtensions(mainCtx()));

const DOC: JSONContent = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { uuid: "h1", level: 2 },
      content: [{ type: "text", text: "Intro" }],
    },
    {
      type: "paragraph",
      attrs: { uuid: "p1" },
      content: [{ type: "text", text: "Body sentence." }],
    },
    {
      type: "heading",
      attrs: { uuid: "h2", level: 2 },
      content: [{ type: "text", text: "Next" }],
    },
  ],
};

function ctxFor(ref: ActionRef): ActionContext {
  const doc = PMNode.fromJSON(schema, DOC);
  const state = EditorState.create({ schema, doc });
  const view = { state } as unknown as ActionContext["view"];
  const editor = { state, view } as unknown as ActionContext["editor"];
  return { editor, view, ref, surface: "grab" };
}

function scopeOf(id: ActionId, ref: ActionRef) {
  const row = VIRGIL_ACTION_REGISTRY[id];
  if (!row?.resolveScope) throw new Error(`no resolveScope for ${id}`);
  return row.resolveScope(ctxFor(ref));
}

// ---------------------------------------------------------------------------
// Registry mutation helper — install a hook on a kind that has none, and
// always put the row back. The resolvers read the registry at CALL time, so a
// temporary slot is a faithful stand-in for "a kind that grows scope
// asymmetry later" without minting a fixture node type.
// ---------------------------------------------------------------------------

type HookName = "collectAnnotationRange" | "collectMoveSource";

const installed: Array<() => void> = [];

function installHook(
  kind: "paragraph",
  hook: HookName,
  fn: (doc: PMNode, uuid: string) => MoveSource | null,
): void {
  const meta = TEXT_OBJECT_REGISTRY[kind] as Record<string, unknown>;
  const prev = meta[hook];
  meta[hook] = fn;
  installed.push(() => {
    if (prev === undefined) delete meta[hook];
    else meta[hook] = prev;
  });
}

afterEach(() => {
  while (installed.length) installed.pop()!();
});

// ---------------------------------------------------------------------------

describe("task 732 — the registry scope hooks are kind-agnostic", () => {
  it("baseline: paragraph declares NEITHER hook, so both classes give its content range", () => {
    expect(TEXT_OBJECT_REGISTRY.paragraph.collectAnnotationRange).toBeUndefined();
    expect(TEXT_OBJECT_REGISTRY.paragraph.collectMoveSource).toBeUndefined();
    const ref: ActionRef = { kind: "paragraph", id: "p1" };
    expect(scopeOf("note", ref)).toEqual(scopeOf("delete", ref));
  });

  it("a NON-heading kind's collectAnnotationRange is honoured (the hook stops being heading-locked)", () => {
    // "Body sentence." sits at content range [8, 22]; narrow the annotation
    // range to its first word only — a range no generic fallback could produce.
    installHook("paragraph", "collectAnnotationRange", (doc, uuid) => {
      expect(uuid).toBe("p1");
      return { from: 9, to: 13, nodes: [] };
    });
    const ref: ActionRef = { kind: "paragraph", id: "p1" };
    expect(scopeOf("note", ref)).toEqual({ from: 9, to: 13 });
    expect(scopeOf("highlight", ref)).toEqual({ from: 9, to: 13 });
    // The lifecycle side declares no hook, so it keeps the generic fallback —
    // the two classes are now ASYMMETRIC for a non-heading kind.
    expect(scopeOf("delete", ref)).not.toEqual({ from: 9, to: 13 });
  });

  it("a NON-heading kind's collectMoveSource is honoured on the lifecycle side", () => {
    installHook("paragraph", "collectMoveSource", () => ({
      from: 7,
      to: 23,
      nodes: [],
    }));
    const ref: ActionRef = { kind: "paragraph", id: "p1" };
    expect(scopeOf("delete", ref)).toEqual({ from: 7, to: 23 });
    expect(scopeOf("archive", ref)).toEqual({ from: 7, to: 23 });
    expect(scopeOf("duplicate", ref)).toEqual({ from: 7, to: 23 });
    // Annotation actions are untouched by the lifecycle hook.
    expect(scopeOf("note", ref)).not.toEqual({ from: 7, to: 23 });
  });

  it("a declared hook that cannot locate its object BAILS — it does not fall back", () => {
    installHook("paragraph", "collectAnnotationRange", () => null);
    const ref: ActionRef = { kind: "paragraph", id: "p1" };
    // The card row's own pre-existing null sentinel is `{0, 0}` (the same
    // answer an unresolvable ref has always produced). What matters is that
    // the hook's failure is NOT quietly replaced by the generic fallback.
    expect(scopeOf("note", ref)).toEqual({ from: 0, to: 0 });
    // ...while the class with no hook still resolves normally, so the bail is
    // the HOOK's answer, not a broken ref.
    expect(scopeOf("delete", ref)).toEqual({ from: 8, to: 22 });
  });

  it("heading behaviour is byte-unchanged: annotation → line, lifecycle → section", () => {
    const ref: ActionRef = { kind: "heading", id: "h1" };
    const line = scopeOf("note", ref)!;
    const section = scopeOf("delete", ref)!;
    expect(line).toEqual({ from: 1, to: 6 });
    expect(section.from).toBe(0);
    expect(section.to).toBeGreaterThan(line.to);
  });
});

// ---------------------------------------------------------------------------
// The parity pin over what used to be two hand-copied lifecycle sets.
// ---------------------------------------------------------------------------

describe("task 732 — one lifecycle-action set, read by every card row", () => {
  it("every card row resolves under the class the canonical set names — both directions", () => {
    const headingRef: ActionRef = { kind: "heading", id: "h1" };
    const section = scopeOf("delete", headingRef)!;
    const line = scopeOf("note", headingRef)!;
    expect(section).not.toEqual(line); // the two answers are distinguishable

    for (const id of CARD_ACTION_ORDER) {
      const row = VIRGIL_ACTION_REGISTRY[id];
      if (!row?.resolveScope) continue;
      const got = scopeOf(id, headingRef);
      if (isLifecycleAction(id)) {
        expect(got, `${id} is canonical-lifecycle → SECTION`).toEqual(section);
        expect(actionScopeClass(id)).toBe("lifecycle");
      } else {
        expect(got, `${id} is canonical-annotation → LINE`).toEqual(line);
        expect(actionScopeClass(id)).toBe("annotation");
      }
    }
  });

  it("the canonical ids are all real card ids (the vocabulary pin, at runtime too)", () => {
    for (const id of LIFECYCLE_ACTION_IDS) {
      expect(CARD_ACTION_ORDER as readonly string[]).toContain(id);
      expect(VIRGIL_ACTION_REGISTRY[id]).toBeTruthy();
    }
  });

  it("collectScopeOverride distinguishes 'no hook' from 'hook failed'", () => {
    const doc = PMNode.fromJSON(schema, DOC);
    expect(collectScopeOverride(doc, "paragraph", "p1", "annotation")).toEqual({
      status: "none",
    });
    installHook("paragraph", "collectAnnotationRange", () => null);
    expect(collectScopeOverride(doc, "paragraph", "p1", "annotation")).toEqual({
      status: "unresolved",
    });
  });
});

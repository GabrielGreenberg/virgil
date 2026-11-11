/**
 * The two acquires a gutter row's open leases its card's expansion through
 * (task 1571): the release undoes exactly what the acquire did, and a card
 * already expanded before the open is left expanded.
 */
import { describe, expect, it, vi } from "vitest";
import { createCardStore } from "@/links/_shared/anchored-card-store";
import { leaseCardExpansion, leaseErrorExpansion } from "../open-lease";

describe("leaseCardExpansion", () => {
  it("expands, and its release collapses", () => {
    const store = createCardStore();
    const ref = { kind: "note", id: "n1" } as const;
    const release = leaseCardExpansion(store, ref);
    expect(store.isExpanded(ref)).toBe(true);
    release?.();
    expect(store.isExpanded(ref)).toBe(false);
  });

  it("leaves a card the user had already expanded expanded", () => {
    const store = createCardStore();
    const ref = { kind: "note", id: "n1" } as const;
    store.expand(ref);
    const release = leaseCardExpansion(store, ref);
    release?.();
    expect(store.isExpanded(ref)).toBe(true);
  });
});

describe("leaseErrorExpansion", () => {
  function diag() {
    const expandedErrorIds = new Set<string>();
    return {
      expandedErrorIds,
      expandError: vi.fn((id: string) => void expandedErrorIds.add(id)),
      collapseError: vi.fn((id: string) => void expandedErrorIds.delete(id)),
    };
  }

  it("an error row's close collapses its error card", () => {
    const d = diag();
    const release = leaseErrorExpansion(d, "e1");
    expect(d.expandedErrorIds.has("e1")).toBe(true);
    release?.();
    expect(d.expandedErrorIds.has("e1")).toBe(false);
  });

  it("leaves an error card already expanded expanded", () => {
    const d = diag();
    d.expandedErrorIds.add("e1");
    expect(leaseErrorExpansion(d, "e1")).toBeUndefined();
    expect(d.expandError).not.toHaveBeenCalled();
  });
});

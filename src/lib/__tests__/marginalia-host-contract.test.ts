// @vitest-environment jsdom
//
// Task 2026-08-02-276 — the `[data-marginalia-host]` contract must live in ONE
// place. Before this pin the attribute string + editor→host resolution were
// triplicated: a bare JSX attr in EditorPane plus two byte-identical reader
// closures (`resolveHost` in useMarginaliaRegistry, `getSnapshot` in
// Marginalia). The registry measures each block's host-relative top against the
// host IT resolves and the renderer portals markers into the host IT resolves;
// if those two ever diverged every marker would paint at an offset, silently.
//
// THE TEETH
//   1. The selector is DERIVED from the attribute const — a rename of the attr
//      can't leave the selector pointing at the old name.
//   2. `resolveMarginaliaHost` climbs to the nearest `[data-marginalia-host]`
//      ancestor of `editor.view.dom`, and returns null when there is none, when
//      there's no view yet, or when the editor is null/undefined — the exact
//      contract both former closures hand-maintained.
import { describe, it, expect } from "vitest";
import type { Editor } from "@tiptap/react";
import {
  MARGINALIA_HOST_ATTR,
  MARGINALIA_HOST_SELECTOR,
  resolveMarginaliaHost,
} from "@/lib/marginalia";

// Minimal editor shape the resolver reads: `editor.view?.dom`.
function fakeEditor(dom: Element | null | undefined): Editor {
  return { view: dom === undefined ? undefined : { dom } } as unknown as Editor;
}

describe("marginalia host contract SSOT", () => {
  it("names the attribute once and derives the selector from it", () => {
    expect(MARGINALIA_HOST_ATTR).toBe("data-marginalia-host");
    expect(MARGINALIA_HOST_SELECTOR).toBe(`[${MARGINALIA_HOST_ATTR}]`);
  });

  it("resolves the nearest [data-marginalia-host] ancestor of editor.view.dom", () => {
    const host = document.createElement("div");
    host.setAttribute(MARGINALIA_HOST_ATTR, "");
    const middle = document.createElement("div");
    const pmDom = document.createElement("div");
    host.appendChild(middle);
    middle.appendChild(pmDom);

    expect(resolveMarginaliaHost(fakeEditor(pmDom))).toBe(host);
  });

  it("returns the host itself when the ProseMirror DOM carries the attr", () => {
    // `closest` includes the element itself — the producer attr could in
    // principle sit on the PM node; the resolver must still find it.
    const pmDom = document.createElement("div");
    pmDom.setAttribute(MARGINALIA_HOST_ATTR, "");
    expect(resolveMarginaliaHost(fakeEditor(pmDom))).toBe(pmDom);
  });

  it("returns null when no ancestor carries the attr", () => {
    const detached = document.createElement("div");
    const pmDom = document.createElement("div");
    detached.appendChild(pmDom);
    expect(resolveMarginaliaHost(fakeEditor(pmDom))).toBeNull();
  });

  it("returns null for a missing view, missing dom, or null/undefined editor", () => {
    expect(resolveMarginaliaHost(fakeEditor(undefined))).toBeNull();
    expect(resolveMarginaliaHost(fakeEditor(null))).toBeNull();
    expect(resolveMarginaliaHost(null)).toBeNull();
    expect(resolveMarginaliaHost(undefined)).toBeNull();
  });
});

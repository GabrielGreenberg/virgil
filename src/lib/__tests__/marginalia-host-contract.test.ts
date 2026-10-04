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
import * as fs from "node:fs";
import * as path from "node:path";
import type { Editor } from "@tiptap/react";
import {
  MARGINALIA_HOST_ATTR,
  MARGINALIA_HOST_SELECTOR,
  resolveMarginaliaHost,
  resolveMarginaliaHostFromDom,
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

// Task 2026-10-04-940 — the element-level door, and the census that keeps every
// reader on it. The viewport frame measured its pod edges by walking to
// `.editor-pane-pod` while every other reader climbed `[data-marginalia-host]`;
// the one producer put both on the same div, so the divergence was latent — but
// the frame's lane arithmetic assumes the pod IS the marker host.
describe("marginalia host: element door + no class-based pod lookup", () => {
  it("resolveMarginaliaHostFromDom climbs the same selector from an element", () => {
    const host = document.createElement("div");
    host.setAttribute(MARGINALIA_HOST_ATTR, "");
    const pmDom = document.createElement("div");
    host.appendChild(pmDom);
    expect(resolveMarginaliaHostFromDom(pmDom)).toBe(host);
    expect(resolveMarginaliaHostFromDom(pmDom)).toBe(
      resolveMarginaliaHost(fakeEditor(pmDom)),
    );
  });

  it("does NOT resolve a pod that carries only the class", () => {
    const pod = document.createElement("div");
    pod.className = "editor-pane-pod";
    const pmDom = document.createElement("div");
    pod.appendChild(pmDom);
    expect(resolveMarginaliaHostFromDom(pmDom)).toBeNull();
    expect(resolveMarginaliaHostFromDom(null)).toBeNull();
    expect(resolveMarginaliaHostFromDom(undefined)).toBeNull();
  });

  it("no source file finds the pod by `closest(\".editor-pane-pod\")`", () => {
    const root = path.resolve(__dirname, "../..");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          if (ent.name === "__tests__" || ent.name === "node_modules") continue;
          walk(p);
        } else if (/\.(ts|tsx)$/.test(ent.name)) {
          const src = fs.readFileSync(p, "utf8");
          if (/closest\(\s*["'`]\.editor-pane-pod["'`]\s*\)/.test(src)) {
            offenders.push(path.relative(root, p));
          }
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});

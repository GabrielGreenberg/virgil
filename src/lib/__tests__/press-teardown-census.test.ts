// Task 1444 — PRESS-TEARDOWN CENSUS: a held gesture's endings include the
// teardown of whatever armed it.
//
// The class: a press/drag arms `window` `mousemove`/`mouseup` and ends ONLY on
// its own events (release, threshold hand-off, missed release). Nothing ends
// it when the component — or plugin view, or editor — that armed it goes away
// mid-press, so the listeners outlive their owner: a press visual stuck on a
// detached element, a body cursor wedged, a later stray release opening a menu
// at (0,0) over a handle that no longer exists (the grab handle, task 1444),
// or a guide drag re-committing into a cancelled margin-edit session
// (`useMarginEdit`). Task 1095 named "unmount is a third ending" for
// FloatingPanel; this census makes it a rule for every site.
//
// Rule: every production file under `src/` or `library/` that arms a WINDOW
// `mouseup` listener must either
//   (a) adopt `useUnmountEnding` (src/lib/pane-resize/use-unmount-ending.ts) —
//       the React door: the gesture parks its cancel there, the hook's unmount
//       cleanup runs it; or
//   (b) be listed in `NON_REACT_TEARDOWN` below, naming the token that IS its
//       teardown ending — and that token must be present in the file.
// A new window-mouseup gesture that does neither FAILS here.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { strip, walkFiles } from "./_source-scan";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");

/** Sites whose teardown ending is not a React unmount — each names the token
 *  that implements it. */
const NON_REACT_TEARDOWN: Record<string, { token: RegExp; why: string }> = {
  "src/lib/tiptap/inline-atom-grab.ts": {
    token: /destroy\(\)\s*\{/,
    why: "ProseMirror plugin: the view's destroy() disposes its ONE ViewLifetime (task 644)",
  },
  "src/components/drop-mode/controller.ts": {
    token: /cancelDropSession\(\)/,
    why: "module-level drop session: the owning editor's unregister cancels a live session (cancel-on-unmount)",
  },
  "src/text-objects/LiftHost.tsx": {
    token: /onDropSessionEnd\(/,
    why: "post-threshold lift subscribes to its drop session's end, which a pane teardown/Escape ends",
  },
  "src/components/FloatingPanel.tsx": {
    token: /kind: "detach"/,
    why: "task 1095: the float's unmount is a named {kind:'detach'} ending of its move/resize gesture (task 1617 split it from the Escape {kind:'cancel'}, which restores)",
  },
  "src/lib/pane-resize/pointer-invariants.ts": {
    token: /return disarm;/,
    why: "watchHeldPress is a primitive: it returns a disposer its caller runs from effect cleanup",
  },
};

const WINDOW_MOUSEUP = /\bwindow\.addEventListener\(\s*["']mouseup["']/;
const ADOPTS_HOOK = /\buseUnmountEnding\(\)/;

function productionFiles(): string[] {
  const out: string[] = [];
  for (const silo of ["src", "library"]) {
    for (const abs of walkFiles(path.join(REPO, silo), {
      skipDirs: (n) => n === "__tests__" || n === "node_modules" || n.startsWith("."),
    })) {
      if (!/\.(ts|tsx)$/.test(abs) || /\.test\.tsx?$/.test(abs)) continue;
      out.push(abs);
    }
  }
  return out;
}

describe("press-teardown CENSUS (task 1444)", () => {
  const sites = productionFiles()
    .map((abs) => ({ rel: path.relative(REPO, abs), code: strip(readFileSync(abs, "utf8"), true) }))
    .filter((f) => WINDOW_MOUSEUP.test(f.code));

  it("finds the population (non-vacuous)", () => {
    const rels = sites.map((s) => s.rel);
    expect(rels).toContain("src/text-objects/TextObjectGrabHandle.tsx");
    expect(rels).toContain("src/hooks/useMarginEdit.ts");
  });

  it("every window-mouseup gesture names a teardown ending", () => {
    const missing = sites
      .filter((s) => !ADOPTS_HOOK.test(s.code))
      .filter((s) => {
        const entry = NON_REACT_TEARDOWN[s.rel];
        return !entry || !entry.token.test(s.code);
      })
      .map((s) => s.rel);
    expect(
      missing,
      "these files arm a window mouseup with no unmount/destroy ending — adopt " +
        "useUnmountEnding (src/lib/pane-resize/use-unmount-ending.ts), or list the " +
        "file in NON_REACT_TEARDOWN with the token that implements its teardown",
    ).toEqual([]);
  });

  it("the exemption table carries no dead rows", () => {
    const live = new Set(sites.map((s) => s.rel));
    const dead = Object.keys(NON_REACT_TEARDOWN).filter((rel) => !live.has(rel));
    expect(dead, "rows for files that no longer arm a window mouseup").toEqual([]);
  });
});

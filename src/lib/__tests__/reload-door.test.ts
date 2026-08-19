/**
 * Task 391 — the reload door, and the CENSUS that gives it teeth.
 *
 * The door was never the part that could misbehave. What shipped the 2026-08-19
 * data loss was a call site that never asked: `applyUpdate()` posted
 * SKIP_WAITING and `onControllerChange` called `window.location.reload()` with
 * zero consultation of the documents whose only copy it was discarding. So the
 * behavioural legs pin the door's ORDER and its honesty, and the census pins
 * that every reload in the app enters it.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { prepareForReload, reloadNow } from "@/lib/reload-door";
import {
  clearUnsavedWork,
  noteSaveBlocked,
  noteSaveLanded,
  noteUnsavedEdit,
} from "@/lib/unsaved-work";
import {
  __resetTickersForTests,
  createMirrorTicker,
  registerMirrorTicker,
} from "@/lib/emergency-mirror";
import {
  __resetForTests as resetFlushers,
  registerPendingFlusher,
} from "@/lib/multi-window/pending-saves";
import { codeOnly, commentsStripped } from "@/lib/__tests__/_source-scan";

const SRC = join(__dirname, "../..");

beforeEach(() => {
  clearUnsavedWork();
  __resetTickersForTests();
  resetFlushers();
});

describe("prepareForReload", () => {
  it("reports nothing to lose when the flush LANDS the work", async () => {
    noteUnsavedEdit("A");
    registerPendingFlusher("A", async () => {
      noteSaveLanded("A");
    });
    const r = await prepareForReload();
    expect(r.unlanded).toEqual([]);
  });

  it("re-reads the CHANNEL after the flush — a refused write resolves normally", async () => {
    // This is the incident: every unload flush "succeeded" as a refusal.
    noteUnsavedEdit("A", Date.now() - 70 * 60_000);
    registerPendingFlusher("A", async () => {
      noteSaveBlocked("A", "conflict");
    });
    const r = await prepareForReload();
    expect(r.unlanded.map((d) => d.docId)).toEqual(["A"]);
    expect(r.unlanded[0].reason).toBe("conflict");
    expect(r.unlanded[0].ageMs).toBeGreaterThan(60 * 60_000);
  });

  it("FORCE-mirrors what could not land, including work too young to have aged in", async () => {
    const writes: unknown[] = [];
    noteUnsavedEdit("A"); // young, unblocked — not armed by aging
    registerPendingFlusher("A", async () => {});
    registerMirrorTicker(
      "A",
      createMirrorTicker({
        docId: "A",
        getModel: () => ({ type: "doc" }),
        windowId: "w",
        write: async (e) => {
          writes.push(e);
        },
      }),
    );
    const r = await prepareForReload();
    expect(r.unlanded).toHaveLength(1);
    expect(r.mirrored).toBe(true);
    expect(writes).toHaveLength(1);
  });

  it("one doc's failed flush does not strand the others", async () => {
    noteUnsavedEdit("A");
    noteUnsavedEdit("B");
    registerPendingFlusher("A", async () => {
      throw new Error("permission lost");
    });
    registerPendingFlusher("B", async () => {
      noteSaveLanded("B");
    });
    const r = await prepareForReload();
    expect(r.unlanded.map((d) => d.docId)).toEqual(["A"]);
  });

  it("reloadNow PREPARES before it reloads — never the other way round", async () => {
    const order: string[] = [];
    noteUnsavedEdit("A");
    registerPendingFlusher("A", async () => {
      order.push("flush");
    });
    registerMirrorTicker(
      "A",
      createMirrorTicker({
        docId: "A",
        getModel: () => ({ type: "doc" }),
        windowId: "w",
        write: async () => {
          order.push("mirror");
        },
      }),
    );
    await reloadNow(() => order.push("reload"));
    expect(order).toEqual(["flush", "mirror", "reload"]);
  });
});

describe("census — every reload enters the door", () => {
  it("no production file calls location.reload() outside the reload door", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of require("node:fs").readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === "__tests__" || e.name === "node_modules") continue;
          walk(p);
        } else if (/\.tsx?$/.test(e.name)) {
          const code = codeOnly(readFileSync(p, "utf8"));
          if (/location\s*\.\s*reload\s*\(/.test(code)) hits.push(p.slice(SRC.length + 1));
        }
      }
    };
    walk(SRC);
    // ServiceWorkerRegistration passes its reload INTO `reloadNow`, so it is the
    // one legitimate speller — and the next leg checks that is what it does.
    expect(hits.sort()).toEqual(["components/ServiceWorkerRegistration.tsx"]);
  });

  it("the SW registration's reload is the ARGUMENT to reloadNow, not a bare call", () => {
    // Literals are KEPT here: the needle IS a quoted module specifier, and
    // `codeOnly` blanks string bodies (which would make this unfalsifiable).
    const code = commentsStripped(
      readFileSync(join(SRC, "components/ServiceWorkerRegistration.tsx"), "utf8"),
    );
    expect(code).toContain("reloadNow(() => window.location.reload())");
    expect(code).toContain('from "@/lib/reload-door"');
  });

  it("the update banner never calls applyUpdate without asking prepareForReload first", () => {
    const code = codeOnly(readFileSync(join(SRC, "components/SoftwareUpdateBanner.tsx"), "utf8"));
    expect(code).toContain("prepareForReload()");
    // Both applyUpdate() calls sit AFTER the readiness check in the handler.
    const gate = code.indexOf("prepareForReload()");
    const firstApply = code.indexOf("applyUpdate()");
    expect(gate).toBeGreaterThan(-1);
    expect(firstApply).toBeGreaterThan(gate);
  });

  it("no other production file calls applyUpdate — the banner is the only door", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of require("node:fs").readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === "__tests__" || e.name === "node_modules") continue;
          walk(p);
        } else if (/\.tsx?$/.test(e.name)) {
          const code = codeOnly(readFileSync(p, "utf8"));
          if (/\bapplyUpdate\s*\(/.test(code)) hits.push(p.slice(SRC.length + 1));
        }
      }
    };
    walk(SRC);
    expect(hits.sort()).toEqual([
      "components/SoftwareUpdateBanner.tsx",
      "hooks/useUpdateAvailable.ts", // its own declaration
    ]);
  });
});

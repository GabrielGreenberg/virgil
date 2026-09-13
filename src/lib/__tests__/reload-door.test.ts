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
  __registeredCountForTests,
  __resetForTests as resetFlushers,
  flushPendingForDoc,
  registerPendingFlusher,
  unregisterPendingFlusher,
} from "@/lib/multi-window/pending-saves";
import {
  codeOnly,
  commentsStripped,
  trackedFiles,
  REPO_ROOT,
} from "@/lib/__tests__/_source-scan";

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

  // ── Task 559: the door flushes EVERY coalescing writer, not one per doc ──
  //
  // A document holds ~20 debounces (the bundle autosave, one per card sidecar,
  // the view-state coalescer). Pre-559 the registry was ONE slot per docId and
  // only the bundle took it, so a card body typed in the 300 ms before a
  // reload was outside step 1 — and, because the channel and the mirror are
  // model-scoped, outside every other net at once. The registry is a
  // multi-set now; these legs pin that the door AWAITS every member before it
  // reads the channel and reports.

  it("awaits EVERY registered writer of a document before it reports — the sidecar beside the bundle", async () => {
    const order: string[] = [];
    noteUnsavedEdit("A");
    // The sidecar registers FIRST, deliberately: under the retired one-slot
    // registry the bundle's registration below REPLACED it, so the sidecar
    // flusher never ran at all and this leg fails for the reason it names.
    registerPendingFlusher("A", async () => {
      await new Promise((r) => setTimeout(r, 5));
      order.push("sidecar-landed");
    });
    registerPendingFlusher("A", async () => {
      noteSaveLanded("A");
      order.push("bundle-landed");
    });
    const r = await prepareForReload();
    order.push("report");
    expect(order).toEqual(
      expect.arrayContaining(["sidecar-landed", "bundle-landed"]),
    );
    // The report is computed AFTER both writes resolved — never before.
    expect(order.indexOf("report")).toBe(order.length - 1);
    expect(r.unlanded).toEqual([]);
  });

  it("CONTROL — a sidecar-only flush on a doc with no model work reports nothing and takes no mirror pass", async () => {
    // The channel and the mirror stay model-scoped: a sidecar write is either
    // landed by step 1 or logged by its own persist; it must NOT make the door
    // chatty (every 300 ms card edit reading as blocked work).
    let flushed = 0;
    const writes: unknown[] = [];
    registerPendingFlusher("A", async () => {
      flushed++;
    });
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
    expect(flushed).toBe(1);
    expect(r).toEqual({ unlanded: [], mirrored: true });
    expect(writes).toHaveLength(0);
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

describe("the pending-flusher registry is a per-document MULTI-SET (task 559)", () => {
  it("fires every writer registered under a doc, and only that doc's", async () => {
    const fired: string[] = [];
    registerPendingFlusher("A", async () => {
      fired.push("A:bundle");
    });
    registerPendingFlusher("A", async () => {
      fired.push("A:notes");
    });
    registerPendingFlusher("B", async () => {
      fired.push("B:bundle");
    });
    await flushPendingForDoc("A");
    expect(fired.sort()).toEqual(["A:bundle", "A:notes"]);
    expect(__registeredCountForTests("A")).toBe(2);
  });

  it("unregister is token-matched — a stale cleanup evicts neither a sibling nor a newer registration", async () => {
    const fired: string[] = [];
    const bundle = async () => {
      fired.push("bundle");
    };
    const notes = async () => {
      fired.push("notes");
    };
    registerPendingFlusher("A", bundle);
    registerPendingFlusher("A", notes);
    // A foreign function (a stale cleanup's closure) removes nothing.
    unregisterPendingFlusher("A", async () => {});
    expect(__registeredCountForTests("A")).toBe(2);
    unregisterPendingFlusher("A", bundle);
    expect(__registeredCountForTests("A")).toBe(1);
    await flushPendingForDoc("A");
    expect(fired).toEqual(["notes"]);
    unregisterPendingFlusher("A", notes);
    expect(__registeredCountForTests("A")).toBe(0);
    // Flushing an empty doc is a no-op, not a throw.
    await expect(flushPendingForDoc("A")).resolves.toBeUndefined();
  });

  it("per-doc flush PROPAGATES a rejection but still starts every sibling", async () => {
    const fired: string[] = [];
    registerPendingFlusher("A", async () => {
      throw new Error("permission lost");
    });
    registerPendingFlusher("A", async () => {
      fired.push("notes");
    });
    await expect(flushPendingForDoc("A")).rejects.toThrow("permission lost");
    expect(fired).toEqual(["notes"]);
  });
});

/**
 * The CENSUS — the leg with teeth. The registry was never the part that
 * could misbehave; a coalescing writer that never registers is, and it
 * type-checks, flushes on its own edges and looks correct on screen. So the
 * population is DERIVED, never hand-listed: a production file that spells a
 * document write door AND a `setTimeout(` is a writer holding a debounce, and
 * every such file must register its settle door with the ONE registry —
 * exact set in both directions, so a fourth coalescing writer is covered by
 * existing, and a retired one cannot leave a stale registration behind.
 */
describe("census — every coalescing writer registers with the ONE registry", () => {
  const WRITE_DOOR =
    /\b(?:writeSidecar|writeDocBundle|mutateSidecar|mutateBib|writeTex)\s*\(/;
  const DEBOUNCE = /\bsetTimeout\s*\(/;
  const REGISTER = /\bregisterPendingFlusher\s*\(/;
  const REGISTRY_FILE = "src/lib/multi-window/pending-saves.ts";

  const production = () =>
    [...trackedFiles("src", /\.tsx?$/), ...trackedFiles("library", /\.tsx?$/)]
      .filter((p) => !/\/__tests__\//.test(p))
      .map((p) => ({
        rel: p.slice(REPO_ROOT.length + 1),
        code: codeOnly(readFileSync(p, "utf8")),
      }));

  const coalescingWriters = () =>
    production()
      .filter(({ code }) => WRITE_DOOR.test(code) && DEBOUNCE.test(code))
      .map(({ rel }) => rel)
      .sort();

  const registrants = () =>
    production()
      .filter(({ rel, code }) => rel !== REGISTRY_FILE && REGISTER.test(code))
      .map(({ rel }) => rel)
      .sort();

  it("discovers a real population — the bundle autosave and both sidecar coalescers", () => {
    // A discovery that found nothing would make the exact-set leg pass
    // vacuously. The three named here are the ones this task found; a fourth
    // joins by writing behind a timer, with no edit to this list.
    const writers = coalescingWriters();
    expect(writers).toEqual(
      expect.arrayContaining([
        "src/hooks/useDocument.ts",
        "src/hooks/usePersistentState.ts",
        "src/hooks/useEditorUIState.ts",
      ]),
    );
  });

  it("the coalescing writers and the registry's registrants are the SAME set", () => {
    expect(registrants()).toEqual(coalescingWriters());
  });

  it("flushAllPendingDocs has exactly ONE production caller — the reload door — and no second flush registry exists", () => {
    const callers = production()
      .filter(
        ({ rel, code }) =>
          rel !== REGISTRY_FILE && /\bflushAllPendingDocs\s*\(/.test(code),
      )
      .map(({ rel }) => rel);
    expect(callers).toEqual(["src/lib/reload-door.ts"]);
    // The registry's own declaration is the only place a flusher map lives.
    const declarers = production()
      .filter(({ code }) => /export function registerPendingFlusher\b/.test(code))
      .map(({ rel }) => rel);
    expect(declarers).toEqual([REGISTRY_FILE]);
  });

  it("can-see canary: a writer behind a timer that never registers is what the needles indict", () => {
    const planted = codeOnly(`
      const t = setTimeout(() => { void writeSidecar(h, "notes.json", s); }, 300);
    `);
    expect(WRITE_DOOR.test(planted) && DEBOUNCE.test(planted)).toBe(true);
    expect(REGISTER.test(planted)).toBe(false);
  });
});

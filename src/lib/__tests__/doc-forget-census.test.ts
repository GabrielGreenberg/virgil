/**
 * DOC-FORGET CENSUS (task 1465) — every module-level map that could hold a
 * paper's state is either FORGOTTEN by `purgeDoc` (its module registers with
 * `registerDocForget`) or EXCLUDED here with the reason it may outlive a reset.
 *
 * Why a census: `purgeDoc`'s in-memory half used to be a hand-written list,
 * and task 1277's compile record (log, diagnostics, PDF bytes) was added
 * outside it — so "Reset example", which re-seeds under the same fixed id,
 * reopened the pristine paper showing the discarded version's PDF as current.
 * Nothing ASKED whether the new store should survive. This guard asks, for
 * every store, at the moment it is written.
 *
 * Population: a top-level `const|let X = new Map<K, …>()` / `new Set<string>()`
 * in production `src/` code, EMPTY at construction (a map built from constant
 * data is a lookup table, not state), whose key is `string`, `DocId` or a
 * `…DocKey` — the shapes a doc id can be stored under. A non-doc string key
 * (a font, a word, a pref) is excluded with that reason; the list is the
 * record that someone looked.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { REPO_ROOT, walkFiles } from "./_source-scan";

/** `file::name` → forgotten by its module's `registerDocForget`. */
const FORGOTTEN: readonly string[] = [
  "src/hooks/useAiRequestCardMigration.ts::migratedDocs",
  "src/lib/compile/compile-progress.ts::byDoc",
  "src/lib/compile/compile-record.ts::byDoc",
  "src/lib/cowork-pen.ts::byDoc",
  "src/lib/cowork-pen.ts::lastReleaseByDoc",
  "src/lib/disk-ledger.ts::inFlight",
  "src/lib/disk-ledger.ts::ledger",
  "src/lib/doc-load-failure.ts::failures",
  "src/lib/figures/doc-graphics-path.ts::entries",
  "src/lib/local-packages.ts::manifestByDoc",
  "src/lib/mirror-recovery.ts::offers",
  "src/lib/preservation-notice.ts::byDoc",
  "src/lib/sidecar-refusal.ts::byDoc",
  "src/lib/storage-dev.ts::sidecarCache",
  "src/lib/storage-fsa.ts::delimiterCacheByDoc",
  "src/lib/storage-fsa.ts::lastSnapshotAtByDoc",
  "src/lib/storage-fsa.ts::sidecarCache",
  "src/lib/sync-conflict-notice.ts::byDoc",
  "src/lib/sync-conflict-notice.ts::dismissed",
  "src/lib/write-preservation.ts::byDoc",
  "src/links/pending-preview-store.ts::dirs",
];

const OWN_LIFETIME = "registered and removed by its subscriber/mount — the owner's lifetime, not the identity's";
const NOT_DOC = "not keyed by a document id";

/** `file::name` → why it may outlive a reset/remove of the doc. */
const EXCLUDED: Readonly<Record<string, string>> = {
  // Monotonic by design (a salt / epoch that never repeats is harmless to a
  // fresh identity under the same id — and the epoch IS the reset's fence).
  "src/lib/compile/compile-record.ts::runCounter": "monotonic diagnostics salt for the session",
  "src/lib/compile/compile-record.ts::epochByDoc": "the identity epoch the forget bumps — must survive it",
  "src/lib/doc-forget.ts::forgets": "the registry itself (keyed by store name)",
  // Owned by a mount / subscriber / in-flight operation.
  "src/lib/local-packages.ts::listenersByDoc": OWN_LIFETIME,
  "src/links/pending-preview-store.ts::listeners": OWN_LIFETIME,
  "src/lib/mirror-recovery.ts::actions": OWN_LIFETIME,
  "src/lib/ai-request-events.ts::listeners": OWN_LIFETIME,
  "src/lib/save-request.ts::doors": OWN_LIFETIME,
  "src/lib/pane-click-origin.ts::hosts": OWN_LIFETIME,
  "src/lib/emergency-mirror.ts::tickers": OWN_LIFETIME,
  "src/lib/multi-window/pending-saves.ts::flushers": OWN_LIFETIME,
  "src/lib/tiptap/archive-holdings.ts::REGISTRY": "inner map keyed by the publishing editor — published and withdrawn by it",
  "src/links/_shared/anchored-card-store.ts::_stores": "ref-counted by pane leases (task 765); the last lease drops it",
  "src/links/_shared/anchored-card-store.ts::_leases": "ref-counted by pane leases (task 765)",
  "src/lib/collab-session.ts::live": "keyed by session, refcounted by mounts",
  "src/lib/write-queue.ts::queues": "in-flight write chains — purgeDoc's caller drains them first; they self-retire",
  "src/lib/local-sidecar.ts::chains": "in-flight write chains — they self-retire",
  "src/lib/multi-window/doc-ownership.ts::claiming": "shadows a live Web Lock — released by the lock's own lifetime",
  "src/lib/multi-window/doc-ownership.ts::draining": "shadows a live Web Lock — released by the lock's own lifetime",
  "src/lib/multi-window/doc-ownership.ts::exclusiveSections": "shadows a live Web Lock — released by the lock's own lifetime",
  "src/lib/multi-window/doc-ownership.ts::heldReleasers": "shadows a live Web Lock — released by the lock's own lifetime",
  "src/lib/multi-window/doc-ownership.ts::releasing": "shadows a live Web Lock — released by the lock's own lifetime",
  "src/lib/unsaved-work.ts::byDoc": "the 'you have unsaved work' alarm — the caller closes/drains the tab first",
  // Self-validating caches: the key carries a content fingerprint.
  "src/hooks/useResolvedFigureUrl.ts::rasterCache": "entries carry the source fingerprint and are confirmed before use",
  "src/hooks/useResolvedFigureUrl.ts::urlCache": "keyed by the content cacheKey; refcounted by consumers",
  "src/lib/bib-parser.ts::PARSE_CACHE": "keyed by the .bib TEXT itself",
  // Not per-doc at all.
  "src/components/editor-layout/omni-pin-store.ts::_pins": "keyed by card wrapper id; consumed by the cascade",
  "src/cards/legacy-token-crosswalk.ts::warnedUnknownTokens": NOT_DOC,
  "src/lib/ai-requests-store.ts::warnedStatuses": NOT_DOC,
  "src/lib/bib-parser.ts::WARNED_KEYS": NOT_DOC,
  "src/lib/feature-flags.ts::warnedEdges": NOT_DOC,
  "src/lib/keystroke-latency-probe.ts::work": NOT_DOC,
  "src/lib/latex-parser.ts::seenTitleFields": NOT_DOC,
  "src/lib/latex-rules.ts::citeCmds": NOT_DOC,
  "src/lib/layout-gesture-probe.ts::sites": NOT_DOC,
  "src/lib/pane-resize/layout-gesture-bus.ts::activeGestures": NOT_DOC,
  "src/lib/panel-theme.ts::cardPaletteCache": NOT_DOC,
  "src/lib/panel-theme.ts::markerPaletteCache": NOT_DOC,
  "src/lib/panel-theme.ts::themeCache": NOT_DOC,
  "src/lib/scroll-reposition-probe.ts::states": NOT_DOC,
  "src/lib/spell/spell-client.ts::verdicts": NOT_DOC,
  "src/lib/text-metrics.ts::FONT_METRICS_CACHE": NOT_DOC,
  "src/lib/text-metrics.ts::TEXT_WIDTH_CACHE": NOT_DOC,
  "src/text-objects/block-frame.ts::warnedMarginTokens": NOT_DOC,
};

const DECL = /^(?:export )?(?:const|let) (\w+)(?:\s*:[^=\n]+)?\s*=\s*new (Map|Set)\s*</gm;

/** The census population of one source text: `name`s of empty, string-keyed
 *  module-level maps/sets. Exported shape for the fixture leg below. */
function perDocCandidates(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(DECL)) {
    // Balance the generic, ignoring the `>` of an arrow type (`() => void`).
    let i = m.index! + m[0].length;
    let depth = 1;
    while (depth > 0 && i < src.length) {
      const c = src[i];
      if (c === "<") depth++;
      else if (c === ">" && src[i - 1] !== "=") depth--;
      i++;
    }
    const generic = src.slice(m.index! + m[0].length, i - 1);
    if (!/^\s*\(\s*\)/.test(src.slice(i))) continue; // built from data: a table
    const key = generic.split(",")[0].trim();
    if (!(key === "string" || key === "DocId" || /DocKey$/.test(key))) continue;
    if (m[2] === "Set" && key !== "string") continue;
    out.push(m[1]);
  }
  return out;
}

function census(): { found: Set<string>; registering: Set<string> } {
  const found = new Set<string>();
  const registering = new Set<string>();
  for (const abs of walkFiles(path.join(REPO_ROOT, "src"), { skipDirs: ["__tests__"] })) {
    if (!/\.tsx?$/.test(abs) || /\.test\.tsx?$/.test(abs)) continue;
    const rel = path.relative(REPO_ROOT, abs);
    const src = readFileSync(abs, "utf8");
    for (const name of perDocCandidates(src)) found.add(`${rel}::${name}`);
    if (/\bregisterDocForget\(/.test(src)) registering.add(rel);
  }
  return { found, registering };
}

describe("doc-forget CENSUS (task 1465)", () => {
  const { found, registering } = census();

  it("every module-level per-doc store is forgotten by purgeDoc or excluded with a reason", () => {
    const unclassified = [...found].filter((k) => !FORGOTTEN.includes(k) && !(k in EXCLUDED));
    expect(
      unclassified,
      "UNCLASSIFIED per-doc store(s). Either register a forget beside the map " +
        '(`registerDocForget("<name>", (docId) => …)` from src/lib/doc-forget.ts) and add it to ' +
        "FORGOTTEN, or add it to EXCLUDED with the reason it may outlive a reset/delete of the paper.",
    ).toEqual([]);
  });

  it("every FORGOTTEN store's module actually registers a forget", () => {
    const silent = FORGOTTEN.filter((k) => !registering.has(k.split("::")[0]));
    expect(silent, "listed as forgotten but the module never calls registerDocForget").toEqual([]);
  });

  it("no stale census entries", () => {
    const stale = [...FORGOTTEN, ...Object.keys(EXCLUDED)].filter((k) => !found.has(k));
    expect(stale, "census entries naming a store that no longer exists — remove them").toEqual([]);
  });

  it("the scanner sees a fixture store that registers nothing", () => {
    const fixture = [
      "const byDoc = new Map<string, number>();",
      "const listenersByDoc = new Map<string, Set<() => void>>();",
      "const TABLE = new Map<string, number>([['a', 1]]);",
      "const byEl = new Map<Element, number>();",
      "const seen = new Set<string>();",
    ].join("\n");
    expect(perDocCandidates(fixture)).toEqual(["byDoc", "listenersByDoc", "seen"]);
  });
});

describe("purgeDoc forgets the in-memory per-doc stores (task 1465)", () => {
  beforeEach(async () => {
    const rec = await import("@/lib/compile/compile-record");
    const prog = await import("@/lib/compile/compile-progress");
    rec.__resetAllCompileRecords();
    prog.__resetAllCompileProgress();
  });

  it("a reset drops the compile record (PDF included) and progress; a run in flight cannot publish into the new identity", async () => {
    const { forgetDocInMemory } = await import("@/lib/doc-forget");
    const rec = await import("@/lib/compile/compile-record");
    const prog = await import("@/lib/compile/compile-progress");
    const id = "example-doc";

    rec.recordCompileResult(id, { log: "L", status: 0, errors: [], pdf: new Uint8Array([1]) });
    prog.beginCompile(id);
    prog.finishCompile(id, "ok");
    expect(rec.getCompileRecord(id).pdf).not.toBeNull();

    // A run in flight across the reset.
    expect(rec.markCompileStarted(id)).toBe(true);
    const epoch = rec.compileEpoch(id);

    forgetDocInMemory(id, "reset");
    expect(rec.getCompileRecord(id).pdf).toBeNull();
    expect(rec.getCompileRecord(id).pdfGeneration).toBe(0);
    expect(prog.getCompileProgress(id)).toBe(prog.IDLE_PROGRESS);
    // The engine is still busy: the re-entry guard holds.
    expect(rec.isCompileRunning(id)).toBe(true);

    // The stale run's result is dropped; its end reports itself stale.
    rec.recordCompileResult(id, { log: "old", status: 0, errors: [], pdf: new Uint8Array([2]) }, epoch);
    expect(rec.getCompileRecord(id).pdf).toBeNull();
    expect(rec.markCompileEnded(id, epoch)).toBe(false);
    expect(rec.isCompileRunning(id)).toBe(false);

    // A fresh run publishes normally.
    expect(rec.markCompileStarted(id)).toBe(true);
    const fresh = rec.compileEpoch(id);
    rec.recordCompileResult(id, { log: "new", status: 0, errors: [], pdf: new Uint8Array([3]) }, fresh);
    expect(rec.getCompileRecord(id).pdf).toEqual(new Uint8Array([3]));
    expect(rec.markCompileEnded(id, fresh)).toBe(true);
  });

  it("forgets notices, the preservation acknowledgement and the pending-preview toggle", async () => {
    const { forgetDocInMemory } = await import("@/lib/doc-forget");
    const pres = await import("@/lib/preservation-notice");
    const preview = await import("@/links/pending-preview-store");
    const id = "example-doc";

    pres.recordPreservationRefusal(id, {
      source: "write",
      region: "body",
      before: 100,
      after: 10,
      lost: 90,
      allowed: 5,
    });
    pres.acknowledgePreservationNotice(id);
    preview.setPreviewDir(id, "card-1", "original");
    expect(pres.isPreservationAcknowledged(id)).toBe(true);

    forgetDocInMemory(id, "reset");
    expect(pres.getPreservationNotice(id)).toBeNull();
    expect(pres.isPreservationAcknowledged(id)).toBe(false);
    expect(preview.getPreviewDir(id, "card-1")).toBe("suggested");
  });
});

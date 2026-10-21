/**
 * Task 1210 — the Library read door's caller census.
 *
 * Task 1115 split the door (`library/lib/library-storage.ts`) into "missing"
 * (`undefined`) and "failed" (REJECTS). It fixed the caller that was reported
 * (PdfView); six others had been written for "undefined on any failure" and a
 * real fault took a path nobody wrote — a BibTeX panel stuck on "Loading…", an
 * unhandled rejection every 6 s from the unsorted polls, a whole libraries
 * reload aborted by one source-.bib check, "main.tex is empty" for "couldn't
 * read".
 *
 * This census follows every call of a door reader to where its rejection ends
 * (engine: `_read-door-census.ts`). A rejection must be HANDLED (a `try`, a
 * `.catch`, a `.then(ok, fail)`) or PROPAGATE out of a function this ledger
 * names — whose own callers are then traced the same way. A floating promise
 * or an unledgered propagator fails CI, so the next contract change at the
 * door cannot strand a caller silently.
 */
import { describe, expect, it } from "vitest";
import { walkFiles } from "../../../src/lib/__tests__/_source-scan";
import { DOOR, libraryProductionFiles, scanReadDoorCallers } from "./_read-door-census";

/** Functions that deliberately let a read fault reject to their callers. Every
 *  caller of each is traced in turn. (Door functions in `library-storage.ts`
 *  propagate by contract and need no row.) */
const PROPAGATORS: Record<string, string> = {
  "library/lib/bib-entry-full.ts::getFullLibraryBibEntry":
    "fetch-on-demand of one master.bib entry; the detail pane settles a failure as 'no full entry'",
  "library/lib/bib-index.ts::readBibIndexStamp": "useMasterBib's reload holds it in a try → its error state",
  "library/lib/bib-index.ts::readBibIndex": "useMasterBib's reload holds it in a try → its error state",
  "library/lib/catalog.ts::readCatalogVersion": "the catalog store / libraries poll catch per tick",
  "library/lib/catalog.ts::readCatalog": "the catalog store keeps its last-good snapshot on a failed read",
  "library/lib/queue-state-store.ts::scanQueue": "refresh catches; subscribers keep the last-good snapshot",
  "library/lib/queue.ts::findQueuedRequest": "the cancel half's reader; a cancel is a queue write (below)",
  "library/lib/skill-sync.ts::syncSkillBundle": "a best-effort sync whose caller logs and continues",
  "library/hooks/useDiskLibraries.ts::loadFromDisk": "flush and reload each hold it in a try",
  "library/hooks/useDiskLibraries.ts::migrateFromLocalStorage":
    "reload catches it and re-arms the one-shot, so the manifests on disk still publish",
};

/** Queue WRITERS (read-modify-write). They always rejected on a failed write,
 *  so their callers were already written for a rejection — the read inside
 *  adds no new failure mode, and their callers are not traced. */
const QUEUE_WRITE = "a queue write: it always rejected on a failed write, so callers already handle a rejection";
const TERMINALS: Record<string, string> = {
  "library/lib/queue.ts::writeQueueEntry": QUEUE_WRITE,
  "library/lib/queue.ts::retireDone": QUEUE_WRITE,
  "library/lib/queue.ts::migrateLegacyOccupant": QUEUE_WRITE,
  "library/lib/queue.ts::addPendingReview": QUEUE_WRITE,
  "library/lib/queue.ts::removePendingReview": QUEUE_WRITE,
  "library/lib/bib-edit.ts::cancelIndex": QUEUE_WRITE,
  "library/lib/bib-edit.ts::cancelPaperReview": QUEUE_WRITE,
  "library/lib/bib-edit.ts::cancelImportBib": QUEUE_WRITE,
  "library/lib/bib-edit.ts::cancelBibReview": QUEUE_WRITE,
  "library/lib/bib-edit.ts::cancelDeepIndex": QUEUE_WRITE,
  "library/lib/bib-edit.ts::queueDeepIndex": QUEUE_WRITE,
};

const scanLive = () =>
  scanReadDoorCallers({
    files: libraryProductionFiles((d) => walkFiles(d)),
    propagators: PROPAGATORS,
    terminals: TERMINALS,
  });

/** A one-file fixture that imports the door. */
const fixture = (body: string, extra: Record<string, string> = {}) => ({
  [DOOR]: "export async function readTextFile() {}\nexport async function listDir() {}\nexport async function fileExists() {}\nexport async function readJsonFile() {}\nexport async function readFile() {}\n",
  "library/hooks/useCanary.ts": `import { readTextFile, listDir, fileExists } from "@library/lib/library-storage";\n${body}`,
  ...extra,
});

const scanFixture = (body: string, propagators: Record<string, string> = {}) =>
  scanReadDoorCallers({ files: fixture(body), propagators, terminals: {} }).violations;

describe("Library read-door caller census (task 1210)", () => {
  it("every rejection a door read can raise is handled or ledgered", () => {
    expect(scanLive().violations).toEqual([]);
  });

  it("the census actually sees the callers (not vacuous)", () => {
    const { hits, traced } = scanLive();
    expect(hits.length).toBeGreaterThan(30);
    const files = new Set(hits.map((h) => h.file));
    for (const f of [
      "library/components/PaperFileBody.tsx",
      "library/components/PaperRender.tsx",
      "library/hooks/useUnsortedBibEntries.ts",
      "library/hooks/useUnsortedPdfs.ts",
      "library/hooks/useSetupStatus.ts",
      "library/hooks/useDiskLibraries.ts",
      "library/components/LibraryView.tsx",
    ]) {
      expect(files, f).toContain(f);
    }
    expect(traced).toContain("library/lib/bib-entry-full.ts::getFullLibraryBibEntry");
  });

  it("canary: a bare `void readTextFile(…)` is FLOATING", () => {
    expect(scanFixture(`export function f(h) { void readTextFile(h, "x"); }`)).toEqual([
      expect.stringContaining("FLOATING"),
    ]);
  });

  it("canary: a one-argument `.then` (the PaperFileBody shape) is FLOATING", () => {
    expect(scanFixture(`export function f(h) { void readTextFile(h, "x").then((t) => t); }`)).toEqual([
      expect.stringContaining("FLOATING"),
    ]);
  });

  it("canary: an unguarded poll reload (the unsorted-hook shape) is an undeclared propagator", () => {
    const v = scanFixture(`
      const reload = useCallback(async () => { const e = await listDir(h, "unsorted"); }, []);
      export function tick() { void reload(); }
    `);
    expect(v).toEqual([expect.stringContaining("UNDECLARED PROPAGATOR library/hooks/useCanary.ts::reload")]);
  });

  it("a ledgered propagator's callers are traced in turn — a helper can't launder a rejection", () => {
    const v = scanFixture(
      `
      const reload = useCallback(async () => { await listDir(h, "unsorted"); }, []);
      export function tick() { void reload(); }
    `,
      { "library/hooks/useCanary.ts::reload": "test" },
    );
    expect(v).toEqual([expect.stringMatching(/useCanary\.ts:\d+ reload\(…\) — FLOATING/)]);
  });

  it("accepts every handled shape", () => {
    expect(
      scanFixture(`
        export async function a(h) { try { await readTextFile(h, "x"); } catch {} }
        export function b(h) { void readTextFile(h, "x").catch(() => {}); }
        export function c(h) { void readTextFile(h, "x").then((t) => t, () => null); }
        export async function d(h) {
          try { await Promise.all(["a"].map(async (n) => (await fileExists(h, n)) ? 1 : 0)); } catch {}
        }
        export function e(h) { (async () => { try { await listDir(h, "q"); } catch {} })(); }
      `),
    ).toEqual([]);
  });

  it("flags a stale ledger row", () => {
    const v = scanReadDoorCallers({
      files: fixture(`export async function a(h) { try { await readTextFile(h, "x"); } catch {} }`),
      propagators: { "library/hooks/useCanary.ts::gone": "test" },
      terminals: {},
    }).violations;
    expect(v).toEqual([expect.stringContaining("STALE LEDGER ROW library/hooks/useCanary.ts::gone")]);
  });
});

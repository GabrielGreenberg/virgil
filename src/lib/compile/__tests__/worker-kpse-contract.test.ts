// @vitest-environment node
/**
 * TASK 454 — THE VENDORED WORKER'S KPSE CONTRACT.
 *
 * `public/swiftlatex/swiftlatexpdftex.js` is vendored, minified upstream code
 * carrying a run of `PATCHED (virgil)` sections. Nothing in this repo can
 * DRIVE it — it needs a real `Worker`, a real WASM instantiation and a real
 * synchronous cross-origin `XMLHttpRequest`, none of which exists in vitest —
 * so this is a SOURCE census, and it is the only instrument that can see any of
 * the properties below.
 *
 * Its whole reason to exist is re-vendoring: the patches are the only thing
 * standing between Virgil and a compile that can never finish, and a `git
 * checkout` of the upstream file would silently drop every one of them with
 * every behavioural suite in the repo still green (they all mock
 * `@/lib/swiftlatex`).
 *
 * The three properties, each with its measured cost:
 *
 *  1. **A miss is negative-cached for EVERY non-200.** Upstream caches only on
 *     status 301 (its own dead CDN's sentinel). Any other answer — 404, 429,
 *     a 5xx, a network error, the per-file timeout — fell through UNCACHED, so
 *     kpse re-issued a full synchronous cross-origin XHR every single time it
 *     probed that name. An unbounded refetch loop against an unhealthy mirror,
 *     which is a hang the user can only read as "nothing is happening".
 *  2. **A fetched asset STREAMS to the main thread.** Durability cannot ride
 *     `dumpnewcache`: that is a request/response round trip and the worker is
 *     blocked inside its synchronous pass for the whole compile, so the one
 *     moment the bytes matter most is the one moment it can never answer.
 *  3. **The per-file XHR timeout is BOUNDED.** Upstream's 150 s means one
 *     stalled file can eat most of a compile budget on its own.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..", "..");
const WORKER = readFileSync(
  join(ROOT, "public", "swiftlatex", "swiftlatexpdftex.js"),
  "utf8",
);
const ENGINE = readFileSync(
  join(ROOT, "public", "swiftlatex", "PdfTeXEngine.js"),
  "utf8",
);

describe("vendored worker — kpse negative cache", () => {
  it("treats 404 and 410 as definitive misses, not only 301", () => {
    // The pre-454 branch was literally `else if(xhr.status===301)`. Measured
    // against the shipped TeXlyre mirror, a missing file answers 301 — but a
    // rate limit, a 5xx or an edge 404 does not, and each of those looped.
    expect(WORKER).toContain("__virgilIsDefinitiveMiss");
    expect(WORKER).toMatch(/status === 301 \|\| status === 404 \|\| status === 410/);
  });

  it("negative-caches a TRANSIENT failure too, so it cannot refetch forever", () => {
    // The key property: after a transient failure the key is written into the
    // 404 cache anyway. A retry within one compile buys nothing (the mirror
    // just answered) and costs another blocking round trip.
    const fileImpl = WORKER.slice(
      WORKER.indexOf("function kpse_find_file_impl"),
      WORKER.indexOf("function kpse_find_pk_impl"),
    );
    expect(fileImpl).toContain("__virgilNoteFetchFailure");
    // Both the definitive and the transient arm must write the miss cache.
    const cacheWrites = fileImpl.match(/texlive404_cache\[cacheKey\] = 1/g) ?? [];
    expect(cacheWrites.length).toBeGreaterThanOrEqual(2);
  });

  it("trips a circuit breaker when the mirror keeps failing", () => {
    // An unreachable mirror must produce a FAST, NAMED failure rather than a
    // grind: after K consecutive failures the worker stops trying and records
    // each further lookup as a miss the compile result can surface.
    expect(WORKER).toContain("KPSE_MAX_CONSECUTIVE_FAILURES");
    expect(WORKER).toContain("__mirrorDown");
  });

  it("bounds the per-file XHR timeout", () => {
    expect(WORKER).toContain("KPSE_XHR_TIMEOUT_MS");
    const m = WORKER.match(/const KPSE_XHR_TIMEOUT_MS = (\d+)/);
    expect(m).toBeTruthy();
    expect(Number(m![1])).toBeLessThanOrEqual(60_000);
    // The upstream 150 s literal must be gone from the kpse layer.
    expect(WORKER).not.toContain("xhr.timeout=15e4");
  });

  it("resets its per-compile fetch bookkeeping", () => {
    // Or a mirror that was down during one compile stays "down" for the rest of
    // the session, and the miss list describes the wrong compile.
    const prep = WORKER.slice(
      WORKER.indexOf("function prepareExecutionContext"),
      WORKER.indexOf("function prepareExecutionContext") + 600,
    );
    // The reset sits in the MINIFIED region, so match without spacing.
    expect(prep).toMatch(/__mirrorDown\s*=\s*false/);
    expect(prep).toContain("__downloadFailures");
  });
});

describe("vendored worker — streaming durability", () => {
  it("posts each fetched asset to the main thread AS IT LANDS", () => {
    expect(WORKER).toContain("__virgilStreamAsset");
    expect(WORKER).toContain('cmd: "assetfetched"');
  });

  it("posts a progress ping BEFORE each download starts", () => {
    // The compile's only live signal: the main thread is not blocked while the
    // worker is, so these are delivered even mid-pass.
    expect(WORKER).toContain('cmd: "kpsefetch"');
  });

  it("carries download failures out on the compile result", () => {
    expect(WORKER).toContain("downloadFailures");
  });

  it("gives the PK font lookup the same offline short-circuit as its sibling", () => {
    // Found by the independent diagnosis: `kpse_find_pk_impl` had NO offline
    // guard at all, so a `.pk` probe fired a full synchronous cross-origin XHR
    // even when the app knew it was offline — the exact hang the sibling's
    // patch exists to prevent, in the function nobody had looked at.
    const pkImpl = WORKER.slice(WORKER.indexOf("function kpse_find_pk_impl"));
    expect(pkImpl).toContain("self.__offline");
    expect(pkImpl).toContain("__mirrorDown");
  });
});

describe("vendored engine wrapper — the persistent channel", () => {
  it("installs the stream listener with addEventListener, not onmessage", () => {
    // Every per-call method swaps `latexWorker.onmessage`, and the compile
    // handler early-returns on any cmd !== "compile" — so a message posted
    // DURING a compile is dropped by that channel by construction. A second,
    // independent listener installed once at boot is the only shape that works.
    expect(ENGINE).toContain("installStreamChannel");
    expect(ENGINE).toMatch(/addEventListener\(\s*['"]message['"]/);
  });

  it("bounds the dumpNewCache round trip", () => {
    // It cannot resolve while the worker is blocked inside a pass, so an
    // unbounded await wedges its caller on exactly the path (a hang) where
    // someone is most likely to reach for it.
    const dump = ENGINE.slice(
      ENGINE.indexOf("PdfTeXEngine.prototype.dumpNewCache"),
      ENGINE.indexOf("PdfTeXEngine.prototype.setOffline"),
    );
    expect(dump).toContain("setTimeout");
  });

  it("exposes both sinks, and drops only the per-attempt one", () => {
    expect(ENGINE).toContain("PdfTeXEngine.prototype.onAsset");
    expect(ENGINE).toContain("PdfTeXEngine.prototype.onFetchProgress");
    const close = ENGINE.slice(
      ENGINE.indexOf("PdfTeXEngine.prototype.closeWorker"),
      ENGINE.indexOf("return PdfTeXEngine;"),
    );
    // The PROGRESS sink is per-attempt bookkeeping and MUST be dropped: an
    // orphaned worker's late fetches counted against the next attempt would
    // make a dead hang look productive and keep the continuation loop going.
    expect(close).toContain("fetchProgressCallback = undefined");
    expect(close).toContain("streamChannelInstalled = false");
    // The DURABILITY sink is deliberately KEPT. `closeWorker` does not
    // terminate() — a worker blocked mid-compile keeps fetching as an orphan,
    // and those bytes are exactly what the next attempt would re-download.
    expect(close).not.toContain("assetCallback = undefined");
  });
});

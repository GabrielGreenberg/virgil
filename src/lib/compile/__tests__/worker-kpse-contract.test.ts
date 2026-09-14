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

  // RENEGOTIATED (task 573). This leg used to be "negative-caches a TRANSIENT
  // failure too" and required `texlive404_cache[cacheKey] = 1` at least TWICE
  // in the file lookup — i.e. the transient arm writing the DURABLE cache. That
  // was the defect pinned as the contract: `texlive404_cache` is a module-level
  // table nothing ever clears, and the engine worker lives for the session, so
  // a key that missed OFFLINE or failed TRANSIENTLY stayed missing — unnamed,
  // since the miss lists ARE reset per compile — until a page reload. The
  // property 454 needed (no re-probe WITHIN a compile) is kept; it now lives in
  // a per-compile table.
  const FILE_IMPL = WORKER.slice(
    WORKER.indexOf("function kpse_find_file_impl"),
    WORKER.indexOf("function kpse_find_pk_impl"),
  );
  const PK_IMPL = WORKER.slice(
    WORKER.indexOf("function kpse_find_pk_impl"),
    WORKER.indexOf("var moduleOverrides"),
  );

  it("negative-caches a TRANSIENT failure for THIS compile, so it cannot refetch within it", () => {
    expect(FILE_IMPL).toContain("__virgilNoteFetchFailure");
    expect(FILE_IMPL).toMatch(/__virgilTransientMisses\(\)\[cacheKey\] = 1/);
    expect(PK_IMPL).toContain("__virgilNoteFetchFailure");
    expect(PK_IMPL).toMatch(/__virgilTransientMisses\(\)\[__virgilPkKey\(cacheKey\)\] = 1/);
  });

  it("writes the DURABLE miss cache on the DEFINITIVE arm only (task 573)", () => {
    // Exactly one durable write per lookup, and it sits behind `res.definitive`.
    // A second write is the offline / breaker / transient arm leaking into a
    // table that outlives the compile.
    const fileWrites = FILE_IMPL.match(/texlive404_cache\[cacheKey\] = 1/g) ?? [];
    expect(fileWrites.length).toBe(1);
    expect(FILE_IMPL).toMatch(
      /if \(res\.definitive\) \{\s*texlive404_cache\[cacheKey\] = 1;/,
    );
    const pkWrites = PK_IMPL.match(/pk404_cache\[cacheKey\] = 1/g) ?? [];
    expect(pkWrites.length).toBe(1);
    expect(PK_IMPL).toMatch(/if \(res\.definitive\) \{\s*pk404_cache\[cacheKey\] = 1;/);
  });

  it("the offline / breaker short-circuit records a PER-COMPILE miss, in both lookups", () => {
    for (const [impl, key] of [
      [FILE_IMPL, "cacheKey"],
      [PK_IMPL, "__virgilPkKey(cacheKey)"],
    ] as const) {
      const arm = impl.slice(
        impl.indexOf("if (self.__offline || self.__mirrorDown)"),
        impl.indexOf("const remote_url"),
      );
      expect(arm).toContain("__offlineMisses");
      expect(arm).toContain(`__virgilTransientMisses()[${key}] = 1`);
      expect(arm).not.toMatch(/404_cache/);
    }
  });

  it("consults BOTH negative caches before the offline branch and the fetch", () => {
    for (const [impl, durable, key] of [
      [FILE_IMPL, "texlive404_cache", "cacheKey"],
      [PK_IMPL, "pk404_cache", "__virgilPkKey(cacheKey)"],
    ] as const) {
      const check = impl.indexOf(`cacheKey in ${durable} || ${key} in __virgilTransientMisses()`);
      expect(check).toBeGreaterThan(0);
      expect(check).toBeLessThan(impl.indexOf("self.__offline"));
      expect(check).toBeLessThan(impl.indexOf("__virgilKpseFetch("));
    }
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
      // To the end of the function (the next top-level statement), not a fixed
      // byte window: patch comments grow it.
      WORKER.indexOf('Module["postRun"]', WORKER.indexOf("function prepareExecutionContext")),
    );
    // The reset sits in the MINIFIED region, so match without spacing.
    expect(prep).toMatch(/__mirrorDown\s*=\s*false/);
    expect(prep).toContain("__downloadFailures");
    // Task 573: and the per-compile negative cache, or the reset above is
    // defeated — the miss lists are cleared while the keys that produced them
    // stay short-circuited, so a reconnected mirror is never retried and the
    // package is no longer named.
    expect(prep).toMatch(/__transientMiss\s*=\s*\{\}/);
  });

  it("clears no DURABLE miss cache per compile (an absent file is absent)", () => {
    // The rejected alternative: resetting texlive404_cache every compile would
    // re-issue a blocking mirror round trip for every `\IfFileExists` probe of
    // a genuinely absent file, the exact grind 454 removed.
    // Exactly one assignment each: the module-level declaration.
    expect(WORKER.match(/texlive404_cache\s*=\s*\{\}/g)?.length).toBe(1);
    expect(WORKER.match(/pk404_cache\s*=\s*\{\}/g)?.length).toBe(1);
  });
});

/**
 * TASK 574 — THE PERSISTENT cacheKey GRAMMAR.
 *
 * kpse keeps two positive caches (texlive200_cache for files, pk200_cache for
 * bitmap fonts) and the write-through channels flatten both into ONE
 * persistent namespace by prefixing pk keys with "pk/". Pre-574 the pk lookup
 * MINTED that prefix and the `seedcache` arm never PARSED it: every persisted
 * key went into texlive200_cache, which kpse_find_pk_impl never reads, so a
 * pk font the user had compiled online was held in IndexedDB and never
 * restored — re-downloaded every session, missing offline.
 */
describe("vendored worker — the persistent cacheKey grammar (task 574)", () => {
  const PK_IMPL = WORKER.slice(
    WORKER.indexOf("function kpse_find_pk_impl"),
    WORKER.indexOf("var moduleOverrides"),
  );
  const SEED_ARM = WORKER.slice(
    WORKER.indexOf('cmd==="seedcache"'),
    WORKER.indexOf('cmd==="dumpnewcache"'),
  );
  const HELPERS = WORKER.slice(
    WORKER.indexOf("const VIRGIL_PK_KEY_PREFIX"),
    WORKER.indexOf("/* PATCHED (virgil, task 573): TWO negative caches"),
  );

  it("spells the pk prefix ONCE, and every minting site goes through it", () => {
    // One definition; no hand-built `"pk/" + …` concatenation anywhere, so the
    // minting arm and the parsing arm cannot come to disagree about the prefix.
    expect(WORKER.match(/const VIRGIL_PK_KEY_PREFIX = "pk\/";/g)?.length).toBe(1);
    expect(WORKER).not.toMatch(/"pk\/"\s*\+/);
    // The streaming arm and the dumpnewcache ledger both mint with the helper.
    expect(PK_IMPL).toContain("__virgilStreamAsset(__virgilPkKey(cacheKey)");
    expect(PK_IMPL).toMatch(/__newlyCached = \{\}\)\)\[__virgilPkKey\(cacheKey\)\] = pkid/);
  });

  it("the seedcache arm routes through the grammar parser, never a bare table write", () => {
    expect(SEED_ARM).toContain('__virgilSeedEntry(data["cacheKey"],savepath)');
    expect(SEED_ARM).not.toMatch(/texlive200_cache\[/);
    expect(SEED_ARM).not.toMatch(/pk200_cache\[/);
  });

  it("a pk key minted by the lookup is seeded back into the table the lookup READS", () => {
    // Behavioural, over the file's own helper bytes: run __virgilPkKey and
    // __virgilSeedEntry against fake tables. The pk lookup's own table key is
    // `dpi + "/" + reqname`, read out of PK_IMPL rather than restated.
    expect(PK_IMPL).toContain('const cacheKey = dpi + "/" + reqname;');
    const run = new Function(
      "pk200_cache",
      "texlive200_cache",
      `${HELPERS}; return { __virgilPkKey, __virgilSeedEntry };`,
    );
    const pk200: Record<string, string> = {};
    const tl200: Record<string, string> = {};
    const { __virgilPkKey, __virgilSeedEntry } = run(pk200, tl200) as {
      __virgilPkKey: (k: string) => string;
      __virgilSeedEntry: (k: string, p: string) => void;
    };

    const lookupKey = 600 + "/" + "cmr10";
    __virgilSeedEntry(__virgilPkKey(lookupKey), "/tex/pk-1");
    __virgilSeedEntry("26/expex.sty", "/tex/exp-1");

    expect(pk200).toEqual({ [lookupKey]: "/tex/pk-1" });
    expect(tl200).toEqual({ "26/expex.sty": "/tex/exp-1" });
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

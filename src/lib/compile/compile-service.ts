/**
 * CompileService — the single owner of the SwiftLaTeX engine lifecycle,
 * recovery, multi-pass driving, self-sufficiency, and byte-first file feeding
 * (P2).
 *
 * This module singleton is the ONLY consumer of `src/lib/swiftlatex.ts`. It
 * replaces the logic that used to be smeared across `useLatexCompile` (file
 * prep + pass heuristic + PDF write), `swiftlatex.ts` (singleton, only nulled
 * on initial boot failure), and the vendored `PdfTeXEngine.js` (a resolve-only,
 * never-timing-out compile). It gives compilation four capabilities the old
 * code lacked:
 *
 *  1. Engine lifecycle with health + reset-on-hang/crash. Every `compileLaTeX`
 *     is wrapped in `Promise.race` against a two-tier timeout (a generous COLD
 *     budget for first-boot + package fetch, a tight WARM budget after). On a
 *     timeout OR the (now-wired) worker-error rejection it runs `recover()`
 *     (`closeWorker` + `resetPdfTeXEngine`) so the next compile reboots — the
 *     permanent stuck-spinner becomes a recoverable timeout error.
 *
 *  2. A correct pass driver keyed on reference-resolution NEED
 *     (`detectPassPlan`), not just bibliography, with LAST-GOOD retention: a
 *     later-pass failure returns the earlier good PDF as `degraded` rather than
 *     discarding a valid artifact and reporting failure.
 *
 *  3. Self-sufficiency: it runs the save-time requirement injection
 *     (`applyRequirementsToFile`) on the IN-MEMORY copy it feeds the engine, so
 *     an unedited on-disk doc compiles — WITHOUT ever writing injected
 *     requirements back to disk (byte-stable round-trip + injection order
 *     preserved).
 *
 *  4. Byte-first file handling: files are decoded with a FATAL UTF-8 decoder
 *     (`decodeTexBytes`); a non-UTF-8 file passes through as raw bytes to memfs
 *     instead of being corrupted with U+FFFD.
 *
 * It also scans the returned log for bibtex-failure signatures and surfaces a
 * `bibtexStatus` so a broken bibliography stops compiling green.
 *
 * Serialization: a single in-flight guard (a shared promise) replaces the old
 * fragile `isCompiling` + engine `Busy`-singleton coupling — concurrent
 * `compile()` calls await the same in-flight compile, so a reboot during
 * recovery can never collide with a live worker.
 */

import { getPdfTeXEngine, resetPdfTeXEngine, writeEngineFile } from "@/lib/swiftlatex";
import { captureNewAssets } from "@/lib/tex-assets";
import { parseTexLog } from "@/lib/parse-tex-log";
import { applyRequirementsToFile } from "@/lib/compile/apply-requirements-to-file";
import { decodeTexBytes } from "@/lib/compile/decode-source";
import { detectBibtexFailure } from "@/lib/compile/bibtex-log";
import { detectPassPlan } from "@/lib/compile/reference-resolution";
import type {
  BibtexStatus,
  CompileInput,
  CompileResult,
} from "@/lib/compile/compile-types";

// Two-tier timeout. The first compile after a fresh boot legitimately fetches
// the .fmt + packages from the TeXlyre mirror over serial sync XHR (cold can
// take tens of seconds), so it gets a generous budget; subsequent warm compiles
// are fast, so a hang there is almost certainly a real crash and gets a tight
// budget for snappy recovery. Module constants so they're easy to tune.
const COLD_TIMEOUT_MS = 180_000;
const WARM_TIMEOUT_MS = 60_000;

// File extensions whose bytes are TEXT we may want to inject requirements into
// or decode for detection. Everything else (images, PDFs) is fed as raw bytes.
const TEXT_EXTS = new Set([
  "tex",
  "bib",
  "sty",
  "cls",
  "bst",
  "tikz",
  "md",
  "txt",
  "cfg",
  "def",
  "ltx",
]);

// SwiftLaTeX bundles bibtex but not biber, so biblatex users get rewritten to
// backend=bibtex. This loses some biblatex features (Unicode sorting, a few
// style options) but covers the vast majority of papers. (Moved verbatim from
// the old hook — the service is the sole rewriter now.)
function rewriteBiblatexBackend(text: string): string {
  return text.replace(
    /\\usepackage(?:\[([^\]]*)\])?\{biblatex\}/g,
    (match, opts?: string) => {
      if (!opts) return "\\usepackage[backend=bibtex]{biblatex}";
      if (/\bbackend\s*=\s*bibtex\b/.test(opts)) return match;
      if (/\bbackend\s*=\s*biber\b/.test(opts)) {
        return `\\usepackage[${opts.replace(/\bbackend\s*=\s*biber\b/, "backend=bibtex")}]{biblatex}`;
      }
      if (/\bbackend\s*=/.test(opts)) return match;
      return `\\usepackage[${opts.trim()},backend=bibtex]{biblatex}`;
    },
  );
}

class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Compile exceeded ${ms}ms budget`);
    this.name = "TimeoutError";
  }
}

class AbortError extends Error {
  constructor() {
    super("Compile aborted");
    this.name = "AbortError";
  }
}

/** What a single decoded file resolves to before it's written to memfs. */
type PreparedFile = { path: string; data: string | Uint8Array };

class CompileService {
  /**
   * Whether the engine has completed at least one successful boot in this
   * session (drives the two-tier timeout). Reset to false by `recover()`.
   */
  private booted = false;
  /** Single in-flight compile, so concurrent triggers serialize. */
  private inFlight: Promise<CompileResult> | null = null;

  /**
   * Compile the given paper files. Serializes against any in-flight compile.
   */
  compile(input: CompileInput): Promise<CompileResult> {
    // Serialize: chain onto any in-flight compile so a reboot during recovery
    // can't collide with a live worker. We chain (not reject) so a second
    // Compile click queues behind the first.
    const run = (this.inFlight ?? Promise.resolve()).then(
      () => this.runCompile(input),
      () => this.runCompile(input),
    );
    // Track only the settle, never expose the internal chain.
    this.inFlight = run.catch(() => undefined) as Promise<CompileResult>;
    return run;
  }

  private async runCompile(input: CompileInput): Promise<CompileResult> {
    const { files, mainTexFilename, signal } = input;
    if (signal?.aborted) return this.abortedResult();

    // 1. Boot / reuse the engine (health-checked, reset-on-failure).
    let engine: PdfTeXEngine;
    const wasBooted = this.booted;
    try {
      engine = await this.ensureEngine();
    } catch (err) {
      // Boot failed — reset so the next call retries a fresh boot.
      resetPdfTeXEngine();
      this.booted = false;
      return {
        status: "boot-failed",
        log: err instanceof Error ? err.message : String(err),
        ranPasses: 0,
        bibtexStatus: "absent",
        diagnostics: [],
      };
    }

    if (signal?.aborted) return this.abortedResult();

    // 2. Prepare files: decode text (fatal), apply requirements to the main
    //    .tex in-memory, rewrite biblatex backend, feed raw bytes for the rest.
    const prepared = this.prepareFiles(files, mainTexFilename);

    // 3. Decide the pass plan from the (injected) main + include sources.
    const passPlan = detectPassPlan(this.joinScannableSources(prepared));

    // 4. Write everything to memfs and set the main file.
    engine.flushCache();
    const createdDirs = new Set<string>();
    for (const f of prepared) {
      writeEngineFile(engine, f.path, f.data, createdDirs);
    }
    engine.setEngineMainFile(mainTexFilename);

    // P1 offline-assets: push connectivity into the worker so an UNCACHED
    // package lookup fails fast (records a miss + returns 0) instead of hanging
    // on a synchronous cross-origin XHR that ignores its timeout. provisionEngine
    // already did this at boot; refresh it here in case connectivity changed
    // between boot and this compile. Best-effort (older/faked engines may lack it).
    try {
      const online =
        typeof navigator !== "undefined" ? navigator.onLine !== false : true;
      engine.setOffline?.(!online);
    } catch {
      // ignore — never fail a compile on the offline knob.
    }

    // 5. Multi-pass loop with last-good retention.
    let lastGood: { pdf: Uint8Array; log: string; pass: number } | null = null;
    let lastLog = "";
    let ranPasses = 0;
    let hardFailure = false;
    // P1: packages the worker could not resolve while offline (union across
    // passes). Surfaced on the result so the hook can render each as a
    // "package X unavailable offline" LatexError.
    const offlineMisses = new Set<string>();

    for (let pass = 1; pass <= passPlan.passes; pass++) {
      if (signal?.aborted) {
        // Keep any good PDF we already have.
        if (lastGood) break;
        return this.abortedResult();
      }

      const timeoutMs = this.booted && wasBooted ? WARM_TIMEOUT_MS : COLD_TIMEOUT_MS;
      let result: PdfTeXCompileResult;
      try {
        result = await this.runPassWithTimeout(engine, timeoutMs, signal);
      } catch (err) {
        // Timeout OR worker-error rejection OR abort — recover the engine.
        if (err instanceof AbortError) {
          await this.recover();
          if (lastGood) break; // return the good artifact below
          return this.abortedResult();
        }
        await this.recover();
        // If an earlier pass produced a good PDF, keep it as degraded.
        if (lastGood) {
          hardFailure = true;
          break;
        }
        return {
          status: "timeout",
          log:
            (lastLog ? lastLog + "\n\n" : "") +
            (err instanceof Error ? err.message : String(err)),
          ranPasses,
          bibtexStatus: "absent",
          diagnostics: [],
        };
      }

      ranPasses = pass;
      lastLog = result.log ?? "";
      // After the first successful compile, mark the engine warm.
      this.booted = true;

      // P1: accumulate any offline package misses the worker reported.
      for (const miss of result.offlineMisses ?? []) offlineMisses.add(miss);

      // P1: write-through the assets the worker fetched this pass to the
      // persistent IndexedDB cache (offline-after-first-online-fetch). Only NEW
      // entries are dumped (worker tracks a delta), and it's best-effort — a
      // cache write never fails the compile.
      await captureNewAssets(engine);

      if (result.status === 0 && result.pdf) {
        lastGood = { pdf: new Uint8Array(result.pdf), log: lastLog, pass };
        // Once the reference-resolution driver is satisfied we still run the
        // planned passes so refs/ToC/bib stabilise; keep looping.
      } else {
        // This pass failed. If an earlier pass produced a good PDF, retain it
        // (degraded); otherwise it's a hard failure.
        hardFailure = true;
        break;
      }
    }

    // 6. Assemble the result.
    const bibtexStatus: BibtexStatus = detectBibtexFailure(lastLog);
    const misses = offlineMisses.size > 0 ? [...offlineMisses] : undefined;

    if (lastGood) {
      const diagnostics = hardFailure
        ? parseTexLog(lastLog)
        : parseTexLog(lastLog).filter((d) => d.severity !== "error");
      // An offline miss makes even a produced PDF degraded (a package the doc
      // asked for was unavailable, so the output may be missing content).
      const degraded = hardFailure || bibtexStatus === "failed" || !!misses;
      return {
        status: degraded ? "degraded" : "ok",
        pdf: lastGood.pdf,
        log: lastLog,
        ranPasses,
        bibtexStatus,
        diagnostics,
        offlineMisses: misses,
      };
    }

    // No PDF at all → failed.
    return {
      status: "failed",
      log: lastLog,
      ranPasses,
      bibtexStatus,
      diagnostics: parseTexLog(lastLog),
      offlineMisses: misses,
    };
  }

  /** Boot or reuse the engine; health-checked. */
  private async ensureEngine(): Promise<PdfTeXEngine> {
    const engine = await getPdfTeXEngine();
    return engine;
  }

  /** Race a single compile pass against a timeout (and an optional abort). */
  private runPassWithTimeout(
    engine: PdfTeXEngine,
    ms: number,
    signal?: AbortSignal,
  ): Promise<PdfTeXCompileResult> {
    const compilePromise = engine.compileLaTeX();
    return new Promise<PdfTeXCompileResult>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new TimeoutError(ms));
      }, ms);
      const onAbort = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new AbortError());
      };
      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }
      compilePromise.then(
        (res) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          resolve(res);
        },
        (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          reject(err instanceof Error ? err : new Error(String(err)));
        },
      );
    });
  }

  /**
   * Reset the engine after a hang / crash: `resetPdfTeXEngine()` closes the
   * worker and nulls the module singleton, so the next `ensureEngine()` boots
   * fresh. Marks the engine cold again (next compile gets the COLD budget).
   */
  private async recover(): Promise<void> {
    resetPdfTeXEngine();
    this.booted = false;
  }

  /**
   * Decode + inject requirements + rewrite biblatex on the in-memory copy of
   * every text file; pass images/binaries as raw bytes. NEVER mutates the
   * on-disk bytes (the returned strings are engine-only).
   */
  private prepareFiles(
    files: import("@/lib/storage-fsa").PaperFile[],
    mainTexFilename: string,
  ): PreparedFile[] {
    const out: PreparedFile[] = [];
    // First decode all text files so we can detect biblatex across the set.
    const decoded = new Map<string, string>();
    for (const f of files) {
      const ext = f.path.split(".").pop()?.toLowerCase() ?? "";
      if (!TEXT_EXTS.has(ext)) continue;
      const d = decodeTexBytes(f.bytes);
      if ("text" in d) decoded.set(f.path, d.text);
    }

    const hasBiblatex = [...decoded.values()].some((t) =>
      /\\usepackage(?:\[[^\]]*\])?\{biblatex\}/.test(t),
    );

    for (const f of files) {
      const ext = f.path.split(".").pop()?.toLowerCase() ?? "";
      const text = decoded.get(f.path);
      if (text === undefined) {
        // Non-text OR non-UTF-8 (decode returned raw): feed bytes verbatim, so
        // a non-UTF-8 file is never corrupted with U+FFFD before the engine.
        out.push({ path: f.path, data: f.bytes });
        continue;
      }

      let prepared = text;
      // Self-sufficiency: inject missing requirements into the MAIN .tex in
      // memory only (byte-stable on disk). Only the entry-point .tex carries a
      // \begin{document}; applyRequirementsToFile no-ops on anything else.
      if (f.path === mainTexFilename) {
        prepared = applyRequirementsToFile(prepared);
      }
      // Rewrite biblatex → backend=bibtex (biber is unavailable in-browser).
      if (hasBiblatex && ext === "tex") {
        const rewritten = rewriteBiblatexBackend(prepared);
        if (rewritten !== prepared) {
          console.warn(
            `[compile] biber is not available in the browser; rewrote \\usepackage{biblatex} in ${f.path} to use backend=bibtex`,
          );
          prepared = rewritten;
        }
      }
      out.push({ path: f.path, data: prepared });
    }
    return out;
  }

  /** Concatenate the text sources so the pass-plan scan sees refs/bib across
   *  the whole project (main + \input includes). */
  private joinScannableSources(prepared: PreparedFile[]): string {
    const parts: string[] = [];
    for (const f of prepared) {
      const ext = f.path.split(".").pop()?.toLowerCase() ?? "";
      if (ext !== "tex" && ext !== "sty" && ext !== "cls") continue;
      if (typeof f.data === "string") parts.push(f.data);
    }
    return parts.join("\n");
  }

  private abortedResult(): CompileResult {
    return {
      status: "failed",
      log: "Compile aborted",
      ranPasses: 0,
      bibtexStatus: "absent",
      diagnostics: [],
    };
  }
}

/** Module singleton — the single owner of engine lifecycle + compile. */
export const compileService = new CompileService();

// Exported for tests only (never construct a second one in app code).
export { CompileService };

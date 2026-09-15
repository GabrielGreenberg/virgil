/**
 * Thin wrapper around the vendored SwiftLaTeX pdfTeX engine.
 *
 * Engine assets live in `public/swiftlatex/`. The engine is loaded lazily
 * on first use and cached at module scope — one compile takes ~1s to boot
 * the WASM worker, so reusing it across clicks is a big win.
 *
 * TeX packages are fetched on demand from TeXlyre's mirror. Upstream
 * SwiftLaTeX's own CDN (texlive2.swiftlatex.com) is offline and the
 * project is unmaintained. TeXlyre (https://github.com/TeXlyre/texlyre)
 * is a living fork that keeps the engines going and hosts the mirror at
 * `https://texlive.texlyre.org`. Long-term we'll want to self-host or
 * move to a local helper process (e.g. Tectonic) — see docs.
 */

import { provisionEngine } from "@/lib/tex-assets";
import { publicAssetUrl } from "@/lib/public-asset-url";

const TEXLIVE_ENDPOINT = "https://texlive.texlyre.org/";

// Hand-rolled <script> tags bypass Next's automatic basePath prefixing, so the
// URL goes through the ONE public-asset door (task 365). Without it,
// subdirectory deploys (e.g. the GitHub Pages deploy at /virgil/) 404 on the
// engine asset.
const ENGINE_SCRIPT_URL = publicAssetUrl("/swiftlatex/PdfTeXEngine.js");

let enginePromise: Promise<PdfTeXEngine> | null = null;

function loadEngineScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("SwiftLaTeX requires a browser"));
  }
  if (window.PdfTeXEngine) return Promise.resolve();
  // Drop any stale tag from a previous failed load: load/error fire once,
  // so reattaching listeners to an already-errored <script> would hang.
  document
    .querySelector<HTMLScriptElement>('script[data-swiftlatex="pdftex"]')
    ?.remove();
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = ENGINE_SCRIPT_URL;
    script.dataset.swiftlatex = "pdftex";
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error(`Failed to load ${ENGINE_SCRIPT_URL}`));
    document.head.appendChild(script);
  });
}

export function getPdfTeXEngine(): Promise<PdfTeXEngine> {
  if (!enginePromise) {
    enginePromise = (async () => {
      await loadEngineScript();
      const engine = new window.PdfTeXEngine();
      await engine.loadEngine();
      engine.setTexliveEndpoint(TEXLIVE_ENDPOINT);
      // P1 offline-assets: seed the worker's kpse cache from the curated core
      // bundle + the persistent IndexedDB write-through cache, and push
      // navigator.onLine into the worker, BEFORE the first compile. Best-effort
      // — a failure degrades to today's mirror-fetch path.
      await provisionEngine(engine);
      return engine;
    })().catch((err) => {
      // Reset on failure so a retry can try again.
      enginePromise = null;
      throw err;
    });
  }
  return enginePromise;
}

/**
 * Force the module-level engine singleton to be discarded so the NEXT
 * `getPdfTeXEngine()` boots a fresh worker.
 *
 * `getPdfTeXEngine` only nulls `enginePromise` on an INITIAL boot failure — a
 * worker that hangs or crashes AFTER a successful boot is never reset, so the
 * `Busy` singleton throws forever and only a page reload recovers. The
 * CompileService calls this after a compile timeout / worker-error rejection so
 * it can reboot cleanly on the next compile.
 *
 * The singleton is nulled SYNCHRONOUSLY so the next call reboots; the close
 * itself rides the (possibly still pending) boot promise, and the returned
 * promise settles once it has run. Never rejects.
 *
 * `mode` is REQUIRED (task 576), because the two answers are opposite claims:
 *
 *  - `"keep-draining"` — the timed-out pass was PRODUCTIVE (it was downloading).
 *    The worker is closed with 'grace' and kept running as an orphan so its late
 *    downloads still reach the durability sink. It is recorded here, and
 *    {@link terminateDrainingWorkers} ends it once those bytes stop mattering.
 *  - `"terminate"` — a genuine hang, an abort, a worker error or a failed boot.
 *    'grace' would never be processed (the worker's event loop is never free),
 *    so it is `Worker.terminate()`d. Anything else is a CPU-pinned worker that
 *    lives until the tab is reloaded.
 */
export type EngineCloseMode = "keep-draining" | "terminate";

/** Engines whose worker was closed in keep-draining mode and may still run. */
const drainingEngines = new Set<PdfTeXEngine>();

export function resetPdfTeXEngine(mode: EngineCloseMode): Promise<void> {
  const pending = enginePromise;
  enginePromise = null;
  if (!pending) return Promise.resolve();
  return pending
    .then((engine) => {
      try {
        engine.closeWorker(mode);
        if (mode === "keep-draining") drainingEngines.add(engine);
        else drainingEngines.delete(engine);
      } catch {
        // A dead worker may already be gone; ignore.
      }
    })
    .catch(() => {
      // The engine never booted — nothing to close.
    });
}

/**
 * Terminate every worker still draining from an earlier `keep-draining` reset
 * (task 576). Called when a compile's continuation loop is over — success, stop
 * or budget — at which point everything they downloaded has already streamed
 * through to the persistent cache, and an orphan still running is at best idle
 * and at worst spinning in a hang forever. Never throws.
 */
export function terminateDrainingWorkers(): void {
  const engines = [...drainingEngines];
  drainingEngines.clear();
  for (const engine of engines) {
    try {
      engine.terminateDrainingWorkers();
    } catch {
      // already gone
    }
  }
}

/**
 * Write a file into the engine's memfs, auto-creating any parent
 * directories. The engine doesn't do this for you — it silently writes
 * nothing if the parent dir is missing.
 */
export function writeEngineFile(
  engine: PdfTeXEngine,
  relPath: string,
  data: string | Uint8Array,
  createdDirs: Set<string>,
): void {
  const parts = relPath.split("/").filter(Boolean);
  for (let i = 1; i < parts.length; i++) {
    const dir = parts.slice(0, i).join("/");
    if (!createdDirs.has(dir)) {
      engine.makeMemFSFolder(dir);
      createdDirs.add(dir);
    }
  }
  engine.writeMemFSFile(relPath, data);
}

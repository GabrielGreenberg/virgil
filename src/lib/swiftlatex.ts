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

const TEXLIVE_ENDPOINT = "https://texlive.texlyre.org/";

let enginePromise: Promise<PdfTeXEngine> | null = null;

function loadEngineScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("SwiftLaTeX requires a browser"));
  }
  if (window.PdfTeXEngine) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-swiftlatex="pdftex"]',
    );
    if (existing) {
      if (window.PdfTeXEngine) {
        resolve();
      } else {
        existing.addEventListener("load", () => resolve());
        existing.addEventListener("error", () =>
          reject(new Error("Failed to load PdfTeXEngine.js")),
        );
      }
      return;
    }
    const script = document.createElement("script");
    script.src = "/swiftlatex/PdfTeXEngine.js";
    script.dataset.swiftlatex = "pdftex";
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error("Failed to load /swiftlatex/PdfTeXEngine.js"));
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

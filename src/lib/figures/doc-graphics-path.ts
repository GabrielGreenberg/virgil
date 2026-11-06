/**
 * Per-doc `\graphicspath` — the directories a paper's preamble tells graphicx
 * to search, held for the figure resolver (`useResolvedFigureUrl`).
 *
 * A REGISTRY keyed by docId (multi-pane keep-alive: N papers are mounted at
 * once), never a single slot. Filled lazily from disk on a doc's first figure
 * resolve, and refreshed by the two paths that change the preamble:
 *  - the code pane's preamble commit (`useDocument.saveWithDelimiters` hands
 *    the new preamble straight in via `noteDocPreamble`), and
 *  - a style switch / external reload, which dispatch the per-doc
 *    tex-delimiters-changed event — the entry is re-read from disk.
 * A change in the parsed directory list notifies the doc's subscribers, so
 * every figure re-resolves against the new search path (task 1437).
 */
import { extractPreambleAndPostamble } from "@/lib/latex-parser";
import { parseGraphicsPath } from "./graphics-path";
import {
  TEX_DELIMITERS_CHANGED_EVENT,
  type TexDelimitersChangedDetail,
} from "@/lib/tex-delimiters-event";
import { registerDocForget } from "@/lib/doc-forget";

type ReadTex = (docId: string) => Promise<string>;

interface Entry {
  dirs: string[] | undefined;
  load: Promise<string[]> | null;
  read: ReadTex | null;
  listeners: Set<() => void>;
}

const entries = new Map<string, Entry>();

function entryFor(docId: string): Entry {
  let e = entries.get(docId);
  if (!e) {
    e = { dirs: undefined, load: null, read: null, listeners: new Set() };
    entries.set(docId, e);
  }
  return e;
}

function sameDirs(a: readonly string[] | undefined, b: readonly string[]): boolean {
  return !!a && a.length === b.length && a.every((d, i) => d === b[i]);
}

function publish(docId: string, dirs: string[]): void {
  const e = entryFor(docId);
  if (sameDirs(e.dirs, dirs)) return;
  e.dirs = dirs;
  for (const fn of [...e.listeners]) fn();
}

function dirsFromTex(tex: string): string[] {
  return parseGraphicsPath(extractPreambleAndPostamble(tex)?.preamble ?? "");
}

/** The doc's search dirs if already known, else undefined (not yet read). */
export function peekDocGraphicsPath(docId: string): string[] | undefined {
  return entries.get(docId)?.dirs;
}

/** Resolve the doc's search dirs, reading the `.tex` once per doc. A failed
 *  read resolves to `[]` (resolve from the paper root, the old behaviour). */
export function loadDocGraphicsPath(docId: string, read: ReadTex): Promise<string[]> {
  const e = entryFor(docId);
  e.read = read;
  if (e.dirs) return Promise.resolve(e.dirs);
  if (!e.load) {
    e.load = read(docId)
      .then(dirsFromTex, () => [] as string[])
      .then((dirs) => {
        // A preamble noted while the read was in flight is fresher — keep it.
        if (entryFor(docId).dirs === undefined) publish(docId, dirs);
        return entryFor(docId).dirs ?? dirs;
      })
      .finally(() => {
        entryFor(docId).load = null;
      });
  }
  return e.load;
}

/** The code pane committed a new preamble for `docId`. O(preamble), edge-only. */
export function noteDocPreamble(docId: string, preamble: string): void {
  publish(docId, parseGraphicsPath(preamble));
}

/** Subscribe to `docId`'s search-dir changes. Returns the unsubscribe. */
export function subscribeDocGraphicsPath(docId: string, fn: () => void): () => void {
  ensureDelimitersListener();
  const e = entryFor(docId);
  e.listeners.add(fn);
  return () => {
    e.listeners.delete(fn);
  };
}

let installed = false;
function ensureDelimitersListener(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener(TEX_DELIMITERS_CHANGED_EVENT, (ev: Event) => {
    const docId = (ev as CustomEvent<TexDelimitersChangedDetail>).detail?.docId;
    const e = docId ? entries.get(docId) : undefined;
    if (!docId || !e?.read) return;
    e.read(docId).then(
      (tex) => publish(docId, dirsFromTex(tex)),
      () => {
        /* best-effort — keep the current dirs */
      },
    );
  });
}

/**
 * Forget `docId`'s search path (task 1465 — `purgeDoc`): it was parsed from the
 * identity's preamble. A doc with live subscribers keeps its entry (they are
 * theirs to remove) with the path and loader cleared, so the next resolve
 * re-reads the reset paper.
 */
function forgetDocGraphicsPath(docId: string): void {
  const e = entries.get(docId);
  if (!e) return;
  if (e.listeners.size === 0) {
    entries.delete(docId);
    return;
  }
  e.dirs = undefined;
  e.load = null;
  e.read = null;
}
registerDocForget("doc-graphics-path", forgetDocGraphicsPath);

/** Test-only: forget every doc. */
export function __resetDocGraphicsPathForTests(): void {
  entries.clear();
}

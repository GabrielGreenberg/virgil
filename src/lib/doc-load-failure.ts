/**
 * "This paper can't be reached" — the document lifecycle's typed load outcome
 * (task 1102).
 *
 * Before this module a paper whose folder had been moved, renamed or deleted
 * opened to a SILENT blank pane: `useDocument`'s load catch only logged, the
 * editor mounts only on non-null content, and the permission gate asks only
 * about PERMISSION (a stale handle can still answer `granted`). The lifecycle
 * had no state for "unreachable" and no way out of it.
 *
 * Three pieces, one vocabulary:
 *
 *   - `probeDocFolder` — asks the folder handle whether the folder and its
 *     `.tex` are still THERE, before anything mounts. The layout's access
 *     check runs it beside the permission query.
 *   - `DocUnreachableError` / `classifyDocLoadFailure` — a failed bundle read
 *     names its kind instead of being an opaque log line.
 *   - a per-doc REGISTRY of load failures (`publishDocLoadFailure` /
 *     `useDocLoadFailure`). `useDocument` publishes into it from the pane; the
 *     layout reads it for the active doc and renders the one
 *     `DocUnreachableGate`. Keyed by doc id, never a single slot — N panes are
 *     mounted at once under multi-doc keep-alive (see
 *     docs/agents/laws/per-doc-services-under-multi-pane-keep-alive.md).
 */

import { useSyncExternalStore } from "react";

export type DocLoadFailureKind =
  /** The folder itself is gone (moved, renamed, deleted) or no handle is stored. */
  | "folder-missing"
  /** The folder is there but the paper's `.tex` is not. */
  | "tex-missing"
  /** The browser refused access. */
  | "permission"
  /** Anything else — the read failed for a reason we can't name. */
  | "unreadable";

export interface DocLoadFailure {
  kind: DocLoadFailureKind;
  /** The underlying error's message, for the detail line. */
  detail: string;
}

/** A bundle read that already knows WHY it could not reach the paper. */
export class DocUnreachableError extends Error {
  readonly kind: DocLoadFailureKind;
  constructor(kind: DocLoadFailureKind, message: string) {
    super(message);
    this.name = "DocUnreachableError";
    this.kind = kind;
  }
}

function errorName(err: unknown): string | null {
  if (err && typeof err === "object" && "name" in err) {
    const n = (err as { name: unknown }).name;
    return typeof n === "string" ? n : null;
  }
  return null;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Map any load error to a kind. A `DocUnreachableError` states its own. */
export function classifyDocLoadFailure(err: unknown): DocLoadFailure {
  const detail = errorMessage(err);
  if (err instanceof DocUnreachableError) return { kind: err.kind, detail };
  const name = errorName(err);
  if (name === "NotFoundError") return { kind: "folder-missing", detail };
  if (name === "NotAllowedError" || name === "SecurityError") {
    return { kind: "permission", detail };
  }
  // `requireDocHandle`'s own diagnostic: no handle stored for this doc.
  if (/No folder handle stored/.test(detail)) {
    return { kind: "folder-missing", detail };
  }
  return { kind: "unreadable", detail };
}

/**
 * Is the paper still where its handle says? Resolves `null` when the folder
 * and its `.tex` are both reachable, else the kind of failure. Never throws.
 *
 * The folder test ENUMERATES the directory rather than looking up the `.tex`:
 * a lookup in a removed directory and a lookup of a removed file both answer
 * `NotFoundError`, and only the enumeration tells them apart.
 */
export async function probeDocFolder(
  handle: FileSystemDirectoryHandle,
  texFilename: string,
): Promise<DocLoadFailureKind | null> {
  try {
    const it = handle.values();
    await it.next();
  } catch (err) {
    const kind = classifyDocLoadFailure(err).kind;
    return kind === "unreadable" ? "folder-missing" : kind;
  }
  try {
    await handle.getFileHandle(texFilename);
  } catch (err) {
    const name = errorName(err);
    if (name === "NotFoundError" || name === "TypeMismatchError") {
      return "tex-missing";
    }
    return classifyDocLoadFailure(err).kind;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Per-doc registry
// ---------------------------------------------------------------------------

const failures = new Map<string, DocLoadFailure>();
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

/** Record (or, with `null`, clear) the load outcome for ONE doc. */
export function publishDocLoadFailure(
  docId: string,
  failure: DocLoadFailure | null,
): void {
  const prev = failures.get(docId) ?? null;
  if (failure === null) {
    if (!prev) return;
    failures.delete(docId);
  } else {
    if (prev && prev.kind === failure.kind && prev.detail === failure.detail) {
      return;
    }
    failures.set(docId, failure);
  }
  notify();
}

export function getDocLoadFailure(docId: string | null): DocLoadFailure | null {
  if (!docId) return null;
  return failures.get(docId) ?? null;
}

/** Every doc id with a standing load failure (a mounted slot must yield). */
export function hasDocLoadFailure(docId: string): boolean {
  return failures.has(docId);
}

export function subscribeDocLoadFailures(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Registry revision — bumps on every change, for whole-set readers. */
let revision = 0;
listeners.add(() => {
  revision += 1;
});
function getRevision() {
  return revision;
}

/** The load failure of `docId`, live. */
export function useDocLoadFailure(docId: string | null): DocLoadFailure | null {
  return useSyncExternalStore(
    subscribeDocLoadFailures,
    () => getDocLoadFailure(docId),
    () => null,
  );
}

/** Re-render on ANY doc's failure changing (the keep-alive slot filter). */
export function useDocLoadFailureRevision(): number {
  return useSyncExternalStore(subscribeDocLoadFailures, getRevision, () => 0);
}

/** Test-only reset. */
export function __resetDocLoadFailuresForTests(): void {
  failures.clear();
  notify();
}

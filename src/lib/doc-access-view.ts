/**
 * What the active paper's pane shows — ONE total function of the access state
 * (task 1459).
 *
 * Task 1102 gave an unreachable paper a gate, but the decision stayed spread
 * over three render sites, each testing its own conjunction of
 * `docPermState`, the folder handle and the load failure. States none of them
 * named fell through to a BLANK pane with no way out: `no-handle` for a paper
 * that IS current (a peer window forgot it, or its handle slot was lost), and
 * `needs-grant` with no handle to grant (the access check's lookup threw). The
 * permission gate could also be handed the PREVIOUS paper's handle.
 *
 * `resolveDocAccessView` is exhaustive over `DocPermState` (a `never` check),
 * so a new state cannot be added without saying what the pane shows, and the
 * three sites — the permission gate, the unreachable gate, and the empty-slot
 * test — all read its answer.
 */

import type { DocLoadFailure } from "./doc-load-failure";

/** The active paper's access state, set by `useDocAccessCheck`. */
export type DocPermState = "loading" | "granted" | "needs-grant" | "no-handle";

export type DocAccessView =
  /** No paper is current — the start screen. */
  | { kind: "none" }
  /** The access check is in flight. Nothing to show yet (transient). */
  | { kind: "loading" }
  /** The paper is reachable and granted — mount the editor. */
  | { kind: "editor" }
  /** The folder needs a fresh readwrite grant, on THIS handle. */
  | { kind: "permission"; handle: FileSystemDirectoryHandle }
  /** The paper can't be reached — Locate / Try again / Remove. */
  | { kind: "unreachable"; failure: DocLoadFailure };

/** What `no-handle` means for a paper that is current: nothing stored to open. */
export const NO_HANDLE_FAILURE: DocLoadFailure = {
  kind: "folder-missing",
  detail: "No folder handle stored for this paper.",
};

/** `needs-grant` without a handle: there is nothing the gate could request. */
export const NO_GRANTABLE_HANDLE_FAILURE: DocLoadFailure = {
  kind: "unreadable",
  detail: "Virgil could not look up this paper's folder.",
};

export function resolveDocAccessView(input: {
  /** Is a paper current (the id resolves to a doc in the index)? */
  hasDoc: boolean;
  docPermState: DocPermState;
  /** The handle the access check resolved FOR THE CURRENT paper, or null. */
  handle: FileSystemDirectoryHandle | null;
  loadFailure: DocLoadFailure | null;
}): DocAccessView {
  const { hasDoc, docPermState, handle, loadFailure } = input;
  if (!hasDoc) return { kind: "none" };
  switch (docPermState) {
    case "loading":
      return { kind: "loading" };
    case "granted":
      return loadFailure
        ? { kind: "unreachable", failure: loadFailure }
        : { kind: "editor" };
    case "needs-grant":
      // A grant is the remedy whenever there is a handle to grant: granting
      // re-runs the load, which re-measures any standing failure.
      if (handle) return { kind: "permission", handle };
      return {
        kind: "unreachable",
        failure: loadFailure ?? NO_GRANTABLE_HANDLE_FAILURE,
      };
    case "no-handle":
      return { kind: "unreachable", failure: loadFailure ?? NO_HANDLE_FAILURE };
    default: {
      const unmapped: never = docPermState;
      throw new Error(`Unmapped doc access state: ${String(unmapped)}`);
    }
  }
}

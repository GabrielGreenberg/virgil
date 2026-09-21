/**
 * THE serialized authority for `ai-requests.json` (task 220).
 *
 * The inbox has two in-app writers — the live hook (`useAiRequests`: drafts,
 * style-merges, manual requests) and the card-flag bridge
 * (`bridgeCardAiRequestFlag`, fired from the per-panel hooks) — plus a THIRD,
 * out-of-app writer: the `/editor/*` skills, which read-modify-write the file
 * straight on disk while the paper is open.
 *
 * Before this module those writers had structurally INCOMPATIBLE persistence
 * models, and the mismatch was silent in both directions:
 *
 *   - the hook persisted its WHOLE in-memory snapshot, derived from React
 *     `prev` state with no read-merge against disk — so it overwrote anything
 *     written since its own last read, and it never published, so nothing else
 *     learned about the write;
 *   - the bridge read-modify-wrote, but its `readSidecar` ran OUTSIDE the
 *     serialized write critical section, so a write landing between its read
 *     and its own write was merged away from a base that no longer existed.
 *
 * Neither is a type error, neither throws, and no round-trip suite catches
 * either: each writer is internally consistent and only ever wrong about what
 * the OTHER one did.
 *
 * > **Every mutation of `ai-requests.json` is a pure function of the list as it
 * > is ON DISK at the moment of the write, computed inside the serialized write
 * > critical section, and every writer PUBLISHES the authoritative post-write
 * > list.** Nothing persists a whole snapshot it computed earlier from state it
 * > merely hopes is current.
 *
 * Two halves, and the second is what makes the first hold for more than one
 * window. `mutateAiRequests` is the write authority (serialization +
 * merge-from-disk + publish); the in-process `publishAiRequests` bus reaches
 * only THIS window, so `useAiRequests` also re-hydrates from disk on the
 * `SidecarWatcher`'s external-change signal — the same channel
 * `usePersistentState` rides, and the reason a peer window's write (or a
 * skill's) converges rather than being clobbered by the next local mutation.
 *
 * Every write door is here. Nothing else in `src/` may name the filename —
 * pinned by `ai-requests-authority.test.ts`, the guard that catches the shape
 * this module exists to retire: not a broken writer, but a call site that never
 * asked the authority.
 */

import { mutateSidecar, readSidecar } from "@/lib/storage";
import type { AiRequest, AiRequestsState } from "@/lib/types";
import {
  getActiveHandle,
  isStalePipelineError,
} from "@/lib/multi-window/doc-pipeline";
import { publishAiRequests } from "@/lib/ai-request-events";
import { UNKNOWN_AI_REQUEST_KIND } from "@/lib/ai-request-kind";

/**
 * The one spelling of the sidecar filename — deliberately module-PRIVATE.
 *
 * It was exported in this task's first cut, and that quietly reopened the hole
 * the census below exists to close: with the name importable, a call site can
 * write `mutateSidecar(handle, AI_REQUESTS_FILE, …)`, spell no literal, and pass
 * every leg of the census while bypassing `mutateAiRequests` entirely — so it
 * never publishes, which is the whole drop-D3 half of the original defect. The
 * census asks "who spells the filename"; the law is "who WRITES the file", and
 * those two coincide only while the name cannot travel.
 *
 * Its one legitimate consumer outside this module (the hook's sidecar-changed
 * filter) does not need the NAME, only the QUESTION — so it gets
 * {@link isAiRequestsFile} instead. Publish whole operations, never the pieces.
 */
const AI_REQUESTS_FILE = "ai-requests.json";

/**
 * Is this `SidecarWatcher` event about the inbox? The predicate form of the
 * private filename above: it answers the only question a reader outside this
 * module has, without handing out a name a writer could address the file with.
 */
export function isAiRequestsFile(filename: string): boolean {
  return filename === AI_REQUESTS_FILE;
}

const EMPTY: AiRequestsState = { requests: [] };

/**
 * A mutation of the inbox: a PURE function from the current list to the next
 * one, or `null` for "nothing to change" (no write, no publish).
 *
 * Purity is load-bearing rather than stylistic. The function runs while the
 * doc lock is held, and a caller that also applies it optimistically to React
 * state runs it a SECOND time against a different base — so it must close over
 * everything it needs (a pre-built request object, a pre-built id map) and
 * must not mint ids, read the clock, or touch storage itself.
 */
export type AiRequestsMutator = (requests: AiRequest[]) => AiRequest[] | null;

/** Tolerate a backend that resolves a missing sidecar to null/undefined, or a
 *  file whose `requests` key is not an array (hand-edited / older shape).
 *
 *  RAW by contract — this is the MERGE BASE every mutation is computed from,
 *  and a mutation is a pure function of the list as it is ON DISK. Normalising
 *  here would make the gate below lossy in the one direction that matters: the
 *  normalised value would be written straight back, so a newer build's kind (or
 *  any field this build does not model) would be overwritten by the older
 *  build's idea of it on the very next toggle. The file is the user's only copy.
 *  Readers get {@link normalizeAiRequestRows}; writers get the bytes. */
function requestsOf(state: AiRequestsState | null | undefined): AiRequest[] {
  return Array.isArray(state?.requests) ? state.requests : [];
}

/**
 * THE inbound gate (task 682): make every row a renderable record, without
 * overwriting a value that carries meaning.
 *
 * The store's tolerance used to stop at the top level — `Array.isArray` on the
 * `requests` key, then every element handed through untouched. But this is the
 * one sidecar with THREE writers, two of them outside the type system (the
 * `/editor/*` Python skills read-modify-write it on disk while the paper is
 * open), and it is hand-editable besides. So a row is unvalidated JSON, and the
 * AI window dereferenced its fields as if it were an `AiRequest`: an off-union
 * `kind` resolved `undefined` out of two per-kind `Record`s and the next
 * dereference THREW — taking down the whole window, and with it the user's view
 * of every other request in the paper. One malformed byte, total failure. A
 * missing `createdAt` did the same one field over, through the bucket sort's
 * `localeCompare`.
 *
 * Two rules, and the second is what keeps the first honest:
 *
 *   1. **Every field a consumer dereferences is present and of the right
 *      primitive type.** No reader needs a `typeof` check, and no reader may
 *      throw on a row that reached it.
 *   2. **No value that carries meaning is overwritten, and no row is dropped**
 *      for being unrecognised. An off-union `kind` is kept VERBATIM — it is a
 *      real token some writer meant (a newer build's kind, a skill's typo), the
 *      reader's job is to say it cannot resolve it, and `AIWindow` renders it as
 *      the row's own label. Only a field with no value at all is filled in.
 *
 * Applied at the two CONSUMER exits (`readAiRequests`, and the authoritative
 * list `mutateAiRequests` returns and publishes) — never to the merge base.
 */
export function normalizeAiRequestRows(rows: readonly unknown[]): AiRequest[] {
  const out: AiRequest[] = [];
  rows.forEach((raw, i) => {
    // A non-object element is not a record: it has no field to render, no id to
    // key or cancel by, and nothing a placeholder could honestly say about it.
    // Dropped from the READ only — `requestsOf` still merges over it, so the
    // bytes stay on disk for whoever wrote them.
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return;
    const r = raw as Record<string, unknown>;
    const str = (v: unknown, fallback: string) =>
      typeof v === "string" && v ? v : fallback;
    const linkedTo =
      typeof r.linkedTo === "object" && r.linkedTo !== null
        ? (r.linkedTo as Record<string, unknown>)
        : null;
    out.push({
      ...(r as unknown as AiRequest),
      // Stable within one read, so React keys and the cancel round-trip hold.
      // A row with no id cannot be addressed by any mutator, so its cancel is a
      // no-op — but it RENDERS, which is how anyone learns it is there.
      id: str(r.id, `unkeyed:${i}`),
      kind: str(r.kind, UNKNOWN_AI_REQUEST_KIND),
      text: typeof r.text === "string" ? r.text : "",
      createdAt: str(r.createdAt, ""),
      status: str(r.status, "pending") as AiRequest["status"],
      ...(linkedTo &&
      typeof linkedTo.panel === "string" &&
      typeof linkedTo.cardId === "string"
        ? {}
        : { linkedTo: undefined }),
    });
  });
  return out;
}

/**
 * Read the inbox from disk. A DIRECT read (bypasses the sidecar bundle cache),
 * so both the mount load and the external-change re-hydrate see the file as it
 * actually is. Resolves `[]` for an absent file; re-throws a real read error so
 * a caller can leave its state untouched rather than blanking the inbox.
 *
 * Rows come back through {@link normalizeAiRequestRows} — renderable by
 * contract, and still carrying whatever their writer meant.
 */
export async function readAiRequests(docId: string): Promise<AiRequest[]> {
  return normalizeAiRequestRows(
    requestsOf(await readSidecar<AiRequestsState>(docId, AI_REQUESTS_FILE, EMPTY)),
  );
}

/**
 * What a mutation DID (task 630) — a discriminated result, not a sentinel.
 *
 * The door used to resolve `AiRequest[] | null`, and that single `null`
 * collapsed five outcomes that call for three different behaviours:
 *
 *   - `declined` — the mutator itself said "nothing to change" (the row is
 *     already gone, the toggle is idempotent). The optimistic apply returned
 *     the same `prev`, so there is nothing to undo and nothing to say.
 *   - `stale` — the doc switched under the write and the NEW owner is
 *     authoritative. Silent, and NOT rolled back: this window's state is about
 *     to be replaced wholesale anyway, and a notice here would be a lie about a
 *     document the user has already left.
 *   - `no-handle` / `read-only` / `failed` — nothing reached disk and nothing
 *     will. The optimistic row is a PHANTOM: it shows in the panel, lights the
 *     inbox dot, and is gone on the next reload with no explanation. These are
 *     the three the caller must roll back and SAY.
 *
 * Collapsing them is why no caller could behave differently for them, which is
 * the whole defect. The shape is the house one — the same discriminated result
 * the FSA picker door takes (`PickFolderResult`, chosen so a caller "can
 * surface a stuck-picker state instead of silently no-op'ing").
 */
export type AiRequestsWriteResult =
  | { kind: "written"; requests: AiRequest[] }
  | { kind: "declined" }
  | { kind: "stale" }
  | { kind: "no-handle" }
  | { kind: "read-only" }
  | { kind: "failed"; error: unknown };

/** Did this result mean the user's change is NOT on disk and never will be? */
export function isAiRequestsWriteRefused(
  r: AiRequestsWriteResult,
): r is { kind: "no-handle" } | { kind: "read-only" } | { kind: "failed"; error: unknown } {
  return r.kind === "no-handle" || r.kind === "read-only" || r.kind === "failed";
}

/**
 * Apply `mutate` to the inbox through the serialized read-modify-write door and
 * announce the result.
 *
 * Resolves {@link AiRequestsWriteResult}. Best-effort by contract: this never
 * throws (its callers are UI event handlers and a fire-and-forget bridge), and
 * it publishes ONLY after a write that actually landed, so the in-memory inbox
 * can never diverge from the on-disk queue in the direction that matters.
 *
 * ## Telling a DECLINED mutation from a REFUSED one
 *
 * `mutateSidecar` answers `null` both ways — the mutator returned `null`, or
 * the host refused the file before the mutator ever ran (a `library-paper:` doc
 * may persist only its derived writable set; the funnel short-circuits on the
 * same question one layer down). The difference is observable from inside the
 * mutator callback and nowhere else, so that is where it is taken: `ran` is set
 * the moment the mutator is invoked. `null` with `ran` is the mutator's own
 * "nothing to change"; `null` WITHOUT it means the write never got that far.
 *
 * Deliberately not re-asked as `libraryPaperSidecarWritable(...)` here: that
 * would be a second speller of the funnel's own gate, and it would answer only
 * for the refusal reason it happens to know about — `ran` is true of every
 * refusal the funnel has now or grows later.
 */
export async function mutateAiRequests(
  docId: string | null,
  mutate: AiRequestsMutator,
): Promise<AiRequestsWriteResult> {
  if (!docId) return { kind: "no-handle" };
  const handle = getActiveHandle(docId);
  if (!handle) return { kind: "no-handle" };

  let ran = false;
  let next: AiRequestsState | null;
  try {
    next = await mutateSidecar<AiRequestsState>(
      handle,
      AI_REQUESTS_FILE,
      EMPTY,
      (current) => {
        ran = true;
        const updated = mutate(requestsOf(current));
        return updated === null ? null : { requests: updated };
      },
    );
  } catch (err) {
    if (isStalePipelineError(err)) return { kind: "stale" };
    console.error("Failed to persist ai requests:", err);
    return { kind: "failed", error: err };
  }
  // `== null`, not `=== null`: "nothing was written" is the ABSENCE of a next
  // state, and absence has two runtime spellings. The declared contract says
  // `T | null`, but a door is only ever as faithful as whatever is standing in
  // for it, and the thing that answered here is not always the real door — a
  // stub, a partial fake, a backend that grew a `return;` path. This narrowing
  // sits AFTER the `try`, so the `undefined` spelling did not fall into the
  // catch: it dereferenced, and with no caller awaiting it (task 643) surfaced
  // as an unhandled rejection rather than a `failed` result. Asking the
  // question that covers both spellings costs nothing and removes the only way
  // this line can throw.
  if (next == null) return ran ? { kind: "declined" } : { kind: "read-only" };

  // Announce the authoritative post-write list so every live reader in THIS
  // window (the inbox hook) adopts it without a disk round-trip. Only after a
  // successful persist — a failed write leaves the on-disk queue unchanged, so
  // the in-memory inbox must not diverge from it.
  // The SAME read gate the mount load goes through (task 682). The merge base
  // was raw — as it must be, so the write preserved the bytes — which means the
  // post-write list carries every unvalidated row the file held. Publishing it
  // un-normalised would hand the inbox a crash-shaped row through the back
  // door: one toggle after a clean read, and the window dies anyway.
  const published = normalizeAiRequestRows(next.requests);
  publishAiRequests(docId, published);
  return { kind: "written", requests: published };
}

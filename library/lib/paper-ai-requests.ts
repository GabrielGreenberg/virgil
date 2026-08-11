/**
 * The five paper AI requests, declared ONCE.
 *
 * Each kind needs three things wired in lockstep: the on-disk **queue kind**
 * that means "checked" (the READ), the enqueue/cancel pair (the WRITE), and
 * the precondition that greys the control. Before this they lived in three
 * separate places inside `PaperHeader` — a `REQUESTS` label array, an
 * if-chain per toggle direction, and a `disabledFor` switch — so a kind could
 * be (and was) half-wired: the read path was a set of hand-picked filenames
 * that no writer referenced, which is exactly how it drifted out of sync with
 * the disk.
 *
 * `PAPER_REQUESTS_BY_KIND` is a `Record` over the `PaperRequestKind` union, so
 * a kind declared and left unwired is a COMPILE error — the
 * `buildInlineAtomCardApis` discipline from the root AGENTS.md ("a per-kind
 * capability is DERIVED, never hand-enumerated"), applied to the queue.
 */

import {
  cancelBibReview,
  cancelDeepIndex,
  cancelImportBib,
  cancelIndex,
  cancelPaperReview,
  queueBibReview,
  queueDeepIndex,
  queueImportBib,
  queueIndex,
  queuePaperReview,
} from "./bib-edit";
import type { QueueKind } from "./queue";

export type PaperRequestKind = "index" | "deep" | "bib" | "doc" | "importbib";

/** Everything a request needs from the surface that files it. */
export interface PaperRequestContext {
  root: FileSystemDirectoryHandle;
  citekey: string;
  /** The user's optional instructions note, already trimmed. */
  note: string;
  /** True when the paper isn't indexed yet — deep index queues a companion
   *  plain index in that case. */
  indexNeeded: boolean;
}

export interface PaperRequestDescriptor {
  kind: PaperRequestKind;
  /** Menu label. */
  label: string;
  /** The on-disk queue kind whose `requested` entry means "this box is
   *  checked". Note `index` and `bib` (→ `authenticate`) SHARE
   *  `queue/<citekey>.json`; they are told apart by this field, never by
   *  filename. */
  queueKind: QueueKind;
  /** When set, the request needs an indexed paper; the string is the
   *  disabled-state tooltip. */
  requiresIndexed?: string;
  enqueue: (ctx: PaperRequestContext) => Promise<unknown>;
  cancel: (ctx: PaperRequestContext) => Promise<unknown>;
}

export const PAPER_REQUESTS_BY_KIND: Record<
  PaperRequestKind,
  PaperRequestDescriptor
> = {
  index: {
    kind: "index",
    label: "Index",
    queueKind: "index",
    enqueue: ({ root, citekey, note }) => queueIndex(root, citekey, note),
    cancel: ({ root, citekey }) => cancelIndex(root, citekey),
  },
  deep: {
    kind: "deep",
    label: "Deep index",
    queueKind: "deepIndex",
    enqueue: ({ root, citekey, note, indexNeeded }) =>
      queueDeepIndex(root, citekey, note, indexNeeded),
    cancel: ({ root, citekey }) => cancelDeepIndex(root, citekey),
  },
  bib: {
    kind: "bib",
    label: "Bib review",
    queueKind: "authenticate",
    enqueue: ({ root, citekey, note }) => queueBibReview(root, citekey, note),
    cancel: ({ root, citekey }) => cancelBibReview(root, citekey),
  },
  doc: {
    kind: "doc",
    label: "Doc review",
    queueKind: "paper-review",
    requiresIndexed: "Index the paper first to file a document AI request",
    enqueue: ({ root, citekey, note }) => queuePaperReview(root, citekey, note),
    cancel: ({ root, citekey }) => cancelPaperReview(root, citekey),
  },
  importbib: {
    kind: "importbib",
    label: "Import bib",
    queueKind: "import-bib",
    requiresIndexed: "Index the paper first to import its bibliography",
    enqueue: ({ root, citekey, note }) => queueImportBib(root, citekey, note),
    cancel: ({ root, citekey }) => cancelImportBib(root, citekey),
  },
};

/** Display order for the AI-requests menu. Pinned against the record by
 *  `paper-ai-requests.test.ts` so a newly-declared kind can't render nowhere. */
export const PAPER_REQUEST_ORDER: readonly PaperRequestKind[] = [
  "index",
  "deep",
  "bib",
  "doc",
  "importbib",
];

export const PAPER_REQUESTS: readonly PaperRequestDescriptor[] =
  PAPER_REQUEST_ORDER.map((k) => PAPER_REQUESTS_BY_KIND[k]);

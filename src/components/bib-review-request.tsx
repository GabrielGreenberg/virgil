"use client";

/**
 * The bib card's AI review request — ONE control for both pods (task 981).
 *
 * The BibTeX Fields pod and the Annotations pod each used to hand-roll a
 * byte-identical chip + note strip, and both minted the request ON THE CLICK
 * that opened the strip — so the note box only appeared once the request was
 * already written, and nothing ever sent what the user typed into it (the row
 * always carried `requestNotes: undefined`, the field `/editor/answer-bib-review`
 * is built to read). Now the order is compose-then-send, like every other AI
 * request composer in the app:
 *
 *   idle      → chip "Request …"   click opens the composer (no write yet)
 *   composing → chip "Send"        click or Return MINTS the request with the
 *                                  typed note (empty is fine); Escape CANCELS
 *                                  — nothing was written, nothing is (the
 *                                  *Escape means cancel* law)
 *   pending   → chip "Requested"   click cancels the request; the strip shows
 *                                  the note READ BACK from the persisted row,
 *                                  so a reload or the popped float shows what
 *                                  was actually sent
 *
 * The chip sits in the pod header and the strip in the pod body, so this is a
 * pair of components over one per-type copy table and one state machine the
 * card owns (`useReviewRequestComposer`).
 */

import React, { useCallback, useState } from "react";
import {
  AMBER_ATTENTION_STRIP,
  AMBER_PENDING_CHIP,
} from "@/panels/_shared/amber-attention";
import { StatusDot } from "@/components/StatusDot";

export type BibReviewType = "fields" | "notes";
export type BibReviewStatus = "none" | "pending" | "complete";

/** Per-type copy — the only thing the two pods' controls differ by. */
export const REVIEW_REQUEST_COPY: Record<
  BibReviewType,
  { label: string; hint: string; placeholder: string }
> = {
  fields: {
    label: "Request review",
    hint: "Request AI review of fields",
    placeholder: "Note for the reviewer (optional) — Return to send",
  },
  notes: {
    label: "Request annotation",
    hint: "Request AI-generated annotation",
    placeholder: "Note for the annotator (optional) — Return to send",
  },
};

/**
 * The card-owned composer state: which types are mid-compose and their drafts.
 * `request` is the WRITE door (null on a read-only preview card — the task-692
 * gate), so nothing here can mint without the card having answered it.
 */
export function useReviewRequestComposer(opts: {
  bibKey: string;
  request: ((bibKey: string, type: BibReviewType, notes?: string) => void) | null;
  cancel: ((bibKey: string, type: BibReviewType) => void) | null;
  getStatus: (bibKey: string, type: BibReviewType) => BibReviewStatus;
  /** Called when a composer opens, so the card can expand the pod it lives in. */
  onOpen?: (type: BibReviewType) => void;
}) {
  const { bibKey, request, cancel, getStatus, onOpen } = opts;
  const [drafts, setDrafts] = useState<Partial<Record<BibReviewType, string>>>({});

  const isComposing = (type: BibReviewType) => drafts[type] !== undefined;

  const close = useCallback((type: BibReviewType) => {
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[type];
      return next;
    });
  }, []);

  const send = useCallback(
    (type: BibReviewType) => {
      if (!request) return;
      const note = (drafts[type] ?? "").trim();
      request(bibKey, type, note || undefined);
      close(type);
    },
    [request, bibKey, drafts, close],
  );

  /** The chip's click — one gesture, three meanings by state. */
  const toggle = useCallback(
    (type: BibReviewType) => {
      if (!request || !cancel) return;
      if (getStatus(bibKey, type) === "pending") {
        cancel(bibKey, type);
        close(type);
      } else if (drafts[type] !== undefined) {
        send(type);
      } else {
        setDrafts((prev) => ({ ...prev, [type]: "" }));
        onOpen?.(type);
      }
    },
    [request, cancel, getStatus, bibKey, drafts, send, close, onOpen],
  );

  const setDraft = useCallback((type: BibReviewType, text: string) => {
    setDrafts((prev) => ({ ...prev, [type]: text }));
  }, []);

  return { isComposing, draftOf: (t: BibReviewType) => drafts[t] ?? "", setDraft, send, close, toggle };
}

export type ReviewRequestComposer = ReturnType<typeof useReviewRequestComposer>;

function SparkleIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
      <g transform="rotate(15 12 12)">
        <line x1="12" y1="2" x2="12" y2="22" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
        <line x1="19.07" y1="4.93" x2="4.93" y2="19.07" />
      </g>
    </svg>
  );
}

/** The chip in the pod header. */
export function ReviewRequestChip({
  type,
  status,
  composer,
}: {
  type: BibReviewType;
  status: BibReviewStatus;
  composer: ReviewRequestComposer;
}) {
  const copy = REVIEW_REQUEST_COPY[type];
  const pending = status === "pending";
  const composing = !pending && composer.isComposing(type);
  const hint = pending
    ? "Click to cancel request"
    : composing
      ? "Send request"
      : copy.hint;
  return (
    <button
      type="button"
      data-review-request-chip={type}
      onClick={(e) => { e.stopPropagation(); composer.toggle(type); }}
      className={`ml-auto flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded transition-colors ${
        pending || composing
          ? AMBER_PENDING_CHIP
          : "text-ink-muted hover:text-ink-body hover-on-light"
      }`}
      data-hint={hint}
      aria-description={hint}
    >
      {pending ? (
        <><StatusDot tone="pending" size="md" motion="ping" /><span>Requested</span></>
      ) : composing ? (
        <><SparkleIcon /><span>Send</span></>
      ) : (
        <><SparkleIcon /><span>{copy.label}</span></>
      )}
    </button>
  );
}

/**
 * The strip in the pod body: an editable note while composing, the SENT note
 * (read back from the persisted row) while pending, nothing otherwise.
 */
export function ReviewRequestStrip({
  type,
  status,
  sentNote,
  composer,
}: {
  type: BibReviewType;
  status: BibReviewStatus;
  sentNote: string | undefined;
  composer: ReviewRequestComposer;
}) {
  if (status === "pending") {
    if (!sentNote) return null;
    return (
      <div
        data-review-request-sent={type}
        className={`${AMBER_ATTENTION_STRIP} rounded-md border overflow-hidden text-xs text-ink-body`}
        onClick={(e) => e.stopPropagation()}
      >
        {sentNote}
      </div>
    );
  }
  if (!composer.isComposing(type)) return null;
  return (
    <div
      className={`${AMBER_ATTENTION_STRIP} rounded-md border overflow-hidden`}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        type="text"
        autoFocus
        data-review-request-note={type}
        value={composer.draftOf(type)}
        onChange={(e) => composer.setDraft(type, e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            composer.send(type);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            composer.close(type);
          }
        }}
        placeholder={REVIEW_REQUEST_COPY[type].placeholder}
        className="w-full text-xs bg-transparent text-ink-body placeholder:text-ink-muted focus:outline-none"
      />
    </div>
  );
}

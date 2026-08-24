"use client";

import {
  createContext,
  useContext,
  useEffect,
  type ReactNode,
} from "react";

/**
 * The float body → float chrome report channel for ONE fact: **this float's
 * source no longer exists in the main document** (task 435).
 *
 * ## Why a channel at all
 *
 * A text-object float OUTLIVES its source — `stack-capture.ts` says so in as
 * many words ("a deleted paragraph, an unmappable id … a fact about this
 * moment"). The body already detects it (`useFloatMainSync` →
 * `setSourceMissing`) and already announces it (`SourceMissingBanner`,
 * "Source paragraph deleted — float is disconnected"). The CHROME above that
 * banner painted a live jump chevron, because `textObjectFloatable` states
 * `canJump: true` statically and `FloatChrome` renders exactly what it is told.
 * One 24px strip contradicting itself, and clicking the chevron called
 * `scrollToParagraphId` on a uuid the document no longer has.
 *
 * `canJump` cannot be resolved in the builder: it is read when `FloatHost`
 * re-renders, and the source dies on a transaction that need never re-render
 * `FloatHost`. So the fact has to travel UP, from the body that observes it to
 * the window that owns the chrome.
 *
 * ## Why the BANNER is the reporter
 *
 * This carries the FACT ("the source is missing"), never an AFFORDANCE
 * ("hide the jump button"). One resolution, two drawings — the banner the user
 * reads and the chrome affordance — exactly the law `AGENTS.md` states under
 * "The resolution half: two DRAWINGS of one anchor read ONE resolution". A
 * `setCanJump` channel would have been the body RESTATING the chrome's
 * decision, and the next chrome element that depends on the same fact would
 * need a second channel of its own.
 *
 * And the reporter is `SourceMissingBanner` ITSELF, mounted iff the source is
 * missing, rather than a setter threaded through
 * `FloatBodyContext` → `TextObjectFloatBodyProps` → each of the ten float
 * bodies. That threading is a per-body obligation, i.e. ten chances to forget
 * and a new body that inherits nothing; binding the report to the banner makes
 * the agreement STRUCTURAL — you cannot paint the banner without withdrawing
 * the chevron, and a body that detects a missing source but tells the user
 * nothing reports nothing, which is correct, because the user is not being
 * told either.
 *
 * ## Cost
 *
 * Zero per-keystroke work: the effect runs on the banner's MOUNT and UNMOUNT —
 * the present↔missing edge — not per transaction. A body outside a float (or
 * any host that provides no channel) resolves `null` and the hook is inert.
 */
export interface FloatSourceReport {
  /** Called with `true` while a float body is telling the user its source is
   *  gone, and `false` when it stops. The window derives its chrome from it. */
  report(missing: boolean): void;
}

const FloatSourceReportContext = createContext<FloatSourceReport | null>(null);

export function FloatSourceReportProvider({
  value,
  children,
}: {
  value: FloatSourceReport;
  children: ReactNode;
}) {
  return (
    <FloatSourceReportContext.Provider value={value}>
      {children}
    </FloatSourceReportContext.Provider>
  );
}

/**
 * Declare, for this component's lifetime, that the float's source is missing.
 * Called by `SourceMissingBanner` — its ONE caller, and the reason the report
 * cannot drift from what the user is shown. Clears on unmount (the source came
 * back — an undo restoring the paragraph — or the body stopped saying so).
 */
export function useReportFloatSourceMissing(): void {
  const ctx = useContext(FloatSourceReportContext);
  useEffect(() => {
    if (!ctx) return;
    ctx.report(true);
    return () => ctx.report(false);
  }, [ctx]);
}

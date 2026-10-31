"use client";

/**
 * **BarStatusAnnouncer — the ONE live region every Virgil-bar status pill
 * speaks through** (task 1390).
 *
 * A live region that only appears WITH its text is not read out: assistive
 * tech announces a CHANGE to a region it already knows about. Every bar item
 * returns `null` while hidden (`useBarStatusVisible`), so a pill that carried
 * its own `aria-live` was created already holding its sentence — "Unsaved",
 * "Changed on disk", "Focus view" appeared silently. Only the widget pill
 * (task 1214) kept its region mounted; the rule it stated applied on one
 * branch.
 *
 * > **The bar has one announcer, mounted for the cluster's whole life; a pill
 * > WRITES its sentence into it on its visibility edge (and when the sentence
 * > changes), and the visible pill carries no live-region attribute.** So
 * > nothing is announced twice, and nothing appears silently.
 *
 * Two regions, because politeness is per-message: `polite` (`role="status"`)
 * and `assertive` (`role="alert"`), chosen by the tone's pairing
 * (`barStatusAnnouncement`). A pill outside any announcer (a standalone test
 * mount) speaks nowhere — the context default is `null`.
 */

import { createContext, useCallback, useContext, useRef, type ReactNode } from "react";

export type BarStatusPoliteness = "polite" | "assertive";

export type BarStatusAnnounce = (text: string, politeness: BarStatusPoliteness) => void;

const BarStatusAnnouncerContext = createContext<BarStatusAnnounce | null>(null);

/** The cluster's announce door, or `null` outside a bar. */
export function useBarStatusAnnounce(): BarStatusAnnounce | null {
  return useContext(BarStatusAnnouncerContext);
}

/** A no-break space appended on a REPEAT, so the same sentence re-appearing
 *  (Unsaved → Saved → Unsaved) is still a change the region announces. */
const REPEAT_MARK = " ";

export function BarStatusAnnouncer({ children }: { children: ReactNode }) {
  const politeRef = useRef<HTMLSpanElement | null>(null);
  const assertiveRef = useRef<HTMLSpanElement | null>(null);
  // Written imperatively: the regions hold no React children, and a state
  // write here would re-render the whole cluster for a string nobody sees.
  const announce = useCallback<BarStatusAnnounce>((text, politeness) => {
    const el = politeness === "assertive" ? assertiveRef.current : politeRef.current;
    if (!el) return;
    el.textContent = el.textContent === text ? text + REPEAT_MARK : text;
  }, []);
  return (
    <BarStatusAnnouncerContext.Provider value={announce}>
      {children}
      <span
        ref={politeRef}
        className="sr-only"
        role="status"
        aria-live="polite"
        data-bar-status-announcer="polite"
      />
      <span
        ref={assertiveRef}
        className="sr-only"
        role="alert"
        aria-live="assertive"
        data-bar-status-announcer="assertive"
      />
    </BarStatusAnnouncerContext.Provider>
  );
}

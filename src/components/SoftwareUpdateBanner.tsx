"use client";

/**
 * **The service-worker update banner** — and, since task 391, the gate in
 * front of it.
 *
 * On 2026-08-19 this button was the literal trigger of a ~70-minute data loss.
 * A sync daemon had reverted the paper's `.tex`; the DiskWatcher detected it
 * and the clobber guard correctly PAUSED autosave, so every edit for the next
 * hour lived in memory alone. Then the overnight deploy's banner appeared,
 * offering nothing but "click to refresh" — `applyUpdate()` posted
 * `SKIP_WAITING`, the controller changed, the page reloaded, and memory went
 * with it. The banner knew nothing about any of it.
 *
 * > **A door that drops memory asks first whether memory is the only copy.**
 * > The click flushes, then VERIFIES against the unsaved-work channel — a
 * > refused write returns normally, so the flush resolving proves nothing —
 * > and only reloads when the work is on disk. When it is not, the banner
 * > refuses to reload quietly: it says which paper, how long it has been
 * > unsaved, and why it cannot land, and it offers the update anyway only
 * > behind a danger confirm that states the mirror has been taken.
 *
 * The banner stays VISIBLE while blocked rather than disappearing. A control
 * that vanishes teaches nothing; one that says "waiting for unsaved work" is
 * the first place the user learns their work is not landing — which, in the
 * incident, was the fact nobody surfaced for 70 minutes.
 *
 * TASK 610 — the reload `SKIP_WAITING` causes is APP-WIDE (activation moves
 * every window to the new worker), so the click asks EVERY live window, not
 * just this one (`prepareAllWindowsForReload`). A window that does not answer
 * is named as unknown and must be confirmed past, never treated as clean. And
 * a window whose work kept it open when another window updated shows the
 * second state, "updated in another window": its click reloads only itself,
 * behind the same local check.
 *
 * KEYSTROKE SANCTITY: reads state only through `useSyncExternalStore` over the
 * unsaved-work channel, which notifies on the clean→dirty EDGE. No editor
 * subscription, no per-keystroke work.
 */

import { memo, useCallback, useState } from "react";

import { applyUpdate, useUpdateState } from "@/hooks/useUpdateAvailable";
import {
  prepareAllWindowsForReload,
  prepareForReload,
  type AppReloadReadiness,
  type UnlandedDoc,
  type WindowUnlandedDoc,
} from "@/lib/reload-door";
import { describeAge, describeBlockReason } from "@/lib/save-state";
import { useAnyUnlandedWork } from "@/hooks/useUnsavedWork";
import { useConfirmDialog } from "./ConfirmDialog";

function UpdateIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2.5 8a5.5 5.5 0 0 1 9.4-3.9L13.5 5.5" />
      <path d="M13.5 2.5v3h-3" />
      <path d="M13.5 8a5.5 5.5 0 0 1-9.4 3.9L2.5 10.5" />
      <path d="M2.5 13.5v-3h3" />
    </svg>
  );
}

/**
 * Why the write did not land, in the user's terms — and, crucially, WHICH flow
 * they have to resolve. A block with no route out is a dead end.
 *
 * TASK 392: the per-reason half is the SHARED vocabulary (`save-state.ts`), not
 * a second copy. This banner used to spell its own three sentences while the
 * conflict pill spelled others and a console.error spelled a third set — which
 * is exactly the "each gate speaks its own dialect" finding, arriving as three
 * plausible paragraphs rather than as a bug. What stays local is the FRAMING
 * (which paper, how long), because only this surface is app-wide.
 */
export function describeBlock(d: UnlandedDoc | WindowUnlandedDoc): string {
  const where =
    "windowId" in d && d.windowId !== null ? " (in another Virgil window)" : "";
  const head = `“${d.docId}”${where} — ${describeAge(d.ageMs)} of unsaved changes`;
  if (!d.reason) return `${head} that have not reached disk yet.`;
  return `${head}; ${describeBlockReason(d.reason).sentence}`;
}

/** What the confirm lists: every unlanded doc, then every window that did
 *  not answer (unknown is a block, never clean). */
export function describeReadiness(r: AppReloadReadiness): string[] {
  const lines = r.unlanded.map(describeBlock);
  if (r.unresponsive.length === 1) {
    lines.push(
      "Another Virgil window did not answer in time, so Virgil cannot tell whether it has unsaved changes.",
    );
  } else if (r.unresponsive.length > 1) {
    lines.push(
      `${r.unresponsive.length} other Virgil windows did not answer in time, so Virgil cannot tell whether they have unsaved changes.`,
    );
  }
  return lines;
}

function SoftwareUpdateBannerImpl() {
  const updateState = useUpdateState();
  const updateAvailable = updateState !== "none";
  const elsewhere = updateState === "activated-elsewhere";
  const anyUnlanded = useAnyUnlandedWork();
  const { confirm, dialog } = useConfirmDialog();
  const [checking, setChecking] = useState(false);

  const handleClick = useCallback(async () => {
    if (checking) return;
    setChecking(true);
    let readiness: AppReloadReadiness;
    try {
      // Updating reloads EVERY window, so ask them all. A reload after
      // another window already updated touches only this one.
      if (elsewhere) {
        const mine = await prepareForReload();
        readiness = {
          unlanded: mine.unlanded.map((d) => ({ ...d, windowId: null })),
          mirrored: mine.mirrored,
          unresponsive: [],
        };
      } else {
        readiness = await prepareAllWindowsForReload();
      }
    } finally {
      setChecking(false);
    }
    if (readiness.unlanded.length === 0 && readiness.unresponsive.length === 0) {
      applyUpdate();
      return;
    }
    // Still unlanded (or unknown) after the flush. Do NOT reload on this
    // click — say what is holding, and make the override an explicit,
    // informed choice.
    const verb = elsewhere ? "Reload" : "Update";
    const ok = await confirm({
      title: `${verb} now and lose unsaved work?`,
      message:
        (elsewhere
          ? `Reloading restarts this Virgil window, and this work has not reached disk:\n\n`
          : `Updating restarts every open Virgil window, and this work has not reached disk:\n\n`) +
        describeReadiness(readiness).join("\n\n") +
        `\n\n` +
        (readiness.unlanded.length === 0
          ? `Saving everywhere first is safer.`
          : readiness.mirrored
            ? `Virgil has kept an emergency copy in this browser, and will offer to restore it the next time you open the paper. Even so, saving first is safer.`
            : `Virgil could NOT keep an emergency copy in this browser, so this work would be gone.`),
      confirmLabel: `${verb} anyway`,
      cancelLabel: "Not yet — let me save",
      tone: "danger",
    });
    if (!ok) return;
    applyUpdate();
  }, [checking, confirm, elsewhere]);

  if (!updateAvailable) return null;

  const blocked = anyUnlanded && !checking;
  const label = elsewhere
    ? blocked
      ? "Virgil updated in another window — reload once your work is saved"
      : "Virgil updated — click to reload"
    : blocked
      ? "Virgil update — unsaved work first"
      : "Virgil update — click to refresh";
  const hint = elsewhere
    ? "Virgil was updated in another window — this window keeps the old version until it reloads"
    : blocked
      ? "A Virgil update is ready — it will restart the app, and you have unsaved work"
      : "Virgil update";

  return (
    <>
      <button
        type="button"
        onClick={() => void handleClick()}
        className="topbarbtn"
        data-hint={hint}
        aria-description={hint}
        data-update-banner={blocked ? "blocked" : "ready"}
        data-update-state={updateState}
      >
        <span aria-hidden style={{ display: "inline-flex" }}>
          <UpdateIcon />
        </span>
        {label}
      </button>
      {dialog}
    </>
  );
}

export const SoftwareUpdateBanner = memo(SoftwareUpdateBannerImpl);
export default SoftwareUpdateBanner;

"use client";

import { memo } from "react";
import type { SkillSyncError, SkillSyncNotice } from "@/hooks/useFiles";

interface Props {
  error: SkillSyncError | null;
  notice: SkillSyncNotice | null;
  /** Retry the sync from the failure banner (also the target of the
   *  "Refresh skills" help-menu item, wired at the StatusCluster call site). */
  onResync: () => void;
  onDismissError: () => void;
  onDismissNotice: () => void;
}

const PILL: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  height: 24,
  padding: "0 4px 0 10px",
  borderRadius: 4,
  fontSize: 12,
  fontWeight: 500,
};

/**
 * Top-bar surface for the per-paper skill-bundle sync. Mirrors the
 * "Virgil update — click to refresh" banner idiom (EditorLayout): a loud,
 * dismissible failure banner with Retry (+ "Grant & retry" on a revoked
 * permission), and a "skills updated — restart your cowork session" notice.
 *
 * Both pieces are CONDITIONAL — they render only when a sync fails or
 * succeeds, so the happy path (silent, auto-synced on doc-open) carries no
 * permanent top-bar chrome. The always-available MANUAL re-sync action does
 * NOT live here: it's a "Refresh skills" item in the Virgil-bar help ("?")
 * menu (StatusCluster), which reuses this component's `onResync`.
 *
 * Pure presentational — no editor subscription, so it adds zero
 * per-keystroke work (keystroke-sanctity, AGENTS.md).
 */
function SkillSyncControls({
  error,
  notice,
  onResync,
  onDismissError,
  onDismissNotice,
}: Props) {
  return (
    <>
      {error && (
        <div
          role="alert"
          style={{
            ...PILL,
            maxWidth: 320,
            background: "var(--danger-soft)",
            color: "var(--danger)",
            boxShadow:
              "inset 0 0 0 1px color-mix(in oklab, var(--danger) 30%, transparent)",
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ flexShrink: 0 }}
          >
            <path d="M8 1.5 1 14h14L8 1.5Z" />
            <path d="M8 6.5v3.2" />
            <circle cx="8" cy="11.8" r="0.4" fill="currentColor" stroke="none" />
          </svg>
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={error.message}
          >
            {error.permission
              ? "Skill sync needs permission"
              : "Skill sync failed"}
          </span>
          <button
            onClick={onResync}
            className="topbarbtn"
            style={{ height: 20, color: "var(--danger)" }}
            data-hint={error.message}
          >
            {error.permission ? "Grant & retry" : "Retry"}
          </button>
          <button
            onClick={onDismissError}
            className="topbarbtn topbarbtn-icon"
            style={{ height: 20, color: "var(--danger)" }}
            data-hint="Dismiss"
            aria-label="Dismiss skill-sync error"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            >
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
      )}
      {notice && (
        <div
          role="status"
          style={{
            ...PILL,
            maxWidth: 480,
            background: "var(--accent-light)",
            color: "var(--accent)",
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ flexShrink: 0 }}
          >
            <path d="M13.5 4.5 6.5 11.5 2.5 7.5" />
          </svg>
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            Skills updated to v{notice.version} — restart your Claude Code
            cowork session to pick up the new commands.
          </span>
          <button
            onClick={onDismissNotice}
            className="topbarbtn topbarbtn-icon"
            style={{ height: 20, color: "var(--accent)" }}
            data-hint="Dismiss"
            aria-label="Dismiss skills-updated notice"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            >
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
      )}
    </>
  );
}

export default memo(SkillSyncControls);

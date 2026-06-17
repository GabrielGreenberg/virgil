"use client";

import type { SkillSyncError, SkillSyncNotice } from "@/hooks/useFiles";

interface Props {
  /** Whether a paper is open (gates the persistent Re-sync button). */
  hasDoc: boolean;
  error: SkillSyncError | null;
  notice: SkillSyncNotice | null;
  /** Re-run the sync (and Retry from the failure banner). */
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
 * Top-bar controls for the per-paper skill-bundle sync. Mirrors the
 * "Virgil update — click to refresh" banner idiom (EditorLayout): a loud,
 * dismissible failure banner with Retry, a "skills updated — restart your
 * cowork session" notice, and a persistent manual Re-sync button.
 *
 * Pure presentational — no editor subscription, so it adds zero
 * per-keystroke work (keystroke-sanctity, AGENTS.md). All three pieces
 * are sync-time / explicit-click driven.
 */
export default function SkillSyncControls({
  hasDoc,
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
      {hasDoc && (
        <button
          onClick={onResync}
          className="topbarbtn topbarbtn-icon"
          data-hint="Re-sync skills to this paper"
          aria-label="Re-sync skills to this paper"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2 5.2V12a1.2 1.2 0 0 0 1.2 1.2h9.6A1.2 1.2 0 0 0 14 12V6.2A1.2 1.2 0 0 0 12.8 5H7.4L6 3.2H3.2A1.2 1.2 0 0 0 2 4.4Z" />
            <path d="M8 7.2v3.4M6.4 9.2 8 10.8l1.6-1.6" />
          </svg>
        </button>
      )}
    </>
  );
}

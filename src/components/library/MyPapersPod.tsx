"use client";

/**
 * "My Papers" pod for the leftmost library column. Lists the user's
 * open Virgil docs and exposes an "+ Add paper" affordance whose popup
 * mirrors the Virgil-bar TabPlusMenu (recent papers + Open folder +
 * Create new), so the user has a second entry point to those actions
 * without leaving the Library view.
 *
 * Lives under src/components/library/ (not /library/components/) so it
 * can import from `@/lib/doc-index`, `@/lib/fsa-permissions`, etc. —
 * the library/ subsystem is forbidden from reaching into Virgil's doc
 * machinery directly. The pod is then injected into the navigator
 * column via `LibraryView`'s `belowNavigator` slot.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import NavPod from "@library/components/NavPod";
import { ensureRW } from "@/lib/fsa-permissions";
import { getDocHandle, type FsaDocMeta } from "@/lib/doc-index";

interface Props {
  /** Every known Virgil doc — feeds the popup's "Recent" list. */
  docs: FsaDocMeta[];
  /** Currently-open Virgil docs (rendered in the pod body). */
  openTabs: FsaDocMeta[];
  /** Active Virgil doc id — drives the pod-row highlight. */
  currentDocId: string | null;
  /** Activate an existing or recent doc. Reused for both the body row
   *  click and the popup row click. */
  onOpenRecent: (id: string) => void;
  /** Triggers `showDirectoryPicker()` flow. */
  onOpenFolder: () => void;
  /** Opens the Virgil "create new document" modal. */
  onCreateNew: () => void;
  /** Skips FSA permission re-grant when true (the dev-storage
   *  back-end has no FSA handles). */
  devStorage: boolean;
}

const ACCENT = "var(--accent)";

export default function MyPapersPod({
  docs,
  openTabs,
  currentDocId,
  onOpenRecent,
  onOpenFolder,
  onCreateNew,
  devStorage,
}: Props) {
  const [popupOpen, setPopupOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!popupOpen) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setPopupOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPopupOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [popupOpen]);

  const recents = useMemo(() => {
    const openSet = new Set(openTabs.map((d) => d.id));
    return [...docs]
      .filter((d) => !openSet.has(d.id))
      .sort(
        (a, b) =>
          new Date(b.lastAccessedAt).getTime() -
          new Date(a.lastAccessedAt).getTime(),
      )
      .slice(0, 5);
  }, [docs, openTabs]);

  const handleRecentClick = useCallback(
    async (id: string) => {
      // FSA permissions must be re-granted inside the user-gesture stack;
      // mirrors the TabPlusMenu logic so a recent click survives a
      // re-prompt when permissions have lapsed.
      if (!devStorage) {
        const handle = await getDocHandle(id);
        if (handle) {
          const ok = await ensureRW(handle);
          if (!ok) {
            setPopupOpen(false);
            return;
          }
        }
      }
      onOpenRecent(id);
      setPopupOpen(false);
    },
    [devStorage, onOpenRecent],
  );

  return (
    <NavPod title="My papers">
      {openTabs.length === 0 ? (
        <div
          style={{
            padding: "2px 14px 6px",
            fontSize: 12,
            color: "var(--muted)",
            fontStyle: "italic",
          }}
        >
          No papers open
        </div>
      ) : (
        openTabs.map((doc) => {
          const active = doc.id === currentDocId;
          return (
            <PaperRow
              key={doc.id}
              label={docDisplayLabel(doc)}
              active={active}
              onClick={() => onOpenRecent(doc.id)}
            />
          );
        })
      )}
      <div ref={wrapRef} style={{ position: "relative" }}>
        <button
          type="button"
          onClick={() => setPopupOpen((v) => !v)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            width: "100%",
            padding: "6px 12px 6px 14px",
            background: "transparent",
            border: "none",
            color: "var(--muted)",
            fontSize: 12,
            cursor: "pointer",
            fontFamily: "inherit",
            textAlign: "left",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background =
              "rgba(0, 0, 0, 0.04)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background =
              "transparent";
          }}
          aria-haspopup="menu"
          aria-expanded={popupOpen}
        >
          <span style={{ width: 14, textAlign: "center" }}>+</span>
          <span>Add paper</span>
        </button>
        {popupOpen && (
          <div
            role="menu"
            style={{
              position: "absolute",
              top: "100%",
              left: 6,
              right: 6,
              marginTop: 2,
              background: "var(--pod-editor, var(--surface))",
              border: "var(--pod-border, 1px solid var(--topbar-border))",
              boxShadow: "var(--pod-shadow)",
              borderRadius: "var(--pod-radius, 8px)",
              padding: "6px 0",
              zIndex: 50,
            }}
          >
            {recents.length > 0 && (
              <>
                <div
                  style={{
                    fontSize: 10,
                    color: "var(--muted)",
                    padding: "2px 12px 4px",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    fontFamily: "var(--mono, ui-monospace, monospace)",
                  }}
                >
                  Recent
                </div>
                {recents.map((d) => (
                  <PopupRow
                    key={d.id}
                    label={docDisplayLabel(d)}
                    onClick={() => handleRecentClick(d.id)}
                  />
                ))}
                <div
                  aria-hidden
                  style={{
                    height: 1,
                    background: "var(--topbar-border)",
                    margin: "6px 8px",
                  }}
                />
              </>
            )}
            {!devStorage && (
              <PopupRow
                label="Open folder…"
                onClick={() => {
                  onOpenFolder();
                  setPopupOpen(false);
                }}
              />
            )}
            <PopupRow
              label="Create new document…"
              onClick={() => {
                onCreateNew();
                setPopupOpen(false);
              }}
            />
          </div>
        )}
      </div>
    </NavPod>
  );
}

function PaperRow({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        padding: "0 12px 0 14px",
        height: 28,
        cursor: "pointer",
        background: active
          ? "var(--accent-light, rgba(124, 94, 60, 0.12))"
          : hovered
            ? "rgba(0, 0, 0, 0.04)"
            : "transparent",
      }}
    >
      {active && (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 4,
            bottom: 4,
            width: 3,
            background: ACCENT,
            borderRadius: 2,
            pointerEvents: "none",
          }}
        />
      )}
      <span
        style={{
          flex: 1,
          fontSize: 13,
          lineHeight: "16px",
          color: "var(--foreground)",
          fontWeight: active ? 500 : 400,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
        title={label}
      >
        {label}
      </span>
    </div>
  );
}

function PopupRow({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        background: "transparent",
        border: "none",
        padding: "6px 12px",
        fontSize: 13,
        color: "var(--foreground)",
        cursor: "pointer",
        fontFamily: "inherit",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background =
          "var(--accent-light, rgba(124, 94, 60, 0.12))";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "transparent";
      }}
    >
      {label}
    </button>
  );
}

function docDisplayLabel(doc: FsaDocMeta): string {
  if (doc.name && doc.name !== doc.folderName) return doc.name;
  if (doc.folderName) return doc.folderName;
  return doc.texFilename ?? "Untitled";
}

"use client";

/**
 * "My Papers" pod for the leftmost library column. Renders the user's
 * curated list of papers (the `myPaperIds` global from `useMyPapers`),
 * NOT the currently-open Virgil docs — those are independent. The pod
 * also exposes an "+ Add paper" menu whose paths are the only way to
 * add to the list:
 *   - Recent → click adds that doc (no tab opens here).
 *   - Open folder… / Create new document… → trigger the existing FSA
 *     flows; the parent (`EditorLayout`) auto-adds the resulting doc to
 *     `myPaperIds` on success.
 *
 * Clicking a row in the body opens that doc as a tab via the existing
 * `onOpenRecent` callback. Hovering a row reveals a × button that
 * removes the entry from My Papers but does not close the tab.
 *
 * Lives under src/components/library/ (not /library/components/) so it
 * can import from `@/lib/doc-index`, `@/lib/fsa-permissions`, etc. —
 * the library/ subsystem is forbidden from reaching into Virgil's doc
 * machinery directly. The pod is then injected into the navigator
 * column via `LibraryView`'s `belowNavigator` slot.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import NavPod from "@library/components/NavPod";
import RowMenu from "@library/components/RowMenu";
import { ensureRW } from "@/lib/fsa-permissions";
import { getDocHandle, type FsaDocMeta } from "@/lib/doc-index";

interface Props {
  /** Every known Virgil doc — used to resolve `myPaperIds` to display
   *  metadata and to feed the popup's "Recent" list. */
  docs: FsaDocMeta[];
  /** Curated paper ids — drives the pod body. */
  myPaperIds: string[];
  /** Add a doc id to the curated list. */
  addMyPaper: (id: string) => void;
  /** Remove a doc id from the curated list. */
  removeMyPaper: (id: string) => void;
  /** Active Virgil doc id — drives the pod-row highlight. */
  currentDocId: string | null;
  /** Activate (open as tab) an existing doc — used on row click. */
  onOpenRecent: (id: string) => void;
  /** Triggers `showDirectoryPicker()` flow. The parent wraps this to
   *  auto-add the resulting doc to My Papers. */
  onOpenFolder: () => void;
  /** Opens the Virgil "create new document" modal. The parent wraps
   *  this to auto-add the resulting doc to My Papers. */
  onCreateNew: () => void;
  /** Skips FSA permission re-grant when true (the dev-storage
   *  back-end has no FSA handles). */
  devStorage: boolean;
}

const ACCENT = "var(--accent)";

export default function MyPapersPod({
  docs,
  myPaperIds,
  addMyPaper,
  removeMyPaper,
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

  const docById = useMemo(
    () => new Map(docs.map((d) => [d.id, d])),
    [docs],
  );

  // Resolve curated ids to live FsaDocMeta. Stale ids (doc removed from
  // index) are silently dropped — no row, no error.
  const rows = useMemo(() => {
    const out: FsaDocMeta[] = [];
    for (const id of myPaperIds) {
      const m = docById.get(id);
      if (m) out.push(m);
    }
    return out;
  }, [myPaperIds, docById]);

  // Recent list excludes anything already in My Papers — re-clicking an
  // entry would be a no-op given set semantics on add.
  const recents = useMemo(() => {
    const addedSet = new Set(myPaperIds);
    return [...docs]
      .filter((d) => !addedSet.has(d.id))
      .sort(
        (a, b) =>
          new Date(b.lastAccessedAt).getTime() -
          new Date(a.lastAccessedAt).getTime(),
      )
      .slice(0, 5);
  }, [docs, myPaperIds]);

  const handleRecentClick = useCallback(
    (id: string) => {
      // "Recent" only adds to My Papers — it does NOT open the doc as
      // a tab. No FSA re-grant needed since we're not touching the
      // file system here.
      addMyPaper(id);
      setPopupOpen(false);
    },
    [addMyPaper],
  );

  const handleRowClick = useCallback(
    async (id: string) => {
      // Row click DOES open the doc as a tab. The doc may have been
      // sitting in My Papers across a session boundary, so we re-grant
      // FSA permission inside the user-gesture stack before activating.
      if (!devStorage) {
        const handle = await getDocHandle(id);
        if (handle) {
          const ok = await ensureRW(handle);
          if (!ok) return;
        }
      }
      onOpenRecent(id);
    },
    [devStorage, onOpenRecent],
  );

  return (
    <NavPod title="My papers">
      {rows.length === 0 ? (
        <div
          style={{
            padding: "2px 14px 6px",
            fontSize: 12,
            color: "var(--muted)",
            fontStyle: "italic",
          }}
        >
          No papers added
        </div>
      ) : (
        rows.map((doc) => {
          const active = doc.id === currentDocId;
          return (
            <PaperRow
              key={doc.id}
              label={docDisplayLabel(doc)}
              active={active}
              onClick={() => handleRowClick(doc.id)}
              onRemove={() => removeMyPaper(doc.id)}
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
              // Library surface: edges ride --library-edge, never the warm
              // top-bar token (task 048; guard in tab-chrome-contracts.test.ts).
              border: "var(--pod-border, 1px solid var(--library-edge))",
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
                    // Divider tone from the library edge token (task 048).
                    background: "var(--library-edge)",
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
  onRemove,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  onRemove: () => void;
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
        padding: "0 6px 0 14px",
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
            borderRadius: "var(--radius-xs)",
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
        data-hint={label} aria-label={label}
      >
        {label}
      </span>
      <RowMenu
        items={[{ key: "remove", label: "Remove", onSelect: onRemove }]}
        ariaLabel={`${label} actions`}
        title="Actions"
        minWidth={140}
      />
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

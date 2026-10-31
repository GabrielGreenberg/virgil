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

import { useCallback, useMemo, type CSSProperties } from "react";
import NavPod from "@library/components/NavPod";
import { NavPodEmptyHint, NavPodRow } from "@library/components/NavPodRow";
import RowMenu from "@library/components/RowMenu";
import { ensureRW } from "@/lib/fsa-permissions";
import { getDocHandle, type FsaDocMeta } from "@/lib/doc-index";
import { AnchoredMenu } from "@/components/menu/AnchoredMenu";
import { MenuActionRow } from "@/components/menu/MenuActionRow";
import { MenuSectionLabel, MenuSeparator } from "@/components/menu/MenuChrome";

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

/** The "+ Add paper" trigger: a full-width pod row (its hover tint is the
 *  `triggerClassName`, not a JS mouseenter). */
const ADD_TRIGGER_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  width: "100%",
  padding: "6px 12px 6px 14px",
  border: "none",
  color: "var(--muted)",
  fontSize: 12,
  cursor: "pointer",
  fontFamily: "inherit",
  textAlign: "left",
};

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
        <NavPodEmptyHint>No papers added</NavPodEmptyHint>
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
      {/* The "+ Add paper" menu — on the ONE anchored-menu door since task
          1361 (it was the last census-declared holdout in the Library silo):
          measured flip + clamp, re-anchoring, the menu z-tier above the float
          layer, click-outside + Escape (cancel) + roving keyboard nav, and the
          row vocabulary of every other menu. Every row is a pick, so the menu
          closes on activation. */}
      <AnchoredMenu
        ariaLabel="Add paper"
        wrapperClassName="relative"
        triggerClassName="hover-on-light"
        triggerStyle={ADD_TRIGGER_STYLE}
        containerStyle={{ minWidth: 200, maxWidth: 320 }}
        closeOnInsideClick
        trigger={() => (
          <>
            <span style={{ width: 14, textAlign: "center" }}>+</span>
            <span>Add paper</span>
          </>
        )}
      >
        {recents.length > 0 && (
          <>
            <MenuSectionLabel>Recent</MenuSectionLabel>
            {recents.map((d) => (
              <MenuActionRow
                key={d.id}
                id={`add-paper-recent-${d.id}`}
                label={docDisplayLabel(d)}
                onSelect={() => handleRecentClick(d.id)}
              />
            ))}
            <MenuSeparator />
          </>
        )}
        {!devStorage && (
          <MenuActionRow
            id="add-paper-open-folder"
            label="Open folder…"
            onSelect={onOpenFolder}
          />
        )}
        <MenuActionRow
          id="add-paper-create-new"
          label="Create new document…"
          onSelect={onCreateNew}
        />
      </AnchoredMenu>
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
  return (
    <NavPodRow
      label={label}
      active={active}
      onActivate={onClick}
      trailing={
        <RowMenu
          items={[{ key: "remove", label: "Remove", onSelect: onRemove }]}
          ariaLabel={`${label} actions`}
          title="Actions"
          minWidth={140}
        />
      }
    />
  );
}

function docDisplayLabel(doc: FsaDocMeta): string {
  if (doc.name && doc.name !== doc.folderName) return doc.name;
  if (doc.folderName) return doc.folderName;
  return doc.texFilename ?? "Untitled";
}

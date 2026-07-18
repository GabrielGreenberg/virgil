"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  CENTRAL_LIBRARY_ID,
  type Library,
  type Registry,
} from "@library/lib/library-store";
import { ENTRIES_DT_TYPE, ENTRY_DT_TYPE } from "@library/lib/dnd-types";
import NavPod from "./NavPod";
import RowMenu, { type RowMenuEntry } from "./RowMenu";

interface Props {
  registry: Registry;
  /** Synthetic per-doc project libraries (in doc order). Empty when no
   *  Virgil docs are open. */
  projectLibraries: Library[];
  /** Active library id in the middle column — used for selection
   *  highlight. */
  activeMiddleId: string;
  /** Library ids currently open as tabs in either panel — used to render
   *  a small "open" dot next to non-active rows. */
  openLibraryIds: ReadonlySet<string>;
  /** Open a library into the middle column with replace-or-append
   *  semantics. */
  onOpenLibrary: (libId: string) => void;
  /** Create a new custom library, open it in the middle column, and
   *  return its id so the navigator can enter rename mode immediately. */
  onCreateLibrary: () => string;
  /** Open the system file picker for a `.bib` file, write it into
   *  `unsorted/`, and create a new custom library populated with the
   *  parsed citekeys. Async: the parent runs the FSA work. */
  onCreateLibraryFromBib: () => void | Promise<void>;
  /** Add entries (resolved citekeys / triage keys) to a custom library
   *  via drag-drop. Always batched. */
  onAddEntriesToLibrary: (libId: string, entryKeys: readonly string[]) => void;
  onRenameLibrary: (id: string, label: string) => void;
  /** Re-run the skill sync — surfaced in the Central row's ⋮ menu (F#5). */
  onResync?: () => void;
  /** Re-pick the library folder — Central row's ⋮ menu "Change folder…". */
  onChangeFolder?: () => void;
  /** Delete a custom library (manifest only; entries + master.bib survive).
   *  Host owns the confirm. F#5. */
  onDeleteLibrary?: (id: string) => void;
  /** Import a picked .bib's entries INTO an existing custom library
   *  (membership add). The standalone "Add from .bib" row is retired in
   *  favour of this per-library action + the header's "New from .bib". F#5. */
  onAddBibToLibrary?: (id: string) => void;
}

const ACCENT = "var(--accent)";
const ACCENT_LIGHT = "var(--accent-light)";

export default function LibrariesNavigator({
  registry,
  projectLibraries,
  activeMiddleId,
  openLibraryIds,
  onOpenLibrary,
  onCreateLibrary,
  onCreateLibraryFromBib,
  onAddEntriesToLibrary,
  onRenameLibrary,
  onResync,
  onChangeFolder,
  onDeleteLibrary,
  onAddBibToLibrary,
}: Props) {
  const central = useMemo(
    () => registry.libraries.find((l) => l.id === CENTRAL_LIBRARY_ID) ?? null,
    [registry.libraries],
  );
  const customs = useMemo(
    () => registry.libraries.filter((l) => l.kind === "custom"),
    [registry.libraries],
  );

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState("");

  const startEditing = (id: string, label: string) => {
    setEditingId(id);
    setDraftLabel(label);
  };
  const commitEdit = () => {
    if (!editingId) return;
    const label = draftLabel.trim() || "Untitled";
    onRenameLibrary(editingId, label);
    setEditingId(null);
  };
  const cancelEdit = () => setEditingId(null);

  const handleCreate = () => {
    const id = onCreateLibrary();
    setEditingId(id);
    setDraftLabel("Untitled");
  };

  const centralMenu: RowMenuEntry[] = [
    ...(onResync
      ? [{ key: "resync", label: "Re-sync skills", onSelect: onResync }]
      : []),
    ...(onChangeFolder
      ? [{ key: "changefolder", label: "Change folder…", onSelect: onChangeFolder }]
      : []),
  ];

  const customMenu = (lib: Library): RowMenuEntry[] => [
    { key: "rename", label: "Rename", onSelect: () => startEditing(lib.id, lib.label) },
    ...(onAddBibToLibrary
      ? [{ key: "addbib", label: "Add from .bib…", onSelect: () => onAddBibToLibrary(lib.id) }]
      : []),
    ...(onDeleteLibrary
      ? ([
          { key: "div", divider: true },
          {
            key: "delete",
            label: "Delete library",
            destructive: true,
            onSelect: () => onDeleteLibrary(lib.id),
          },
        ] satisfies RowMenuEntry[])
      : []),
  ];

  const newLibraryMenu: RowMenuEntry[] = [
    { key: "new-empty", label: "New empty library", onSelect: handleCreate },
    {
      key: "new-from-bib",
      label: "New library from .bib…",
      onSelect: () => void onCreateLibraryFromBib(),
    },
  ];

  return (
    <NavPod title="Libraries">
      {central ? (
        <NavRow
          key={central.id}
          label={central.label}
          active={activeMiddleId === central.id}
          isOpen={openLibraryIds.has(central.id)}
          onClick={() => onOpenLibrary(central.id)}
          menuItems={centralMenu.length > 0 ? centralMenu : undefined}
          menuAriaLabel="Central library actions"
        />
      ) : null}

      <SectionHeader>Project libraries</SectionHeader>
      {projectLibraries.length === 0 ? (
        <EmptyHint>No documents open</EmptyHint>
      ) : (
        projectLibraries.map((lib) => (
          <NavRow
            key={lib.id}
            label={lib.label}
            active={activeMiddleId === lib.id}
            isOpen={openLibraryIds.has(lib.id)}
            onClick={() => onOpenLibrary(lib.id)}
          />
        ))
      )}

      <SectionHeader addMenu={newLibraryMenu}>My libraries</SectionHeader>
      {customs.length === 0 ? (
        <EmptyHint>No custom libraries</EmptyHint>
      ) : (
        customs.map((lib) => (
          <NavRow
            key={lib.id}
            label={lib.label}
            active={activeMiddleId === lib.id}
            isOpen={openLibraryIds.has(lib.id)}
            onClick={() => onOpenLibrary(lib.id)}
            editing={editingId === lib.id}
            draftLabel={editingId === lib.id ? draftLabel : undefined}
            onDraftChange={setDraftLabel}
            onCommitEdit={commitEdit}
            onCancelEdit={cancelEdit}
            onStartEdit={() => startEditing(lib.id, lib.label)}
            dropTargetLibId={lib.id}
            onDropEntries={onAddEntriesToLibrary}
            menuItems={customMenu(lib)}
            menuAriaLabel={`${lib.label} actions`}
          />
        ))
      )}
    </NavPod>
  );
}

interface NavRowProps {
  label: string;
  active: boolean;
  isOpen: boolean;
  onClick: () => void;
  editing?: boolean;
  draftLabel?: string;
  onDraftChange?: (v: string) => void;
  onCommitEdit?: () => void;
  onCancelEdit?: () => void;
  onStartEdit?: () => void;
  /** When set, the row accepts entry drops and forwards them via
   *  onDropEntries. */
  dropTargetLibId?: string;
  onDropEntries?: (libId: string, keys: readonly string[]) => void;
  /** Right-aligned ⋮ menu (always visible). Omit for no menu. F#5. */
  menuItems?: RowMenuEntry[];
  menuAriaLabel?: string;
}

function NavRow({
  label,
  active,
  isOpen,
  onClick,
  editing,
  draftLabel,
  onDraftChange,
  onCommitEdit,
  onCancelEdit,
  onStartEdit,
  dropTargetLibId,
  onDropEntries,
  menuItems,
  menuAriaLabel,
}: NavRowProps) {
  const [hovered, setHovered] = useState(false);
  const [dropOver, setDropOver] = useState(false);

  const dataTransferHas = (e: DragEvent<HTMLDivElement>, type: string) => {
    const types = e.dataTransfer.types;
    for (let i = 0; i < types.length; i++) if (types[i] === type) return true;
    return false;
  };
  const readEntryKeys = (e: DragEvent<HTMLDivElement>): string[] => {
    const multi = e.dataTransfer.getData(ENTRIES_DT_TYPE);
    if (multi) {
      try {
        const parsed = JSON.parse(multi);
        if (
          Array.isArray(parsed) &&
          parsed.every((k): k is string => typeof k === "string")
        ) {
          return parsed;
        }
      } catch {
        // fall through
      }
    }
    const single = e.dataTransfer.getData(ENTRY_DT_TYPE);
    return single ? [single] : [];
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!dropTargetLibId) return;
    if (!dataTransferHas(e, ENTRY_DT_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (!dropOver) setDropOver(true);
  };
  const handleDragLeave = () => {
    if (dropOver) setDropOver(false);
  };
  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!dropTargetLibId || !onDropEntries) return;
    const keys = readEntryKeys(e);
    if (keys.length === 0) return;
    e.preventDefault();
    setDropOver(false);
    onDropEntries(dropTargetLibId, keys);
  };

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "0 12px 0 14px",
        height: 28,
        cursor: editing ? "text" : "pointer",
        background: dropOver
          ? ACCENT_LIGHT
          : active
            ? "var(--accent-light, rgba(124, 94, 60, 0.12))"
            : hovered
              ? "rgba(0, 0, 0, 0.04)"
              : "transparent",
        outline: dropOver ? `2px solid ${ACCENT}` : undefined,
        outlineOffset: dropOver ? -2 : undefined,
        borderRadius: dropOver ? "var(--radius-sm)" : 0,
      }}
      onClick={editing ? undefined : onClick}
      onDoubleClick={onStartEdit}
    >
      {/* Left accent bar for the active row */}
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
      {editing ? (
        <RowTitleInput
          value={draftLabel ?? ""}
          onChange={(v) => onDraftChange?.(v)}
          onCommit={() => onCommitEdit?.()}
          onCancel={() => onCancelEdit?.()}
        />
      ) : (
        <span
          style={{
            flex: 1,
            fontSize: 13,
            lineHeight: "16px",
            color: active ? "var(--foreground)" : "var(--foreground)",
            fontWeight: active ? 500 : 400,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={label}
        >
          {label}
        </span>
      )}
      {!editing && isOpen && !active && (
        <span
          aria-hidden
          title="Open in a panel"
          style={{
            flexShrink: 0,
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "var(--muted-light, #aaa)",
          }}
        />
      )}
      {!editing && menuItems && menuItems.length > 0 && (
        <RowMenu items={menuItems} ariaLabel={menuAriaLabel ?? "Library actions"} />
      )}
    </div>
  );
}

function SectionHeader({
  children,
  addMenu,
}: {
  children: ReactNode;
  /** When set, the header shows a "+" that opens this menu (New empty /
   *  New from .bib). Replaces the old single-action onAdd + the standalone
   *  AddFromBibRow. F#5. */
  addMenu?: RowMenuEntry[];
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "10px 8px 4px 14px",
        marginTop: 4,
      }}
    >
      <div
        style={{
          flex: 1,
          fontSize: 10,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          fontFamily: "var(--mono, ui-monospace, monospace)",
        }}
      >
        {children}
      </div>
      {addMenu && addMenu.length > 0 ? (
        <RowMenu
          items={addMenu}
          glyph="+"
          ariaLabel="New custom library"
          title="New custom library"
          minWidth={184}
          triggerStyle={{
            flexShrink: 0,
            background: "transparent",
            border: "none",
            width: 22,
            height: 22,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--muted)",
            cursor: "pointer",
            fontSize: 16,
            lineHeight: 1,
            borderRadius: "var(--radius-xs)",
            padding: 0,
            fontFamily: "inherit",
          }}
        />
      ) : null}
    </div>
  );
}

function EmptyHint({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        padding: "2px 14px 6px",
        fontSize: 12,
        color: "var(--muted)",
        fontStyle: "italic",
      }}
    >
      {children}
    </div>
  );
}

function RowTitleInput({
  value,
  onChange,
  onCommit,
  onCancel,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onCommit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };
  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={handleKeyDown}
      onClick={(e) => e.stopPropagation()}
      style={{
        flex: 1,
        background: "transparent",
        border: "none",
        outline: "none",
        padding: 0,
        margin: 0,
        fontSize: 13,
        lineHeight: "16px",
        fontFamily: "inherit",
        color: "inherit",
      }}
    />
  );
}

"use client";

/**
 * The Virgil bar's Help menu ("?") and its Commands sub-menu — on the `<Menu>`
 * primitive since task 1361.
 *
 * Before, this was the last census-declared HOLDOUT in the bar: its open state
 * and anchor rect lived in `EditorLayout` (the app root, re-rendered by every
 * anchor refresh), it closed through a hand-rolled `window` click listener,
 * Escape did nothing (the Escape-means-cancel law), it carried no menu ARIA
 * and no roving nav — and its Commands sub-menu opened on HOVER only, as an
 * `absolute left-full` child with no horizontal escape, so a keyboard user
 * could not reach it at all and, the "?" sitting at the window's right edge,
 * a mouse user got it half off-screen.
 *
 * Now:
 *   - the trigger, its rect, re-anchoring, flip, click-outside, Escape and the
 *     activedescendant host are `AnchoredMenu`'s, stated once there;
 *   - Commands is a NESTED `MenuProvider` (the R6 stack: only the innermost
 *     open menu owns the keyboard, Escape pops one level), anchored to the
 *     Commands row and placed `right-of` → `left-of`, so it escapes sideways;
 *   - it opens on hover, on click, on Enter/Space and on ArrowRight; ArrowLeft
 *     and Escape close it and hand the keyboard back to the parent;
 *   - Helper mode is a `MenuToggleRow` (a real `menuitemcheckbox`), not a
 *     hand-drawn ✓.
 */

import {
  useCallback,
  useEffect,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { SkillSyncNotice } from "@/hooks/useFiles";
import { VIRGIL_COMMAND_NAMES } from "@/lib/tiptap-extensions";
import { iconHint } from "@/components/Hint";
import {
  AnchoredMenu,
  MenuProvider,
  MenuSeparator,
  MenuToggleRow,
  useMenuItem,
} from "@/components/menu";
import { useMenuContext } from "@/components/menu/context";
import { menuTriggerAria } from "@/components/menu/menu-trigger";
import {
  menuRowRovingStyle,
  menuRowToneClass,
} from "@/components/menu/row-tone";
import type { FloatingMenuPlacement } from "@/hooks/useFloatingMenuPosition";

/** The Commands row's registry id — read by the parent's ArrowRight hook. */
const COMMANDS_ROW_ID = "help-commands";

/** Sideways first, the side with room winning; the cross-axis pair under each
 *  so a sub-menu near the window bottom slides up rather than clipping (the
 *  `ANCHORED_MENU_PLACEMENTS` rule, turned ninety degrees). */
const SUBMENU_PLACEMENTS: FloatingMenuPlacement[] = [
  { side: "right-of", align: "start" },
  { side: "left-of", align: "start" },
  { side: "right-of", align: "end" },
  { side: "left-of", align: "end" },
];

export interface HelpMenuProps {
  appVersion: string;
  /** A paper is open — "Refresh skills" is only meaningful then. */
  hasDoc: boolean;
  skillSyncNotice: SkillSyncNotice | null;
  onResyncSkills: () => void;
  onDismissSkillSyncNotice: () => void;
  helperOn: boolean;
  onHelperToggle: () => void;
  onInsertVirgilCommand: (name: string) => void;
}

/** How the sub-menu was opened: a keyboard open lands the cursor on its
 *  first row, a pointer open leaves it unset (the house pointer rule). */
type SubOpen = "closed" | "pointer" | "keyboard";

export function HelpMenu(props: HelpMenuProps) {
  const [subOpen, setSubOpen] = useState<SubOpen>("closed");
  const onArrowHorizontal = useCallback(
    (dir: "left" | "right", activeId: string | null) => {
      if (dir === "right" && activeId === COMMANDS_ROW_ID) setSubOpen("keyboard");
    },
    [],
  );
  return (
    <AnchoredMenu
      ariaLabel="Help"
      align="end"
      wrapperClassName="relative"
      triggerClassName="topbarbtn"
      triggerHint={iconHint({ label: "Help" })["data-hint"]}
      menuClassName="text-xs text-ink-body whitespace-nowrap text-left min-w-[160px]"
      onArrowHorizontal={onArrowHorizontal}
      trigger={() => (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M9.5 9a2.75 2.75 0 0 1 5.25 1.1c0 1.6-2.25 2.4-2.75 3.4" />
          <path d="M12 17h.01" />
        </svg>
      )}
    >
      {({ close, triggerEl }) => (
        <HelpMenuBody
          {...props}
          close={() => {
            setSubOpen("closed");
            close();
          }}
          triggerEl={triggerEl}
          subOpen={subOpen}
          setSubOpen={setSubOpen}
        />
      )}
    </AnchoredMenu>
  );
}

function HelpMenuBody({
  appVersion,
  hasDoc,
  skillSyncNotice,
  onResyncSkills,
  onDismissSkillSyncNotice,
  helperOn,
  onHelperToggle,
  onInsertVirgilCommand,
  close,
  triggerEl,
  subOpen,
  setSubOpen,
}: HelpMenuProps & {
  close: () => void;
  triggerEl: HTMLElement | null;
  subOpen: SubOpen;
  setSubOpen: (s: SubOpen) => void;
}) {
  const { registry } = useMenuContext();
  // The parent menu closing (click-away, Escape at the top level) unmounts
  // this body; the sub-menu's open state lives one level up, so it is reset
  // here rather than surviving into the next open.
  useEffect(() => () => setSubOpen("closed"), [setSubOpen]);

  // Pointer intent over the PARENT's rows: the Commands row opens the
  // sub-menu, any other row closes it. A DOM-containment test, not a React
  // one — the sub-menu is portaled, and React bubbles its events through this
  // wrapper too; those must not read as "the pointer left Commands".
  const onMouseOver = (e: ReactMouseEvent<HTMLDivElement>) => {
    const t = e.target as Node;
    if (!e.currentTarget.contains(t)) return;
    const row = registry.refFor(COMMANDS_ROW_ID);
    if (row?.contains(t)) {
      if (subOpen === "closed") setSubOpen("pointer");
    } else if ((t as Element).closest?.('[role="menuitem"], [role="menuitemcheckbox"]')) {
      if (subOpen !== "closed") setSubOpen("closed");
    }
  };

  return (
    <div onMouseOver={onMouseOver}>
      <div className="px-3 py-2" role="presentation">
        <div className="font-medium text-ink-body mb-0.5">Version</div>
        <div>Virgil v{appVersion}</div>
      </div>
      <MenuSeparator />
      <CommandsRow
        subOpen={subOpen}
        setSubOpen={setSubOpen}
        triggerEl={triggerEl}
        onInsert={(name) => {
          close();
          onInsertVirgilCommand(name);
        }}
      />
      <MenuSeparator />
      {/* Refresh skills — the manual re-sync (formerly a persistent top-bar
          icon). An edge action: auto-sync runs on doc-open, so this is only
          for force-refresh or re-granting FSA permission after a revoked
          grant. A menu activation is still a user gesture, so the permission
          re-grant path is preserved. Sync failures still surface loudly via
          the SkillSyncControls pill, independent of this item. Task 1131: a
          SUCCESSFUL sync is informational, so it is not on the bar — its
          version and the restart hint live on this row. */}
      {hasDoc && (
        <RefreshSkillsRow
          skillSyncNotice={skillSyncNotice}
          onSelect={() => {
            // The new sync supersedes the last one's note.
            onDismissSkillSyncNotice();
            onResyncSkills();
            close();
          }}
        />
      )}
      <MenuToggleRow
        id="help-helper-mode"
        label="Helper mode"
        checked={helperOn}
        onToggle={() => {
          onHelperToggle();
          close();
        }}
      />
    </div>
  );
}

/** The two-line "Refresh skills" row: the label, and (after a sync) the
 *  version + restart hint under it — richer than `MenuActionRow`'s one-line
 *  label, so it registers through `useMenuItem` and paints from `row-tone.ts`
 *  like every row. */
function RefreshSkillsRow({
  skillSyncNotice,
  onSelect,
}: {
  skillSyncNotice: SkillSyncNotice | null;
  onSelect: () => void;
}) {
  const { active, getItemProps } = useMenuItem({
    id: "help-refresh-skills",
    run: onSelect,
  });
  return (
    <button
      {...getItemProps()}
      type="button"
      className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between gap-3 ${menuRowToneClass("default", false)}`}
      style={menuRowRovingStyle(active, false)}
      data-hint="Re-sync the skill bundle to this paper"
      data-skill-sync-notice={skillSyncNotice ? skillSyncNotice.version : undefined}
    >
      <span className="flex flex-col items-start gap-0.5">
        <span>Refresh skills</span>
        {skillSyncNotice && (
          <span className="text-[10px] text-ink-subtle leading-snug whitespace-normal">
            Updated to v{skillSyncNotice.version} — restart your Claude Code
            cowork session to pick up the new commands.
          </span>
        )}
      </span>
      <svg aria-hidden="true" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-ink-muted">
        <path d="M2 5.2V12a1.2 1.2 0 0 0 1.2 1.2h9.6A1.2 1.2 0 0 0 14 12V6.2A1.2 1.2 0 0 0 12.8 5H7.4L6 3.2H3.2A1.2 1.2 0 0 0 2 4.4Z" />
        <path d="M8 7.2v3.4M6.4 9.2 8 10.8l1.6-1.6" />
      </svg>
    </button>
  );
}

/** The Commands row — a sub-menu TRIGGER inside the parent menu. */
function CommandsRow({
  subOpen,
  setSubOpen,
  triggerEl,
  onInsert,
}: {
  subOpen: SubOpen;
  setSubOpen: (s: SubOpen) => void;
  triggerEl: HTMLElement | null;
  onInsert: (name: string) => void;
}) {
  const { registry } = useMenuContext();
  const { active, getItemProps } = useMenuItem({
    id: COMMANDS_ROW_ID,
    run: () => setSubOpen("keyboard"),
    // Opening a sub-menu is not a pick: the parent must stay open.
    keepMenuOpen: true,
  });
  const itemProps = getItemProps();
  const open = subOpen !== "closed";
  const rowEl = open ? registry.refFor(COMMANDS_ROW_ID) : null;
  const anchor = useCallback(
    () => registry.refFor(COMMANDS_ROW_ID)?.getBoundingClientRect() ?? null,
    [registry],
  );
  const closeSub = useCallback(() => setSubOpen("closed"), [setSubOpen]);
  return (
    <>
      <button
        {...itemProps}
        type="button"
        {...menuTriggerAria("menu", open)}
        className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between gap-3 ${menuRowToneClass("default", false)}`}
        // The row stays lit while its sub-menu is open, so the eye can trace
        // which row the floating list belongs to.
        style={menuRowRovingStyle(active || open, false)}
      >
        <span className="font-medium">Commands</span>
        <svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-muted">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
      {open && rowEl && (
        <MenuProvider
          id="help-commands-submenu"
          layout="list"
          ariaLabel="Commands"
          anchorRect={rowEl.getBoundingClientRect()}
          trackAnchor={anchor}
          placements={SUBMENU_PLACEMENTS}
          gap={4}
          maxHeight
          // The row that opened it is not "outside" — a click on it keeps
          // the sub-menu (its run re-opens what is already open).
          excludeRefs={[rowEl]}
          getActiveDescendantHost={() => triggerEl}
          onArrowHorizontal={(dir) => {
            if (dir === "left") closeSub();
          }}
          onClose={closeSub}
          containerClassName="py-1 text-xs text-ink-body min-w-[160px]"
        >
          {VIRGIL_COMMAND_NAMES.map((name) => (
            <CommandRow key={name} name={name} onInsert={onInsert} />
          ))}
          <div
            role="presentation"
            className="border-t border-edge-subtle mt-1 pt-1.5 pb-1 px-3 text-[10px] text-ink-muted flex items-center gap-1"
          >
            <span>Type text +</span>
            <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 10 4 15 9 20" />
              <path d="M20 4v7a4 4 0 0 1-4 4H4" />
            </svg>
          </div>
          {subOpen === "keyboard" && <CursorOnFirstRow />}
        </MenuProvider>
      )}
    </>
  );
}

function CommandRow({
  name,
  onInsert,
}: {
  name: string;
  onInsert: (name: string) => void;
}) {
  const { active, getItemProps } = useMenuItem({
    id: `help-command-${name}`,
    run: () => onInsert(name),
  });
  return (
    <button
      {...getItemProps()}
      type="button"
      className={`block w-full text-left px-3 py-1 font-mono ${menuRowToneClass("default", false)}`}
      style={menuRowRovingStyle(active, false)}
    >
      {`\\${name}`}
    </button>
  );
}

/** A keyboard-opened sub-menu lands its cursor on the first row (the WAI-ARIA
 *  menu-button pattern). Rendered AFTER the rows, so their registrations —
 *  child effects run in order — are in place when this effect asks. */
function CursorOnFirstRow() {
  const { registry } = useMenuContext();
  useEffect(() => {
    if (registry.activeId() == null) registry.move("home");
  }, [registry]);
  return null;
}

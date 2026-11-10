"use client";

/**
 * The Virgil bar's ⋯ menu: everything the bar does not keep out, and the one
 * trailing control it has. The bar shows the view switch, Compile and AI
 * requests; the rest of the tools live here, and when the tabs need the room
 * those three fold in as well, so a tool is never out of reach.
 *
 * Built on the `<Menu>` primitive since task 1361 (as the Help menu, which this
 * grew out of):
 *   - the trigger, its rect, re-anchoring, flip, click-outside, Escape and the
 *     activedescendant host are `AnchoredMenu`'s, stated once there;
 *   - Commands is a NESTED `MenuProvider` (the R6 stack: only the innermost
 *     open menu owns the keyboard, Escape pops one level), anchored to the
 *     Commands row and placed `right-of` → `left-of`, so it escapes sideways;
 *   - it opens on hover, on click, on Enter/Space and on ArrowRight; ArrowLeft
 *     and Escape close it and hand the keyboard back to the parent;
 *   - the on/off tools are `MenuToggleRow`s (real `menuitemcheckbox`es).
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
import { MenuGlyph } from "@/components/icons/MenuGlyph";
import {
  AnchoredMenu,
  MenuActionRow,
  MenuProvider,
  MenuSeparator,
  MenuToggleRow,
  useMenuItem,
} from "@/components/menu";
import { useMenuContext } from "@/components/menu/context";
import { MenuRadioGroup } from "@/components/menu/MenuRadioGroup";
import { PomodoroMenuRow, PomodoroStatusDot } from "@/components/PomodoroTimer";
import { useCollabContext } from "@/hooks/useCollab";
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

/** The bar's view switch: what the right-hand pane shows beside the text. */
export type BarView = "text" | "code" | "pdf";

/** The tools the bar keeps out, as data, so the switch and the menu rows that
 *  stand in for it when the tools fold state them once. */
export const BAR_VIEW_LABEL: Record<BarView, string> = {
  text: "Text",
  code: "Code",
  pdf: "PDF",
};

export interface BarMoreMenuProps {
  appVersion: string;
  /** A paper is open — "Refresh skills" is only meaningful then. */
  hasDoc: boolean;
  skillSyncNotice: SkillSyncNotice | null;
  onResyncSkills: () => void;
  onDismissSkillSyncNotice: () => void;
  helperOn: boolean;
  onHelperToggle: () => void;
  onInsertVirgilCommand: (name: string) => void;

  zenOn: boolean;
  onToggleZen: () => void;
  onOpenStyle: () => void;
  /** Why the row is greyed; absent while it can run. */
  styleBlocked?: string;
  onOpenPrint: () => void;
  printBlocked?: string;
  onOpenPreferences: () => void;
  onEnableCollab: () => void;
  onDisableCollab: () => void;
  /** Per-machine dev tool; the row is absent without it. */
  onOpenBugReport?: () => void;

  /** The bar's tools are folded away (by the user or the occupancy rule), so
   *  their rows stand in here. */
  toolsCollapsed: boolean;
  onToggleTools: () => void;
  view: BarView;
  onViewChange: (view: BarView) => void;
  pdfBlocked?: string;
  onCompile: () => void;
  compileBlocked?: string;
  onOpenAiRequests: () => void;
}

/** How the sub-menu was opened: a keyboard open lands the cursor on its
 *  first row, a pointer open leaves it unset (the house pointer rule). */
type SubOpen = "closed" | "pointer" | "keyboard";

export function BarMoreMenu(props: BarMoreMenuProps) {
  const [subOpen, setSubOpen] = useState<SubOpen>("closed");
  const onArrowHorizontal = useCallback(
    (dir: "left" | "right", activeId: string | null) => {
      if (dir === "right" && activeId === COMMANDS_ROW_ID) setSubOpen("keyboard");
    },
    [],
  );
  return (
    <AnchoredMenu
      ariaLabel="More"
      triggerAriaLabel="More"
      align="end"
      wrapperClassName="relative"
      triggerClassName="topbarbtn relative"
      triggerHint={iconHint({ label: "More" })["data-hint"]}
      menuClassName="text-xs text-ink-body whitespace-nowrap text-left min-w-[160px]"
      onArrowHorizontal={onArrowHorizontal}
      trigger={() => (
        <>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <circle cx="3" cy="8" r="1.25" />
            <circle cx="8" cy="8" r="1.25" />
            <circle cx="13" cy="8" r="1.25" />
          </svg>
          <PomodoroStatusDot />
        </>
      )}
    >
      {({ close, triggerEl }) => (
        <BarMoreMenuBody
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

function BarMoreMenuBody({
  appVersion,
  hasDoc,
  skillSyncNotice,
  onResyncSkills,
  onDismissSkillSyncNotice,
  helperOn,
  onHelperToggle,
  onInsertVirgilCommand,
  zenOn,
  onToggleZen,
  onOpenStyle,
  styleBlocked,
  onOpenPrint,
  printBlocked,
  onOpenPreferences,
  onEnableCollab,
  onDisableCollab,
  onOpenBugReport,
  toolsCollapsed,
  onToggleTools,
  view,
  onViewChange,
  pdfBlocked,
  onCompile,
  compileBlocked,
  onOpenAiRequests,
  close,
  triggerEl,
  subOpen,
  setSubOpen,
}: BarMoreMenuProps & {
  close: () => void;
  triggerEl: HTMLElement | null;
  subOpen: SubOpen;
  setSubOpen: (s: SubOpen) => void;
}) {
  const { registry } = useMenuContext();
  // Read here, not through a prop, so a collab pen/presence tick never reaches
  // the bar's memoized cluster: this body exists only while the menu is open.
  const collab = useCollabContext();
  /** Run a row's action and dismiss the menu. */
  const pick = (run: () => void) => () => {
    close();
    run();
  };
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
    // A column: the rows are buttons, inline by default, so two adjacent action
    // rows would otherwise share a line and the second would run off the menu.
    <div className="flex flex-col" onMouseOver={onMouseOver}>
      {toolsCollapsed && !zenOn && (
        <>
          <MenuRadioGroup
            idPrefix="more-view-"
            ariaLabel="View"
            options={(Object.keys(BAR_VIEW_LABEL) as BarView[]).map((v) => ({
              value: v,
              label: BAR_VIEW_LABEL[v],
              disabled: v === "pdf" && !!pdfBlocked,
              hint: v === "pdf" ? pdfBlocked : undefined,
            }))}
            value={view}
            onPick={(v) => pick(() => onViewChange(v))()}
          />
          <MenuActionRow
            id="more-compile"
            leading={<MenuGlyph name="compile" />}
            label="Compile"
            disabledReason={compileBlocked}
            onSelect={pick(onCompile)}
          />
          <MenuActionRow
            id="more-ai-requests"
            leading={<MenuGlyph name="ai-requests" />}
            label="AI requests"
            onSelect={pick(onOpenAiRequests)}
          />
          <MenuSeparator />
        </>
      )}
      <MenuActionRow
        id="more-style"
        leading={<MenuGlyph name="style" />}
        label="Document style…"
        disabledReason={styleBlocked}
        onSelect={pick(onOpenStyle)}
      />
      <MenuActionRow
        id="more-print"
        leading={<MenuGlyph name="print" />}
        label="Print…"
        disabledReason={printBlocked}
        onSelect={pick(onOpenPrint)}
      />
      <MenuSeparator />
      <MenuToggleRow
        id="more-zen"
        leading={<MenuGlyph name="zen" />}
        label="Zen mode"
        checked={zenOn}
        onToggle={pick(onToggleZen)}
      />
      <PomodoroMenuRow onPicked={close} />
      <MenuToggleRow
        id="more-collab"
        leading={<MenuGlyph name="collab" />}
        label="Collaborator mode"
        checked={!!collab.enabled}
        onToggle={pick(collab.enabled ? onDisableCollab : onEnableCollab)}
      />
      <MenuSeparator />
      <CommandsRow
        subOpen={subOpen}
        setSubOpen={setSubOpen}
        triggerEl={triggerEl}
        onInsert={(name) => pick(() => onInsertVirgilCommand(name))()}
      />
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
        leading={<MenuGlyph name="helper" />}
        label="Helper mode"
        checked={helperOn}
        onToggle={pick(onHelperToggle)}
      />
      <MenuSeparator />
      <MenuActionRow
        id="more-preferences"
        leading={<MenuGlyph name="preferences" />}
        label="Preferences…"
        onSelect={pick(onOpenPreferences)}
      />
      {onOpenBugReport && (
        <MenuActionRow
          id="more-bug-report"
          leading={<MenuGlyph name="bug" />}
          label="Report a bug…"
          onSelect={pick(onOpenBugReport)}
        />
      )}
      <MenuActionRow
        id="more-toolbar"
        leading={<MenuGlyph name="toolbar" />}
        label={toolsCollapsed ? "Show toolbar" : "Hide toolbar"}
        onSelect={pick(onToggleTools)}
      />
      <MenuSeparator />
      <div className="px-3 pt-1 pb-1.5 text-2xs text-ink-muted" role="presentation">
        Virgil v{appVersion}
      </div>
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
      className={`w-full text-left px-3 py-1.5 text-xs flex items-start gap-2 ${menuRowToneClass("default", false)}`}
      style={menuRowRovingStyle(active, false)}
      data-hint="Re-sync the skill bundle to this paper"
      data-skill-sync-notice={skillSyncNotice ? skillSyncNotice.version : undefined}
    >
      <span className="mt-px flex">
        <MenuGlyph name="refresh" />
      </span>
      <span className="flex flex-1 flex-col items-start gap-0.5">
        <span>Refresh skills</span>
        {skillSyncNotice && (
          <span className="text-2xs text-ink-subtle leading-snug whitespace-normal">
            Updated to v{skillSyncNotice.version} — restart your Claude Code
            cowork session to pick up the new commands.
          </span>
        )}
      </span>
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
        <span className="flex items-center gap-2">
          <MenuGlyph name="commands" />
          <span className="font-medium">Commands</span>
        </span>
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
          // Escape closes only the sub-menu, so focus returns to the row that
          // opened it, not the ⋯ trigger (task 1388; WAI-ARIA sub-menu).
          returnFocusOnCancel={() => registry.refFor(COMMANDS_ROW_ID)}
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
            className="border-t border-edge-subtle mt-1 pt-1.5 pb-1 px-3 text-2xs text-ink-muted flex items-center gap-1"
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

"use client";

import { useCallback, useMemo, useState, useRef } from "react";
import type { EditorPreferences, PreferencePreset, ResolvedSettings, SettingsSnapshot } from "@/hooks/usePreferences";
import {
  DEFAULT_SETTINGS_SNAPSHOT,
  isReservedPresetName,
  resolveSettings,
  settingsEqual,
} from "@/hooks/usePreferences";
import type { GlobalTransforms } from "@/lib/color-transforms";
import { useSideSettings } from "@/lib/settings-stores";
import { PREFERENCES_TREE, isLeaf } from "@/lib/preferences-tree";
import { SMART_PREFERENCES } from "@/lib/smart-preferences";
import PreferenceTree from "./PreferenceTree";
import { Field, Input, Select } from "./field-primitives";
import { Button } from "./Button";
import SmartPreferencesSection from "./SmartPreferences";
import SystemDialog, { SystemDialogSidebarLayout, type SystemDialogSection } from "./system-dialog";
import { ItemMenu } from "./panel-primitives";
import { MenuActionRow } from "./menu/MenuActionRow";
import {
  SUPPRESSIBLE_CONFIRM_LABELS,
  restoreAllConfirms,
  useSuppressedConfirms,
} from "./confirm-suppression";
import { isCancelEscape, isCommitEnter } from "@/lib/key-intent";

interface PreferencesModalProps {
  prefs: EditorPreferences;
  transforms: GlobalTransforms;
  presets: PreferencePreset[];
  onUpdate: <K extends keyof EditorPreferences>(key: K, value: EditorPreferences[K]) => void;
  onUpdateTransform: <K extends keyof GlobalTransforms>(key: K, value: GlobalTransforms[K]) => void;
  onReset: () => void;
  onClose: () => void;
  onSavePreset: (name: string) => void;
  onLoadPreset: (name: string) => void;
  onDeletePreset: (name: string) => void;
  /** Undo doors (task 903): put the settings / a preset back as it was. */
  onRestoreSettings: (snapshot: SettingsSnapshot) => void;
  onRestorePreset: (preset: PreferencePreset) => void;
}

/** What an undo offer is checked against: the LIVE settings — every store the
 *  dialog renders, side stores included (task 1489) — and presets. */
interface UndoLiveState {
  settings: ResolvedSettings;
  presets: PreferencePreset[];
}

/** The one pending undo the dialog offers: what just happened, and how to take
 *  it back. ONE slot, not a stack — the next undoable action replaces it.
 *
 *  An offer is actionable only while the live state is still EXACTLY what its
 *  action produced (`stillCurrent`, derived in render — task 1121). It used to
 *  be retired by the dialog's own edit wrappers, a proxy for "nothing changed
 *  since" that two live writers bypassed (FontsDialog, open beside this
 *  dialog, and a peer window's storage sync): an Undo pressed after either
 *  silently reverted their edits too — a second destructive action. Asking the
 *  state, not the route, retires the offer for every writer, present or
 *  future. */
interface PendingUndo {
  message: string;
  undo: () => void;
  stillCurrent: (live: UndoLiveState) => boolean;
}

/** The live user preset of that name, if any (built-ins are derived, never
 *  the target of a preset undo). */
function userPreset(presets: PreferencePreset[], name: string): PreferencePreset | undefined {
  return presets.find((p) => p.name === name && !p.builtIn);
}

// ─── Global Transform Slider ──────────────────────────────────────────────────

function TransformSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  const rafRef = useRef<number>(0);
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => onChange(v));
  }, [onChange]);

  // A labelled field (task 903): the caption above the slider used to be a bare
  // `<span>`, so "Contrast"/"Hue"/"Brightness" named nothing.
  return (
    <Field label={label} className="flex-1 min-w-0 relative">
      {({ id }) => (
        <>
          <span className="absolute right-0 top-0 text-2xs text-ink-muted tabular-nums w-8 text-right">
            {value > 0 ? `+${value}` : value}
          </span>
          <input
            id={id}
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={handleChange}
            className="w-full h-1 accent-[var(--accent)]"
          />
        </>
      )}
    </Field>
  );
}

// ─── Preset Bar ───────────────────────────────────────────────────────────────

function PresetBar({
  id,
  presets,
  onLoad,
  onSave,
  onDelete,
  onUndoable,
  onRestore,
  onRestoreSettings,
  settings,
}: {
  /** The picker's id, for the field label above it. */
  id: string;
  presets: PreferencePreset[];
  onLoad: (name: string) => void;
  onSave: (name: string) => void;
  onDelete: (name: string) => void;
  onUndoable: (pending: PendingUndo) => void;
  onRestore: (preset: PreferencePreset) => void;
  onRestoreSettings: (snapshot: SettingsSnapshot) => void;
  /** The live settings — what a save writes into the preset, and what a load
   *  replaces (and its Undo restores). */
  settings: ResolvedSettings;
}) {
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState("");
  // The preset last PICKED — the delete affordance's target, not an "active
  // preset" claim. The picker itself holds no selection (see below), so this is
  // deliberately not fed back into the <select>.
  const [target, setTarget] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const trimmedName = newName.trim();
  const nameReserved = isReservedPresetName(trimmedName);
  const canSaveName = trimmedName.length > 0 && !nameReserved;

  const handleSave = useCallback(() => {
    if (saving) {
      const name = newName.trim();
      if (name && !isReservedPresetName(name)) {
        // Saving over an existing name replaced it silently; snapshot it first
        // so the overwrite can be taken back (task 903).
        const replaced = presets.find((p) => p.name === name && !p.builtIn);
        onSave(name);
        if (replaced) {
          const saved = settings;
          onUndoable({
            message: `Preset \u201c${name}\u201d replaced`,
            undo: () => onRestore(replaced),
            // Current while the preset still holds what THIS save wrote.
            stillCurrent: ({ presets: live }) => {
              const p = userPreset(live, name);
              return !!p && settingsEqual(p, saved);
            },
          });
        }
        setNewName("");
        setSaving(false);
      }
    } else {
      setSaving(true);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [saving, newName, onSave, presets, onUndoable, onRestore, settings]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (isCommitEnter(e)) handleSave();
    if (isCancelEscape(e)) setSaving(false);
  }, [handleSave]);

  // The picker is an ACTION, not a bound value: it applies the preset and
  // immediately returns to its placeholder. Bound to a selection it lied twice —
  // re-picking the preset you were already on fired no change event (so you
  // could not revert your edits by re-applying it), and after "Reset to
  // defaults" it went on naming a preset that was no longer in effect. The DOM
  // reset is imperative because React re-renders on an UNCHANGED `target` are
  // bailed out, which would leave the picked option stuck in the DOM.
  //
  // Loading replaces EVERY setting, so it is undoable like reset (task 1489):
  // mis-picking "Default" used to destroy unsaved tweaks irrecoverably. No
  // offer when the load changed nothing.
  const handleSelectChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const name = e.currentTarget.value;
    e.currentTarget.value = "";
    if (!name) return;
    setTarget(name);
    const picked = presets.find((p) => p.name === name);
    const before = settings;
    onLoad(name);
    if (!picked) return;
    const after = resolveSettings(picked);
    if (settingsEqual(before, after)) return;
    onUndoable({
      message: `Preset \u201c${name}\u201d loaded`,
      undo: () => onRestoreSettings(before),
      // Current while the settings are still exactly what the load made them.
      stillCurrent: ({ settings: live }) => settingsEqual(live, after),
    });
  }, [onLoad, presets, settings, onUndoable, onRestoreSettings]);

  const targetPreset = presets.find((p) => p.name === target);
  const canDelete = !!targetPreset && !targetPreset.builtIn;

  return (
    <div className="flex items-center gap-2">
      <Select
        id={id}
        value=""
        onChange={handleSelectChange}
        className="flex-1 min-w-0 text-xs px-2 py-1.5"
      >
        <option value="" hidden>Load preset...</option>
        {presets.map((p) => (
          <option key={p.name} value={p.name}>
            {p.name}{p.builtIn ? " (built-in)" : ""}
          </option>
        ))}
      </Select>

      {saving ? (
        <Input
          ref={inputRef}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => { if (!newName.trim()) setSaving(false); }}
          placeholder="Preset name"
          invalid={nameReserved}
          aria-invalid={nameReserved || undefined}
          data-hint={nameReserved ? `"${trimmedName}" is a built-in preset name` : undefined}
          className="text-xs px-2 py-1.5 w-28"
        />
      ) : null}

      <Button
        size="sm"
        onClick={handleSave}
        disabled={saving && !canSaveName}
        data-hint={saving && nameReserved ? `"${trimmedName}" is a built-in preset name` : undefined}
        className="whitespace-nowrap"
      >
        {saving ? "OK" : "Save"}
      </Button>

      {canDelete && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            // A one-click delete with no way back (task 903) — snapshot it.
            const deleted = targetPreset;
            onDelete(target);
            setTarget("");
            if (deleted) {
              onUndoable({
                message: `Preset \u201c${deleted.name}\u201d deleted`,
                undo: () => onRestore(deleted),
                // Current while nothing (a re-save, a peer window) has put a
                // preset of that name back.
                stillCurrent: ({ presets: live }) => !userPreset(live, deleted.name),
              });
            }
          }}
          data-hint={`Delete preset "${target}"`}
          className="max-w-[9rem]"
        >
          <span className="truncate">Delete &ldquo;{target}&rdquo;</span>
        </Button>
      )}
    </div>
  );
}

// ─── Main Modal ───────────────────────────────────────────────────────────────

/* ── Restore hidden confirmations ─────────────────────────────────────────────
 *
 * The way BACK from every "Don't show this again" tick, so suppression is never
 * a one-way door (task 492). Renders NOTHING when nothing is suppressed rather
 * than a disabled control that does nothing — the false-affordance rule this
 * codebase applies to the unanchored-cards chip and every other count-gated
 * affordance. It lives in the modal CHROME and not in `PREFERENCES_TREE`
 * because the tree's leaves are `EditorPreferences` keys that each move a pixel
 * through a CSS variable (the `inert-preference-controls` census); this is an
 * action, not a value.
 */
function RestoreHiddenConfirmations() {
  const suppressed = useSuppressedConfirms();
  if (suppressed.length === 0) return null;
  return (
    <MenuActionRow
      id="restore-confirmations"
      label={`Restore hidden confirmations (${suppressed.length})`}
      onSelect={restoreAllConfirms}
    />
  );
}

/** The sidebar's pages: the theme, then the Smart sections, then the tree's
 *  top-level groups. */
const THEME_SECTION = "theme";
const SECTIONS: readonly SystemDialogSection[] = [
  { id: THEME_SECTION, label: "Theme" },
  ...SMART_PREFERENCES.map(({ id, label }) => ({ id, label })),
  ...PREFERENCES_TREE.map((node) => ({ id: `tree:${node.label}`, label: node.label })),
];

export default function PreferencesModal({
  prefs,
  transforms,
  presets,
  onUpdate,
  onUpdateTransform,
  onReset,
  onClose,
  onSavePreset,
  onLoadPreset,
  onDeletePreset,
  onRestoreSettings,
  onRestorePreset,
}: PreferencesModalProps) {
  const [offeredUndo, setPendingUndo] = useState<PendingUndo | null>(null);
  // DERIVED (task 1121): the offer shows only while the live state is still
  // what its action produced — any writer's change retires it by construction.
  // Every store the dialog renders (task 1489): prefs + transforms from the
  // host, plus the Smart section's panel colours / typography / link deltas.
  const side = useSideSettings();
  const settings: ResolvedSettings = useMemo(
    () => ({ prefs, transforms, ...side }),
    [prefs, transforms, side],
  );
  const pendingUndo = offeredUndo?.stillCurrent({ settings, presets }) ? offeredUndo : null;

  // "Reset to defaults" wipes every setting — every store above — in one
  // click. It stays one click — a confirm in front of an UNDOABLE action is
  // friction with no protection — but it is undoable now (task 903): the
  // settings it replaced are snapshotted and offered back in the footer.
  const handleReset = useCallback(() => {
    const snapshot = settings;
    onReset();
    setPendingUndo({
      message: "Preferences reset",
      undo: () => onRestoreSettings(snapshot),
      // `onReset` makes the settings exactly the shipped defaults.
      stillCurrent: ({ settings: live }) => settingsEqual(live, DEFAULT_SETTINGS_SNAPSHOT),
    });
  }, [settings, onReset, onRestoreSettings]);

  const runUndo = useCallback(() => {
    if (!pendingUndo) return;
    setPendingUndo(null);
    pendingUndo.undo();
  }, [pendingUndo]);

  const [sectionId, setSectionId] = useState<string>(THEME_SECTION);
  const smartSection = SMART_PREFERENCES.find((s) => s.id === sectionId);
  const treeNode = PREFERENCES_TREE.find((n) => `tree:${n.label}` === sectionId);

  // Scrimless draggable SystemDialog: it owns the portal, surface chrome
  // (SYSTEM_DIALOG_TOKENS), the DRAGGABLE_DIALOG_Z tier (retiring the old bare
  // z-[9999] that collided with the drop indicator), the drag (grab either title
  // strip), Esc, and outside-click-to-close. `ignoreOutsideSelector` preserves
  // the topbar-trigger guard: clicking the Preferences button doesn't close-then-
  // reopen (the same gesture would otherwise flip `preferencesOpen` back on), and
  // a row of the window's own ⋯ menu, portaled outside the frame, is not outside.
  return (
    <SystemDialog
      open
      variant="draggable"
      onClose={onClose}
      ignoreOutsideSelector='[data-hint="Preferences"], .menu-surface'
      /* A dismissal is FREE: every preference commits UPSTREAM the instant it
         changes (`onUpdate` writes straight to the prefs store), so closing
         loses no setting. The pockets of local state that do die with the
         unmount — `PresetBar`'s half-typed preset name,
         `PreferenceTree.ColorPref`'s half-typed hex, and the pending Undo (an
         offer, like a toast's, that ends with the surface) — are each a short
         token or a click. */
      dismissIsFree
      labelledBy="preferences-modal-title"
      frameClassName="w-full max-w-[740px] h-[min(85vh,640px)] flex flex-col overflow-hidden"
    >
      <SystemDialogSidebarLayout
        title="Preferences"
        titleId="preferences-modal-title"
        sections={SECTIONS}
        active={sectionId}
        onSelect={setSectionId}
        heading={SECTIONS.find((s) => s.id === sectionId)?.label ?? ""}
        onClose={onClose}
        actions={
          <ItemMenu hint="More options">
            <RestoreHiddenConfirmations />
            <MenuActionRow
              id="reset-all"
              tone="danger"
              label="Reset to defaults"
              onSelect={handleReset}
            />
          </ItemMenu>
        }
      >
        <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-4">
          {smartSection ? (
            <SmartPreferencesSection section={smartSection} prefs={prefs} onUpdate={onUpdate} />
          ) : treeNode && !isLeaf(treeNode) ? (
            <PreferenceTree tree={treeNode.children} prefs={prefs} onUpdate={onUpdate} />
          ) : (
            <div className="space-y-5">
              <Field label="Preset">
                {({ id }) => (
                  <PresetBar
                    id={id}
                    presets={presets}
                    onLoad={onLoadPreset}
                    onSave={onSavePreset}
                    onDelete={onDeletePreset}
                    onUndoable={setPendingUndo}
                    onRestore={onRestorePreset}
                    onRestoreSettings={onRestoreSettings}
                    settings={settings}
                  />
                )}
              </Field>
              <div className="flex items-start gap-4">
                <TransformSlider
                  label="Contrast"
                  value={transforms.contrast}
                  min={-100}
                  max={100}
                  step={5}
                  onChange={(v) => onUpdateTransform("contrast", v)}
                />
                <TransformSlider
                  label="Hue"
                  value={transforms.hue}
                  min={-180}
                  max={180}
                  step={5}
                  onChange={(v) => onUpdateTransform("hue", v)}
                />
                <TransformSlider
                  label="Brightness"
                  value={transforms.brightness}
                  min={-50}
                  max={50}
                  step={2}
                  onChange={(v) => onUpdateTransform("brightness", v)}
                />
              </div>
            </div>
          )}
        </div>
        {/* A live status, so a screen reader hears the reset happened. It stays
            mounted and takes no room until there is an Undo to offer. */}
        <div role="status" aria-live="polite" className="text-xs text-ink-muted">
          {pendingUndo && (
            <div className="flex items-center gap-2 min-w-0 px-5 py-2">
              <span className="truncate">{pendingUndo.message}</span>
              <Button variant="ghost" size="sm" onClick={runUndo}>
                Undo
              </Button>
            </div>
          )}
        </div>
      </SystemDialogSidebarLayout>
    </SystemDialog>
  );
}

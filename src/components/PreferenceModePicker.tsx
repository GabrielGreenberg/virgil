"use client";

/**
 * Preference Mode Picker
 * ======================
 *
 * Floating popover that opens on ctrl+click (⌘+click on macOS) while
 * preference mode is active. Surfaces only the preferences advertised by
 * the clicked element and its ancestors — users see the exact controls
 * relevant to what they clicked, without scrolling through the full
 * preferences modal.
 *
 * See usePreferenceMode.ts for the bigger-picture architecture and
 * "how to extend" guide. This file owns the ctrl+click detection, DOM
 * walking, popover positioning, and PreferenceTree filtering.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Lifecycle
 * ────────────────────────────────────────────────────────────────────────
 *
 *   1. Host (EditorLayout) renders <PreferenceModePicker /> unconditionally.
 *   2. On mount, we register a single `mousedown` listener in the capture
 *      phase on document. Capture phase so we see the event before any
 *      component-local stopPropagation fires.
 *   3. Listener gates on:
 *        - preference mode is on (body[data-pref-mode="on"])
 *        - ctrl or meta key held at click time
 *      If either is false, we bail and let the click proceed normally.
 *   4. Walker starts at event.target and walks up via parentElement,
 *      collecting `data-prefs` (comma-separated pref keys) and
 *      `data-panel-theme` (a PanelThemeKey) attributes as it goes.
 *      Keys are deduped; order preserves "most specific first".
 *   5. If at least one key was collected, preventDefault() + stopPropagation()
 *      and set state to open the popover anchored at the click coordinates.
 *      If nothing was collected, we do NOT intercept — a normal ctrl+click
 *      proceeds (so the user can still multi-select, open links, etc.).
 *   6. Popover dismisses on Esc, outside click, or preference-mode toggling off.
 *
 * ────────────────────────────────────────────────────────────────────────
 * DOM annotation contract
 * ────────────────────────────────────────────────────────────────────────
 *
 *   data-prefs="<key>[,<key>...]"
 *       Values are `keyof EditorPreferences`. The picker renders the
 *       matching leaves from PREFERENCES_TREE (found via findLeafByKey).
 *       Unknown keys are silently skipped so renames don't crash the UI.
 *
 *   data-panel-theme="<PanelThemeKey>"
 *       Values are PanelThemeKey from panel-theme.ts. The picker renders
 *       a simple color input bound to getPanelColor / setPanelColor — the
 *       same pathway the existing PanelThemePicker uses. Per-panel colors
 *       don't live in preferences-tree and use their own override system.
 *
 * ────────────────────────────────────────────────────────────────────────
 * How to extend
 * ────────────────────────────────────────────────────────────────────────
 *
 *  - New annotation attribute: add it to the walker's `collect()` body,
 *    extend the `Selection` type, and add a rendering branch in the
 *    popover body. Don't forget to also extend globals.css's hover-outline
 *    selector list so the new attr gets the visual hint.
 *
 *  - Change the modifier (ctrl+click → alt+click): replace `isModified()`
 *    with e.altKey. Keep preference-mode gating separate so the toggle
 *    button keeps working.
 *
 *  - Change the popover style/position: edit this file. The picker deliberately
 *    has no external styling API — if a second caller ever needs a
 *    differently-styled popover, extract a <PrefPopover> primitive rather
 *    than plumbing style props through.
 *
 *  - Add grouping (e.g. "This element" vs "Everything of this kind"):
 *    the walker already preserves order. Tag entries with their DOM depth
 *    in collect(), then render headers when depth transitions.
 */

import { useEffect, useState, useMemo, useCallback } from "react";
import SystemDialog from "./system-dialog";
import type { EditorPreferences } from "@/hooks/usePreferences";
import { usePreferences } from "@/hooks/usePreferences";
import {
  PREFERENCES_TREE,
  findLeafByKey,
  type PrefLeaf,
  type PrefNode,
} from "@/lib/preferences-tree";
import type { PanelThemeKey } from "@/lib/panel-theme";
import {
  getPanelColor,
  setPanelColor,
  subscribePanelColors,
  DEFAULT_PANEL_COLORS,
  SYSTEM_THEME_KEYS,
} from "@/lib/panel-theme";
import { usePreferenceMode } from "@/hooks/usePreferenceMode";
import PreferenceTree from "./PreferenceTree";

// ── Types ─────────────────────────────────────────────────────────────────

type PrefKey = keyof EditorPreferences;

interface Selection {
  /** Ordered, deduped list of pref-tree keys collected from the DOM walk. */
  prefKeys: PrefKey[];
  /** Per-panel theme keys collected from data-panel-theme attrs. */
  panelKeys: PanelThemeKey[];
  /** Viewport coordinates of the click, used to anchor the popover. */
  x: number;
  y: number;
}

// ── DOM walker ────────────────────────────────────────────────────────────

const KNOWN_PANEL_KEYS = new Set<PanelThemeKey>(
  (Object.keys(DEFAULT_PANEL_COLORS) as PanelThemeKey[]).filter(
    (k) => !SYSTEM_THEME_KEYS.has(k), // system accents are non-overridable
  ),
);

function collect(startEl: Element | null): {
  prefKeys: PrefKey[];
  panelKeys: PanelThemeKey[];
} {
  const prefKeys: PrefKey[] = [];
  const panelKeys: PanelThemeKey[] = [];
  const seenPref = new Set<string>();
  const seenPanel = new Set<string>();

  let node: Element | null = startEl;
  while (node) {
    // data-prefs — comma-separated EditorPreferences keys
    const prefs = node.getAttribute?.("data-prefs");
    if (prefs) {
      for (const raw of prefs.split(",")) {
        const key = raw.trim();
        if (!key || seenPref.has(key)) continue;
        // Validate by looking up in the tree; unknown keys silently drop
        // so renaming a pref in the tree doesn't break un-updated markup.
        if (findLeafByKey(key as PrefKey)) {
          prefKeys.push(key as PrefKey);
          seenPref.add(key);
        }
      }
    }
    // data-panel-theme — single PanelThemeKey
    const panel = node.getAttribute?.("data-panel-theme");
    if (panel) {
      const k = panel.trim();
      if (k && !seenPanel.has(k) && KNOWN_PANEL_KEYS.has(k as PanelThemeKey)) {
        panelKeys.push(k as PanelThemeKey);
        seenPanel.add(k);
      }
    }
    node = node.parentElement;
  }

  return { prefKeys, panelKeys };
}

// ── Per-panel color row ──────────────────────────────────────────────────

function PanelColorRow({ panelKey }: { panelKey: PanelThemeKey }) {
  // Subscribe to panel-color overrides so the displayed value stays fresh
  // if the same picker is open across multiple clicks.
  const [, force] = useState(0);
  useEffect(() => subscribePanelColors(() => force((n) => n + 1)), []);
  const value = getPanelColor(panelKey);
  const defaultValue = DEFAULT_PANEL_COLORS[panelKey];
  const isDefault = value.toLowerCase() === defaultValue.toLowerCase();

  return (
    <div className="flex items-center gap-3 py-1 px-3.5">
      <div className="w-36 shrink-0">
        <span className="text-xs text-ink-body capitalize">{panelKey} panel</span>
        <span className="text-[10px] text-ink-muted block leading-tight">
          Color theme for all {panelKey} cards and markers
        </span>
      </div>
      <div className="flex items-center gap-2 flex-1">
        <input
          type="color"
          value={value}
          onChange={(e) => setPanelColor(panelKey, e.target.value)}
          className="w-6 h-6 rounded border border-edge-subtle cursor-pointer p-0 bg-transparent"
        />
        <span className="text-[11px] font-mono text-ink-subtle">{value}</span>
        {!isDefault && (
          <button
            onClick={() => setPanelColor(panelKey, defaultValue)}
            className="text-[10px] text-ink-muted hover:text-ink-body underline ml-auto"
          >
            reset
          </button>
        )}
      </div>
    </div>
  );
}

// ── Picker popover ───────────────────────────────────────────────────────

export default function PreferenceModePicker() {
  const { on: prefModeOn } = usePreferenceMode();
  const { prefs, updatePref } = usePreferences();
  const [selection, setSelection] = useState<Selection | null>(null);

  // Build a flat synthetic tree from the collected pref keys. Each key
  // becomes a top-level leaf in the popover. We lose the group structure
  // but that's desirable here — the picker is a small focused view.
  const filteredTree = useMemo<PrefNode[]>(() => {
    if (!selection) return [];
    const leaves: PrefLeaf[] = [];
    for (const key of selection.prefKeys) {
      const leaf = findLeafByKey(key);
      if (leaf) leaves.push(leaf);
    }
    return leaves;
  }, [selection]);

  // Modifier detection — ctrl on win/linux, meta (cmd) on macOS. We accept
  // both to be forgiving; users of keyboard-remapping tools often swap them.
  const isModified = useCallback((e: MouseEvent) => e.ctrlKey || e.metaKey, []);

  // Global click interceptor. Capture phase, so component-local
  // stopPropagation on editor elements doesn't hide the event from us.
  useEffect(() => {
    if (!prefModeOn) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!isModified(e)) return;
      // Re-read the body attribute in case this listener fires between
      // the hook's state update and the attribute mirror useEffect.
      if (document.body.getAttribute("data-pref-mode") !== "on") return;
      const target = e.target as Element | null;
      const { prefKeys, panelKeys } = collect(target);
      if (prefKeys.length === 0 && panelKeys.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      setSelection({ prefKeys, panelKeys, x: e.clientX, y: e.clientY });
    };
    document.addEventListener("mousedown", onMouseDown, /* capture = */ true);
    return () => {
      document.removeEventListener("mousedown", onMouseDown, true);
    };
  }, [prefModeOn, isModified]);

  // Dismiss when preference mode turns off.
  useEffect(() => {
    if (!prefModeOn) setSelection(null);
  }, [prefModeOn]);

  if (!selection) return null;

  const totalCount = selection.prefKeys.length + selection.panelKeys.length;

  // Scrimless anchored SystemDialog: it owns the portal, surface chrome, Esc,
  // and outside-click-to-close (measured + viewport-clamped at the click point).
  // The `outsideClickGuard` preserves ctrl+click-to-retarget: a modifier click
  // outside doesn't dismiss — the capture-phase interceptor above re-collects.
  return (
    <SystemDialog
      open
      variant="anchored"
      at={{ x: selection.x + 8, y: selection.y + 8 }}
      onClose={() => setSelection(null)}
      outsideClickGuard={isModified}
      labelledBy="pref-mode-picker-title"
      frameClassName="w-[340px] max-h-[400px] flex flex-col"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-edge-subtle shrink-0">
        <span
          id="pref-mode-picker-title"
          className="text-[11px] font-semibold text-ink-subtle uppercase tracking-wider"
        >
          Edit preferences
        </span>
        <button
          onClick={() => setSelection(null)}
          className="text-ink-muted hover:text-ink-body text-xs"
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      <div className="overflow-y-auto px-1 py-2 flex-1">
        {totalCount === 0 ? (
          <div className="px-3 py-2 text-xs text-ink-muted italic">
            No editable preferences at this spot.
          </div>
        ) : (
          <>
            {filteredTree.length > 0 && (
              <PreferenceTree
                tree={filteredTree}
                prefs={prefs}
                onUpdate={updatePref}
              />
            )}
            {selection.panelKeys.map((k) => (
              <PanelColorRow key={k} panelKey={k} />
            ))}
          </>
        )}
      </div>
      <div className="px-3 py-1.5 border-t border-edge-subtle text-[10px] text-ink-muted shrink-0">
        Esc to close • ctrl+click elsewhere to retarget
      </div>
    </SystemDialog>
  );
}

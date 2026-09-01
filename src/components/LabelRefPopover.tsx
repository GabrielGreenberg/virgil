"use client";

/**
 * The cross-reference picker popover. Click an existing `\ref` to retarget it
 * (or flip its command via the tri-toggle), or open in create-mode to insert a
 * new `\ref` by typing/picking a label.
 *
 * ── MENU-PRIMITIVE MIGRATION (Phase C) ──
 * Migrated onto the `<Menu>` primitive (`src/components/menu/`, design
 * `docs/agents/menu-system-design.md` §3.5 + §4 the LabelRefPopover row) as the
 * input-bearing COMBOBOX reference. It now renders via
 * `<MenuProvider layout="combobox" role="listbox" portal>`; the provider owns
 * positioning (the old centered-below / flip-above positioner → `placements`),
 * click-outside dismissal (the old rAF-deferred mousedown effect → the
 * provider's), Escape (now TWO-STAGE via `onEscape` — first press exits edit
 * mode / collapses the dropdown, second closes), and the keyboard controller.
 *
 * The owned `<input>` is the combobox input (`role="combobox"
 * aria-expanded aria-controls aria-activedescendant`) — it KEEPS focus and is
 * the keyboard SOURCE (arrows route through `useMenuCombobox` to the controller,
 * which `preventDefault`s them so the single-line caret never moves). Each
 * `combinedOptions` row registers via `useMenuItem({ region: "list",
 * role: "option", run })`; the group headings (Sections / Examples) are visual
 * dividers, NOT nav stops. The bespoke `activeIndex` + `scrollIntoView` are
 * replaced by the controller's roving cursor + built-in scroll re-anchor.
 * PRESERVED: create-mode input auto-focus, the filter, commit-on-Enter (active
 * option or the typed fallback), the `\ref` / `\getref` / `\getfullref`
 * round-trip, click-outside.
 */

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import type { FloatingMenuPlacement } from "@/hooks/useFloatingMenuPosition";
import { MenuProvider } from "./menu/MenuProvider";
import { useMenuItem } from "./menu/useMenuItem";
import { useMenuCombobox } from "./menu/useMenuCombobox";
import { NEVER_SPELLCHECK_PROPS } from "@/lib/spellcheck-policy";

/**
 * A discoverable target for a `\ref`. Headings carry their own section
 * number and title; labels pulled out of raw-tex blocks (figure /
 * equation / table environments, or stray `\label{...}` occurrences)
 * only get a kind badge so they can at least be chosen from the popover
 * even though Virgil can't render the reference yet.
 */
export interface LabelInfo {
  label: string;
  kind: "heading" | "equation" | "figure" | "table" | "label" | "example";
  /** Short type badge, e.g. "Section 1.2", "Figure", "Equation", "Label", "Example (3b)". */
  typeLabel: string;
  /** Display title: heading text, example preview, or empty. */
  title: string;
}

export type RefCommand = "ref" | "getref" | "getfullref";

interface Props {
  /** The label key of the ref that was clicked (empty string = creating new ref) */
  label: string;
  /** Screen-space rect of the clicked ref node */
  anchorRect: DOMRect;
  /** All labels available in the document */
  labels: LabelInfo[];
  /** Current ref-command of the clicked labelRef (for the tri-toggle). */
  refCommand?: RefCommand;
  /** Called when the user picks a different label */
  onChangeLabel: (oldLabel: string, newLabel: string) => void;
  /** Called when the user clicks the target heading link */
  onJumpToLabel: (label: string) => void;
  /** Called when creating a new ref (via \ref command) — inserts a labelRef node */
  onInsertRef?: (label: string, refCommand?: RefCommand) => void;
  /** Called when the user flips the ref-command via the tri-toggle. */
  onChangeRefCommand?: (label: string, next: RefCommand) => void;
  /** Close the popover */
  onClose: () => void;
}

const POPOVER_WIDTH = 240;

// The old manual positioner placed the popover centered below the anchor and
// flipped it above when there was no room. That is exactly
// `[{ side: "below", align: "center" }, { side: "above", align: "center" }]`.
const LABEL_REF_PLACEMENTS: FloatingMenuPlacement[] = [
  { side: "below", align: "center" },
  { side: "above", align: "center" },
];

/** Stable registry id for an option row. Headings + examples are distinct
 *  label keys in a doc, but prefix by group so the two regions never collide
 *  and registration order (headings then examples) matches the combined list. */
function optionId(kind: "h" | "e", label: string): string {
  return `${kind}:${label}`;
}

export default function LabelRefPopover({
  label,
  anchorRect,
  labels,
  refCommand = "ref",
  onChangeLabel,
  onJumpToLabel,
  onInsertRef,
  onChangeRefCommand,
  onClose,
}: Props) {
  const isCreateMode = label === "";
  // The combobox input is the aria-activedescendant host (the controller writes
  // the active option's domId onto it) AND the keyboard source — focus stays in
  // it. A getter resolves the live element for the provider lazily.
  const inputRef = useRef<HTMLInputElement>(null);
  const getInputHost = useCallback(() => inputRef.current, []);

  // Two-stage Escape (§3.2): the body publishes a stage-1 handler into this ref.
  // The provider's `onEscape` interceptor calls it — return `true` to consume
  // Escape WITHOUT closing (first press exits edit mode / collapses the
  // dropdown); `false` lets the provider close (second press). In display mode
  // (not editing) the first press already returns false → closes, matching the
  // old single-stage behavior for an already-placed ref.
  const escapeStage1Ref = useRef<() => boolean>(() => false);
  const onEscape = useCallback(() => escapeStage1Ref.current(), []);

  if (typeof document === "undefined") return null;

  return (
    <MenuProvider
      id="label-ref"
      layout="combobox"
      role="listbox"
      portal
      anchorRect={anchorRect}
      placements={LABEL_REF_PLACEMENTS}
      gap={6}
      keyboardSource="input"
      getActiveDescendantHost={getInputHost}
      onEscape={onEscape}
      onClose={onClose}
      ariaLabel="Cross-reference labels"
      // The ONE menu that authors its own surface (task 295). `.label-ref-popover`
      // is a 2px `--amber-highlight-edge` border + a matching halo, which binds
      // the popover to the amber `\ref` highlight in the text it points at —
      // an identity, not the chrome drift the shared surface exists to end.
      // Allowlisted in menu-surface-guardrail.test.ts.
      surface="none"
      containerStyle={{ width: POPOVER_WIDTH }}
      containerClassName="label-ref-popover"
    >
      <LabelRefBody
        label={label}
        labels={labels}
        refCommand={refCommand}
        isCreateMode={isCreateMode}
        inputRef={inputRef}
        escapeStage1Ref={escapeStage1Ref}
        onChangeLabel={onChangeLabel}
        onJumpToLabel={onJumpToLabel}
        onInsertRef={onInsertRef}
        onChangeRefCommand={onChangeRefCommand}
        onClose={onClose}
      />
    </MenuProvider>
  );
}

interface BodyProps {
  label: string;
  labels: LabelInfo[];
  refCommand: RefCommand;
  isCreateMode: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** The two-stage Escape stage-1 handler bridge (see the outer component). */
  escapeStage1Ref: React.MutableRefObject<() => boolean>;
  onChangeLabel: (oldLabel: string, newLabel: string) => void;
  onJumpToLabel: (label: string) => void;
  onInsertRef?: (label: string, refCommand?: RefCommand) => void;
  onChangeRefCommand?: (label: string, next: RefCommand) => void;
  onClose: () => void;
}

/** The popover body — lives INSIDE the provider so it can drive the combobox
 *  (`useMenuCombobox`) and register each option (`useMenuItem`). */
function LabelRefBody({
  label,
  labels,
  refCommand,
  isCreateMode,
  inputRef,
  escapeStage1Ref,
  onChangeLabel,
  onJumpToLabel,
  onInsertRef,
  onChangeRefCommand,
  onClose,
}: BodyProps) {
  const [editing, setEditing] = useState(isCreateMode);
  const [inputValue, setInputValue] = useState(label);
  const [dropdownOpen, setDropdownOpen] = useState(isCreateMode);

  const { activeId, clearActive, getInputProps } = useMenuCombobox();

  // Publish the two-stage Escape stage-1 handler the provider's `onEscape`
  // calls. While editing (the input is open), the FIRST Escape exits edit mode
  // + collapses the dropdown and returns `true` (consumed, popover stays open);
  // the SECOND Escape (no longer editing) returns `false` → the provider
  // closes. In display mode the first press already returns `false` (close).
  // Written in a layout effect (NOT during render) so the ref-write is
  // off the render path — the provider's `onEscape` reads it at keydown time,
  // after commit, so it always sees the latest `editing`.
  useLayoutEffect(() => {
    escapeStage1Ref.current = () => {
      if (editing) {
        setEditing(false);
        setDropdownOpen(false);
        return true; // consume — don't close yet (two-stage)
      }
      return false; // let the provider close
    };
  }, [editing, escapeStage1Ref]);

  // Resolve target info from label
  const target = labels.find((l) => l.label === label);

  // Auto-focus input in create mode (preserved from the pre-migration file).
  useEffect(() => {
    if (isCreateMode) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isCreateMode, inputRef]);

  const startEditing = useCallback(() => {
    setEditing(true);
    setInputValue(label);
    setDropdownOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [label, inputRef]);

  const commitLabel = useCallback(
    (newLabel: string) => {
      setEditing(false);
      setDropdownOpen(false);
      if (!newLabel) return;
      if (isCreateMode && onInsertRef) {
        onInsertRef(newLabel, refCommand);
        onClose();
      } else if (newLabel !== label) {
        onChangeLabel(label, newLabel);
      }
    },
    [label, isCreateMode, onChangeLabel, onInsertRef, refCommand, onClose],
  );

  // Filter labels for dropdown and split by kind.
  const filteredLabels = useMemo(
    () =>
      labels.filter((l) =>
        l.label.toLowerCase().includes(inputValue.toLowerCase()),
      ),
    [labels, inputValue],
  );
  const filteredHeadings = useMemo(
    () => filteredLabels.filter((l) => l.kind !== "example"),
    [filteredLabels],
  );
  const filteredExamples = useMemo(
    () => filteredLabels.filter((l) => l.kind === "example"),
    [filteredLabels],
  );
  // Map an option's registry id back to its label, so Enter on the roving-
  // active option commits the right key. Built off the SAME [...headings,
  // ...examples] order the rows register in.
  const idToLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of filteredHeadings) m.set(optionId("h", l.label), l.label);
    for (const l of filteredExamples) m.set(optionId("e", l.label), l.label);
    return m;
  }, [filteredHeadings, filteredExamples]);

  const showDropdown = editing && dropdownOpen && filteredLabels.length > 0;

  return (
    <>
      {/* Top pod: target heading */}
      <div
        className="label-ref-popover-pod label-ref-popover-target"
        onClick={() => {
          if (target) {
            onJumpToLabel(target.label);
            requestAnimationFrame(() => onClose());
          }
        }}
        style={{ cursor: target ? "pointer" : "default" }}
      >
        {target ? (
          <>
            <span className="label-ref-popover-type">{target.typeLabel}</span>
            {target.title && (
              <span className="label-ref-popover-title">{target.title}</span>
            )}
          </>
        ) : (
          <span className="label-ref-popover-unresolved">Unresolved reference</span>
        )}
      </div>

      {/* Ref-command tri-toggle: flip between \ref / \getref / \getfullref. */}
      {!isCreateMode && onChangeRefCommand && (
        <div className="label-ref-popover-pod label-ref-popover-refcmd">
          {(["ref", "getref", "getfullref"] as RefCommand[]).map((cmd) => (
            <button
              key={cmd}
              type="button"
              className={`label-ref-popover-refcmd-btn${cmd === refCommand ? " active" : ""}`}
              onClick={(e) => {
                e.preventDefault();
                if (cmd !== refCommand) onChangeRefCommand(label, cmd);
              }}
            >
              \{cmd}
            </button>
          ))}
        </div>
      )}

      {/* Bottom pod: label (click to edit) */}
      <div className="label-ref-popover-pod label-ref-popover-label">
        {editing ? (
          <div className="label-ref-popover-edit">
            <input
              {...getInputProps({
                open: showDropdown,
                onNavigate: () => setDropdownOpen(true),
                onKeyDown: (e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    // Commit the roving-active option when one is highlighted;
                    // otherwise fall back to the raw typed value.
                    const picked = activeId ? idToLabel.get(activeId) : undefined;
                    commitLabel(picked ?? inputValue);
                  }
                  // Escape is owned by the provider's two-stage onEscape; typing
                  // falls through to onChange.
                },
              })}
              ref={inputRef}
              className="label-ref-popover-input"
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                setDropdownOpen(true);
                // Reset the highlight on the same keystroke so a stale active id
                // never points past the re-filtered set (matches the old
                // setActiveIndex(-1) on typing).
                clearActive();
              }}
              onBlur={() => {
                // Delay so a dropdown click can register before edit mode exits.
                setTimeout(() => {
                  setEditing(false);
                  setDropdownOpen(false);
                }, 150);
              }}
              placeholder="label key"
              {...NEVER_SPELLCHECK_PROPS}
            />
            {showDropdown && (
              <div className="label-ref-popover-dropdown">
                {filteredHeadings.length > 0 && filteredExamples.length > 0 && (
                  <div className="label-ref-popover-group-heading" aria-hidden>
                    Sections
                  </div>
                )}
                {filteredHeadings.map((l) => (
                  <LabelRefOption
                    key={`h-${l.label}`}
                    id={optionId("h", l.label)}
                    info={l}
                    current={l.label === label}
                    run={() => commitLabel(l.label)}
                  />
                ))}
                {filteredHeadings.length > 0 && filteredExamples.length > 0 && (
                  <div className="label-ref-popover-group-heading" aria-hidden>
                    Examples
                  </div>
                )}
                {filteredExamples.map((l) => (
                  <LabelRefOption
                    key={`e-${l.label}`}
                    id={optionId("e", l.label)}
                    info={l}
                    current={l.label === label}
                    run={() => commitLabel(l.label)}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="label-ref-popover-label-display" onClick={startEditing}>
            <span className="label-ref-popover-label-key">label:</span>
            <span className="label-ref-popover-label-value">{label}</span>
          </div>
        )}
      </div>
    </>
  );
}

interface OptionProps {
  id: string;
  info: LabelInfo;
  current: boolean;
  run: () => void;
}

/** One listbox option. Registers into the menu registry (`region: "list",
 *  role: "option"`) so the roving cursor crosses it; spreads `getItemProps()`
 *  onto the row so it gains `aria-selected` + the `data-active` highlight. The
 *  group-heading dividers are NOT options — they don't register. */
function LabelRefOption({ id, info, current, run }: OptionProps) {
  const { active, getItemProps } = useMenuItem({
    id,
    region: "list",
    role: "option",
    run,
  });
  const itemProps = getItemProps();

  return (
    <div
      {...itemProps}
      aria-selected={active}
      className={`label-ref-popover-option${current ? " current" : ""}${active ? " active" : ""}`}
      // Keep the input from blurring when an option is clicked (the container
      // also preventDefaults non-input mousedowns, but this guards the focus
      // explicitly so the option's onClick → commit fires cleanly).
      onMouseDown={(e) => e.preventDefault()}
    >
      <span className="label-ref-option-label">{info.label}</span>
      <span className="label-ref-option-info">{info.typeLabel}</span>
    </div>
  );
}

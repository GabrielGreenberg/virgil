/**
 * `caretEditableHost` — the ONE resolver for "the editable this menu parks the
 * caret in".
 *
 * Four editor-anchored menus never take DOM focus: the grab-bar menu
 * (`DragHandleMenu`), the lightning menu (`ActionsMenuPanel`),
 * `HeadingTypeMenu` and `SelectionColorPopover`. They leave the caret in the PM
 * view's contentEditable and track the active row with roving
 * `aria-activedescendant` written onto that element. All four used to carry a
 * character-identical private copy of this resolver, which is exactly how the
 * FOURTH one shipped — and how a fifth would.
 *
 * It is not only an ARIA detail. The element this returns is the menu's
 * OWNERSHIP STATEMENT: while the menu is open, the keys arriving at this
 * editable are the menu's to take, and every other editable's keys are not
 * (`useMenuKeyboard`'s window-capture bail — task 734). A menu that owns its
 * own `<input>` instead declares it through the combobox keyboard source, not
 * through this door.
 *
 * Returns null when focus is not on a contentEditable — the keyboard
 * controller then owns nothing and the ARIA write no-ops.
 *
 * Runtime LEAF: imports nothing.
 */
export function caretEditableHost(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const el = document.activeElement;
  if (el instanceof HTMLElement && el.isContentEditable) return el;
  return null;
}

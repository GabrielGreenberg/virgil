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
 * It reads LIVE focus, so it answers correctly only at the moment a menu
 * opens. `useMenuKeyboard` therefore calls it ONCE per open and keeps the
 * element it got (task 995): ownership re-derived per keydown let focus that
 * drifted to another contentEditable (Tab into a card title) become "the
 * menu's", and its Backspace ran the grab menu's delete row.
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

/**
 * One menu's claim on a host's `aria-activedescendant` (task 995).
 *
 * Several open menus can share ONE host — the ⚡ lightning menu and the
 * `SelectionColorPopover` it opens both park the caret in the same PM
 * editable. A single attribute cannot hold two writers, so it is a STACK per
 * host: the most recent claim (the innermost open menu) is what the attribute
 * shows; a writer lower down records its id silently; and releasing a claim
 * re-shows the next writer's CURRENT id instead of removing the attribute —
 * closing a nested menu re-announces its parent's active row rather than
 * leaving the parent mute.
 */
export interface ActiveDescendantClaim {
  /** Record this writer's active dom id (null = none); shown if top. */
  set(domId: string | null): void;
  /** Drop this writer; the attribute falls back to the next writer's id. */
  release(): void;
}

interface Writer {
  domId: string | null;
}

const writersByHost = new WeakMap<HTMLElement, Writer[]>();

function paint(host: HTMLElement, stack: readonly Writer[]): void {
  const top = stack[stack.length - 1];
  if (top?.domId) host.setAttribute("aria-activedescendant", top.domId);
  else host.removeAttribute("aria-activedescendant");
}

export function claimActiveDescendant(host: HTMLElement): ActiveDescendantClaim {
  let stack = writersByHost.get(host);
  if (!stack) {
    stack = [];
    writersByHost.set(host, stack);
  }
  const writer: Writer = { domId: null };
  stack.push(writer);
  // The new top has no active row yet — stop announcing the one beneath it.
  paint(host, stack);
  let released = false;
  return {
    set(domId) {
      if (released) return;
      writer.domId = domId;
      const s = writersByHost.get(host);
      if (s && s[s.length - 1] === writer) paint(host, s);
    },
    release() {
      if (released) return;
      released = true;
      const s = writersByHost.get(host);
      if (!s) return;
      const i = s.indexOf(writer);
      if (i < 0) return;
      const wasTop = i === s.length - 1;
      s.splice(i, 1);
      if (s.length === 0) writersByHost.delete(host);
      if (wasTop) paint(host, s);
    },
  };
}

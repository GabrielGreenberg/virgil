"use client";

// A backdrop click dismisses only when the WHOLE press happened on the backdrop.
//
// `click` fires on the nearest common ancestor of the mousedown and mouseup
// targets. So a text-selection drag that starts in a dialog's textarea and is
// released past the card's edge delivers a click whose target IS the backdrop —
// `e.target === e.currentTarget` holds, and a dialog that trusts it closes
// mid-gesture and discards the typing (task 763: `BibEditModal` lost an entry's
// edits this way; `SystemDialog`'s shell had the same test). The press has to
// START on the backdrop too.

import { useCallback, useRef } from "react";

export interface BackdropPressHandlers {
  onMouseDown: (e: React.MouseEvent) => void;
  onClick: (e: React.MouseEvent) => void;
}

/** Spread onto a backdrop element: `onDismiss` runs only for a press that both
 *  began and ended on the backdrop itself (never on a child of it). */
export function useBackdropPress(onDismiss: () => void): BackdropPressHandlers {
  const pressedOnBackdrop = useRef(false);
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    pressedOnBackdrop.current = e.target === e.currentTarget;
  }, []);
  const onClick = useCallback(
    (e: React.MouseEvent) => {
      const began = pressedOnBackdrop.current;
      pressedOnBackdrop.current = false;
      if (began && e.target === e.currentTarget) onDismiss();
    },
    [onDismiss],
  );
  return { onMouseDown, onClick };
}

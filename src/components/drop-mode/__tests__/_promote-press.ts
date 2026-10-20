/**
 * Test helper (task 1192): a press on a press-started drop producer only PENDS
 * its session (`pendDropSession`); the session begins once the held pointer
 * travels past `DROP_DRAG_THRESHOLD_PX`. Fire that drag move.
 */
import { fireEvent } from "@testing-library/react";

export function promotePress(clientX = 9999, clientY = 9999): void {
  fireEvent(
    window,
    new MouseEvent("mousemove", { bubbles: true, clientX, clientY, buttons: 1 }),
  );
}

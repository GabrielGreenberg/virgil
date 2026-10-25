/**
 * **What the Stack's add door REPORTS, and what the user is told** (task 1285).
 *
 * Task 591 made the add door report; task 1100 gave it three more ways to
 * refuse. But it reported a bare `false`, and the one capture terminal mapped
 * every `false` to "The Stack is full — remove some items". Two of those
 * refusals happen with the strip EMPTY (an unreadable envelope reads as no
 * items), so the user was told to remove items from a strip that had none —
 * a remedy that can never work, for a Stack that stayed wedged.
 *
 * So the refusal is TYPED at the door that knows why, and the notice is
 * DERIVED from that reason through {@link STACK_ADD_REFUSAL_NOTICE} — an
 * exhaustive `Record`, so a new reason cannot ship without its own copy.
 */

/** Why an add did not land. */
export type StackAddRefusal =
  /** The write threw even after FIFO-evicting down to the new item alone,
   *  and the Stack HELD items before the add — removing some is a real
   *  remedy, because they are what is still occupying storage. */
  | "full"
  /** Same failed write, but the Stack was EMPTY: the room is taken by
   *  something other than the Stack, so "remove items" would be a lie. */
  | "no-room"
  /** The stored envelope parses but is not one this build writes (another
   *  version of Virgil owns it) — never overwritten. */
  | "foreign"
  /** Browser storage itself could not be read (it threw, or there is no
   *  `localStorage` at all). */
  | "unreadable-storage"
  /** The stored blob does not parse, and setting it aside before starting
   *  fresh failed even after clearing the previous quarantine. */
  | "quarantine-failed";

/** THE add door's answer. Only `ok: true` may be reported as a capture. */
export type StackAddReport =
  | { ok: true }
  | { ok: false; reason: StackAddRefusal };

export interface StackRefusalNotice {
  title: string;
  message: string;
}

/** One notice per refusal reason. Exhaustive by type: a reason without copy
 *  does not compile. */
export const STACK_ADD_REFUSAL_NOTICE: Record<StackAddRefusal, StackRefusalNotice> = {
  full: {
    title: "The Stack is full",
    message:
      "This capture could not be saved — the Stack has run out of room. " +
      "Remove some items from the Stack strip and try again.",
  },
  "no-room": {
    title: "No room to save this capture",
    message:
      "This capture could not be saved — the browser's storage for Virgil is " +
      "full, and the Stack is already empty. This item may be too large to " +
      "keep in the Stack.",
  },
  foreign: {
    title: "The Stack belongs to another version",
    message:
      "The Stack was saved by a different version of Virgil, so this one " +
      "won't overwrite it. Reload Virgil to use it.",
  },
  "unreadable-storage": {
    title: "The Stack is unavailable",
    message:
      "Virgil can't reach the browser's storage, so the Stack can't save " +
      "anything right now. Check that site data isn't blocked, then reload.",
  },
  "quarantine-failed": {
    title: "The Stack's saved data is damaged",
    message:
      "The Stack's saved data can't be read, and there isn't room to set it " +
      "aside and start fresh. Clearing this site's data in the browser will " +
      "reset the Stack.",
  },
};

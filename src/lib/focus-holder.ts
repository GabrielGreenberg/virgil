/**
 * "What holds focus now, as a place to give it BACK to?" — one answer for every
 * surface that takes DOM focus and owes its return (task 1542).
 *
 * Two surfaces capture the prior focus holder on their open edge: the dialog
 * shell (`useDialogFocusRestore`, task 531) and the menu primitive
 * (`MenuProvider`'s Escape ladder, task 1542). They share this read so "nothing
 * meaningful was focused" means the same thing in both: no active element,
 * `<body>`, the document element, or something with no `focus()` to call.
 *
 * [cost: O(1)] — one `document.activeElement` read.
 */
export function readFocusHolder(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return null;
  const html = el as HTMLElement;
  return typeof html.focus === "function" ? html : null;
}

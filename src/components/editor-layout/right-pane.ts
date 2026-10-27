/**
 * The document row's ONE right-hand pane (task 1320): what accompanies the
 * text — the LaTeX source (`"code"`) or the compiled PDF (`"pdf"`), never both.
 * Both open in the same `SplitWithCode` right pane; `null` is the text alone.
 *
 * It replaced two booleans (`codeView`, `pdfView`) that four callbacks kept
 * mutually exclusive by hand while two different layout mechanisms rendered
 * them. Every transition the shell makes is one of the pure functions below,
 * so the exclusivity is the type and the policy is stated once.
 */
export type RightPaneKind = "code" | "pdf";
export type RightPane = RightPaneKind | null;

/** Open `kind`, replacing whatever held the slot. */
export function openRightPane(_prev: RightPane, kind: RightPaneKind): RightPane {
  return kind;
}

/** Close `kind` if it holds the slot; leave any other occupant alone. */
export function closeRightPane(prev: RightPane, kind: RightPaneKind): RightPane {
  return prev === kind ? null : prev;
}

/** A fresh compile success opens the PDF only into an EMPTY slot — an open code
 *  pane is the user's working surface (it already shows the compile status), so
 *  it is never yanked away; an open PDF simply stays. */
export function afterFreshCompile(prev: RightPane): RightPane {
  return prev ?? "pdf";
}

/** A paper switch closes the PDF (it showed the previous paper's PDF); the code
 *  pane stays open across switches, as it always has. */
export function afterDocSwitch(prev: RightPane): RightPane {
  return closeRightPane(prev, "pdf");
}

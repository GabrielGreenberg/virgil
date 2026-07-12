// Grid-track SSOT for LibraryView's resizable column layout.
//
// The two column sizes ride CSS custom properties on the grid node; the
// templates below wrap them in the HARD min/max constraints so LAYOUT owns
// the clamp composition (kills the R8 class: the old render-time
// `window.innerWidth` clamps were independent and non-reactive, so widths
// persisted on a wider monitor could sum past the viewport and silently
// collapse the 1fr reader column to 0).
//
// Constraint shape (3-col):
//   - the nav track caps at 100% − (list min + reader min + both gutters),
//     so it can never push the other columns below their floors;
//   - the list track caps at 100% − the RESOLVED nav track − (reader min +
//     both gutters), so nav+list can never sum past what leaves the reader
//     its minimum;
//   - the reader is `minmax(READER_MIN, 1fr)`: it absorbs all slack and can
//     never collapse to 0. Only when the container is narrower than the sum
//     of the three mins + gutters does the grid overflow — irreducible.
//
// The pane-resize engine's JS clamps in LibraryView MIRROR these bounds for
// pointer UX only (so the divider tracks the finger instead of dead-zoning
// against the CSS clamp); the template is the authority. Because the max
// bounds are container-relative calc()s, a width persisted on a wide monitor
// is clamped reactively on a narrow one and re-expands when the window grows
// — the stored value is never rewritten by a mere viewport change.

/** Width of every resizer gutter track (and the papers-pod splitter). */
export const LIB_GRID_GUTTER = 6;

/** The reader (right) column's hard floor — `minmax(READER_MIN, 1fr)`. */
export const READER_MIN = 200;

// Column/pod floors + defaults. The floors MUST match the view-session
// store's NAV_WIDTH_MIN / MIDDLE_WIDTH_MIN / PAPERS_HEIGHT_MIN (the store
// floors legacy-migrated values with the same constants).
export const NAV_MIN = 180;
export const NAV_DEFAULT = 220;
export const LEFT_MIN = 220;
export const LEFT_DEFAULT = 360;
// Height floor for BOTH navigator-column pods: the My Papers pod keeps at
// least this, and the Libraries pod above it keeps the same, so the splitter
// can't smash either into invisibility.
export const PAPERS_MIN = 100;
export const PAPERS_DEFAULT = 240;

/** CSS custom properties the pane-resize engine retargets per frame. */
export const LIB_NAV_W_VAR = "--lib-nav-w";
export const LIB_LIST_W_VAR = "--lib-list-w";

const NAV_TRACK =
  `clamp(${NAV_MIN}px, var(${LIB_NAV_W_VAR}, ${NAV_DEFAULT}px), ` +
  `calc(100% - ${LEFT_MIN + READER_MIN + 2 * LIB_GRID_GUTTER}px))`;

const LIST_TRACK_3COL =
  `clamp(${LEFT_MIN}px, var(${LIB_LIST_W_VAR}, ${LEFT_DEFAULT}px), ` +
  `calc(100% - ${NAV_TRACK} - ${READER_MIN + 2 * LIB_GRID_GUTTER}px))`;

const LIST_TRACK_2COL =
  `clamp(${LEFT_MIN}px, var(${LIB_LIST_W_VAR}, ${LEFT_DEFAULT}px), ` +
  `calc(100% - ${READER_MIN + LIB_GRID_GUTTER}px))`;

const READER_TRACK = `minmax(${READER_MIN}px, 1fr)`;

/** navigator | gutter | list | gutter | reader (inline Library tab). */
export const LIB_GRID_TEMPLATE_3COL = `${NAV_TRACK} ${LIB_GRID_GUTTER}px ${LIST_TRACK_3COL} ${LIB_GRID_GUTTER}px ${READER_TRACK}`;

/** list | gutter | reader (tear-out outer-tab mode, no navigator). */
export const LIB_GRID_TEMPLATE_2COL = `${LIST_TRACK_2COL} ${LIB_GRID_GUTTER}px ${READER_TRACK}`;

/**
 * Custom MIME types used for in-app drag-and-drop. Distinct types let
 * drop targets disambiguate by what's being dragged: a tab (manila-folder
 * tab, source library reorder/move) vs. an entry row (catalog item being
 * added to a library).
 */

export const TAB_DT_TYPE = "application/x-virgil-library-tab";
export const ENTRY_DT_TYPE = "application/x-virgil-library-entry";
/**
 * Multi-row drag payload — JSON array of entry keys, written alongside
 * `ENTRY_DT_TYPE` whenever a row is dragged. Drop handlers should prefer
 * this when present; `ENTRY_DT_TYPE` continues to carry the primary key
 * (the row the user grabbed) for back-compat. A drag of a single,
 * unselected row produces a one-element array.
 */
export const ENTRIES_DT_TYPE = "application/x-virgil-library-entries";
/**
 * Carried alongside TAB_DT_TYPE only when the dragged inner tab is a
 * paper-kind library file. The value is the bare citekey (no prefix),
 * so consumers outside the library subsystem (e.g. the Virgil bar)
 * can promote a paper to an outer tab without parsing the library id.
 */
export const PAPER_DT_TYPE = "application/x-virgil-paper-citekey";
/**
 * Carried alongside TAB_DT_TYPE when a NON-Central library tab (project
 * or custom) is dragged. The value is the bare libId. Used by the
 * Virgil bar to promote a library to an outer tab. Drop semantics are
 * COPY: the donor inner tab stays put.
 */
export const LIBRARY_DT_TYPE = "application/x-virgil-library-id";

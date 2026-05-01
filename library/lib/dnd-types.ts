/**
 * Custom MIME types used for in-app drag-and-drop. Distinct types let
 * drop targets disambiguate by what's being dragged: a tab (manila-folder
 * tab, source library reorder/move) vs. an entry row (catalog item being
 * added to a library).
 */

export const TAB_DT_TYPE = "application/x-virgil-library-tab";
export const ENTRY_DT_TYPE = "application/x-virgil-library-entry";

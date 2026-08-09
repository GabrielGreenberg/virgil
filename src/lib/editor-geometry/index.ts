export {
  geomHoverEnabled,
  measureBlock,
  type BlockAtY,
  type EditorGeometryService,
  type GeometryStats,
} from "./service";
export { getGeometry, getOrCreateGeometry, coordsAtPosCached } from "./registry";
export {
  EMPTY_VIEWPORT_FRAME,
  computeViewportFrame,
  viewportFramesEqual,
  type EditorViewportFrame,
} from "./viewport-frame";
export {
  computeSectionPathAt,
  geomBreadcrumbEnabled,
  type SectionPathResult,
  type SectionSkipBand,
} from "./section-path";

import type { SourcePodConfig } from "@/components/SourcePodNodeView";

/**
 * THE `texBlock` source-pod config — one object, module-scope.
 *
 * The sibling of `FOREST_POD_CONFIG` (`@/lib/forest/pod-config`), and constant
 * for the same two reasons stated there: the pod memoizes on the config, so a
 * literal minted per render re-derives on every unrelated re-render of the
 * block; and a config spelled at its call site is a config that drifts from the
 * one a test drives.
 *
 * It could not be a constant until task 730, because it carried `isPopped` — a
 * per-render boolean. Now that the pod resolves "is my float open?" itself from
 * the node's `(kind, uuid)`, nothing here varies, and texBlock's NodeView is
 * strings-only like forest's.
 *
 * texBlock contributes no `derive`: its bytes ARE raw LaTeX between the
 * `%!vtex:` sentinels, so there is no rendered view to offer beside the source.
 */
export const TEX_POD_CONFIG: SourcePodConfig = {
  hostClass: "tex-block",
  sourceAttr: "code",
  chipLabel: ".tex",
  kindLabel: "LaTeX block",
  emptyLabel: "(empty .tex)",
  confirmMessage:
    "This will remove the LaTeX block and its contents. You can undo with Cmd+Z.",
};

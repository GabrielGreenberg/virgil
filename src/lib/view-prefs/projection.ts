/**
 * The view-pref → CSS projection — ONE applier for what the registry DECLARES
 * (task 927).
 *
 * A Display toggle that changes the screen through CSS says so on its own
 * `VIEW_PREF_REGISTRY` row (`project: { class, when }` / `{ attr, value, when }`
 * / an enum's `{ classOf }`), and this module turns a prefs snapshot into
 * the class tokens + attributes those rows ask for. Nothing else spells a
 * pref's class name: adding a projected toggle is one registry row.
 *
 * WHERE it lands is the point of the task. Two `useViewPrefs` instances exist
 * at once (the editor's, and the Library Reader's ephemeral one), and each
 * owns its own surfaces. The projection is therefore applied to an instance's
 * OWN roots — `EditorPane`'s `.editor-pane-root` and every `FloatingPanel` it
 * portals (via `ViewPrefProjectionProvider`) — never to `<body>`, which is one
 * slot two instances would fight over (the Reader's toggles used to change
 * nothing because only EditorLayout wrote it).
 *
 * Cost: O(registry rows) on a prefs change; the consumers memo on the result's
 * string identity, so nothing here runs per keystroke.
 */
import {
  VIEW_PREF_REGISTRY,
  VIEW_PREF_KEYS,
  type RegistryPrefs,
  type ViewPrefDef,
} from "./registry";

export interface ViewPrefProjection {
  /** Class tokens, in registry order. */
  readonly classes: readonly string[];
  /** Inherited HTML attributes to write on the projecting root. */
  readonly attrs: Readonly<Record<string, string>>;
}

/** Project a prefs snapshot through every row's declared `project`. */
export function projectViewPrefs(prefs: Partial<RegistryPrefs>): ViewPrefProjection {
  const classes: string[] = [];
  const attrs: Record<string, string> = {};
  for (const key of VIEW_PREF_KEYS) {
    const def = VIEW_PREF_REGISTRY[key] as ViewPrefDef;
    if (def.kind === "set" || !def.project) continue;
    const value = key in prefs ? prefs[key] : def.default;
    if (def.kind === "enum") {
      if (!("classOf" in def.project)) continue;
      classes.push(def.project.classOf(String(value)));
      continue;
    }
    const p = def.project;
    if (value !== p.when) continue;
    if ("class" in p) classes.push(p.class);
    else attrs[p.attr] = p.value;
  }
  return { classes, attrs };
}

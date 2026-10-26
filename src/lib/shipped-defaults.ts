/**
 * The ONE door from a promoted defaults JSON to its typed preference shape.
 *
 * A `*.defaults.json` sidecar is rewritten by `tools/promote-defaults.mjs`, not
 * by hand, so its type is whatever `resolveJsonModule` infers from its literal
 * contents — wider than the interface it stands for (a string where the
 * interface has a union). Reaching the interface therefore needs a cast, and a
 * bare `json as Prefs` also forgives a MISSING key: a field added to the
 * interface and forgotten in the JSON typechecks and ships `undefined` to every
 * fresh profile (task 1306). This helper keeps the cast for VALUE types but
 * makes KEY coverage a compile error: `Json` must declare every key of
 * `Want`, and tsc names the ones it lacks.
 *
 * Curried so `Want` is stated and `Json` is inferred:
 * `shippedDefaults<EditorPreferences>()(json)`. Keys a defaults file
 * deliberately does not ship are removed from `Want` with `Omit<>` at the call
 * site — that `Omit` is the only exemption list, and it is the cast itself.
 */
export function shippedDefaults<Want>() {
  return <Json extends Record<keyof Want, unknown>>(json: Json): Want =>
    json as unknown as Want;
}

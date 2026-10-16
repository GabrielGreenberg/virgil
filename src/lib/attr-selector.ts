/**
 * The ONE door for "select the element whose attribute EQUALS this value"
 * (task 1146). A quoted CSS attribute value needs only `"` and `\` escaped (plus
 * a raw newline, which a CSS string cannot hold), so this is total and needs no
 * platform API — unlike `CSS.escape`, which jsdom does not provide at all: the
 * unguarded `CSS.escape` in `focusNewCard`'s retry threw under every test whose
 * frames ran. Six sites spelled this by hand, three of them unguarded.
 */
export function attrSelector(name: string, value: string): string {
  // A single `return` so the pane-dom census's builder fold reads the
  // attribute NAME through this call (the value folds to a hole).
  return `[${name}="${quoteAttrValue(value)}"]`;
}

function quoteAttrValue(value: string): string {
  return value.replace(/["\\]/g, "\\$&").replace(/\n/g, "\\a ");
}

# Target-Registry Audit Analysis

## Files examined
- target-registry.ts: registerDropTarget, findEditorAtPoint
- hit-test.ts: findEditorAtPoint caller
- Editor.tsx:1824-1827: main editor registration
- RichTextField.tsx:487-490: card body registration

## Registration & Cleanup Flow

### registerDropTarget (line 27-36)
```
if (!editor) return () => {}  // null-safe
const dom = editor.view.dom   // cache at registration time
editorByDom.set(dom, editor)  // register
return () => {
  if (editorByDom.get(dom) === editor)  // guard: only delete if same editor
    editorByDom.delete(dom)
}
```

Cleanup is CONDITIONAL: deletes only if the cached editor === current value.
This is CORRECT for handling:
- Editor A registers with dom1
- Editor A updates (new instance), registers with dom1' (different dom)
- Editor A's old dispose runs: get(dom1) !== newEditor, so does NOT delete

## Key Edge Cases to Consider

### 1. view.dom stability
Q: Can view.dom change without the editor reference changing?
A: TipTap's EditorView.dom should be stable per editor lifecycle.
   But if PM creates a new view internally (unexpected), dom could change.

### 2. Multiple registrations of same dom
Current code:
- Editor instance A: dom1 → editorByDom.set(dom1, A)
- (React re-render, same editor reference)
- useEffect reruns: editorByDom.set(dom1, A)  // overwrites with same
This is HARMLESS — sets the same value.

### 3. Overlapping editors (floats over main)
Current code:
- findEditorAtPoint walks elements top-to-bottom
- Returns FIRST matching editor
- If InlineAtomGhost or Indicator is in elementsFromPoint:
  * Indicator: pointerEvents:none ✓ → excluded from elementsFromPoint
  * InlineAtomGhost: pointerEvents:none ✓ → excluded from elementsFromPoint
- Next element might be drop zone or stale editor

### 4. Orphaned entries
registerDropTarget disposes CONDITIONALLY (lines 32-33):
```
if (editorByDom.get(dom) === editor) {
  editorByDom.delete(dom)
}
```

Scenario: If two editors somehow share the same dom:
- Editor A registers with dom → editorByDom.set(dom, A)
- Editor B registers with dom → editorByDom.set(dom, B)  // overwrites!
- Editor A disposes: get(dom) === A? NO, it's B. Does NOT delete.
- Editor B disposes: get(dom) === B? YES, deletes.
- Result: OK, both disposed

But: Can two editor instances share editor.view.dom?
ANSWER: Per TipTap architecture, no. Each Editor has its own View instance.
Unless: useEditor returns a different instance with the same DOM?

### 5. Editor instance mutation
EditorContent (TipTap React component) in Editor.tsx calls:
- useEditor({...}) to create/recreate the editor
- Returns Editor | null

If editor reference changes (new instance):
- Old useEffect disposal runs first (old editor reference)
- Then new useEffect runs (new editor reference)
- Pattern: safe if dispose guards on editor identity ✓

## Critical Finding: the dom check

Line 32:
```
if (editorByDom.get(dom) === editor) {
```

This checks that the STORED editor === the CURRENT editor reference.
But it uses the CAPTURED dom from closure.

SCENARIO (POTENTIAL DEFECT):
1. Editor A mounts: registerDropTarget(A)
   - dom_a = A.view.dom
   - editorByDom.set(dom_a, A)
   - dispose captured dom_a
2. Editor A updates (content/state change, but SAME instance)
   - useEffect dependency is [editor] → [A]
   - [A] didn't change, useEffect does NOT re-run
   - No re-registration, no cleanup
3. Editor A.view.dom changes internally (unlikely but hypothetical)
   - editorByDom still maps dom_a → A
   - Cursor now over A's NEW dom → won't find A in registry
   - Cursor returns null editor → no drop target

LIKELIHOOD: Very LOW. TipTap's EditorView.dom should be stable.
But: Comment in target-registry.ts lines 6-7 says "That DOM element is 
stable across renders" — so this is acknowledged as an assumption.

## Finding: dispose-guard race

Editor.tsx lines 1824-1827:
```
useEffect(() => {
  if (!editor) return;
  return registerDropTarget(editor);
}, [editor]);
```

RichTextField.tsx lines 487-490: identical.

FLOW during unmount:
1. React calls cleanup function from previous effect
2. registerDropTarget returns dispose
3. dispose runs
4. THEN component unmounts

ISSUE: If the dispose captures the wrong dom reference...
Actually, the closure captures the EXACT dom at registration time.
So it's safe.

## Actual Defect Found?

Let me check: can elementsFromPoint return a child .ProseMirror inside 
a parent .ProseMirror, and could we return the WRONG one?

target-registry.ts lines 45-59:
```
const els = document.elementsFromPoint(x, y)
for (const el of els) {
  if (el.classList.contains("ProseMirror")) {
    const pm = el  // DIRECT MATCH
    const ed = editorByDom.get(pm)
    if (ed) return ed  // RETURN FIRST MATCH
  } else {
    const pm = el.closest(".ProseMirror")  // WALK UP
    if (pm) {
      const ed = editorByDom.get(pm)
      if (ed) return ed
    }
  }
}
```

TOP-LEVEL for loop walks elementsFromPoint in order (top z-order first).
The comment says "the first ancestor with a registered `.ProseMirror` wins."

SCENARIO: Nested editors (e.g., table cells with inline editors):
- elementsFromPoint returns [innerPM, parentPM, ...]
- Loop hits innerPM first
- If innerPM is registered, returns it ✓
- If innerPM is NOT registered, walks up to parentPM ✓

This is CORRECT for nested cases.

SCENARIO: Two separate editors, one floating above the other:
- FloatingPanel with RichTextField floats above main editor
- Cursor in gap between them (above floating editor, below nothing)
- elementsFromPoint returns [floatingPM, mainPM, ...]
- Returns floatingPM (first registered) ✓

This is CORRECT.

## SSR edge case

Line 46: `if (typeof document === "undefined") return null;`
Defensive check for SSR. ✓

## Conclusion

Surface is CLEAN on target-registry correctness lane. No reachable defects found.

The registration/cleanup logic is sound:
- Caches dom at registration time ✓
- Conditional delete prevents orphans ✓
- Overlays have pointer-events:none ✓
- Nested editors handled correctly ✓
- SSR guarded ✓

The only assumption is that editor.view.dom is stable per editor lifetime,
which is reasonable and documented.

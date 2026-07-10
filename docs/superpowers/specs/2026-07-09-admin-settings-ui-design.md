# Admin Settings — Separate Pages + Hierarchy Tree View

**Date:** 2026-07-09
**Scope:** Frontend only. No backend or API changes.

## Problem

Two unrelated admin surfaces — User Hierarchy and Leave Settings — live in one component,
swapped by a `useState` tab in `Admin.jsx`. They aren't real pages: no deep links, no back
button, no way to share a URL.

Separately, the only way to view the org is a React Flow graph. A graph is a good picture of
an org and a poor tool for editing one. There is no scannable, searchable list.

## Decisions

Reached through brainstorming; each was chosen over named alternatives.

1. **Sidebar submenu**, not a hover flyout or a landing page. Both destinations stay visible,
   it works with keyboard and touch, and it takes a third admin page without redesign.
2. **Hover-revealed "Move" button → searchable manager picker**, not a per-row `<select>` and
   not drag-and-drop. Keeps rows clean, keeps the row click free for expand/collapse, and
   scales past ten people. Drag-and-drop stays available as a later additive layer.
3. **Sequenced expand-then-travel animation**, not simultaneous. Open the drawer, then put the
   thing in it.
4. **List is the default view**, graph is secondary. The list is where editing happens.

## Routing

| Route | Renders |
|---|---|
| `/admin` | Redirect to `/admin/hierarchy` |
| `/admin/hierarchy` | `UserHierarchy` |
| `/admin/leaves` | `LeaveSettings` |

Both sit under the existing `AuthLayout` route in `main.jsx`. The admin guard
(`if (!user?.is_admin) return <Navigate to="/" replace />`) currently lives in `Admin.jsx`;
it moves to a small `AdminRoute` wrapper so both pages are protected by one check rather than
two copies.

`Admin.jsx` is deleted. Its header (`<h1>Admin Settings</h1>`) moves into each page, since
each page now owns its own title.

View selection within the hierarchy page persists in the query string: `?view=chart`. Absent
or unrecognized means list.

## Sidebar

`Sidebar.jsx` gains a nested nav item. The "Admin" entry becomes a button with a chevron that
expands in place to reveal two indented `NavLink`s.

- Auto-expands when the current route starts with `/admin`, so the active page is never hidden.
- Chevron rotates 90° on expand, `transition-transform`.
- Sub-links use the same active treatment as top-level links (`text-blue-700 bg-blue-50`),
  one indent step in, at a slightly smaller type size than the parent.
- The parent "Admin" row shows a subdued active state when any child is active.
- Expansion state is local component state. It does not need to persist across reloads —
  route-driven auto-expand covers the real case.

## Component structure

`UserHierarchy.jsx` is currently 378 lines doing four jobs: data fetching, graph layout, node
rendering, and the edit panel. It splits along the seam this feature already creates.

```
pages/admin/UserHierarchy.jsx     shell: fetch users, own view toggle, own save handler
components/hierarchy/
  HierarchyGraph.jsx              React Flow view (extracted, behavior unchanged)
  PersonNode.jsx                  React Flow custom node (extracted from graph)
  HierarchyTree.jsx               new list view
  TreeRow.jsx                     one person row: chevron, avatar, name, role, Move button
  ManagerPicker.jsx               anchored popover: search field + valid-manager list
  useSubtreeMove.js               FLIP animation hook
lib/hierarchy.js                  buildTree, getDescendantIds, getValidManagers
```

Both views receive `users` and an `onChangeManager(userId, managerId)` callback. Neither
fetches or saves on its own. The shell calls `getAdminUsers()` once and `adminUpdateUser()` on
save — no new API surface.

### Shared domain logic — `lib/hierarchy.js`

The cycle-prevention rule (a person may not be managed by themselves or any of their
descendants) currently lives in `getDescendants()` inside `UserHierarchy.jsx` and is written
against React Flow's `edges` array. That is domain logic wearing a rendering library's clothes.

It lifts into `lib/hierarchy.js`, rewritten against the plain user list:

- `buildTree(users)` → roots with nested `children`, for the list view.
- `getDescendantIds(users, userId)` → `Set<number>`, breadth-first over `manager_id`.
- `getValidManagers(users, userId)` → all users minus self minus descendants.

Both views call `getValidManagers`. The rule lives in exactly one place. This is a pure module
over plain data, unit-testable without rendering anything, which matters because it is the one
piece of this feature where a bug corrupts data rather than just looking wrong.

## The tree view

Roots render at depth 0. Each row with reports gets a chevron; clicking anywhere on the row
toggles expansion. Rows are indented by depth with a guide line, in the style of the reference
screenshot.

Row contents: chevron (or spacer), avatar with role colour from the existing `ROLE_COLORS`
map, name, role, email. On hover or keyboard focus, a "Move" button fades in at the right edge.
Nothing else is permanently present — this is the fix for the screenshot's noisy per-row
`<select>`.

Default expansion: all nodes expanded on first load. The org is small enough that the full
picture is the useful default.

A search field above the tree filters by name, role, and email. A match keeps its entire
subtree, so searching a manager's name shows their whole team. Ancestors of a match stay
visible too, carrying only the branches that lead to a match, so a match is never orphaned
from its context. Search does not disable the Move button.

### Manager picker

Clicking Move opens a popover anchored to the row.

- Autofocused search input at the top.
- Below it, `getValidManagers(users, userId)` rendered with avatar, name, and role — not a
  bare name list, because "which Sharma" is a real question on a flat dropdown.
- A "— No manager —" option at the top, for promoting someone to root.
- Type to filter, arrows to navigate, Enter to select, Escape to dismiss.
- The person's current manager is marked and cannot be re-selected as a no-op.
- Closes on outside click and on scroll of the tree container.

Selecting a manager closes the popover and begins the save-then-animate sequence.

## The move animation

FLIP: measure before, mutate, measure after, invert, play. Same shape as the graph's existing
node interpolation in `UserHierarchy.jsx`, and it reuses that file's `ease` function and its
`DURATION = 2000` so both views feel like one product.

**Order of operations.** The save fires first and must resolve before anything moves. A failed
save animates nothing and surfaces an error. Animating optimistically and rewinding on failure
would show the user a lie.

Once the save succeeds:

1. **Scroll.** If the destination manager's row is outside the viewport, smooth-scroll it into
   view and wait for the scroll to settle. If source and destination cannot both fit, favour
   the destination — the landing is the part worth seeing.
2. **Measure First.** Record `getBoundingClientRect()` for every visible row, keyed by user id.
3. **Expand.** If the destination is collapsed, rotate its chevron and expand its children over
   ~250ms. Let it settle. Expansion completes *before* the next measurement, which is the whole
   reason this is sequenced rather than simultaneous — otherwise "Last" is measured against a
   layout still in motion.
4. **Mutate.** Apply the new `manager_id` to local state and re-render. The moving row and its
   subtree are now in their final DOM position.
5. **Measure Last.** Record rects again.
6. **Invert and play.** Transform every row whose position changed from its old rect to its new
   one, interpolated over 2000ms with the shared cubic ease. Rows below the old parent slide up
   to close the gap; rows below the new parent slide down to open one; the moving row travels
   between them.

**The moving subtree.** A person's reports travel with them as one block. If they were
expanded, they stay expanded and the whole block moves intact. The block gets an elevated
`z-index` and a soft shadow while in flight, because it visually crosses out of one parent's
container into another's and would otherwise render beneath the rows it passes.

**Continuity.** The moving row is never unmounted. React keys are user ids, stable across the
reparent, so the element identity survives and the row does not blink out and back.

**Rows newly revealed by step 3** (the destination's other reports, if it was collapsed) fade
in during the expand, not during the travel. They are already settled by the time anything
moves.

### Edge cases

| Case | Behaviour |
|---|---|
| Destination collapsed | Expand first, settle, then travel. |
| Destination off-screen | Smooth-scroll into view before measuring First. |
| Moving person has reports | Whole subtree travels as one block, expansion preserved. |
| Source parent left with zero reports | Chevron fades out and it becomes a leaf, *after* travel settles. |
| Moving person becomes a root | Travels to root level at depth 0, bottom of the root list. |
| Interruption (click, navigate, re-open picker) | Snap immediately to final state. Never queue a second animation on top of a running one. |
| Component unmounts mid-animation | `cancelAnimationFrame` and clear timers in a cleanup function. The graph's current `setTimeout(..., DURATION + 100)` at line 251 leaks on unmount; the extracted version fixes it. |
| `prefers-reduced-motion: reduce` | Skip all motion. Apply the final state directly. Two seconds of movement is a long time, and for some people it is genuinely unpleasant. |
| Save fails | Nothing moves. Row shows an inline error. Local state untouched. |
| Save succeeds but user already navigated | Cleanup guard; no state update on an unmounted tree. |

## Accessibility

- Sidebar submenu toggle: `aria-expanded`, `aria-controls`.
- Tree container: `role="tree"`, rows `role="treeitem"` with `aria-expanded` and `aria-level`.
- Move button: reachable by keyboard, labelled `Change manager for {name}`.
- Picker: `role="dialog"`, focus trapped, focus returns to the Move button on close.
- Row focus ring visible; hover-revealed controls also reveal on `:focus-within`, so the Move
  button is not mouse-only.
- Reassignment announced via an `aria-live="polite"` region: `{name} now reports to {manager}`.
  The animation conveys this visually; the live region conveys it otherwise.

## Testing

**`lib/hierarchy.js` — unit tests, no rendering.** This is where a bug corrupts data.

- `buildTree` with multiple roots, with a single root, with an empty list.
- `getDescendantIds` on a leaf (empty), on a mid-tree manager, on a root (everyone else).
- `getValidManagers` excludes self, excludes direct reports, excludes transitive descendants,
  includes unrelated peers, includes the current manager's manager.
- Given a user list, no `getValidManagers` result can produce a cycle.

**Components.**

- `HierarchyTree` renders every user, nests by `manager_id`, expands and collapses on row click.
- Search filters and preserves ancestor chains of matches.
- `ManagerPicker` lists only valid managers; filters on type; Escape closes and restores focus.
- Move → save rejects → nothing moves, error shown, local state unchanged.
- `prefers-reduced-motion` → final state applied with no interpolation.

Animation timing is deliberately not asserted frame by frame. Tests assert the final committed
state and that motion is skipped under reduced-motion. Testing eased intermediate positions
tests the easing function, not the feature.

## Out of scope

- Backend, API, and schema: unchanged.
- Drag-and-drop reparenting. The picker is the accessible path any drag implementation would
  need as a fallback; drag can be added on top later without a rewrite.
- Editing anything other than `manager_id` from the tree.
- Changes to `LeaveSettings` beyond its new route and owning its own page title.
- `App.jsx` is dead code — `main.jsx` is the real entry point and does not import it. Deleting
  it is correct but unrelated to this work.

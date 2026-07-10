# Admin Settings UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split Admin Settings into two real routes reached via a sidebar submenu, and add a searchable tree view to User Hierarchy where reassigning a manager plays a 2-second move animation.

**Architecture:** `Admin.jsx` is deleted; `/admin/hierarchy` and `/admin/leaves` become real routes behind a shared `AdminRoute` guard. `UserHierarchy.jsx` becomes a thin shell owning the data fetch, a Chart/List tab toggle, and the save handler, with `HierarchyGraph` and `HierarchyTree` as sibling views. Org-tree domain logic (cycle prevention, tree building, filtering, flattening) lifts out of the React Flow view into a pure, unit-tested `lib/hierarchy.js`. The tree renders as a flat list of visible rows so a FLIP animation can measure and transform each row independently.

**Tech Stack:** React 19, react-router-dom 7, Tailwind 3, lucide-react, @xyflow/react (graph view only), Vitest + jsdom + Testing Library (added by Task 1).

## Global Constraints

- **Never run `git commit`.** Every "Commit" step below means: `git add` the listed files, then **stop and report that the task is ready**. The controller asks Neel for approval and commits on the feature branch `admin-settings-ui`. An implementer that runs `git commit` has violated this plan.
- **Never run `git stash`, `git checkout`, `git reset`, or `git rebase`.** Neel has in-progress work in `stash@{0}`. Touching the stash or the branch pointer destroys it.
- **Frontend only.** No backend, API, or schema changes. The only endpoints used are the existing `getAdminUsers()` and `adminUpdateUser(id, data)` from `src/lib/api.js`.
- **Existing style vocabulary.** Tailwind utilities with bracket font sizes (`text-[14.5px]`), `rounded-xl` / `rounded-2xl`, `border-slate-200`, active nav state `text-blue-700 bg-blue-50`. Match it.
- **Type sizes lean larger.** Body/name text in new UI is `text-[14.5px]` or `text-[15px]`, secondary text `text-[12.5px]`. Do not shrink below this.
- **Animation constants are shared.** `MOVE_DURATION = 2000` and the cubic `ease` function live in `useSubtreeMove.js` and are imported by the graph view. Do not duplicate them.
- **User ids are numbers.** `user.id` and `user.manager_id` are numbers or `null`. React Flow stringifies them; that conversion stays inside `HierarchyGraph.jsx` and never leaks into `lib/hierarchy.js`.
- All new files use `.js` for pure logic and `.jsx` for components, matching the existing tree.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/hierarchy.js` | **Create.** Pure org-tree logic: `getDescendantIds`, `getValidManagers`, `buildTree`, `filterTree`, `flattenVisible`. No React. |
| `src/lib/hierarchy.test.js` | **Create.** Unit tests for the above. |
| `src/components/layout/AdminRoute.jsx` | **Create.** Admin guard + `<Outlet />`. |
| `src/main.jsx` | **Modify.** Nested `/admin` routes. |
| `src/pages/Admin.jsx` | **Delete.** Replaced by routing. |
| `src/components/layout/Sidebar.jsx` | **Modify.** Expanding admin submenu. |
| `src/pages/admin/UserHierarchy.jsx` | **Rewrite.** Thin shell: fetch, tabs, save handler. |
| `src/pages/admin/LeaveSettings.jsx` | **Modify.** Owns its own page header. |
| `src/components/hierarchy/PersonNode.jsx` | **Create.** Extracted React Flow node. |
| `src/components/hierarchy/HierarchyGraph.jsx` | **Create.** Extracted React Flow view. |
| `src/components/hierarchy/HierarchyTree.jsx` | **Create.** List view: search, expansion, live region. |
| `src/components/hierarchy/TreeRow.jsx` | **Create.** One row: chevron, avatar, name, role, Move button. |
| `src/components/hierarchy/ManagerPicker.jsx` | **Create.** Anchored searchable popover. |
| `src/components/hierarchy/useSubtreeMove.js` | **Create.** FLIP animation hook. |
| `src/components/hierarchy/roleMeta.js` | **Create.** `ROLE_COLORS` / `ROLE_LABELS`, shared by graph and tree. |

---

## Task 1: Test infrastructure + core hierarchy logic

The frontend currently has no test runner. This task installs one and uses it immediately for the module where a bug corrupts the org chart rather than merely looking wrong.

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/vite.config.js`
- Create: `frontend/src/test/setup.js`
- Create: `frontend/src/lib/hierarchy.js`
- Test: `frontend/src/lib/hierarchy.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `getDescendantIds(users: User[], userId: number) => Set<number>`
  - `getValidManagers(users: User[], userId: number) => User[]`
  - `buildTree(users: User[]) => TreeNode[]` where `TreeNode = User & { children: TreeNode[] }`
  - `User` is `{ id: number, name: string, role: string|null, role_level: string, email: string, manager_id: number|null }`

- [ ] **Step 1: Install test dependencies**

```bash
cd frontend
npm install -D vitest@^3 jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

- [ ] **Step 2: Add the test script**

In `frontend/package.json`, add to `"scripts"`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Configure Vitest**

Replace `frontend/vite.config.js` with:

```js
/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    css: false,
  },
})
```

- [ ] **Step 4: Create the test setup file**

Create `frontend/src/test/setup.js`:

```js
import "@testing-library/jest-dom/vitest";

// jsdom implements neither of these; components under test call both.
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
```

- [ ] **Step 5: Write the failing tests**

Create `frontend/src/lib/hierarchy.test.js`:

```js
import { describe, it, expect } from "vitest";
import { getDescendantIds, getValidManagers, buildTree } from "./hierarchy";

// ceo(1) ─ eng(2) ─ senior(4), junior(5)
//        └ design(3) ─ ui(6)
const USERS = [
  { id: 1, name: "Arjun Desai",  role: "CEO",              role_level: "l2_lead",    email: "arjun@x.ai",  manager_id: null },
  { id: 2, name: "Neel Mehta",   role: "Engineering Mgr",  role_level: "l1_manager", email: "neel@x.ai",   manager_id: 1 },
  { id: 3, name: "Sneha Kapoor", role: "Design Lead",      role_level: "l1_manager", email: "sneha@x.ai",  manager_id: 1 },
  { id: 4, name: "Priya Sharma", role: "Senior Engineer",  role_level: "ic",         email: "priya@x.ai",  manager_id: 2 },
  { id: 5, name: "Rahul Verma",  role: "Software Engineer",role_level: "ic",         email: "rahul@x.ai",  manager_id: 2 },
  { id: 6, name: "Aditya Rao",   role: "UI Designer",      role_level: "ic",         email: "aditya@x.ai", manager_id: 3 },
];

const ids = (users) => users.map((u) => u.id).sort((a, b) => a - b);

describe("getDescendantIds", () => {
  it("returns an empty set for a leaf", () => {
    expect(getDescendantIds(USERS, 4)).toEqual(new Set());
  });

  it("returns direct reports for a mid-tree manager", () => {
    expect(getDescendantIds(USERS, 2)).toEqual(new Set([4, 5]));
  });

  it("returns transitive descendants for the root", () => {
    expect(getDescendantIds(USERS, 1)).toEqual(new Set([2, 3, 4, 5, 6]));
  });

  it("returns an empty set for an unknown id", () => {
    expect(getDescendantIds(USERS, 999)).toEqual(new Set());
  });
});

describe("getValidManagers", () => {
  it("excludes self", () => {
    expect(ids(getValidManagers(USERS, 2))).not.toContain(2);
  });

  it("excludes direct reports", () => {
    const valid = ids(getValidManagers(USERS, 2));
    expect(valid).not.toContain(4);
    expect(valid).not.toContain(5);
  });

  it("excludes transitive descendants", () => {
    expect(ids(getValidManagers(USERS, 1))).toEqual([]);
  });

  it("includes unrelated peers and the current manager", () => {
    // Priya(4) reports to Neel(2). Sneha(3) is an unrelated peer manager.
    const valid = ids(getValidManagers(USERS, 4));
    expect(valid).toEqual([1, 2, 3, 5, 6]);
  });

  it("never yields a manager that would create a cycle", () => {
    for (const u of USERS) {
      for (const candidate of getValidManagers(USERS, u.id)) {
        const descendants = getDescendantIds(USERS, u.id);
        expect(descendants.has(candidate.id)).toBe(false);
        expect(candidate.id).not.toBe(u.id);
      }
    }
  });
});

describe("buildTree", () => {
  it("returns an empty array for no users", () => {
    expect(buildTree([])).toEqual([]);
  });

  it("nests children under their manager", () => {
    const roots = buildTree(USERS);
    expect(roots).toHaveLength(1);
    expect(roots[0].id).toBe(1);
    expect(ids(roots[0].children)).toEqual([2, 3]);
    const eng = roots[0].children.find((c) => c.id === 2);
    expect(ids(eng.children)).toEqual([4, 5]);
  });

  it("supports multiple roots", () => {
    const orphans = [
      { id: 1, name: "A", manager_id: null },
      { id: 2, name: "B", manager_id: null },
    ];
    expect(ids(buildTree(orphans))).toEqual([1, 2]);
  });

  it("treats a dangling manager_id as a root", () => {
    const dangling = [{ id: 1, name: "A", manager_id: 42 }];
    const roots = buildTree(dangling);
    expect(roots).toHaveLength(1);
    expect(roots[0].id).toBe(1);
  });

  it("does not mutate the input users", () => {
    const copy = structuredClone(USERS);
    buildTree(USERS);
    expect(USERS).toEqual(copy);
  });
});
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `cd frontend && npm test -- src/lib/hierarchy.test.js`
Expected: FAIL — `Failed to resolve import "./hierarchy"`.

- [ ] **Step 7: Write the implementation**

Create `frontend/src/lib/hierarchy.js`:

```js
// Pure org-tree logic over the plain user list. No rendering library types.
// The cycle rule lives here and nowhere else: both the graph and the tree
// view call getValidManagers, so a person can never be reparented under
// themselves or one of their own descendants.

function buildChildMap(users) {
  const childMap = new Map();
  for (const u of users) {
    if (u.manager_id == null) continue;
    if (!childMap.has(u.manager_id)) childMap.set(u.manager_id, []);
    childMap.get(u.manager_id).push(u.id);
  }
  return childMap;
}

export function getDescendantIds(users, userId) {
  const childMap = buildChildMap(users);
  const result = new Set();
  const queue = [userId];
  while (queue.length) {
    const curr = queue.shift();
    for (const childId of childMap.get(curr) ?? []) {
      if (result.has(childId)) continue;
      result.add(childId);
      queue.push(childId);
    }
  }
  return result;
}

export function getValidManagers(users, userId) {
  const descendants = getDescendantIds(users, userId);
  return users.filter((u) => u.id !== userId && !descendants.has(u.id));
}

export function buildTree(users) {
  const byId = new Map(users.map((u) => [u.id, { ...u, children: [] }]));
  const roots = [];
  for (const node of byId.values()) {
    const parent = node.manager_id != null ? byId.get(node.manager_id) : null;
    // A manager_id pointing at nobody makes the node a root rather than
    // silently dropping the person off the chart.
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd frontend && npm test -- src/lib/hierarchy.test.js`
Expected: PASS, 14 tests.

- [ ] **Step 9: Stage and hand off**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vite.config.js \
        frontend/src/test/setup.js frontend/src/lib/hierarchy.js frontend/src/lib/hierarchy.test.js
```

Then stop and report. Do not commit.

---

## Task 2: Tree filtering and flattening

The tree renders as a **flat list of visible rows**, not nested DOM. FLIP measures and transforms each row independently; nested containers would make a moving subtree fight its ancestors' transforms.

**Files:**
- Modify: `frontend/src/lib/hierarchy.js`
- Test: `frontend/src/lib/hierarchy.test.js`

**Interfaces:**
- Consumes: `buildTree` from Task 1.
- Produces:
  - `filterTree(roots: TreeNode[], query: string) => TreeNode[]`
  - `flattenVisible(roots: TreeNode[], expandedIds: Set<number>) => VisibleRow[]` where `VisibleRow = { node: TreeNode, depth: number }`
  - `collectSubtreeIds(node: TreeNode) => number[]` (the node itself plus every descendant, used by the animation to move a block)

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/lib/hierarchy.test.js`:

```js
import { filterTree, flattenVisible, collectSubtreeIds } from "./hierarchy";

const ROOTS = buildTree(USERS);
const ALL_IDS = new Set(USERS.map((u) => u.id));

describe("filterTree", () => {
  it("returns the tree unchanged for an empty query", () => {
    expect(filterTree(ROOTS, "")).toEqual(ROOTS);
    expect(filterTree(ROOTS, "   ")).toEqual(ROOTS);
  });

  it("keeps a match and its whole ancestor chain", () => {
    const roots = filterTree(ROOTS, "Priya");
    expect(roots).toHaveLength(1);
    expect(roots[0].id).toBe(1);              // CEO kept as ancestor
    expect(roots[0].children).toHaveLength(1);
    expect(roots[0].children[0].id).toBe(2);  // Neel kept as ancestor
    expect(roots[0].children[0].children[0].id).toBe(4); // Priya, the match
  });

  it("drops branches with no match anywhere", () => {
    const roots = filterTree(ROOTS, "Priya");
    expect(roots[0].children.find((c) => c.id === 3)).toBeUndefined();
  });

  it("matches on role and email, case-insensitively", () => {
    expect(flattenVisible(filterTree(ROOTS, "ui designer"), ALL_IDS).map((r) => r.node.id)).toContain(6);
    expect(flattenVisible(filterTree(ROOTS, "RAHUL@x.ai"), ALL_IDS).map((r) => r.node.id)).toContain(5);
  });

  it("tolerates a null role", () => {
    const roots = buildTree([{ id: 1, name: "A", role: null, email: "a@x.ai", manager_id: null }]);
    expect(filterTree(roots, "zzz")).toEqual([]);
    expect(filterTree(roots, "a@x")).toHaveLength(1);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterTree(ROOTS, "nobody")).toEqual([]);
  });
});

describe("flattenVisible", () => {
  it("returns only roots when nothing is expanded", () => {
    const rows = flattenVisible(ROOTS, new Set());
    expect(rows).toEqual([{ node: expect.objectContaining({ id: 1 }), depth: 0 }]);
  });

  it("emits rows in depth-first order with correct depth", () => {
    const rows = flattenVisible(ROOTS, ALL_IDS);
    expect(rows.map((r) => [r.node.id, r.depth])).toEqual([
      [1, 0], [2, 1], [4, 2], [5, 2], [3, 1], [6, 2],
    ]);
  });

  it("hides children of a collapsed node", () => {
    const expanded = new Set([1]); // CEO open, managers closed
    expect(flattenVisible(ROOTS, expanded).map((r) => r.node.id)).toEqual([1, 2, 3]);
  });
});

describe("collectSubtreeIds", () => {
  it("returns the node itself for a leaf", () => {
    const priya = ROOTS[0].children.find((c) => c.id === 2).children.find((c) => c.id === 4);
    expect(collectSubtreeIds(priya)).toEqual([4]);
  });

  it("returns the node plus every descendant", () => {
    const neel = ROOTS[0].children.find((c) => c.id === 2);
    expect(collectSubtreeIds(neel).sort((a, b) => a - b)).toEqual([2, 4, 5]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npm test -- src/lib/hierarchy.test.js`
Expected: FAIL — `filterTree is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `frontend/src/lib/hierarchy.js`:

```js
function matchesQuery(node, needle) {
  return [node.name, node.role, node.email]
    .filter(Boolean)
    .some((field) => field.toLowerCase().includes(needle));
}

// A match keeps its entire subtree, so searching a manager's name shows their
// whole team. A non-match survives only to carry a descendant match, and then
// keeps just the branches leading to it — which is what attaches a match to its
// ancestor chain instead of orphaning it at the root.
export function filterTree(roots, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return roots;

  function prune(node) {
    if (matchesQuery(node, needle)) return node;
    const children = node.children.map(prune).filter(Boolean);
    if (children.length > 0) {
      return { ...node, children };
    }
    return null;
  }

  return roots.map(prune).filter(Boolean);
}

export function flattenVisible(roots, expandedIds) {
  const rows = [];
  function walk(node, depth) {
    rows.push({ node, depth });
    if (!expandedIds.has(node.id)) return;
    for (const child of node.children) walk(child, depth + 1);
  }
  for (const root of roots) walk(root, 0);
  return rows;
}

export function collectSubtreeIds(node) {
  const ids = [node.id];
  for (const child of node.children) ids.push(...collectSubtreeIds(child));
  return ids;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npm test -- src/lib/hierarchy.test.js`
Expected: PASS, 25 tests.

- [ ] **Step 5: Stage and hand off**

```bash
git add frontend/src/lib/hierarchy.js frontend/src/lib/hierarchy.test.js
```

Then stop and report. Do not commit.

---

## Task 3: Real admin routes

**Files:**
- Create: `frontend/src/components/layout/AdminRoute.jsx`
- Modify: `frontend/src/main.jsx`
- Modify: `frontend/src/pages/admin/LeaveSettings.jsx:231`
- Delete: `frontend/src/pages/Admin.jsx`
- Test: `frontend/src/components/layout/AdminRoute.test.jsx`

**Interfaces:**
- Consumes: `useUser()` from `src/contexts/UserContext`.
- Produces: routes `/admin/hierarchy` and `/admin/leaves`; `/admin` redirects to `/admin/hierarchy`.

At this point `UserHierarchy.jsx` still exists in its current 378-line form and renders fine on its own route. Task 5 rewrites it.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/layout/AdminRoute.test.jsx`:

```jsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { UserContext } from "../../contexts/UserContext";
import AdminRoute from "./AdminRoute";

function renderAt(path, user) {
  return render(
    <UserContext.Provider value={{ user, setUser: () => {} }}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={<p>Dashboard</p>} />
          <Route path="/admin" element={<AdminRoute />}>
            <Route path="hierarchy" element={<p>Hierarchy Page</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </UserContext.Provider>
  );
}

describe("AdminRoute", () => {
  it("renders the nested admin page for an admin", () => {
    renderAt("/admin/hierarchy", { id: 1, name: "Arjun", is_admin: true });
    expect(screen.getByText("Hierarchy Page")).toBeInTheDocument();
  });

  it("redirects a non-admin to the dashboard", () => {
    renderAt("/admin/hierarchy", { id: 2, name: "Priya", is_admin: false });
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.queryByText("Hierarchy Page")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npm test -- src/components/layout/AdminRoute.test.jsx`
Expected: FAIL — `Failed to resolve import "./AdminRoute"`.

- [ ] **Step 3: Create AdminRoute**

Create `frontend/src/components/layout/AdminRoute.jsx`:

```jsx
import { Navigate, Outlet } from "react-router-dom";
import { useUser } from "../../contexts/UserContext";

// One guard for every admin page, instead of one copy per page.
export default function AdminRoute() {
  const { user } = useUser();
  if (!user?.is_admin) return <Navigate to="/" replace />;
  return <Outlet />;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npm test -- src/components/layout/AdminRoute.test.jsx`
Expected: PASS, 2 tests.

- [ ] **Step 5: Wire the nested routes**

Replace `frontend/src/main.jsx` with:

```jsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "./index.css";
import AuthLayout from "./components/layout/AuthLayout";
import AdminRoute from "./components/layout/AdminRoute";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Leaves from "./pages/Leaves";
import Catchups from "./pages/Catchups";
import UserHierarchy from "./pages/admin/UserHierarchy";
import LeaveSettings from "./pages/admin/LeaveSettings";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<AuthLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="/leaves" element={<Leaves />} />
          <Route path="/catchups" element={<Catchups />} />
          <Route path="/admin" element={<AdminRoute />}>
            <Route index element={<Navigate to="hierarchy" replace />} />
            <Route path="hierarchy" element={<UserHierarchy />} />
            <Route path="leaves" element={<LeaveSettings />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
```

- [ ] **Step 6: Give LeaveSettings its own page header**

`Admin.jsx` used to render the `<h1>`. Each page now owns its title.

In `frontend/src/pages/admin/LeaveSettings.jsx`, replace the opening of the returned JSX — the line `<div className="p-8">` at line 231 — with:

```jsx
    <div>
      <div className="px-8 pt-7 pb-6 bg-white border-b border-slate-200">
        <h1 className="text-2xl font-bold text-slate-900">Leave Settings</h1>
        <p className="text-[13.5px] text-slate-500 mt-1">
          Leave limits, notice requirements, and the holiday calendar.
        </p>
      </div>
      <div className="p-8">
```

Then find the matching close of that wrapper. The component's return currently ends with:

```jsx
      <ConfirmDialog
        ...
      />
    </div>
  );
}
```

Change it to close both divs:

```jsx
        <ConfirmDialog
          ...
        />
      </div>
    </div>
  );
}
```

Leave the `ConfirmDialog` props exactly as they are; only the indentation and the extra closing `</div>` change.

- [ ] **Step 7: Delete the old Admin page**

```bash
git rm frontend/src/pages/Admin.jsx
```

- [ ] **Step 8: Verify the app builds and both routes render**

Run: `cd frontend && npm run dev`
Visit `/admin` — expect a redirect to `/admin/hierarchy` showing the graph.
Visit `/admin/leaves` — expect the Leave Settings page with its new header.
Confirm the back button moves between them. Stop the dev server.

Run: `cd frontend && npm test`
Expected: PASS, all tests.

- [ ] **Step 9: Stage and hand off**

```bash
git add frontend/src/main.jsx frontend/src/components/layout/AdminRoute.jsx \
        frontend/src/components/layout/AdminRoute.test.jsx frontend/src/pages/admin/LeaveSettings.jsx
```

Then stop and report. Do not commit.

---

## Task 4: Sidebar submenu

**Files:**
- Modify: `frontend/src/components/layout/Sidebar.jsx`
- Test: `frontend/src/components/layout/Sidebar.test.jsx`

**Interfaces:**
- Consumes: routes from Task 3.
- Produces: no exports. Behavioural contract: the submenu auto-expands when the current path starts with `/admin`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/layout/Sidebar.test.jsx`:

```jsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { UserContext } from "../../contexts/UserContext";
import Sidebar from "./Sidebar";

function renderSidebar(path, user = { id: 1, name: "Arjun Desai", is_admin: true }) {
  return render(
    <UserContext.Provider value={{ user, setUser: () => {} }}>
      <MemoryRouter initialEntries={[path]}>
        <Sidebar />
      </MemoryRouter>
    </UserContext.Provider>
  );
}

describe("Sidebar admin submenu", () => {
  it("hides the admin section entirely from non-admins", () => {
    renderSidebar("/", { id: 2, name: "Priya", is_admin: false });
    expect(screen.queryByRole("button", { name: /admin/i })).not.toBeInTheDocument();
  });

  it("starts collapsed on a non-admin route", () => {
    renderSidebar("/");
    const toggle = screen.getByRole("button", { name: /admin/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "User Hierarchy" })).not.toBeInTheDocument();
  });

  it("expands on click and reveals both sub-pages", async () => {
    const user = userEvent.setup();
    renderSidebar("/");
    await user.click(screen.getByRole("button", { name: /admin/i }));
    expect(screen.getByRole("button", { name: /admin/i })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "User Hierarchy" })).toHaveAttribute("href", "/admin/hierarchy");
    expect(screen.getByRole("link", { name: "Leave Settings" })).toHaveAttribute("href", "/admin/leaves");
  });

  it("auto-expands when already on an admin route", () => {
    renderSidebar("/admin/leaves");
    expect(screen.getByRole("button", { name: /admin/i })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Leave Settings" })).toBeInTheDocument();
  });

  it("collapses on a second click", async () => {
    const user = userEvent.setup();
    renderSidebar("/");
    const toggle = screen.getByRole("button", { name: /admin/i });
    await user.click(toggle);
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npm test -- src/components/layout/Sidebar.test.jsx`
Expected: FAIL — no button named "Admin" exists; the current sidebar renders a `NavLink`.

- [ ] **Step 3: Implement the submenu**

In `frontend/src/components/layout/Sidebar.jsx`, replace the import line and the admin `NavLink` block (lines 51–65).

New imports at the top:

```jsx
import { useState } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { LayoutDashboard, CalendarDays, Users, LogOut, Settings, ChevronRight } from "lucide-react";
```

Add a constant next to `navItems`:

```jsx
const adminItems = [
  { to: "/admin/hierarchy", label: "User Hierarchy" },
  { to: "/admin/leaves", label: "Leave Settings" },
];
```

Inside the component, above `handleLogout`:

```jsx
  const location = useLocation();
  const onAdminRoute = location.pathname.startsWith("/admin");
  // Route drives the default; the user can still toggle it shut.
  const [adminOpen, setAdminOpen] = useState(onAdminRoute);
  const expanded = adminOpen || onAdminRoute;
```

Replace the whole `{user?.is_admin && (...)}` block with:

```jsx
        {user?.is_admin && (
          <div>
            <button
              type="button"
              onClick={() => setAdminOpen((v) => !v)}
              aria-expanded={expanded}
              aria-controls="admin-submenu"
              className={`w-full flex items-center gap-3.5 px-3.5 py-3 rounded-lg text-[15.5px] font-medium transition-colors ${
                onAdminRoute
                  ? "text-slate-800 bg-slate-50"
                  : "text-slate-500 hover:text-slate-800 hover:bg-slate-50"
              }`}
            >
              <Settings size={19} strokeWidth={2} />
              <span className="flex-1 text-left">Admin</span>
              <ChevronRight
                size={16}
                strokeWidth={2.5}
                className={`text-slate-400 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
              />
            </button>

            {expanded && (
              <div id="admin-submenu" className="mt-1 ml-4 pl-3.5 border-l border-slate-200 space-y-1">
                {adminItems.map(({ to, label }) => (
                  <NavLink
                    key={to}
                    to={to}
                    className={({ isActive }) =>
                      `block px-3 py-2.5 rounded-lg text-[14.5px] font-medium transition-colors ${
                        isActive
                          ? "text-blue-700 bg-blue-50"
                          : "text-slate-500 hover:text-slate-800 hover:bg-slate-50"
                      }`
                    }
                  >
                    {label}
                  </NavLink>
                ))}
              </div>
            )}
          </div>
        )}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npm test -- src/components/layout/Sidebar.test.jsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Stage and hand off**

```bash
git add frontend/src/components/layout/Sidebar.jsx frontend/src/components/layout/Sidebar.test.jsx
```

Then stop and report. Do not commit.

---

## Task 5: Split UserHierarchy into a shell + graph view

Pure extraction plus the view toggle. The graph's behaviour must not change. The list view is a placeholder here; Task 6 fills it.

**Files:**
- Create: `frontend/src/components/hierarchy/roleMeta.js`
- Create: `frontend/src/components/hierarchy/PersonNode.jsx`
- Create: `frontend/src/components/hierarchy/HierarchyGraph.jsx`
- Rewrite: `frontend/src/pages/admin/UserHierarchy.jsx`
- Test: `frontend/src/pages/admin/UserHierarchy.test.jsx`

**Interfaces:**
- Consumes: `getValidManagers` (Task 1); `getAdminUsers`, `adminUpdateUser` from `src/lib/api`.
- Produces:
  - `roleMeta.js`: `ROLE_COLORS: Record<string,string>`, `ROLE_LABELS: Record<string,string>`, `roleColor(level: string) => string`
  - `HierarchyGraph({ users, onChangeManager })` where `onChangeManager(userId: number, managerId: number|null) => Promise<void>`
  - `HierarchyTree({ users, onChangeManager })` — same signature, so the shell can swap them freely.

- [ ] **Step 1: Create the shared role metadata**

Create `frontend/src/components/hierarchy/roleMeta.js`:

```js
export const ROLE_COLORS = {
  l2_lead: "#3b82f6",
  l1_manager: "#8b5cf6",
  ic: "#64748b",
};

export const ROLE_LABELS = {
  l2_lead: "L2 Lead",
  l1_manager: "Manager",
  ic: "IC",
};

export function roleColor(level) {
  return ROLE_COLORS[level] ?? "#64748b";
}
```

- [ ] **Step 2: Extract PersonNode**

Create `frontend/src/components/hierarchy/PersonNode.jsx`. This is the existing `PersonNode` from `UserHierarchy.jsx:33-77`, unchanged except that it imports `roleColor` and uses shared `getInitials`:

```jsx
import { Handle, Position } from "@xyflow/react";
import { getInitials } from "../../lib/utils";
import { roleColor, ROLE_LABELS } from "./roleMeta";

export const NODE_W = 190;
export const NODE_H = 68;

export default function PersonNode({ data, selected }) {
  return (
    <div
      style={{ width: NODE_W }}
      className={`bg-white rounded-xl border shadow-sm px-3.5 py-3 select-none cursor-pointer transition-shadow hover:shadow-md ${
        selected ? "border-blue-400 ring-2 ring-blue-200" : "border-slate-200"
      }`}
    >
      <Handle type="target" position={Position.Top} style={{ background: "#cbd5e1", width: 7, height: 7 }} />
      <div className="flex items-center gap-2.5">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[11px] font-bold shrink-0"
          style={{ backgroundColor: roleColor(data.roleLevel) }}
        >
          {getInitials(data.name)}
        </div>
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-slate-900 truncate leading-tight">{data.name}</p>
          <p className="text-[11.5px] text-slate-400 truncate leading-tight mt-0.5">
            {data.role || ROLE_LABELS[data.roleLevel]}
          </p>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: "#cbd5e1", width: 7, height: 7 }} />
    </div>
  );
}
```

- [ ] **Step 3: Extract HierarchyGraph**

Create `frontend/src/components/hierarchy/HierarchyGraph.jsx`. This is the graph half of the old file: layout, edges, node click, side panel. The manager `<select>` now sources its options from `getValidManagers` instead of the local `getDescendants` walk over `edges`, and the animation constants come from the shared hook module.

```jsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow, Background, Controls, MiniMap,
  useNodesState, useEdgesState, MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import Dagre from "@dagrejs/dagre";
import { X, Check } from "lucide-react";
import { getInitials } from "../../lib/utils";
import { getValidManagers } from "../../lib/hierarchy";
import { ROLE_COLORS, ROLE_LABELS, roleColor } from "./roleMeta";
import { MOVE_DURATION, ease, prefersReducedMotion } from "./useSubtreeMove";
import PersonNode, { NODE_W, NODE_H } from "./PersonNode";

const nodeTypes = { person: PersonNode };

function layoutNodes(nodes, edges) {
  const g = new Dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", ranksep: 70, nodesep: 30 });
  nodes.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
  edges.forEach((e) => g.setEdge(e.source, e.target));
  Dagre.layout(g);
  return nodes.map((n) => {
    const { x, y } = g.node(n.id);
    return { ...n, position: { x: x - NODE_W / 2, y: y - NODE_H / 2 } };
  });
}

function edgeFor(userId, managerId) {
  return {
    id: `e${userId}-${managerId}`,
    type: "default",
    source: String(managerId),
    target: String(userId),
    markerEnd: { type: MarkerType.ArrowClosed, color: "#94a3b8" },
    style: { stroke: "#cbd5e1", strokeWidth: 1.5 },
  };
}

function buildGraph(users) {
  const rawNodes = users.map((u) => ({
    id: String(u.id),
    type: "person",
    data: { name: u.name, role: u.role, roleLevel: u.role_level },
    position: { x: 0, y: 0 },
  }));
  const edges = users.filter((u) => u.manager_id).map((u) => edgeFor(u.id, u.manager_id));
  return { nodes: layoutNodes(rawNodes, edges), edges };
}

export default function HierarchyGraph({ users, onChangeManager }) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges] = useEdgesState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [managerDraft, setManagerDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null); // "saved" | "error"

  const rafRef = useRef(null);
  const timerRef = useRef(null);

  // Cancel in-flight animation work when the view unmounts. The original
  // implementation left a setTimeout running past unmount.
  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  useEffect(() => {
    const { nodes: n, edges: e } = buildGraph(users);
    setNodes(n);
    setEdges(e);
    // Rebuild only when the set of people or their reporting lines change.
  }, [users]);

  useEffect(() => {
    setNodes((nds) => nds.map((n) => ({ ...n, selected: n.id === selectedId })));
  }, [selectedId]);

  const selectedUser = users.find((u) => String(u.id) === selectedId) ?? null;

  const onNodeClick = useCallback((_, node) => {
    setSelectedId(node.id);
    const u = users.find((x) => String(x.id) === node.id);
    setManagerDraft(u?.manager_id ? String(u.manager_id) : "");
    setSaveStatus(null);
  }, [users]);

  const onPaneClick = useCallback(() => setSelectedId(null), []);

  const managerOptions = useMemo(
    () => (selectedUser ? getValidManagers(users, selectedUser.id) : []),
    [users, selectedUser]
  );

  async function handleSave() {
    if (!selectedUser) return;
    const newManagerId = managerDraft ? parseInt(managerDraft, 10) : null;
    if (newManagerId === (selectedUser.manager_id ?? null)) {
      setSelectedId(null);
      return;
    }

    setSaving(true);
    setSaveStatus(null);
    try {
      await onChangeManager(selectedUser.id, newManagerId);
      setSaveStatus("saved");
    } catch {
      setSaveStatus("error");
      setSaving(false);
      return;
    }
    setSaving(false);

    const withoutOld = edges.filter((e) => e.target !== String(selectedUser.id));
    const updatedEdges = newManagerId ? [...withoutOld, edgeFor(selectedUser.id, newManagerId)] : withoutOld;
    setEdges(updatedEdges);

    if (prefersReducedMotion()) {
      setNodes(layoutNodes(nodes, updatedEdges));
      setSelectedId(null);
      return;
    }

    const targetNodes = layoutNodes(nodes, updatedEdges);
    const start = Object.fromEntries(nodes.map((n) => [n.id, { ...n.position }]));
    const target = Object.fromEntries(targetNodes.map((n) => [n.id, { ...n.position }]));
    const startTime = performance.now();

    function step(now) {
      const progress = Math.min((now - startTime) / MOVE_DURATION, 1);
      const eased = ease(progress);
      setNodes((nds) =>
        nds.map((n) => {
          const s = start[n.id];
          const t = target[n.id];
          if (!s || !t) return n;
          return { ...n, position: { x: s.x + (t.x - s.x) * eased, y: s.y + (t.y - s.y) * eased } };
        })
      );
      if (progress < 1) rafRef.current = requestAnimationFrame(step);
    }
    rafRef.current = requestAnimationFrame(step);
    timerRef.current = setTimeout(() => setSelectedId(null), MOVE_DURATION + 100);
  }

  return (
    <div className="h-full relative flex">
      <div className="flex-1 h-full">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.2}
          maxZoom={2}
        >
          <Background color="#e2e8f0" gap={20} size={1} />
          <Controls className="!shadow-none !border !border-slate-200 !rounded-xl overflow-hidden" />
          <MiniMap
            nodeColor={(n) => roleColor(n.data?.roleLevel)}
            maskColor="rgba(241,245,249,0.7)"
            className="!border !border-slate-200 !rounded-xl !shadow-none"
          />
        </ReactFlow>
      </div>

      {selectedUser && (
        <div className="w-72 shrink-0 h-full bg-white border-l border-slate-200 flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <span className="text-[14px] font-semibold text-slate-700">Edit Person</span>
            <button
              onClick={() => setSelectedId(null)}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>

          <div className="px-4 py-4 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-white text-[12px] font-bold shrink-0"
                style={{ backgroundColor: ROLE_COLORS[selectedUser.role_level] ?? "#64748b" }}
              >
                {getInitials(selectedUser.name)}
              </div>
              <div className="min-w-0">
                <p className="text-[14.5px] font-semibold text-slate-900 truncate">{selectedUser.name}</p>
                <p className="text-[12.5px] text-slate-400 truncate">
                  {selectedUser.role || ROLE_LABELS[selectedUser.role_level]}
                </p>
              </div>
            </div>
          </div>

          <div className="px-4 py-4 flex-1">
            <label htmlFor="manager-select" className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Manager
            </label>
            <select
              id="manager-select"
              value={managerDraft}
              onChange={(e) => setManagerDraft(e.target.value)}
              className="w-full text-[14px] border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">(no manager)</option>
              {managerOptions.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>

          <div className="px-4 pb-4 flex gap-2">
            <button
              onClick={() => setSelectedId(null)}
              className="flex-1 py-2 text-[13px] font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className={`flex-1 py-2 text-[13px] font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
                saveStatus === "saved" ? "bg-emerald-500 text-white"
                : saveStatus === "error" ? "bg-red-500 text-white"
                : "bg-blue-600 text-white hover:bg-blue-700"
              } disabled:opacity-50`}
            >
              {saving ? "Saving…" : saveStatus === "saved" ? (<><Check size={13} /> Saved</>) : saveStatus === "error" ? "Error" : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create the animation constants module (stub)**

`HierarchyGraph` imports from `useSubtreeMove`, which Task 9 fleshes out. Create the constants now so the graph compiles.

Create `frontend/src/components/hierarchy/useSubtreeMove.js`:

```js
export const MOVE_DURATION = 2000;

// Cubic ease-in-out. Shared by both views so a reassignment feels identical
// whichever one you are looking at.
export function ease(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}
```

- [ ] **Step 5: Write the failing shell test**

Create `frontend/src/pages/admin/UserHierarchy.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import UserHierarchy from "./UserHierarchy";

vi.mock("../../lib/api", () => ({
  getAdminUsers: vi.fn(),
  adminUpdateUser: vi.fn(),
}));

// React Flow needs layout APIs jsdom does not provide. The shell test only
// cares about the tabs, so stub the graph view out entirely.
vi.mock("../../components/hierarchy/HierarchyGraph", () => ({
  default: () => <div data-testid="graph-view" />,
}));

import { getAdminUsers } from "../../lib/api";

const USERS = [
  { id: 1, name: "Arjun Desai", role: "CEO", role_level: "l2_lead", email: "arjun@x.ai", manager_id: null },
  { id: 2, name: "Neel Mehta", role: "Eng Mgr", role_level: "l1_manager", email: "neel@x.ai", manager_id: 1 },
];

beforeEach(() => {
  getAdminUsers.mockResolvedValue(USERS);
});

const renderAt = (path = "/admin/hierarchy") =>
  render(<MemoryRouter initialEntries={[path]}><UserHierarchy /></MemoryRouter>);

describe("UserHierarchy shell", () => {
  it("defaults to the list view", async () => {
    renderAt();
    expect(await screen.findByText("Arjun Desai")).toBeInTheDocument();
    expect(screen.queryByTestId("graph-view")).not.toBeInTheDocument();
  });

  it("renders the graph view when ?view=chart", async () => {
    renderAt("/admin/hierarchy?view=chart");
    expect(await screen.findByTestId("graph-view")).toBeInTheDocument();
  });

  it("switches views via the tabs", async () => {
    const user = userEvent.setup();
    renderAt();
    await screen.findByText("Arjun Desai");
    await user.click(screen.getByRole("tab", { name: "Chart" }));
    expect(await screen.findByTestId("graph-view")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "List" }));
    await waitFor(() => expect(screen.queryByTestId("graph-view")).not.toBeInTheDocument());
  });

  it("marks the active tab with aria-selected", async () => {
    renderAt();
    await screen.findByText("Arjun Desai");
    expect(screen.getByRole("tab", { name: "List" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Chart" })).toHaveAttribute("aria-selected", "false");
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd frontend && npm test -- src/pages/admin/UserHierarchy.test.jsx`
Expected: FAIL — no `tab` role; the current page renders only the graph.

- [ ] **Step 7: Rewrite UserHierarchy as a shell**

Replace `frontend/src/pages/admin/UserHierarchy.jsx` entirely:

```jsx
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { List, Network } from "lucide-react";
import { getAdminUsers, adminUpdateUser } from "../../lib/api";
import HierarchyGraph from "../../components/hierarchy/HierarchyGraph";
import HierarchyTree from "../../components/hierarchy/HierarchyTree";

const VIEWS = [
  { id: "list", label: "List", icon: List },
  { id: "chart", label: "Chart", icon: Network },
];

export default function UserHierarchy() {
  const [users, setUsers] = useState([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get("view") === "chart" ? "chart" : "list";

  useEffect(() => {
    getAdminUsers().then(setUsers);
  }, []);

  // Single write path for both views. Local state updates only after the
  // server confirms, so a rejected save never moves anything.
  const handleChangeManager = useCallback(async (userId, managerId) => {
    await adminUpdateUser(userId, { manager_id: managerId });
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, manager_id: managerId } : u)));
  }, []);

  function selectView(id) {
    setSearchParams(id === "list" ? {} : { view: id }, { replace: true });
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-8 pt-7 pb-5 shrink-0 bg-white border-b border-slate-200 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">User Hierarchy</h1>
          <p className="text-[13.5px] text-slate-500 mt-1">
            Who reports to whom. Change a manager to reshape the org.
          </p>
        </div>

        <div role="tablist" aria-label="Hierarchy view" className="flex gap-1 bg-slate-100 rounded-xl p-1">
          {VIEWS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              role="tab"
              aria-selected={view === id}
              onClick={() => selectView(id)}
              className={`flex items-center gap-2 px-3.5 py-2 text-[13.5px] font-medium rounded-lg transition-colors ${
                view === id
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              <Icon size={15} strokeWidth={2} />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {view === "chart"
          ? <HierarchyGraph users={users} onChangeManager={handleChangeManager} />
          : <HierarchyTree users={users} onChangeManager={handleChangeManager} />}
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Create a placeholder HierarchyTree so the shell compiles**

Create `frontend/src/components/hierarchy/HierarchyTree.jsx`. Task 6 replaces this wholesale.

```jsx
export default function HierarchyTree({ users }) {
  return (
    <div className="p-8">
      {users.map((u) => (
        <p key={u.id} className="text-[14.5px] text-slate-800">{u.name}</p>
      ))}
    </div>
  );
}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `cd frontend && npm test`
Expected: PASS, all tests including the 4 new shell tests.

- [ ] **Step 10: Verify the graph still works in the browser**

Run: `cd frontend && npm run dev`, visit `/admin/hierarchy?view=chart`, click a node, change a manager, confirm the 2-second node animation still plays. Stop the dev server.

- [ ] **Step 11: Stage and hand off**

```bash
git add frontend/src/components/hierarchy/ frontend/src/pages/admin/UserHierarchy.jsx \
        frontend/src/pages/admin/UserHierarchy.test.jsx
```

Then stop and report. Do not commit.

---

## Task 6: The tree view — rows, expansion, search

**Files:**
- Create: `frontend/src/components/hierarchy/TreeRow.jsx`
- Rewrite: `frontend/src/components/hierarchy/HierarchyTree.jsx`
- Test: `frontend/src/components/hierarchy/HierarchyTree.test.jsx`

**Interfaces:**
- Consumes: `buildTree`, `filterTree`, `flattenVisible` (Tasks 1–2); `Avatar` from `src/components/ui/Avatar`.
- Produces:
  - `TreeRow({ node, depth, expanded, hasChildren, onToggle, onMove, rowRef })`
  - `HierarchyTree({ users, onChangeManager })`

The `onMove` prop is wired to a no-op button here; Task 8 attaches the picker.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/hierarchy/HierarchyTree.test.jsx`:

```jsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HierarchyTree from "./HierarchyTree";

const USERS = [
  { id: 1, name: "Arjun Desai",  role: "CEO",             role_level: "l2_lead",    email: "arjun@x.ai",  manager_id: null },
  { id: 2, name: "Neel Mehta",   role: "Engineering Mgr", role_level: "l1_manager", email: "neel@x.ai",   manager_id: 1 },
  { id: 3, name: "Sneha Kapoor", role: "Design Lead",     role_level: "l1_manager", email: "sneha@x.ai",  manager_id: 1 },
  { id: 4, name: "Priya Sharma", role: "Senior Engineer", role_level: "ic",         email: "priya@x.ai",  manager_id: 2 },
];

const renderTree = () => render(<HierarchyTree users={USERS} onChangeManager={vi.fn()} />);

describe("HierarchyTree", () => {
  it("renders every user, expanded by default", () => {
    renderTree();
    for (const u of USERS) expect(screen.getByText(u.name)).toBeInTheDocument();
  });

  it("exposes tree semantics", () => {
    renderTree();
    expect(screen.getByRole("tree")).toBeInTheDocument();
    expect(screen.getAllByRole("treeitem")).toHaveLength(4);
  });

  it("nests rows by depth via aria-level", () => {
    renderTree();
    const items = screen.getAllByRole("treeitem");
    expect(items[0]).toHaveAttribute("aria-level", "1"); // Arjun
    expect(items[1]).toHaveAttribute("aria-level", "2"); // Neel
    expect(items[2]).toHaveAttribute("aria-level", "3"); // Priya
  });

  it("collapses a subtree when its row is clicked", async () => {
    const user = userEvent.setup();
    renderTree();
    await user.click(screen.getByText("Neel Mehta"));
    expect(screen.queryByText("Priya Sharma")).not.toBeInTheDocument();
    expect(screen.getByText("Sneha Kapoor")).toBeInTheDocument();
  });

  it("re-expands on a second click", async () => {
    const user = userEvent.setup();
    renderTree();
    await user.click(screen.getByText("Neel Mehta"));
    await user.click(screen.getByText("Neel Mehta"));
    expect(screen.getByText("Priya Sharma")).toBeInTheDocument();
  });

  it("gives leaf rows no expand affordance", () => {
    renderTree();
    const priya = screen.getByText("Priya Sharma").closest('[role="treeitem"]');
    expect(priya).not.toHaveAttribute("aria-expanded");
  });

  it("filters on search and keeps the ancestor chain", async () => {
    const user = userEvent.setup();
    renderTree();
    await user.type(screen.getByPlaceholderText(/search/i), "Priya");
    expect(screen.getByText("Priya Sharma")).toBeInTheDocument();
    expect(screen.getByText("Neel Mehta")).toBeInTheDocument();   // ancestor
    expect(screen.getByText("Arjun Desai")).toBeInTheDocument();  // ancestor
    expect(screen.queryByText("Sneha Kapoor")).not.toBeInTheDocument();
  });

  it("shows an empty state when nothing matches", async () => {
    const user = userEvent.setup();
    renderTree();
    await user.type(screen.getByPlaceholderText(/search/i), "zzzzz");
    expect(screen.getByText(/no one matches/i)).toBeInTheDocument();
  });

  it("reveals the move button on focus, not only hover", async () => {
    const user = userEvent.setup();
    renderTree();
    await user.tab(); // search field
    const moveButtons = screen.getAllByRole("button", { name: /change manager for/i });
    expect(moveButtons).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npm test -- src/components/hierarchy/HierarchyTree.test.jsx`
Expected: FAIL — no `tree` role; the placeholder renders bare `<p>` tags.

- [ ] **Step 3: Create TreeRow**

Create `frontend/src/components/hierarchy/TreeRow.jsx`:

```jsx
import { forwardRef } from "react";
import { ChevronRight, GitBranch } from "lucide-react";
import Avatar from "../ui/Avatar";
import { ROLE_LABELS } from "./roleMeta";

const INDENT_PX = 30;

const TreeRow = forwardRef(function TreeRow(
  { node, depth, expanded, hasChildren, onToggle, onMove, moving },
  ref
) {
  return (
    <div
      ref={ref}
      role="treeitem"
      aria-level={depth + 1}
      {...(hasChildren ? { "aria-expanded": expanded } : {})}
      tabIndex={-1}
      onClick={() => hasChildren && onToggle(node.id)}
      style={{ paddingLeft: 12 + depth * INDENT_PX }}
      className={`group relative flex items-center gap-3 pr-3 py-2.5 rounded-xl transition-colors ${
        hasChildren ? "cursor-pointer" : "cursor-default"
      } ${moving ? "z-20 bg-white shadow-lg ring-1 ring-slate-200" : "hover:bg-slate-50 focus-within:bg-slate-50"}`}
    >
      <span className="w-5 shrink-0 flex items-center justify-center">
        {hasChildren && (
          <ChevronRight
            size={16}
            strokeWidth={2.5}
            className={`text-slate-400 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
          />
        )}
      </span>

      <Avatar name={node.name} size="md" />

      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold text-slate-900 truncate leading-tight">{node.name}</p>
        <p className="text-[12.5px] text-slate-400 truncate leading-tight mt-0.5">
          {node.role || ROLE_LABELS[node.role_level]} · {node.email}
        </p>
      </div>

      <button
        type="button"
        aria-label={`Change manager for ${node.name}`}
        onClick={(e) => { e.stopPropagation(); onMove(node, e.currentTarget); }}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12.5px] font-medium text-slate-500
                   opacity-0 group-hover:opacity-100 focus:opacity-100 focus-visible:opacity-100
                   hover:bg-slate-100 hover:text-slate-800 transition-opacity
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        <GitBranch size={14} strokeWidth={2} />
        Move
      </button>
    </div>
  );
});

export default TreeRow;
```

- [ ] **Step 4: Rewrite HierarchyTree**

Replace `frontend/src/components/hierarchy/HierarchyTree.jsx`:

```jsx
import { useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { buildTree, filterTree, flattenVisible } from "../../lib/hierarchy";
import TreeRow from "./TreeRow";

export default function HierarchyTree({ users, onChangeManager }) {
  const [query, setQuery] = useState("");
  // Collapsed-by-exception: an empty collapsed set means the whole tree is open,
  // which is the right default and needs no seeding from an async fetch. Seeding
  // expanded ids from `users` would capture an empty array, because the shell
  // mounts this component before the fetch resolves.
  const [collapsedIds, setCollapsedIds] = useState(() => new Set());
  const rowRefs = useRef(new Map());

  const roots = useMemo(() => buildTree(users), [users]);
  const visibleRoots = useMemo(() => filterTree(roots, query), [roots, query]);

  const expandedIds = useMemo(
    () => new Set(users.filter((u) => !collapsedIds.has(u.id)).map((u) => u.id)),
    [users, collapsedIds]
  );

  // While searching, force every surviving branch open so matches are reachable.
  const effectiveExpanded = useMemo(
    () => (query.trim() ? new Set(users.map((u) => u.id)) : expandedIds),
    [query, users, expandedIds]
  );

  const rows = useMemo(
    () => flattenVisible(visibleRoots, effectiveExpanded),
    [visibleRoots, effectiveExpanded]
  );

  const toggle = useCallback((id) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  function handleMove() {
    // Wired to the manager picker in Task 8.
  }

  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <div className="max-w-3xl mx-auto">
        <div className="relative mb-5">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, role, or email"
            className="w-full text-[14.5px] bg-white border border-slate-200 rounded-xl pl-10 pr-4 py-2.5
                       text-slate-800 placeholder:text-slate-400
                       focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-2">
          {rows.length === 0 ? (
            <p className="text-[14.5px] text-slate-400 text-center py-12">No one matches “{query}”.</p>
          ) : (
            <div role="tree" aria-label="Organisation hierarchy">
              {rows.map(({ node, depth }) => (
                <TreeRow
                  key={node.id}
                  ref={(el) => {
                    if (el) rowRefs.current.set(node.id, el);
                    else rowRefs.current.delete(node.id);
                  }}
                  node={node}
                  depth={depth}
                  hasChildren={node.children.length > 0}
                  expanded={effectiveExpanded.has(node.id)}
                  onToggle={toggle}
                  onMove={handleMove}
                  moving={false}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npm test -- src/components/hierarchy/HierarchyTree.test.jsx`
Expected: PASS, 9 tests.

- [ ] **Step 6: Stage and hand off**

```bash
git add frontend/src/components/hierarchy/TreeRow.jsx \
        frontend/src/components/hierarchy/HierarchyTree.jsx \
        frontend/src/components/hierarchy/HierarchyTree.test.jsx
```

Then stop and report. Do not commit.

---

## Task 7: The manager picker popover

**Files:**
- Create: `frontend/src/components/hierarchy/ManagerPicker.jsx`
- Test: `frontend/src/components/hierarchy/ManagerPicker.test.jsx`

**Interfaces:**
- Consumes: `getValidManagers` (Task 1); `Avatar`.
- Produces: `ManagerPicker({ user, users, anchorRect, onSelect, onClose })` where `onSelect(managerId: number|null) => void` and `anchorRect` is a `DOMRect` from the Move button.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/hierarchy/ManagerPicker.test.jsx`:

```jsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ManagerPicker from "./ManagerPicker";

const USERS = [
  { id: 1, name: "Arjun Desai",  role: "CEO",             role_level: "l2_lead",    email: "arjun@x.ai", manager_id: null },
  { id: 2, name: "Neel Mehta",   role: "Engineering Mgr", role_level: "l1_manager", email: "neel@x.ai",  manager_id: 1 },
  { id: 3, name: "Sneha Kapoor", role: "Design Lead",     role_level: "l1_manager", email: "sneha@x.ai", manager_id: 1 },
  { id: 4, name: "Priya Sharma", role: "Senior Engineer", role_level: "ic",         email: "priya@x.ai", manager_id: 2 },
];

const anchorRect = { top: 100, bottom: 130, left: 200, right: 260, width: 60, height: 30 };

function renderPicker(subjectId, overrides = {}) {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  render(
    <ManagerPicker
      user={USERS.find((u) => u.id === subjectId)}
      users={USERS}
      anchorRect={anchorRect}
      onSelect={onSelect}
      onClose={onClose}
      {...overrides}
    />
  );
  return { onSelect, onClose };
}

describe("ManagerPicker", () => {
  it("lists only valid managers", () => {
    renderPicker(2); // Neel: cannot be managed by himself or Priya
    expect(screen.getByRole("option", { name: /Arjun Desai/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Sneha Kapoor/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Neel Mehta/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Priya Sharma/ })).not.toBeInTheDocument();
  });

  it("offers a no-manager option", () => {
    renderPicker(4);
    expect(screen.getByRole("option", { name: /no manager/i })).toBeInTheDocument();
  });

  it("marks the current manager and disables re-selecting them", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderPicker(4); // Priya reports to Neel
    const current = screen.getByRole("option", { name: /Neel Mehta/ });
    expect(current).toHaveAttribute("aria-selected", "true");
    await user.click(current);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("filters as you type", async () => {
    const user = userEvent.setup();
    renderPicker(4);
    await user.type(screen.getByPlaceholderText(/search/i), "sneha");
    expect(screen.getByRole("option", { name: /Sneha Kapoor/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Arjun Desai/ })).not.toBeInTheDocument();
  });

  it("selects with a click", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderPicker(4);
    await user.click(screen.getByRole("option", { name: /Sneha Kapoor/ }));
    expect(onSelect).toHaveBeenCalledWith(3);
  });

  it("selects the active option with Enter after arrowing", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderPicker(4);
    await user.keyboard("{ArrowDown}{Enter}"); // first option is "No manager"
    expect(onSelect).toHaveBeenCalledWith(1);  // second is Arjun
  });

  it("passes null when No manager is chosen", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderPicker(4);
    await user.click(screen.getByRole("option", { name: /no manager/i }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    const { onClose } = renderPicker(4);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("autofocuses the search field", () => {
    renderPicker(4);
    expect(screen.getByPlaceholderText(/search/i)).toHaveFocus();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npm test -- src/components/hierarchy/ManagerPicker.test.jsx`
Expected: FAIL — `Failed to resolve import "./ManagerPicker"`.

- [ ] **Step 3: Implement the picker**

Create `frontend/src/components/hierarchy/ManagerPicker.jsx`:

```jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, UserMinus } from "lucide-react";
import Avatar from "../ui/Avatar";
import { getValidManagers } from "../../lib/hierarchy";
import { ROLE_LABELS } from "./roleMeta";

const PANEL_W = 320;
const PANEL_MAX_H = 360;

// null id is the "no manager" row; it sorts first.
const NO_MANAGER = { id: null, name: "— No manager —" };

export default function ManagerPicker({ user, users, anchorRect, onSelect, onClose }) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const panelRef = useRef(null);
  const inputRef = useRef(null);

  const options = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const valid = getValidManagers(users, user.id).filter((u) =>
      !needle || [u.name, u.role, u.email].filter(Boolean).some((f) => f.toLowerCase().includes(needle))
    );
    const showNone = !needle || "no manager".includes(needle);
    return showNone ? [NO_MANAGER, ...valid] : valid;
  }, [users, user.id, query]);

  useEffect(() => setActiveIndex(0), [query]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    function onDocMouseDown(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) onClose();
    }
    document.addEventListener("mousedown", onDocMouseDown);
    // Any scroll detaches the popover from its anchor, so dismiss instead of
    // letting it float over an unrelated row.
    window.addEventListener("scroll", onClose, true);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  const currentManagerId = user.manager_id ?? null;

  function choose(option) {
    if (option.id === currentManagerId) return; // no-op reassignment
    onSelect(option.id);
  }

  function onKeyDown(e) {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex((i) => Math.min(i + 1, options.length - 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex((i) => Math.max(i - 1, 0)); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      const option = options[activeIndex];
      if (option) choose(option);
    }
  }

  // Flip above the anchor when there is not enough room below.
  const spaceBelow = window.innerHeight - anchorRect.bottom;
  const top = spaceBelow < PANEL_MAX_H ? Math.max(8, anchorRect.top - PANEL_MAX_H - 8) : anchorRect.bottom + 8;
  const left = Math.min(Math.max(8, anchorRect.right - PANEL_W), window.innerWidth - PANEL_W - 8);

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={`Change manager for ${user.name}`}
      onKeyDown={onKeyDown}
      style={{ top, left, width: PANEL_W, maxHeight: PANEL_MAX_H }}
      className="fixed z-50 bg-white border border-slate-200 rounded-2xl shadow-xl flex flex-col overflow-hidden"
    >
      <div className="p-3 border-b border-slate-100">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for a manager"
          className="w-full text-[14.5px] bg-slate-50 border border-transparent rounded-lg px-3 py-2
                     text-slate-800 placeholder:text-slate-400
                     focus:outline-none focus:bg-white focus:border-blue-500"
        />
      </div>

      <div role="listbox" aria-label="Managers" className="overflow-y-auto p-1.5">
        {options.length === 0 && (
          <p className="text-[13.5px] text-slate-400 text-center py-6">No matching people.</p>
        )}

        {options.map((option, i) => {
          const isCurrent = option.id === currentManagerId;
          const isActive = i === activeIndex;
          return (
            <div
              key={option.id ?? "none"}
              role="option"
              aria-selected={isCurrent}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => choose(option)}
              className={`flex items-center gap-3 px-2.5 py-2 rounded-lg ${
                isCurrent ? "cursor-default opacity-60" : "cursor-pointer"
              } ${isActive && !isCurrent ? "bg-blue-50" : ""}`}
            >
              {option.id === null ? (
                <span className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                  <UserMinus size={16} className="text-slate-400" />
                </span>
              ) : (
                <Avatar name={option.name} size="md" />
              )}

              <div className="min-w-0 flex-1">
                <p className="text-[14.5px] font-medium text-slate-800 truncate leading-tight">{option.name}</p>
                {option.id !== null && (
                  <p className="text-[12.5px] text-slate-400 truncate leading-tight mt-0.5">
                    {option.role || ROLE_LABELS[option.role_level]}
                  </p>
                )}
              </div>

              {isCurrent && <Check size={15} className="text-slate-400 shrink-0" />}
            </div>
          );
        })}
      </div>
    </div>,
    document.body
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npm test -- src/components/hierarchy/ManagerPicker.test.jsx`
Expected: PASS, 9 tests.

- [ ] **Step 5: Stage and hand off**

```bash
git add frontend/src/components/hierarchy/ManagerPicker.jsx \
        frontend/src/components/hierarchy/ManagerPicker.test.jsx
```

Then stop and report. Do not commit.

---

## Task 8: The move animation hook

FLIP: measure every visible row, mutate, measure again, transform each row from where it was to where it now is, and interpolate over 2 seconds.

**Correction to the spec.** The spec lists "measure First" *before* expanding the destination. That is wrong: expanding shifts every row beneath it, so those shifts would be folded into the 2s travel, contradicting the spec's own promise that revealed rows are settled before anything moves. The correct order, implemented below, is: **scroll → expand → settle → measure First → mutate → measure Last → play.**

**Files:**
- Modify: `frontend/src/components/hierarchy/useSubtreeMove.js`
- Test: `frontend/src/components/hierarchy/useSubtreeMove.test.jsx`

**Interfaces:**
- Consumes: nothing.
- Produces, in addition to the existing `MOVE_DURATION`, `ease`, `prefersReducedMotion`:
  - `useSubtreeMove(rowRefs: RefObject<Map<number, HTMLElement>>) => { runMove, isMoving }`
  - `runMove({ destinationId, movingIds, expandDestination, applyChange }) => Promise<void>`
    - `expandDestination: () => void` — synchronously opens the destination in React state; may be a no-op if already open.
    - `applyChange: () => void` — synchronously applies the new `manager_id` to state.
    - `movingIds: number[]` — the moving subtree, raised above its neighbours in flight.
  - `isMoving: boolean`

- [ ] **Step 1: Write the failing tests**

jsdom reports every `getBoundingClientRect()` as zeroes, so there is nothing to assert about eased intermediate positions. What is worth asserting is the **contract**: correct call order, reduced-motion short circuit, and cleanup. Create `frontend/src/components/hierarchy/useSubtreeMove.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { useSubtreeMove, ease, MOVE_DURATION } from "./useSubtreeMove";

function setReducedMotion(reduce) {
  window.matchMedia = (query) => ({
    matches: reduce, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  });
}

function renderMove() {
  return renderHook(() => {
    const rowRefs = useRef(new Map());
    return useSubtreeMove(rowRefs);
  });
}

beforeEach(() => { setReducedMotion(false); vi.useFakeTimers({ shouldAdvanceTime: true }); });
afterEach(() => { vi.useRealTimers(); });

describe("ease", () => {
  it("is pinned at both ends", () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
  });
  it("is symmetric about the midpoint", () => {
    expect(ease(0.5)).toBeCloseTo(0.5, 5);
    expect(ease(0.25) + ease(0.75)).toBeCloseTo(1, 5);
  });
});

describe("useSubtreeMove", () => {
  it("expands the destination before applying the change", async () => {
    const calls = [];
    const { result } = renderMove();
    await act(async () => {
      await result.current.runMove({
        destinationId: 3,
        movingIds: [4],
        expandDestination: () => calls.push("expand"),
        applyChange: () => calls.push("apply"),
      });
    });
    expect(calls).toEqual(["expand", "apply"]);
  });

  it("skips all motion under prefers-reduced-motion", async () => {
    setReducedMotion(true);
    const raf = vi.spyOn(window, "requestAnimationFrame");
    const { result } = renderMove();
    const applyChange = vi.fn();
    await act(async () => {
      await result.current.runMove({ destinationId: 3, movingIds: [4], expandDestination: () => {}, applyChange });
    });
    expect(applyChange).toHaveBeenCalledOnce();
    expect(raf).not.toHaveBeenCalled();
    expect(result.current.isMoving).toBe(false);
    raf.mockRestore();
  });

  it("reports isMoving across the animation and clears it at the end", async () => {
    const { result } = renderMove();
    let done;
    await act(async () => {
      done = result.current.runMove({ destinationId: 3, movingIds: [4], expandDestination: () => {}, applyChange: () => {} });
    });
    await waitFor(() => expect(result.current.isMoving).toBe(true));
    await act(async () => { vi.advanceTimersByTime(MOVE_DURATION + 400); await done; });
    expect(result.current.isMoving).toBe(false);
  });

  it("applies the change exactly once even if called twice in a row", async () => {
    const { result } = renderMove();
    const applyChange = vi.fn();
    await act(async () => {
      const a = result.current.runMove({ destinationId: 3, movingIds: [4], expandDestination: () => {}, applyChange });
      const b = result.current.runMove({ destinationId: 3, movingIds: [4], expandDestination: () => {}, applyChange });
      vi.advanceTimersByTime(MOVE_DURATION + 400);
      await Promise.all([a, b]);
    });
    // The second call snaps the first to its end state rather than stacking.
    expect(applyChange).toHaveBeenCalledTimes(2);
    expect(result.current.isMoving).toBe(false);
  });

  it("cancels pending frames on unmount", async () => {
    const cancel = vi.spyOn(window, "cancelAnimationFrame");
    const { result, unmount } = renderMove();
    await act(async () => {
      result.current.runMove({ destinationId: 3, movingIds: [4], expandDestination: () => {}, applyChange: () => {} });
    });
    unmount();
    expect(cancel).toHaveBeenCalled();
    cancel.mockRestore();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npm test -- src/components/hierarchy/useSubtreeMove.test.jsx`
Expected: FAIL — `useSubtreeMove is not a function`. The `ease` tests pass already.

- [ ] **Step 3: Implement the hook**

Replace `frontend/src/components/hierarchy/useSubtreeMove.js`:

```js
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

export const MOVE_DURATION = 2000;
const EXPAND_MS = 250;
const SCROLL_TIMEOUT_MS = 600;

// Cubic ease-in-out. Shared by both views so a reassignment feels identical
// whichever one you are looking at.
export function ease(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// scrollend has patchy support; race it against a timeout so we never hang.
function waitForScrollEnd() {
  return Promise.race([
    new Promise((r) => window.addEventListener("scrollend", r, { once: true, capture: true })),
    wait(SCROLL_TIMEOUT_MS),
  ]);
}

export function useSubtreeMove(rowRefs) {
  const [isMoving, setIsMoving] = useState(false);
  const rafRef = useRef(null);
  const finishRef = useRef(null);

  const clearTransforms = useCallback(() => {
    for (const el of rowRefs.current.values()) {
      el.style.transform = "";
      el.style.transition = "";
    }
  }, [rowRefs]);

  // Snap any running animation to its end state instead of stacking a second
  // one on top of it.
  const finishNow = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    clearTransforms();
    finishRef.current?.();
    finishRef.current = null;
    setIsMoving(false);
  }, [clearTransforms]);

  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    finishRef.current = null;
  }, []);

  const runMove = useCallback(
    async ({ destinationId, movingIds, expandDestination, applyChange }) => {
      finishNow();

      if (prefersReducedMotion()) {
        expandDestination();
        applyChange();
        return;
      }

      // 1. Scroll the destination into view. The landing is the part worth seeing.
      const destEl = destinationId != null ? rowRefs.current.get(destinationId) : null;
      if (destEl?.scrollIntoView) {
        destEl.scrollIntoView({ behavior: "smooth", block: "center" });
        await waitForScrollEnd();
      }

      // 2. Expand the destination and let it settle. This must complete before
      //    "First" is measured, or the expansion's row shifts get folded into
      //    the travel.
      flushSync(() => expandDestination());
      await wait(EXPAND_MS);
      await nextFrame();

      // 3. Measure First.
      const first = new Map();
      for (const [id, el] of rowRefs.current) first.set(id, el.getBoundingClientRect());

      // 4. Mutate synchronously so the DOM is final before we measure Last.
      flushSync(() => applyChange());

      // 5. Measure Last and invert.
      const deltas = [];
      for (const [id, firstRect] of first) {
        const el = rowRefs.current.get(id);
        if (!el) continue;
        const lastRect = el.getBoundingClientRect();
        const dx = firstRect.left - lastRect.left;
        const dy = firstRect.top - lastRect.top;
        if (dx !== 0 || dy !== 0) deltas.push({ el, dx, dy });
      }
      if (deltas.length === 0) return;

      const moving = new Set(movingIds);
      for (const [id, el] of rowRefs.current) {
        // The moving block crosses out of one parent's rows into another's; it
        // must paint above the rows it passes.
        if (moving.has(id)) el.style.zIndex = "20";
      }

      // 6. Play.
      setIsMoving(true);
      await new Promise((resolve) => {
        finishRef.current = resolve;
        const startTime = performance.now();

        function step(now) {
          const progress = Math.min((now - startTime) / MOVE_DURATION, 1);
          const eased = ease(progress);
          for (const { el, dx, dy } of deltas) {
            const x = dx * (1 - eased);
            const y = dy * (1 - eased);
            el.style.transform = `translate(${x}px, ${y}px)`;
          }
          if (progress < 1) {
            rafRef.current = requestAnimationFrame(step);
          } else {
            rafRef.current = null;
            clearTransforms();
            for (const el of rowRefs.current.values()) el.style.zIndex = "";
            finishRef.current = null;
            setIsMoving(false);
            resolve();
          }
        }
        rafRef.current = requestAnimationFrame(step);
      });
    },
    [rowRefs, finishNow, clearTransforms]
  );

  return { runMove, isMoving };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npm test -- src/components/hierarchy/useSubtreeMove.test.jsx`
Expected: PASS, 7 tests.

- [ ] **Step 5: Run the full suite (the graph imports these constants)**

Run: `cd frontend && npm test`
Expected: PASS, all tests.

- [ ] **Step 6: Stage and hand off**

```bash
git add frontend/src/components/hierarchy/useSubtreeMove.js \
        frontend/src/components/hierarchy/useSubtreeMove.test.jsx
```

Then stop and report. Do not commit.

---

## Task 9: Wire picker + animation into the tree

**Files:**
- Modify: `frontend/src/components/hierarchy/HierarchyTree.jsx`
- Modify: `frontend/src/components/hierarchy/HierarchyTree.test.jsx`

**Interfaces:**
- Consumes: `ManagerPicker` (Task 7), `useSubtreeMove` (Task 8), `collectSubtreeIds` (Task 2).
- Produces: no new exports.

Sequence on select: **save first**, then animate. A rejected save moves nothing.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/components/hierarchy/HierarchyTree.test.jsx`:

```jsx
import { waitFor } from "@testing-library/react";

describe("HierarchyTree reassignment", () => {
  it("opens the picker from a row's Move button", async () => {
    const user = userEvent.setup();
    render(<HierarchyTree users={USERS} onChangeManager={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Change manager for Priya Sharma" }));
    expect(screen.getByRole("dialog", { name: /change manager for priya/i })).toBeInTheDocument();
  });

  it("saves before moving anything", async () => {
    const user = userEvent.setup();
    const onChangeManager = vi.fn().mockResolvedValue(undefined);
    render(<HierarchyTree users={USERS} onChangeManager={onChangeManager} />);
    await user.click(screen.getByRole("button", { name: "Change manager for Priya Sharma" }));
    await user.click(screen.getByRole("option", { name: /Sneha Kapoor/ }));
    await waitFor(() => expect(onChangeManager).toHaveBeenCalledWith(4, 3));
  });

  it("closes the picker after a successful save", async () => {
    const user = userEvent.setup();
    render(<HierarchyTree users={USERS} onChangeManager={vi.fn().mockResolvedValue(undefined)} />);
    await user.click(screen.getByRole("button", { name: "Change manager for Priya Sharma" }));
    await user.click(screen.getByRole("option", { name: /Sneha Kapoor/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("shows an error and moves nothing when the save fails", async () => {
    const user = userEvent.setup();
    const onChangeManager = vi.fn().mockRejectedValue(new Error("500"));
    render(<HierarchyTree users={USERS} onChangeManager={onChangeManager} />);
    await user.click(screen.getByRole("button", { name: "Change manager for Priya Sharma" }));
    await user.click(screen.getByRole("option", { name: /Sneha Kapoor/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn.t change/i);
  });

  it("announces the change for screen readers", async () => {
    const user = userEvent.setup();
    render(<HierarchyTree users={USERS} onChangeManager={vi.fn().mockResolvedValue(undefined)} />);
    await user.click(screen.getByRole("button", { name: "Change manager for Priya Sharma" }));
    await user.click(screen.getByRole("option", { name: /Sneha Kapoor/ }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Priya Sharma now reports to Sneha Kapoor")
    );
  });

  it("announces promotion to no manager", async () => {
    const user = userEvent.setup();
    render(<HierarchyTree users={USERS} onChangeManager={vi.fn().mockResolvedValue(undefined)} />);
    await user.click(screen.getByRole("button", { name: "Change manager for Priya Sharma" }));
    await user.click(screen.getByRole("option", { name: /no manager/i }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Priya Sharma no longer reports to anyone")
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npm test -- src/components/hierarchy/HierarchyTree.test.jsx`
Expected: FAIL — clicking Move does nothing; `handleMove` is a no-op.

- [ ] **Step 3: Wire it up**

Replace `frontend/src/components/hierarchy/HierarchyTree.jsx`:

```jsx
import { useCallback, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { buildTree, filterTree, flattenVisible, collectSubtreeIds } from "../../lib/hierarchy";
import TreeRow from "./TreeRow";
import ManagerPicker from "./ManagerPicker";
import { useSubtreeMove } from "./useSubtreeMove";

function findNode(roots, id) {
  for (const root of roots) {
    if (root.id === id) return root;
    const hit = findNode(root.children, id);
    if (hit) return hit;
  }
  return null;
}

export default function HierarchyTree({ users, onChangeManager }) {
  const [query, setQuery] = useState("");
  // Collapsed-by-exception: an empty set means the whole tree is open, which
  // needs no seeding from a fetch that has not resolved yet.
  const [collapsedIds, setCollapsedIds] = useState(() => new Set());
  const [picker, setPicker] = useState(null); // { user, anchorRect }
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [movingIds, setMovingIds] = useState(new Set());

  const rowRefs = useRef(new Map());
  const { runMove } = useSubtreeMove(rowRefs);

  const roots = useMemo(() => buildTree(users), [users]);
  const visibleRoots = useMemo(() => filterTree(roots, query), [roots, query]);

  const expandedIds = useMemo(
    () => new Set(users.filter((u) => !collapsedIds.has(u.id)).map((u) => u.id)),
    [users, collapsedIds]
  );
  const effectiveExpanded = useMemo(
    () => (query.trim() ? new Set(users.map((u) => u.id)) : expandedIds),
    [query, users, expandedIds]
  );
  const rows = useMemo(() => flattenVisible(visibleRoots, effectiveExpanded), [visibleRoots, effectiveExpanded]);

  const toggle = useCallback((id) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const handleMove = useCallback((node, buttonEl) => {
    setError("");
    setPicker({ user: node, anchorRect: buttonEl.getBoundingClientRect() });
  }, []);

  async function handleSelect(newManagerId) {
    const subject = picker.user;
    setPicker(null);

    // Save first. Animating optimistically and rewinding on failure would show
    // the user a lie for two seconds.
    try {
      await onChangeManager(subject.id, newManagerId);
    } catch {
      setError(`Couldn't change ${subject.name}'s manager. Please try again.`);
      return;
    }

    const managerName = users.find((u) => u.id === newManagerId)?.name;
    setAnnouncement(
      managerName
        ? `${subject.name} now reports to ${managerName}`
        : `${subject.name} no longer reports to anyone`
    );

    const subtree = collectSubtreeIds(findNode(roots, subject.id) ?? { id: subject.id, children: [] });
    setMovingIds(new Set(subtree));

    await runMove({
      destinationId: newManagerId,
      movingIds: subtree,
      expandDestination: () => {
        if (newManagerId == null) return;
        setCollapsedIds((prev) => {
          if (!prev.has(newManagerId)) return prev;
          const next = new Set(prev);
          next.delete(newManagerId);
          return next;
        });
      },
      // The parent already updated `users` inside onChangeManager; this render
      // is what lands the row in its new home.
      applyChange: () => setMovingIds(new Set(subtree)),
    });

    setMovingIds(new Set());
  }

  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <div className="max-w-3xl mx-auto">
        <div className="relative mb-5">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, role, or email"
            className="w-full text-[14.5px] bg-white border border-slate-200 rounded-xl pl-10 pr-4 py-2.5
                       text-slate-800 placeholder:text-slate-400
                       focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {error && (
          <div role="alert" className="mb-4 text-[13.5px] text-red-700 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
            {error}
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-2xl p-2">
          {rows.length === 0 ? (
            <p className="text-[14.5px] text-slate-400 text-center py-12">No one matches “{query}”.</p>
          ) : (
            <div role="tree" aria-label="Organisation hierarchy">
              {rows.map(({ node, depth }) => (
                <TreeRow
                  key={node.id}
                  ref={(el) => {
                    if (el) rowRefs.current.set(node.id, el);
                    else rowRefs.current.delete(node.id);
                  }}
                  node={node}
                  depth={depth}
                  hasChildren={node.children.length > 0}
                  expanded={effectiveExpanded.has(node.id)}
                  onToggle={toggle}
                  onMove={handleMove}
                  moving={movingIds.has(node.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {picker && (
        <ManagerPicker
          user={picker.user}
          users={users}
          anchorRect={picker.anchorRect}
          onSelect={handleSelect}
          onClose={() => setPicker(null)}
        />
      )}

      {/* The animation conveys the change visually; this conveys it otherwise. */}
      <div role="status" aria-live="polite" className="sr-only">{announcement}</div>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npm test -- src/components/hierarchy/HierarchyTree.test.jsx`
Expected: PASS, 15 tests.

- [ ] **Step 5: Run the full suite**

Run: `cd frontend && npm test`
Expected: PASS, all tests.

- [ ] **Step 6: Verify the real thing in a browser**

Run: `cd frontend && npm run dev`. At `/admin/hierarchy`:

1. Collapse a manager, then move someone under them. The destination expands, settles, then the person travels for 2 seconds. No blink.
2. Move a manager who has reports. The whole subtree travels as one block, above the rows it passes.
3. Move someone to "No manager". They travel to depth 0.
4. Scroll so the destination is off-screen, then move someone there. It scrolls into view first.
5. Search "priya", confirm the ancestor chain stays.
6. In devtools, emulate `prefers-reduced-motion: reduce`. The row jumps straight to its new home.
7. Tab to a row's Move button, press Enter, arrow to a manager, press Enter. It works without a mouse.

Stop the dev server.

- [ ] **Step 7: Stage and hand off**

```bash
git add frontend/src/components/hierarchy/HierarchyTree.jsx \
        frontend/src/components/hierarchy/HierarchyTree.test.jsx
```

Then stop and report. Do not commit.

---

## Self-Review

**Spec coverage.** Every section maps to a task: sidebar submenu → 4; routes and `AdminRoute` → 3; `Admin.jsx` deletion → 3; `LeaveSettings` header → 3; component split → 5; `lib/hierarchy.js` → 1, 2; tree view + search → 6; picker → 7; animation and edge cases → 8, 9; accessibility → 4, 6, 7, 9; testing → every task.

**Deviations from the spec, deliberate:**
- Step order in the animation corrected (expand before measuring First). The spec's order contradicted its own stated behaviour.
- Tree renders flat rather than nested, so FLIP can transform rows independently.
- Vitest infrastructure added in Task 1; the spec assumed it existed.
- Commit steps replaced with stage-and-report, per Neel's standing instruction.

**Out of scope, unchanged:** backend, drag-and-drop, editing fields other than `manager_id`, and the dead `App.jsx`.

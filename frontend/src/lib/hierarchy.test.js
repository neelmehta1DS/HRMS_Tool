import { describe, it, expect } from "vitest";
import { getDescendantIds, getValidManagers, buildTree, filterTree, flattenVisible } from "./hierarchy";

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

  it("keeps the full subtree of a match even when no descendant matches", () => {
    // Neel(2) matches; his reports Priya(4) and Rahul(5) do not.
    const roots = filterTree(ROOTS, "Neel");
    const neel = roots[0].children.find((c) => c.id === 2);
    expect(ids(neel.children)).toEqual([4, 5]);
  });

  it("keeps ancestors of a match without their unrelated branches", () => {
    // Priya(4) matches. Arjun(1) and Neel(2) are ancestors. Sneha(3) is unrelated.
    const roots = filterTree(ROOTS, "Priya");
    expect(ids(roots[0].children)).toEqual([2]);
  });

  it("keeps a matching root's entire tree", () => {
    const roots = filterTree(ROOTS, "Arjun");
    expect(ids(roots[0].children)).toEqual([2, 3]);
    const neel = roots[0].children.find((c) => c.id === 2);
    expect(ids(neel.children)).toEqual([4, 5]);
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

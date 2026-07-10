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

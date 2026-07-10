import { useCallback, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { buildTree, filterTree, flattenVisible } from "../../lib/hierarchy";
import TreeRow from "./TreeRow";
import ManagerPicker from "./ManagerPicker";

export default function HierarchyTree({ users, onChangeManager }) {
  const [query, setQuery] = useState("");
  // Collapsed-by-exception: an empty collapsed set means the whole tree is open,
  // which is the right default and needs no seeding from an async fetch.
  const [collapsedIds, setCollapsedIds] = useState(() => new Set());
  const [picker, setPicker] = useState(null); // null | { user, anchorRect, anchorEl }
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");

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

  // Roving tabindex: exactly one row is the tree's single tab stop. Derive the
  // effective focused id so it repairs itself when the focused row disappears
  // (e.g. filtered out by search), falling back to the first visible row.
  const [focusedIdRaw, setFocusedId] = useState(null);
  const focusedId = rows.some((r) => r.node.id === focusedIdRaw)
    ? focusedIdRaw
    : rows[0]?.node.id ?? null;

  const rowRefs = useRef(new Map());

  const focusRow = useCallback((id) => {
    setFocusedId(id);
    rowRefs.current.get(id)?.focus();
  }, []);

  const toggle = useCallback((id) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const handleMove = useCallback((node, buttonEl) => {
    setError("");
    setPicker((prev) =>
      prev?.user.id === node.id
        ? null
        : { user: node, anchorRect: buttonEl.getBoundingClientRect(), anchorEl: buttonEl }
    );
  }, []);

  const handleKeyDown = useCallback((e, node) => {
    // Let the Move button (or any inner control) handle its own keys.
    if (e.target !== e.currentTarget) return;

    const idx = rows.findIndex((r) => r.node.id === node.id);
    if (idx === -1) return;
    const hasChildren = node.children.length > 0;
    const isExpanded = effectiveExpanded.has(node.id);

    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        if (rows[idx + 1]) focusRow(rows[idx + 1].node.id);
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        if (rows[idx - 1]) focusRow(rows[idx - 1].node.id);
        break;
      }
      case "Home": {
        e.preventDefault();
        if (rows[0]) focusRow(rows[0].node.id);
        break;
      }
      case "End": {
        e.preventDefault();
        if (rows.length) focusRow(rows[rows.length - 1].node.id);
        break;
      }
      case "ArrowRight": {
        e.preventDefault();
        if (!hasChildren) break;
        if (!isExpanded) toggle(node.id);
        else if (rows[idx + 1]) focusRow(rows[idx + 1].node.id); // first child
        break;
      }
      case "ArrowLeft": {
        e.preventDefault();
        if (hasChildren && isExpanded) {
          toggle(node.id);
        } else if (node.manager_id != null && rows.some((r) => r.node.id === node.manager_id)) {
          focusRow(node.manager_id);
        }
        break;
      }
      case "Enter":
      case " ": {
        e.preventDefault();
        if (hasChildren) toggle(node.id);
        break;
      }
      default:
        break;
    }
  }, [rows, effectiveExpanded, toggle, focusRow]);

  async function handleSelect(newManagerId) {
    const subject = picker.user;

    try {
      await onChangeManager(subject.id, newManagerId);
    } catch {
      // Keep the picker open so the user doesn't lose their place on a failure.
      setError(`Couldn't change ${subject.name}'s manager. Please try again.`);
      return;
    }
    setPicker(null);

    // Make sure the person is visible under their new manager.
    if (newManagerId != null) {
      setCollapsedIds((prev) => {
        if (!prev.has(newManagerId)) return prev;
        const next = new Set(prev);
        next.delete(newManagerId);
        return next;
      });
    }

    const managerName = users.find((u) => u.id === newManagerId)?.name;
    setAnnouncement(
      managerName
        ? `${subject.name} now reports to ${managerName}`
        : `${subject.name} no longer reports to anyone`
    );
  }

  return (
    <div className="h-full overflow-y-auto px-8 py-6">
      <div className="max-w-3xl mx-auto">
        {error && (
          <div role="alert" className="mb-4 text-[13.5px] text-red-700 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
            {error}
          </div>
        )}

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
            <p className="text-[14.5px] text-slate-400 text-center py-12">
              {users.length === 0
                ? "Loading…"
                : query.trim()
                ? `No one matches “${query}”.`
                : "No people yet."}
            </p>
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
                  focused={node.id === focusedId}
                  onToggle={toggle}
                  onMove={handleMove}
                  onFocusRow={setFocusedId}
                  onKeyDown={handleKeyDown}
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
          anchorEl={picker.anchorEl}
          onSelect={handleSelect}
          onClose={() => setPicker(null)}
        />
      )}

      {/* Nothing else tells a screen-reader user the reassignment happened. */}
      <div role="status" aria-live="polite" className="sr-only">{announcement}</div>
    </div>
  );
}

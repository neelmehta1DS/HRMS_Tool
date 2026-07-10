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
import { MOVE_DURATION, ease, prefersReducedMotion } from "./motion";
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
  const animatingRef = useRef(false);
  const mountedRef = useRef(true);

  // Cancel in-flight animation work when the view unmounts. The original
  // implementation left a setTimeout running past unmount. mountedRef also
  // stops a save that resolves after unmount from scheduling fresh work.
  useEffect(() => () => {
    mountedRef.current = false;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  useEffect(() => {
    // A save updates `users`, but handleSave is already driving nodes and edges
    // to the same destination one frame at a time. Rebuilding here would paint
    // the final layout before the animation's next frame corrects it, and would
    // drop the moving node's selection ring on the way.
    if (animatingRef.current) return;
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
    // Raised before the await: onChangeManager updates `users` in the parent,
    // which would otherwise trigger the rebuild effect mid-save.
    animatingRef.current = true;
    try {
      await onChangeManager(selectedUser.id, newManagerId);
    } catch {
      animatingRef.current = false;
      if (!mountedRef.current) return;
      setSaveStatus("error");
      setSaving(false);
      return;
    }

    // The user may have switched tabs while the save was in flight. Bail before
    // touching state or scheduling animation work on an unmounted component.
    if (!mountedRef.current) {
      animatingRef.current = false;
      return;
    }

    // Everything past the await runs outside the save's try/catch; a throw here
    // (Dagre layout, edge rebuild, rAF setup) must still clear the flags, or the
    // rebuild effect stays suppressed and the graph freezes for every later save.
    try {
      setSaveStatus("saved");
      setSaving(false);

      const withoutOld = edges.filter((e) => e.target !== String(selectedUser.id));
      const updatedEdges = newManagerId ? [...withoutOld, edgeFor(selectedUser.id, newManagerId)] : withoutOld;
      setEdges(updatedEdges);

      if (prefersReducedMotion()) {
        setNodes(layoutNodes(nodes, updatedEdges));
        animatingRef.current = false;
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
        if (progress < 1) {
          rafRef.current = requestAnimationFrame(step);
        } else {
          rafRef.current = null;
          animatingRef.current = false;
        }
      }
      rafRef.current = requestAnimationFrame(step);
      timerRef.current = setTimeout(() => setSelectedId(null), MOVE_DURATION + 100);
    } catch {
      // Rethrowing here would surface only as an unhandled rejection, since this
      // runs from an async click handler. The save itself already succeeded; it
      // is the local layout that failed, so say so rather than claiming "Saved".
      animatingRef.current = false;
      setSaving(false);
      setSaveStatus("error");
    }
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

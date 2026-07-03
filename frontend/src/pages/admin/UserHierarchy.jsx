import { useCallback, useEffect, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import Dagre from "@dagrejs/dagre";
import { X, Check } from "lucide-react";
import { getAdminUsers, adminUpdateUser } from "../../lib/api";

const ROLE_COLORS = {
  l2_lead: "#3b82f6",
  l1_manager: "#8b5cf6",
  ic: "#64748b",
};

const ROLE_LABELS = {
  l2_lead: "L2 Lead",
  l1_manager: "Manager",
  ic: "IC",
};

const NODE_W = 190;
const NODE_H = 68;

function PersonNode({ data, selected }) {
  const initials = data.name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const color = ROLE_COLORS[data.roleLevel] ?? "#64748b";

  return (
    <div
      style={{ width: NODE_W }}
      className={`bg-white rounded-xl border shadow-sm px-3.5 py-3 select-none cursor-pointer transition-shadow hover:shadow-md ${
        selected ? "border-blue-400 ring-2 ring-blue-200" : "border-slate-200"
      }`}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: "#cbd5e1", width: 7, height: 7 }}
      />
      <div className="flex items-center gap-2.5">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[11px] font-bold shrink-0"
          style={{ backgroundColor: color }}
        >
          {initials}
        </div>
        <div className="min-w-0">
          <p className="text-[12.5px] font-semibold text-slate-900 truncate leading-tight">
            {data.name}
          </p>
          <p className="text-[11px] text-slate-400 truncate leading-tight mt-0.5">
            {data.role || ROLE_LABELS[data.roleLevel]}
          </p>
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: "#cbd5e1", width: 7, height: 7 }}
      />
    </div>
  );
}

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

function buildGraph(users) {
  const rawNodes = users.map((u) => ({
    id: String(u.id),
    type: "person",
    data: { name: u.name, role: u.role, roleLevel: u.role_level },
    position: { x: 0, y: 0 },
  }));
  const edges = users
    .filter((u) => u.manager_id)
    .map((u) => ({
      id: `e${u.id}-${u.manager_id}`,
      type: "default",
      source: String(u.manager_id),
      target: String(u.id),
      markerEnd: { type: MarkerType.ArrowClosed, color: "#94a3b8" },
      style: { stroke: "#cbd5e1", strokeWidth: 1.5 },
    }));
  return { nodes: layoutNodes(rawNodes, edges), edges };
}

function getDescendants(userId, edges) {
  const childMap = {};
  edges.forEach((e) => {
    if (!childMap[e.source]) childMap[e.source] = [];
    childMap[e.source].push(e.target);
  });
  const result = new Set();
  const queue = [String(userId)];
  while (queue.length) {
    const curr = queue.shift();
    (childMap[curr] || []).forEach((c) => {
      if (!result.has(c)) {
        result.add(c);
        queue.push(c);
      }
    });
  }
  return result;
}

export default function UserHierarchy() {
  const [allUsers, setAllUsers] = useState([]);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges] = useEdgesState([]);

  const [selectedId, setSelectedId] = useState(null);
  const [managerDraft, setManagerDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null); // "saved" | "error"

  useEffect(() => {
    getAdminUsers().then((users) => {
      setAllUsers(users);
      const { nodes: n, edges: e } = buildGraph(users);
      setNodes(n);
      setEdges(e);
    });
  }, []);

  const selectedUser = allUsers.find((u) => String(u.id) === selectedId) ?? null;

  const onNodeClick = useCallback((_, node) => {
    setSelectedId(node.id);
    const u = allUsers.find((u) => String(u.id) === node.id);
    setManagerDraft(u?.manager_id ? String(u.manager_id) : "");
    setSaveStatus(null);
  }, [allUsers]);

  const onPaneClick = useCallback(() => {
    setSelectedId(null);
  }, []);

  // Mark selected node
  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) => ({ ...n, selected: n.id === selectedId }))
    );
  }, [selectedId]);

  async function handleSave() {
    if (!selectedUser) return;
    const newManagerId = managerDraft ? parseInt(managerDraft) : null;
    if (newManagerId === (selectedUser.manager_id ?? null)) {
      setSelectedId(null);
      return;
    }

    setSaving(true);
    setSaveStatus(null);
    try {
      await adminUpdateUser(selectedUser.id, { manager_id: newManagerId });

      setAllUsers((prev) =>
        prev.map((u) =>
          u.id === selectedUser.id ? { ...u, manager_id: newManagerId } : u
        )
      );

      // Compute updated edges directly so we can pass them to layoutNodes
      const withoutOld = edges.filter((e) => e.target !== String(selectedUser.id));
      const updatedEdges = newManagerId
        ? [
            ...withoutOld,
            {
              id: `e${selectedUser.id}-${newManagerId}`,
              type: "default",
              source: String(newManagerId),
              target: String(selectedUser.id),
              markerEnd: { type: MarkerType.ArrowClosed, color: "#94a3b8" },
              style: { stroke: "#cbd5e1", strokeWidth: 1.5 },
            },
          ]
        : withoutOld;

      // Compute target layout before touching state
      const targetNodes = layoutNodes(nodes, updatedEdges);
      const startPositions = Object.fromEntries(
        nodes.map((n) => [n.id, { ...n.position }])
      );
      const targetPositions = Object.fromEntries(
        targetNodes.map((n) => [n.id, { ...n.position }])
      );

      // Update edge and kick off animation in the same frame so the new
      // edge connection appears exactly as nodes start moving
      setEdges(updatedEdges);

      const DURATION = 2000;
      const startTime = performance.now();

      function ease(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      }

      function step(now) {
        const progress = Math.min((now - startTime) / DURATION, 1);
        const eased = ease(progress);
        setNodes((nds) =>
          nds.map((n) => {
            const s = startPositions[n.id];
            const t = targetPositions[n.id];
            if (!s || !t) return n;
            return {
              ...n,
              position: {
                x: s.x + (t.x - s.x) * eased,
                y: s.y + (t.y - s.y) * eased,
              },
            };
          })
        );
        if (progress < 1) requestAnimationFrame(step);
      }

      requestAnimationFrame(step);

      setSaveStatus("saved");
      setTimeout(() => setSelectedId(null), DURATION + 100);
    } catch {
      setSaveStatus("error");
    } finally {
      setSaving(false);
    }
  }

  // Build valid manager options: exclude self and descendants
  const descendants = selectedId ? getDescendants(selectedId, edges) : new Set();
  const managerOptions = allUsers.filter(
    (u) => String(u.id) !== selectedId && !descendants.has(String(u.id))
  );

  return (
    <div className="h-full relative flex">
      {/* Graph */}
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
            nodeColor={(n) => ROLE_COLORS[n.data?.roleLevel] ?? "#64748b"}
            maskColor="rgba(241,245,249,0.7)"
            className="!border !border-slate-200 !rounded-xl !shadow-none"
          />
        </ReactFlow>
      </div>

      {/* Edit panel */}
      {selectedUser && (
        <div className="w-64 shrink-0 h-full bg-white border-l border-slate-200 flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <span className="text-[13px] font-semibold text-slate-700">Edit Person</span>
            <button
              onClick={() => setSelectedId(null)}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <X size={14} />
            </button>
          </div>

          {/* Person info */}
          <div className="px-4 py-4 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-white text-[12px] font-bold shrink-0"
                style={{ backgroundColor: ROLE_COLORS[selectedUser.role_level] ?? "#64748b" }}
              >
                {selectedUser.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-[13.5px] font-semibold text-slate-900 truncate">
                  {selectedUser.name}
                </p>
                <p className="text-[11.5px] text-slate-400 truncate">
                  {selectedUser.role || ROLE_LABELS[selectedUser.role_level]}
                </p>
              </div>
            </div>
          </div>

          {/* Manager select */}
          <div className="px-4 py-4 flex-1">
            <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Manager
            </label>
            <select
              value={managerDraft}
              onChange={(e) => setManagerDraft(e.target.value)}
              className="w-full text-[13px] border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">(no manager)</option>
              {managerOptions.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>

          {/* Actions */}
          <div className="px-4 pb-4 flex gap-2">
            <button
              onClick={() => setSelectedId(null)}
              className="flex-1 py-2 text-[12.5px] font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className={`flex-1 py-2 text-[12.5px] font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
                saveStatus === "saved"
                  ? "bg-emerald-500 text-white"
                  : saveStatus === "error"
                  ? "bg-red-500 text-white"
                  : "bg-blue-600 text-white hover:bg-blue-700"
              } disabled:opacity-50`}
            >
              {saving ? (
                "Saving…"
              ) : saveStatus === "saved" ? (
                <><Check size={13} /> Saved</>
              ) : saveStatus === "error" ? (
                "Error"
              ) : (
                "Save"
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

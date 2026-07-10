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

import { forwardRef } from "react";
import { ChevronRight, GitBranch } from "lucide-react";
import Avatar from "../ui/Avatar";
import { ROLE_LABELS } from "./roleMeta";

const INDENT_PX = 30;

const TreeRow = forwardRef(function TreeRow(
  { node, depth, expanded, hasChildren, focused, onToggle, onMove, onFocusRow, onKeyDown },
  ref
) {
  return (
    <div
      ref={ref}
      role="treeitem"
      aria-level={depth + 1}
      {...(hasChildren ? { "aria-expanded": expanded } : {})}
      tabIndex={focused ? 0 : -1}
      onKeyDown={(e) => onKeyDown(e, node)}
      onClick={() => { onFocusRow(node.id); if (hasChildren) onToggle(node.id); }}
      style={{ paddingLeft: 12 + depth * INDENT_PX }}
      className={`group relative flex items-center gap-3 pr-3 py-2.5 rounded-xl transition-colors hover:bg-slate-50 focus:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
        hasChildren ? "cursor-pointer" : "cursor-default"
      }`}
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

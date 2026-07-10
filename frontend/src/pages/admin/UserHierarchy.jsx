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

import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useUser } from "../contexts/UserContext";
import UserHierarchy from "./admin/UserHierarchy";
import LeaveSettings from "./admin/LeaveSettings";

const TABS = [
  { id: "hierarchy", label: "User Hierarchy" },
  { id: "leaves", label: "Leave Settings" },
];

export default function Admin() {
  const { user } = useUser();
  const [tab, setTab] = useState("hierarchy");

  if (!user?.is_admin) return <Navigate to="/" replace />;

  return (
    <div className="flex flex-col h-full">
      {/* Header + tabs */}
      <div className="px-8 pt-7 shrink-0 bg-white border-b border-slate-200">
        <h1 className="text-2xl font-bold text-slate-900 mb-5">Admin Settings</h1>
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-[13px] font-medium rounded-t-lg border-b-2 transition-colors ${
                tab === t.id
                  ? "border-blue-600 text-blue-700"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === "hierarchy" && <UserHierarchy />}
        {tab === "leaves" && (
          <div className="h-full overflow-y-auto">
            <LeaveSettings />
          </div>
        )}
      </div>
    </div>
  );
}

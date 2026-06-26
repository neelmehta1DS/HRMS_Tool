import { LayoutDashboard, CalendarDays, Users2, LogOut, Building2 } from "lucide-react";
import Avatar from "../ui/Avatar";
import { isManager } from "../../lib/utils";

const NAV = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "leaves",    label: "Leave",     icon: CalendarDays },
  { id: "catchups",  label: "Catch-ups", icon: Users2 },
];

export default function Sidebar({ page, setPage, currentUser, onLogout }) {
  return (
    <aside className="w-56 flex-shrink-0 bg-white border-r border-slate-100 flex flex-col">
      {/* Logo */}
      <div className="px-5 pt-5 pb-4 border-b border-slate-50">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shadow-sm shadow-blue-200">
            <Building2 className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-sm tracking-tight text-slate-800">DigiSync</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = page === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setPage(item.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                active
                  ? "bg-blue-50 text-blue-700"
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
              }`}
            >
              <Icon className={`w-4 h-4 flex-shrink-0 ${active ? "text-blue-600" : "text-slate-400"}`} />
              <span className="flex-1 text-left">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 pb-4 pt-3 border-t border-slate-50">
        <div className="flex items-center gap-2.5 px-3 py-2 mb-1">
          <Avatar name={currentUser.name} size="sm" />
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate text-slate-800">{currentUser.name}</p>
            <p className="text-[10px] truncate text-slate-400">
              {isManager(currentUser) ? "Manager" : "Employee"}
            </p>
          </div>
        </div>
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition-colors"
        >
          <LogOut className="w-3.5 h-3.5" /> Sign out
        </button>
      </div>
    </aside>
  );
}
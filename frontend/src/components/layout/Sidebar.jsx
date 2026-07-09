import { NavLink, useNavigate } from "react-router-dom";
import { LayoutDashboard, CalendarDays, Users, LogOut, Settings } from "lucide-react";
import { useUser } from "../../contexts/UserContext";
import { logout } from "../../lib/api";
import Avatar from "../ui/Avatar";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard", end: true },
  { to: "/leaves", icon: CalendarDays, label: "Leave" },
  { to: "/catchups", icon: Users, label: "Catchups" },
];

export default function Sidebar() {
  const { user } = useUser();
  const navigate = useNavigate();

  async function handleLogout() {
    try { await logout(); } catch (_) {}
    navigate("/login");
  }

  return (
    <aside className="w-[262px] shrink-0 flex flex-col h-full bg-white border-r border-slate-200 hide-scroll overflow-y-auto">
      <div className="px-6 py-5 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="w-[34px] h-[34px] bg-blue-600 rounded-lg flex items-center justify-center shrink-0">
            <span className="text-white font-bold text-[12.5px] tracking-tight">DS</span>
          </div>
          <span className="text-slate-900 font-semibold text-[18px] tracking-tight">DigiSync</span>
        </div>
      </div>

      <nav className="flex-1 px-4 py-5 space-y-1">
        {navItems.map(({ to, icon: Icon, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-3.5 px-3.5 py-3 rounded-lg text-[15.5px] font-medium transition-colors ${
                isActive
                  ? "text-blue-700 bg-blue-50"
                  : "text-slate-500 hover:text-slate-800 hover:bg-slate-50"
              }`
            }
          >
            <Icon size={19} strokeWidth={2} />
            {label}
          </NavLink>
        ))}
        {user?.is_admin && (
          <NavLink
            to="/admin"
            className={({ isActive }) =>
              `flex items-center gap-3.5 px-3.5 py-3 rounded-lg text-[15.5px] font-medium transition-colors ${
                isActive
                  ? "text-blue-700 bg-blue-50"
                  : "text-slate-500 hover:text-slate-800 hover:bg-slate-50"
              }`
            }
          >
            <Settings size={19} strokeWidth={2} />
            Admin
          </NavLink>
        )}
      </nav>

      <div className="px-4 pb-5 border-t border-slate-100 pt-4">
        <div className="flex items-center gap-3 px-2 py-2 mb-1">
          <Avatar name={user.name} size="md" />
          <p className="flex-1 min-w-0 text-slate-800 text-[14.5px] font-medium truncate leading-tight">{user.name}</p>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-[14.5px] font-medium text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition-colors"
        >
          <LogOut size={16} strokeWidth={2} />
          Sign out
        </button>
      </div>
    </aside>
  );
}

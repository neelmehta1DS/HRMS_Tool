import { NavLink, useNavigate } from "react-router-dom";
import { LayoutDashboard, CalendarDays, Users, LogOut } from "lucide-react";
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
    <aside className="w-[220px] shrink-0 flex flex-col h-full bg-white border-r border-slate-200 hide-scroll overflow-y-auto">
      <div className="px-5 py-[18px] border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center shrink-0">
            <span className="text-white font-bold text-[11px] tracking-tight">DS</span>
          </div>
          <span className="text-slate-900 font-semibold text-[15px] tracking-tight">DigiSync</span>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {navItems.map(({ to, icon: Icon, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13.5px] font-medium transition-colors ${
                isActive
                  ? "text-blue-700 bg-blue-50"
                  : "text-slate-500 hover:text-slate-800 hover:bg-slate-50"
              }`
            }
          >
            <Icon size={15} strokeWidth={2} />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="px-3 pb-4 border-t border-slate-100 pt-3">
        <div className="flex items-center gap-2.5 px-2 py-2 mb-0.5">
          <Avatar name={user.name} size="sm" />
          <div className="flex-1 min-w-0">
            <p className="text-slate-800 text-[12.5px] font-medium truncate leading-tight">{user.name}</p>
            <p className="text-slate-400 text-[11px] truncate leading-tight mt-0.5">
              {user.role || (user.role_level === "l2_lead" ? "Lead" : user.role_level === "l1_manager" ? "Manager" : "IC")}
            </p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition-colors"
        >
          <LogOut size={13} strokeWidth={2} />
          Sign out
        </button>
      </div>
    </aside>
  );
}

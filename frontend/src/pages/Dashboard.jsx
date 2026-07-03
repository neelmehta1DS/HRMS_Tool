import { useState, useEffect, useMemo } from "react";
import {
  LayoutDashboard,
  Home,
  Clock,
  LogOut,
  DoorOpen,
  Cake,
  Star,
  UserX,
  CalendarOff,
  CalendarDays,
  Video,
  ClipboardList,
  Users,
  Bell,
} from "lucide-react";
import Avatar from "../components/ui/Avatar";
import Badge from "../components/ui/Badge";
import Spinner from "../components/ui/Spinner";
import TimePicker, { TIME_OPTIONS, snapTime } from "../components/ui/TimePicker";
import { useUser } from "../contexts/UserContext";
import {
  getGreeting,
  formatDateShort,
  formatDateTime,
  getUserStatus,
} from "../lib/utils";
import { getDashboardSummary, getUsers, updateStatus, getHolidays } from "../lib/api";

// ─── helpers ────────────────────────────────────────────────────────────────

function useLiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function formatLiveClock(d) {
  const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
  const month = d.toLocaleDateString("en-US", { month: "long" });
  const day = d.getDate();
  const year = d.getFullYear();
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${weekday}, ${month} ${day}, ${year} · ${h}:${m} ${ampm}`;
}

function daysLabel(days) {
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `in ${days} days`;
}

function deriveOfficeMode(user) {
  if (user.office_status === "WFH") return "wfh";
  if (user.office_status === "IN") return "office";
  return "ooo";
}

// ─── Section label ────────────────────────────────────────────────────────────

function SectionLabel({ children }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <span className="text-[13px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">
        {children}
      </span>
      <div className="flex-1 h-px bg-slate-200" />
    </div>
  );
}

// ─── Time picker — single styled select, 10 AM–7 PM in 15-min steps ──────────



// ─── Status bar ────────────────────────────────────────────────────────────────

const OFFICE_MODES = [
  { id: "office", label: "In Office",        icon: LayoutDashboard },
  { id: "ooo",    label: "Out of Office",     icon: DoorOpen        },
  { id: "wfh",    label: "Working from Home", icon: Home            },
];

function StatusBar({ user, setUser }) {
  const [officeMode, setOfficeMode]   = useState(() => deriveOfficeMode(user));
  const [lateActive, setLateActive]   = useState(() => !!user.late_arrive_eta);
  const [earlyActive, setEarlyActive] = useState(() => !!user.early_exit_eta);
  const [lateEta,  setLateEta]  = useState(() => snapTime(user.late_arrive_eta?.slice(0, 5),  "10:00"));
  const [earlyEta, setEarlyEta] = useState(() => snapTime(user.early_exit_eta?.slice(0, 5), "17:00"));
  const [saving, setSaving] = useState(null);

  async function patch(data, onOptimistic, onRollback) {
    const prev = { ...user };
    onOptimistic();
    setSaving(Object.keys(data)[0]);
    try {
      const updated = await updateStatus(data);
      setUser(updated);
    } catch {
      setUser(prev);
      onRollback?.();
    } finally {
      setSaving(null);
    }
  }

  function applyOffice(mode) {
    if (saving) return;
    const statusMap = { office: "IN", ooo: "OUT", wfh: "WFH" };
    setOfficeMode(mode);
    patch(
      { office_status: statusMap[mode] },
      () => setUser({ ...user, office_status: statusMap[mode] }),
      () => setOfficeMode(deriveOfficeMode(user)),
    );
  }

  function toggleLate(on) {
    if (saving) return;
    if (on) {
      setLateActive(true);
      patch(
        { late_arrive_eta: lateEta },
        () => setUser({ ...user, late_arrive_eta: lateEta }),
        () => setLateActive(false),
      );
    } else {
      setLateActive(false);
      patch(
        { late_arrive_eta: null },
        () => setUser({ ...user, late_arrive_eta: null }),
        () => setLateActive(true),
      );
    }
  }

  function toggleEarly(on) {
    if (saving) return;
    if (on) {
      setEarlyActive(true);
      patch(
        { early_exit_eta: earlyEta },
        () => setUser({ ...user, early_exit_eta: earlyEta }),
        () => setEarlyActive(false),
      );
    } else {
      setEarlyActive(false);
      patch(
        { early_exit_eta: null },
        () => setUser({ ...user, early_exit_eta: null }),
        () => setEarlyActive(true),
      );
    }
  }

  function handleLateTime(time) {
    if (!lateActive || saving) return;
    setLateEta(time);
    patch(
      { late_arrive_eta: time },
      () => setUser({ ...user, late_arrive_eta: time }),
      () => setLateEta(user.late_arrive_eta?.slice(0, 5) || "10:00"),
    );
  }

  function handleEarlyTime(time) {
    if (!earlyActive || saving) return;
    setEarlyEta(time);
    patch(
      { early_exit_eta: time },
      () => setUser({ ...user, early_exit_eta: time }),
      () => setEarlyEta(user.early_exit_eta?.slice(0, 5) || "17:00"),
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex flex-wrap items-center gap-2.5">
        {/* Office status — mutually exclusive */}
        {OFFICE_MODES.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => applyOffice(id)}
            disabled={!!saving}
            className={`
              inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-[13.5px] font-medium border transition-all
              ${officeMode === id
                ? "bg-blue-600 text-white border-blue-600"
                : "text-slate-600 border-slate-200 hover:bg-slate-50 bg-white"
              }
              disabled:opacity-60 disabled:cursor-not-allowed
            `}
          >
            <Icon size={15} strokeWidth={2} />
            {label}
          </button>
        ))}

        <div className="w-px h-7 bg-slate-200 self-center" />

        {/* Modifiers — independent toggles */}
        {[
          { id: "late",  label: "Running Late",  icon: Clock,   active: lateActive,  toggle: toggleLate  },
          { id: "early", label: "Leaving Early", icon: LogOut,  active: earlyActive, toggle: toggleEarly },
        ].map(({ id, label, icon: Icon, active, toggle }) => (
          <button
            key={id}
            onClick={() => toggle(!active)}
            disabled={!!saving}
            className={`
              inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-[13.5px] font-medium border transition-all
              ${active
                ? "bg-blue-600 text-white border-blue-600"
                : "text-slate-600 border-slate-200 hover:bg-slate-50 bg-white"
              }
              disabled:opacity-60 disabled:cursor-not-allowed
            `}
          >
            <Icon size={15} strokeWidth={2} />
            {label}
          </button>
        ))}
      </div>

      {/* ETA pickers — appear when modifier is active, auto-save on change */}
      {(lateActive || earlyActive) && (
        <div className="mt-3 pt-3 border-t border-slate-100 flex flex-col gap-2">
          {lateActive && (
            <div className="flex items-center gap-3">
              <span className="text-[12.5px] text-slate-500 w-[108px] shrink-0">ETA in office:</span>
              <TimePicker value={lateEta} onChange={handleLateTime} disabled={saving === "late_arrive_eta"} />
              {saving === "late_arrive_eta" && <span className="text-[12px] text-slate-400">Saving…</span>}
            </div>
          )}
          {earlyActive && (
            <div className="flex items-center gap-3">
              <span className="text-[12.5px] text-slate-500 w-[108px] shrink-0">Leaving at:</span>
              <TimePicker value={earlyEta} onChange={handleEarlyTime} disabled={saving === "early_exit_eta"} />
              {saving === "early_exit_eta" && <span className="text-[12px] text-slate-400">Saving…</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Event strip widgets ───────────────────────────────────────────────────────

function EventWidget({ icon: Icon, iconBg, iconColor, title, subtitle, count, children }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 flex flex-col h-[260px]">
      <div className="flex items-center gap-3 mb-4 shrink-0">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${iconBg}`}>
          <Icon size={16} strokeWidth={2} className={iconColor} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[15px] font-semibold text-slate-700 truncate">{title}</span>
            {subtitle && <span className="text-[11px] text-slate-400 font-normal shrink-0">({subtitle})</span>}
          </div>
        </div>
        {count > 0 && (
          <span className="text-[12px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 shrink-0">
            {count}
          </span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto pr-0.5">
        {children}
      </div>
    </div>
  );
}

function BirthdaysWidget({ items }) {
  return (
    <EventWidget icon={Cake} iconBg="bg-violet-100" iconColor="text-violet-600" title="Birthdays" subtitle="next 30 days" count={items.length}>
      {items.length === 0 ? (
        <p className="text-[12.5px] text-slate-400">No birthdays in the next 30 days</p>
      ) : (
        <div className="space-y-2.5">
          {items.map(b => (
            <div key={b.user_id} className="flex items-center gap-2.5">
              <Avatar name={b.name} size="xs" />
              <p className="text-[13px] font-medium text-slate-700 flex-1 truncate">{b.name}</p>
              <span className="text-[12px] text-violet-600 font-medium shrink-0">{daysLabel(b.days_until)}</span>
            </div>
          ))}
        </div>
      )}
    </EventWidget>
  );
}

function AnniversariesWidget({ items }) {
  return (
    <EventWidget icon={Star} iconBg="bg-teal-100" iconColor="text-teal-600" title="Work Anniversaries" subtitle="next 30 days" count={items.length}>
      {items.length === 0 ? (
        <p className="text-[12.5px] text-slate-400">No anniversaries in the next 30 days</p>
      ) : (
        <div className="space-y-2.5">
          {items.map(a => (
            <div key={a.user_id} className="flex items-center gap-2.5">
              <Avatar name={a.name} size="xs" />
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-slate-700 truncate">{a.name}</p>
                <p className="text-[11px] text-slate-400">{a.years} yr{a.years !== 1 ? "s" : ""}</p>
              </div>
              <span className="text-[12px] text-teal-600 font-medium shrink-0">{daysLabel(a.days_until)}</span>
            </div>
          ))}
        </div>
      )}
    </EventWidget>
  );
}

function CatchupsWidget({ asEmployee, asManager, currentUserId }) {
  const seen = new Set();
  const merged = [...asEmployee, ...asManager].filter(c => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  }).sort((a, b) => new Date(a.date_and_time) - new Date(b.date_and_time));

  return (
    <EventWidget icon={Video} iconBg="bg-emerald-100" iconColor="text-emerald-600" title="Your Catchups" subtitle="next 30 days" count={merged.length}>
      {merged.length === 0 ? (
        <p className="text-[12.5px] text-slate-400">No catchups scheduled</p>
      ) : (
        <div className="space-y-2.5">
          {merged.map(c => {
            const isManager = c.manager_id === currentUserId || c.alternate_manager_id === currentUserId;
            const personName = isManager ? (c.employee?.name ?? "Team member") : (c.manager?.name ?? "Manager");
            return (
              <div key={c.id} className="flex items-start gap-2.5">
                <Avatar name={personName} size="xs" />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-slate-700 truncate">{personName}</p>
                  <p className="text-[11px] text-slate-400">{formatDateTime(c.date_and_time)}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </EventWidget>
  );
}

function TeamLeavesWidget({ today: todayItems, upcoming: upcomingItems }) {
  const total = todayItems.length + upcomingItems.length;
  return (
    <EventWidget icon={CalendarOff} iconBg="bg-amber-100" iconColor="text-amber-600" title="Team Leaves" count={total}>
      <div className="space-y-3">
        <div>
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Today</p>
          {todayItems.length === 0 ? (
            <p className="text-[12.5px] text-slate-400">Everyone's in today</p>
          ) : (
            <div className="space-y-2.5">
              {todayItems.map(l => (
                <div key={l.user_id} className="flex items-center gap-2.5">
                  <Avatar name={l.name} size="xs" />
                  <p className="text-[13px] font-medium text-slate-700 flex-1 truncate">{l.name}</p>
                  <Badge variant={l.leave_type === "sick" ? "red" : "yellow"}>
                    {l.leave_type === "sick" ? "Sick" : "Casual"}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="border-t border-slate-100 pt-3">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Upcoming · next 30 days</p>
          {upcomingItems.length === 0 ? (
            <p className="text-[12.5px] text-slate-400">No upcoming leaves</p>
          ) : (
            <div className="space-y-2.5">
              {upcomingItems.map((l, i) => (
                <div key={`${l.user_id}-${l.start_date}-${i}`} className="flex items-center gap-2.5">
                  <Avatar name={l.name} size="xs" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-slate-700 truncate">{l.name}</p>
                    <p className="text-[11px] text-slate-400">
                      {formatDateShort(l.start_date)}
                      {l.end_date !== l.start_date ? ` – ${formatDateShort(l.end_date)}` : ""}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </EventWidget>
  );
}

function NeedsYouItem({ iconBg, iconColor, icon: Icon, title, subtitle }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-slate-100 last:border-b-0 first:pt-0 last:pb-0">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${iconBg}`}>
        <Icon size={14} strokeWidth={2} className={iconColor} />
      </div>
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-slate-800 leading-snug">{title}</p>
        <p className="text-[11.5px] text-slate-400 mt-0.5">{subtitle}</p>
      </div>
    </div>
  );
}

function NeedsYouWidget({ pendingApprovalsCount, catchupsAsManager, catchupsAsEmployee }) {
  const allCatchupIds = new Set([...catchupsAsManager.map(c => c.id), ...catchupsAsEmployee.map(c => c.id)]);
  const totalCatchups = allCatchupIds.size;

  const items = [];

  if (pendingApprovalsCount > 0) {
    items.push({
      key: "approvals",
      iconBg: "bg-amber-100",
      iconColor: "text-amber-600",
      icon: ClipboardList,
      title: `${pendingApprovalsCount} leave request${pendingApprovalsCount !== 1 ? "s" : ""} pending`,
      subtitle: "Awaiting your approval",
    });
  }

  if (totalCatchups > 0) {
    items.push({
      key: "catchups",
      iconBg: "bg-emerald-100",
      iconColor: "text-emerald-600",
      icon: Video,
      title: `${totalCatchups} upcoming catchup${totalCatchups !== 1 ? "s" : ""}`,
      subtitle: "In the next 30 days",
    });
  }

  return (
    <EventWidget icon={Bell} iconBg="bg-slate-100" iconColor="text-slate-600" title="Needs You" count={items.length}>
      {items.length === 0 ? (
        <p className="text-[12.5px] text-slate-400">You're all caught up</p>
      ) : (
        <div>
          {items.map(item => (
            <NeedsYouItem key={item.key} {...item} />
          ))}
        </div>
      )}
    </EventWidget>
  );
}


function UpcomingHolidaysWidget({ holidays }) {
  const today = new Date().toISOString().split("T")[0];
  const cutoff = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const items = (holidays ?? []).filter(h => h.date >= today && h.date <= cutoff);

  return (
    <EventWidget icon={CalendarDays} iconBg="bg-rose-100" iconColor="text-rose-600" title="Upcoming Holidays" subtitle="next 30 days" count={items.length}>
      {items.length === 0 ? (
        <p className="text-[12.5px] text-slate-400">No holidays in the next 30 days</p>
      ) : (
        <div className="space-y-2.5">
          {items.map(h => {
            const d = new Date(h.date + "T00:00:00");
            const dayName = d.toLocaleString("en-US", { weekday: "short" });
            const formatted = d.toLocaleString("en-US", { month: "short", day: "numeric" });
            return (
              <div key={h.date} className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-rose-50 flex items-center justify-center shrink-0">
                  <span className="text-[11px] font-bold text-rose-500">{d.getDate()}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-slate-700 truncate">{h.name}</p>
                  <p className="text-[11px] text-slate-400">{dayName}, {formatted}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </EventWidget>
  );
}

// ─── Team status filter + cards ───────────────────────────────────────────────

const STATUS_FILTERS = [
  { id: "all",    label: "All"           },
  { id: "office", label: "In Office"     },
  { id: "wfh",    label: "WFH"           },
  { id: "late",   label: "Running Late"  },
  { id: "early",  label: "Leaving Early" },
  { id: "leave",  label: "On Leave"      },
  { id: "out",    label: "Out of Office" },
];

function statusBadgeProps(status) {
  switch (status) {
    case "office": return { variant: "green", label: "In Office" };
    case "wfh":    return { variant: "teal",  label: "WFH" };
    case "leave":  return { variant: "red",   label: "On Leave" };
    default:       return { variant: "slate", label: "Out of Office" };
  }
}

function TeamCard({ member, onLeaveIds, isMe }) {
  const status = getUserStatus(member, onLeaveIds);
  const { variant, label } = statusBadgeProps(status);
  const isOnLeave = status === "leave";
  return (
    <div
      className={`
        bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-4
        hover:shadow-md transition-shadow cursor-default
        ${isMe ? "ring-1 ring-blue-200 border-blue-200" : ""}
      `}
    >
      <Avatar name={member.name} size="md" />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-slate-900 text-[13.5px] leading-snug truncate">
          {member.name}{isMe && <span className="text-[11px] text-blue-400 font-normal ml-1">(you)</span>}
        </p>
        <p className="text-[12px] text-slate-500 mt-0.5 truncate">{member.role}</p>
        <div className="mt-2 flex flex-wrap gap-1">
          <Badge variant={variant}>{label}</Badge>
          {!isOnLeave && member.late_arrive_eta && (
            <Badge variant="yellow">Late · {member.late_arrive_eta.slice(0, 5)}</Badge>
          )}
          {!isOnLeave && member.early_exit_eta && (
            <Badge variant="orange">Early · {member.early_exit_eta.slice(0, 5)}</Badge>
          )}
        </div>
      </div>
    </div>
  );
}

function TeamSection({ users, summary }) {
  const [filter, setFilter] = useState("all");
  const { user: currentUser } = useUser();

  const onLeaveIds = useMemo(
    () => new Set((summary?.team_on_leave_today ?? []).map(l => l.user_id)),
    [summary]
  );

  const counts = useMemo(() => {
    const c = { all: users.length, office: 0, wfh: 0, late: 0, early: 0, leave: 0, out: 0 };
    for (const u of users) {
      if (onLeaveIds.has(u.id)) { c.leave++; continue; }
      if (u.office_status === "IN") c.office++;
      else if (u.office_status === "WFH") c.wfh++;
      else c.out++;
      if (u.late_arrive_eta)  c.late++;
      if (u.early_exit_eta) c.early++;
    }
    return c;
  }, [users, onLeaveIds]);

  const filtered = useMemo(() => {
    return users
      .filter(u => {
        if (filter === "all") return true;
        if (filter === "leave") return onLeaveIds.has(u.id);
        if (onLeaveIds.has(u.id)) return false;
        if (filter === "late")   return !!u.late_arrive_eta;
        if (filter === "early")  return !!u.early_exit_eta;
        if (filter === "office") return u.office_status === "IN";
        if (filter === "wfh")    return u.office_status === "WFH";
        if (filter === "out")    return u.office_status === "OUT";
        return false;
      })
      .sort((a, b) => (b.id === currentUser.id) - (a.id === currentUser.id));
  }, [users, filter, onLeaveIds, currentUser.id]);

  return (
    <div>
      <SectionLabel>Your Team</SectionLabel>

      <div className="flex flex-wrap gap-2 mb-5">
        {STATUS_FILTERS.map(({ id, label }) => {
          const active = filter === id;
          const n = counts[id] ?? 0;
          return (
            <button
              key={id}
              onClick={() => setFilter(id)}
              className={`
                inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12.5px] font-medium border transition-all
                ${active
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                }
              `}
            >
              {label}
              <span
                className={`text-[11px] font-semibold px-1.5 rounded-full ${
                  active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"
                }`}
              >
                {n}
              </span>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map(u => (
          <TeamCard key={u.id} member={u} onLeaveIds={onLeaveIds} isMe={u.id === currentUser.id} />
        ))}
        {filtered.length === 0 && (
          <p className="col-span-full text-[13px] text-slate-400 py-4">No team members match this filter.</p>
        )}
      </div>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { user, setUser: setContextUser } = useUser();
  const now = useLiveClock();

  const [summary, setSummary] = useState(null);
  const [allUsers, setAllUsers] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([getDashboardSummary(), getUsers(), getHolidays()])
      .then(([s, u, h]) => {
        if (cancelled) return;
        setSummary(s);
        setAllUsers(u);
        setHolidays(h);
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load dashboard. Please refresh.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // Sync status updates into allUsers so team cards reflect changes immediately
  function handleUserUpdate(updated) {
    setContextUser(updated);
    setAllUsers(prev => prev.map(u => u.id === updated.id ? updated : u));
  }

  if (loading) {
    return (
      <div className="flex h-full min-h-screen items-center justify-center bg-slate-100">
        <Spinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full min-h-screen items-center justify-center bg-slate-100">
        <p className="text-[13px] text-slate-500">{error}</p>
      </div>
    );
  }

  const firstName = user.name.split(" ")[0];

  return (
    <div className="p-8 bg-slate-100 min-h-screen">
      {/* ── Header ── */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">
          {getGreeting()}, {firstName}
        </h1>
        <p className="text-[13.5px] text-slate-500 mt-1">{formatLiveClock(now)}</p>
        <div className="mt-4">
          <StatusBar user={user} setUser={handleUserUpdate} />
        </div>
      </div>

      {/* ── Event strip ──
          Row 1 (lg): Birthdays | Anniversaries | Catchups
          Row 2 (lg): [gap] On Leave Today | Upcoming Leaves [gap]  ← centered via 6-col grid
      ── */}
      <div className="mt-8">
        <SectionLabel>What's happening</SectionLabel>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <NeedsYouWidget
            pendingApprovalsCount={summary.pending_approvals_count ?? 0}
            catchupsAsManager={summary.upcoming_catchups_as_manager ?? []}
            catchupsAsEmployee={summary.my_catchups_upcoming ?? []}
          />
          <BirthdaysWidget     items={summary.birthdays_upcoming    ?? []} />
          <AnniversariesWidget items={summary.anniversaries_upcoming ?? []} />
          <CatchupsWidget
            asEmployee={summary.my_catchups_upcoming ?? []}
            asManager={summary.upcoming_catchups_as_manager ?? []}
            currentUserId={user.id}
          />
          <TeamLeavesWidget
            today={summary.team_on_leave_today   ?? []}
            upcoming={summary.team_leaves_upcoming ?? []}
          />
          <UpcomingHolidaysWidget holidays={holidays} />
        </div>
      </div>

      {/* ── Team ── */}
      <div className="mt-8">
        <TeamSection users={allUsers} summary={summary} />
      </div>
    </div>
  );
}

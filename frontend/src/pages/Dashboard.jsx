import { useState, useRef, useEffect } from "react";
import { Clock, Calendar, CalendarDays, X } from "lucide-react";
import Avatar from "../components/ui/Avatar";
import { getGreeting, formatDateShort, getDefaultETA } from "../lib/utils";
import { updateStatus } from "../lib/api";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const CAL_START = 8;
const CAL_END = 18;

function formatHour(h) {
  const period = h >= 12 ? "PM" : "AM";
  let d = h % 12;
  if (d === 0) d = 12;
  return `${d}${period}`;
}

function getWeekStart() {
  const d = new Date();
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  d.setHours(0, 0, 0, 0);
  return d;
}

const TIME_OPTIONS = (() => {
  const opts = [];
  for (let h = 7; h <= 21; h++) {
    for (let m = 0; m < 60; m += 15) {
      const val = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      const period = h >= 12 ? "PM" : "AM";
      const dh = h > 12 ? h - 12 : h === 0 ? 12 : h;
      opts.push({ val, label: `${dh}:${String(m).padStart(2, "0")} ${period}` });
    }
  }
  return opts;
})();

function fmt12(val) {
  if (!val) return "";
  const [hStr, mStr] = val.slice(0, 5).split(":");
  const h = parseInt(hStr, 10);
  const period = h >= 12 ? "PM" : "AM";
  const dh = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${dh}:${mStr} ${period}`;
}

function TimeSelect({ value, onChange, accentClass }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const current = value?.slice(0, 5);

  useEffect(() => {
    if (!open) return;
    function onDown(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (open && ref.current) {
      const el = ref.current.querySelector("[data-selected]");
      el?.scrollIntoView({ block: "center" });
    }
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`text-xs font-bold ${accentClass} flex items-center gap-1 hover:opacity-70 transition-opacity`}
      >
        {fmt12(value)}
        <svg className="w-3 h-3 opacity-60" viewBox="0 0 16 16" fill="currentColor">
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1.5 bg-white border border-slate-200 rounded-xl shadow-xl z-50 w-28 max-h-52 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden py-1">
          {TIME_OPTIONS.map(o => (
            <button key={o.val} data-selected={o.val === current ? true : undefined}
              onClick={() => { onChange(o.val); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-xs transition-colors
                ${o.val === current ? "bg-blue-50 text-blue-600 font-bold" : "text-slate-600 hover:bg-slate-50 font-medium"}`}>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function getStatusBadges(user) {
  const badges = [];
  if (user.in_office) {
    badges.push({ label: "In Office", color: "bg-emerald-100 text-emerald-700" });
  } else {
    badges.push({ label: "Out of Office", color: "bg-slate-100 text-slate-600" });
  }
  if (user.wfh) badges.push({ label: "WFH", color: "bg-teal-100 text-teal-700" });
  if (user.late_arrive_eta) badges.push({ label: `Running Late · ${user.late_arrive_eta.slice(0,5)}`, color: "bg-amber-100 text-amber-700" });
  if (user.early_exit_eta) badges.push({ label: `Early Exit · ${user.early_exit_eta.slice(0,5)}`, color: "bg-orange-100 text-orange-700" });
  return badges;
}

export default function Dashboard({ currentUser, users, teamLeavesData, onUserUpdate }) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [calendarFor, setCalendarFor] = useState(null);

  const totalHours = CAL_END - CAL_START;
  const hourMarks = Array.from({ length: totalHours + 1 }, (_, i) => CAL_START + i);

  async function toggleInOffice() {
    const updated = { ...currentUser, in_office: !currentUser.in_office };
    onUserUpdate(updated);
    try { const r = await updateStatus({ in_office: !currentUser.in_office }); onUserUpdate(r); }
    catch { onUserUpdate(currentUser); }
  }

  async function toggleWFH() {
    const updated = { ...currentUser, wfh: !currentUser.wfh };
    onUserUpdate(updated);
    try { const r = await updateStatus({ wfh: !currentUser.wfh }); onUserUpdate(r); }
    catch { onUserUpdate(currentUser); }
  }

  async function toggleLate() {
    const eta = currentUser.late_arrive_eta ? null : getDefaultETA();
    onUserUpdate({ ...currentUser, late_arrive_eta: eta });
    try { const r = await updateStatus({ late_arrive_eta: eta }); onUserUpdate(r); }
    catch { onUserUpdate(currentUser); }
  }

  async function toggleEarly() {
    const eta = currentUser.early_exit_eta ? null : getDefaultETA();
    onUserUpdate({ ...currentUser, early_exit_eta: eta });
    try { const r = await updateStatus({ early_exit_eta: eta }); onUserUpdate(r); }
    catch { onUserUpdate(currentUser); }
  }

  async function updateETA(key, val) {
    onUserUpdate({ ...currentUser, [key]: val });
    try { const r = await updateStatus({ [key]: val }); onUserUpdate(r); }
    catch { onUserUpdate(currentUser); }
  }

  const onLeaveTodayIds = new Set(teamLeavesData.current.map(l => l.user?.id).filter(Boolean));
  const wfhUsers = users.filter(u => u.wfh);

  const filtered = users
    .filter(u => {
      if (statusFilter === "in-office") return u.in_office;
      if (statusFilter === "out") return !u.in_office;
      if (statusFilter === "wfh") return u.wfh;
      if (statusFilter === "late") return !!u.late_arrive_eta;
      if (statusFilter === "early") return !!u.early_exit_eta;
      if (statusFilter === "on-leave") return onLeaveTodayIds.has(u.id);
      return true;
    })
    .sort((a, b) => (b.id === currentUser.id) - (a.id === currentUser.id));

  const filters = [
    { id: "all",       label: "All",          count: users.length,                                          on: "bg-slate-800 text-white border-slate-800",    off: "bg-white text-slate-500 border-slate-200 hover:border-slate-300" },
    { id: "in-office", label: "In Office",     count: users.filter(u => u.in_office).length,                 on: "bg-emerald-500 text-white border-emerald-500", off: "bg-white text-slate-500 border-slate-200 hover:border-emerald-300 hover:text-emerald-600" },
    { id: "wfh",       label: "WFH",           count: wfhUsers.length,                                       on: "bg-teal-500 text-white border-teal-500",      off: "bg-white text-slate-500 border-slate-200 hover:border-teal-300 hover:text-teal-600" },
    { id: "out",       label: "Out",           count: users.filter(u => !u.in_office).length,                 on: "bg-slate-600 text-white border-slate-600",    off: "bg-white text-slate-500 border-slate-200 hover:border-slate-400" },
    { id: "late",      label: "Running Late",  count: users.filter(u => !!u.late_arrive_eta).length,         on: "bg-amber-500 text-white border-amber-500",    off: "bg-white text-slate-500 border-slate-200 hover:border-amber-300 hover:text-amber-600" },
    { id: "early",     label: "Early Exit",    count: users.filter(u => !!u.early_exit_eta).length,          on: "bg-orange-500 text-white border-orange-500",  off: "bg-white text-slate-500 border-slate-200 hover:border-orange-300 hover:text-orange-600" },
    { id: "on-leave",  label: "On Leave",      count: onLeaveTodayIds.size,                                  on: "bg-violet-500 text-white border-violet-500",  off: "bg-white text-slate-500 border-slate-200 hover:border-violet-300 hover:text-violet-600" },
  ];

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Greeting */}
      <div className="mb-7">
        <h1 className="text-2xl font-semibold text-slate-800">
          {getGreeting()}, {currentUser.name.split(" ")[0]}.
        </h1>
        <p className="text-sm mt-1 text-slate-400">
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
        </p>
      </div>

      {/* Status */}
      <div className="bg-white rounded-2xl border border-slate-100 p-5 mb-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide mb-3 text-slate-400">Your status</p>
        <div className="flex flex-wrap gap-2">
          {[
            { label: "In Office",       active: currentUser.in_office,  onClick: toggleInOffice },
            { label: "Work From Home",  active: currentUser.wfh,        onClick: toggleWFH     },
            { label: "Out of Office",   active: !currentUser.in_office, onClick: toggleInOffice },
            { label: "Running Late",    active: !!currentUser.late_arrive_eta,              onClick: toggleLate    },
            { label: "Early Exit",      active: !!currentUser.early_exit_eta,               onClick: toggleEarly   },
          ].map(btn => (
            <button
              key={btn.label}
              onClick={btn.onClick}
              className={`px-4 py-2 rounded-xl text-sm font-medium border-2 transition-all ${btn.active ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"}`}
            >
              {btn.label}
            </button>
          ))}
        </div>

        {(currentUser.late_arrive_eta || currentUser.early_exit_eta) && (
          <div className="mt-3.5 flex flex-wrap gap-2.5">
            {currentUser.late_arrive_eta && (
              <div className="inline-flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
                <Clock className="w-3.5 h-3.5 text-amber-500" />
                <span className="text-xs font-medium text-amber-700">ETA in office</span>
                <TimeSelect value={currentUser.late_arrive_eta} onChange={v => updateETA("late_arrive_eta", v)} accentClass="text-amber-700" />
              </div>
            )}
            {currentUser.early_exit_eta && (
              <div className="inline-flex items-center gap-2 bg-orange-50 border border-orange-200 rounded-lg px-3 py-1.5">
                <Clock className="w-3.5 h-3.5 text-orange-500" />
                <span className="text-xs font-medium text-orange-700">Leaving at</span>
                <TimeSelect value={currentUser.early_exit_eta} onChange={v => updateETA("early_exit_eta", v)} accentClass="text-orange-700" />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Team */}
      <div className="mb-6">
        <h2 className="text-base font-semibold text-slate-800 mb-3">Team</h2>
        <div className="flex flex-wrap gap-2 mb-4">
          {filters.map(btn => {
            const active = statusFilter === btn.id;
            return (
              <button key={btn.id} onClick={() => setStatusFilter(btn.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${active ? btn.on : btn.off}`}>
                {btn.label}
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${active ? "bg-white/25" : "bg-slate-100 text-slate-400"}`}>
                  {btn.count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map(member => {
            const badges = getStatusBadges(member);
            const isMe = member.id === currentUser.id;
            const isOnLeaveToday = onLeaveTodayIds.has(member.id);
            const onLeaveLeave = isOnLeaveToday
              ? teamLeavesData.current.find(l => l.user?.id === member.id)
              : null;
            return (
              <div key={member.id}
                className={`bg-white rounded-xl border p-4 hover:shadow-md transition-all ${isMe ? "border-blue-200 ring-1 ring-blue-100" : "border-slate-100"}`}>
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <Avatar name={member.name} size="md" />
                    <div>
                      <p className="text-sm font-semibold leading-tight text-slate-800">
                        {member.name} {isMe && <span className="text-[10px] text-blue-400 font-normal">(you)</span>}
                      </p>
                      <p className="text-[11px] text-slate-400">{member.role}</p>
                    </div>
                  </div>
                  <button onClick={() => setCalendarFor(member)}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors">
                    <Calendar className="w-3 h-3" /> Calendar
                  </button>
                </div>

                <div className="flex flex-wrap gap-1 mb-3 min-h-[20px]">
                  {isOnLeaveToday
                    ? <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">On Leave</span>
                    : badges.length === 0
                      ? <span className="text-[11px] text-slate-300">No status set</span>
                      : badges.map((b, i) => (
                          <span key={i} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${b.color}`}>{b.label}</span>
                        ))
                  }
                </div>

                {onLeaveLeave && (
                  <div className="mb-2 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-50">
                    <CalendarDays className="w-3 h-3 flex-shrink-0 text-slate-400" />
                    <span className="text-[11px] text-slate-500">
                      On leave{onLeaveLeave.end_date !== onLeaveLeave.start_date ? ` until ${formatDateShort(onLeaveLeave.end_date)}` : " today"}
                    </span>
                  </div>
                )}

              </div>
            );
          })}
        </div>
      </div>

      {/* On Leave Today */}
      {teamLeavesData.current.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm mb-4">
          <h2 className="text-sm font-semibold text-slate-800 mb-3">
            On Leave Today <span className="text-xs font-normal text-slate-400">· {teamLeavesData.current.length}</span>
          </h2>
          <div className="space-y-1">
            {teamLeavesData.current.map(l => (
              <div key={l.id} className="flex items-center gap-3 py-2 border-b border-slate-50 last:border-0">
                <Avatar name={l.user?.name || "?"} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800">{l.user?.name}</p>
                  <p className="text-xs text-slate-400">
                    {l.leave_type} · {formatDateShort(l.start_date)}
                    {l.start_date !== l.end_date ? " – " + formatDateShort(l.end_date) : ""}
                  </p>
                </div>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-50 text-violet-600">On Leave</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Working From Home */}
      {wfhUsers.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm mb-4">
          <h2 className="text-sm font-semibold text-slate-800 mb-3">
            Working From Home <span className="text-xs font-normal text-slate-400">· {wfhUsers.length}</span>
          </h2>
          <div className="space-y-1">
            {wfhUsers.map(u => (
              <div key={u.id} className="flex items-center gap-3 py-2 border-b border-slate-50 last:border-0">
                <Avatar name={u.name} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800">{u.name}</p>
                  <p className="text-xs text-slate-400">{u.role}</p>
                </div>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-teal-50 text-teal-600">WFH</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upcoming Leaves */}
      {teamLeavesData.upcoming.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-800 mb-3">
            Upcoming Leaves <span className="text-xs font-normal text-slate-400">· next 2 weeks</span>
          </h2>
          <div className="space-y-1">
            {teamLeavesData.upcoming.map(l => (
              <div key={l.id} className="flex items-center gap-3 py-2 border-b border-slate-50 last:border-0">
                <Avatar name={l.user?.name || "?"} size="sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800">{l.user?.name}</p>
                  <p className="text-xs text-slate-400">
                    {l.leave_type} · {formatDateShort(l.start_date)}
                    {l.start_date !== l.end_date ? " – " + formatDateShort(l.end_date) : ""}
                  </p>
                </div>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600">Approved</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Calendar modal */}
      {calendarFor && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={e => e.target === e.currentTarget && setCalendarFor(null)}>
          <div className="bg-white rounded-2xl w-full max-w-2xl shadow-xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 flex-shrink-0">
              <div className="flex items-center gap-3">
                <Avatar name={calendarFor.name} size="md" />
                <div>
                  <h3 className="font-semibold text-sm text-slate-800">{calendarFor.name}'s calendar</h3>
                  <p className="text-xs text-slate-400">This week</p>
                </div>
              </div>
              <button onClick={() => setCalendarFor(null)} className="text-slate-400 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto">
              <p className="text-[11px] mb-4 text-slate-400">Showing busy / free time only — meeting details aren't shown here.</p>
              <div className="flex">
                <div className="w-12 flex-shrink-0">
                  <div className="h-7 mb-2" />
                  <div className="relative" style={{ height: totalHours * 40 }}>
                    {hourMarks.map(h => (
                      <div key={h} className="absolute right-2 -translate-y-1/2 text-[10px] text-slate-400"
                        style={{ top: ((h - CAL_START) * (40 * totalHours)) / totalHours }}>
                        {formatHour(h)}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex-1 grid grid-cols-5 gap-2">
                  {DAY_LABELS.map((label, dayIdx) => {
                    const ws = getWeekStart();
                    ws.setDate(ws.getDate() + dayIdx);
                    const isToday = ws.toDateString() === new Date().toDateString();
                    return (
                      <div key={label} className="min-w-0">
                        <div className={`h-7 mb-2 text-center rounded-lg flex items-center justify-center ${isToday ? "bg-blue-50" : ""}`}>
                          <p className={`text-[10px] font-bold uppercase tracking-wide ${isToday ? "text-blue-600" : "text-slate-400"}`}>{label}</p>
                        </div>
                        <div className="relative rounded-lg border border-slate-200 bg-slate-50/60" style={{ height: totalHours * 40 }}>
                          {hourMarks.map(h => (
                            <div key={h} className="absolute left-0 right-0 border-t border-slate-100"
                              style={{ top: (h - CAL_START) * 40 }} />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

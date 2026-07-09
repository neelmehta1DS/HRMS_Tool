import { useState, useEffect, useMemo, useRef } from "react";
import {
  Home,
  Clock,
  LogOut,
  Cake,
  Star,
  UserX,
  CalendarOff,
  CalendarDays,
  Video,
  ClipboardList,
  Users,
  Bell,
  Filter,
  Building2,
  MapPin,
  ArrowUpRight,
  Check,
  Lock,
} from "lucide-react";
import Avatar from "../components/ui/Avatar";
import Badge from "../components/ui/Badge";
import Spinner from "../components/ui/Spinner";
import TeamCalendar from "../components/dashboard/TeamCalendar";
import ProfileSidebar from "../components/dashboard/ProfileSidebar";
import { useUser } from "../contexts/UserContext";
import {
  getGreeting,
  formatDateShort,
  formatDateTime,
  getUserStatus,
  statusBadgeProps,
  LEAVE_TYPE_META,
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


// ─── Time helpers ─────────────────────────────────────────────────────────────

function genTimes(startH, endH) {
  const times = [];
  for (let h = startH; h <= endH; h++) {
    for (let m = 0; m < 60; m += 15) {
      if (h === endH && m > 0) break;
      times.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return times;
}

function fmt12(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const ap = h < 12 ? "AM" : "PM";
  const hh = h % 12 || 12;
  return `${hh}:${String(m).padStart(2, "0")} ${ap}`;
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

const LATE_TIMES  = genTimes(8, 12);
const EARLY_TIMES = genTimes(13, 19);
const OUT_TIMES   = genTimes(9, 19);
const LATE_QUICK  = ["09:30", "10:00", "10:30", "11:00"];
const EARLY_QUICK = ["15:00", "16:00", "16:30", "17:00"];

function TimePopover({ title, times, quickTimes, onPick }) {
  return (
    <div className="absolute top-full left-0 mt-2 z-50 w-60 bg-white border border-slate-200 rounded-xl shadow-xl p-4">
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-3">{title}</p>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {quickTimes.map(t => (
          <button
            key={t}
            onMouseDown={e => { e.stopPropagation(); onPick(t); }}
            className="border border-slate-200 bg-white px-2.5 py-1.5 rounded-lg text-[12.5px] hover:border-amber-400 hover:bg-amber-50 hover:text-amber-700 transition-all"
          >
            {fmt12(t)}
          </button>
        ))}
      </div>
      <div className="max-h-40 overflow-y-auto border border-slate-200 rounded-lg">
        {times.map(t => (
          <div
            key={t}
            onMouseDown={e => { e.stopPropagation(); onPick(t); }}
            className="px-3 py-2 text-[13px] cursor-pointer hover:bg-amber-50 hover:text-amber-700 border-b border-slate-100 last:border-b-0"
          >
            {fmt12(t)}
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusBar({ user, setUser, isOnLeave }) {
  const [mode, setMode] = useState(() => {
    if (user.office_status === "IN")  return "office";
    if (user.office_status === "WFH") return "wfh";
    return null;
  });
  const [lateTime,  setLateTime]  = useState(() => user.late_arrive_eta ? user.late_arrive_eta.slice(0, 5) : null);
  const [earlyTime, setEarlyTime] = useState(() => user.early_exit_eta  ? user.early_exit_eta.slice(0, 5)  : null);
  const [stepOut,   setStepOut]   = useState(() =>
    user.stepping_out_from && user.stepping_out_to
      ? { from: user.stepping_out_from.slice(0, 5), to: user.stepping_out_to.slice(0, 5) }
      : null
  );
  const [outFrom,   setOutFrom]   = useState("12:00");
  const [outTo,     setOutTo]     = useState("13:00");
  const [openPop,   setOpenPop]   = useState(null);
  const [isEditing, setIsEditing] = useState(() => !user.office_status || user.office_status === "OUT");
  const [saving,    setSaving]    = useState(false);
  const popRef = useRef(null);

  useEffect(() => {
    if (!openPop) return;
    function handler(e) {
      if (popRef.current && !popRef.current.contains(e.target)) setOpenPop(null);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openPop]);

  async function saveStatus() {
    if (!mode || saving) return;
    setSaving(true);
    try {
      const updated = await updateStatus({
        office_status:      mode === "office" ? "IN" : "WFH",
        late_arrive_eta:    lateTime  || null,
        early_exit_eta:     earlyTime || null,
        stepping_out_from:  stepOut?.from || null,
        stepping_out_to:    stepOut?.to   || null,
      });
      setUser(updated);
      setIsEditing(false);
    } finally {
      setSaving(false);
    }
  }

  // On Leave locked state
  if (isOnLeave) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[13px] font-semibold bg-[#efeaff] text-[#7c5cf0]">
            <MapPin size={14} />On Leave
          </span>
          <span className="text-[13.5px] text-slate-500">today</span>
        </div>
        <div className="mt-3 inline-flex items-center gap-2 text-[12.5px] text-[#7c5cf0] bg-[#efeaff] border border-[#cfc2f7] rounded-lg px-3 py-2">
          <Lock size={13} />
          Auto-set from an approved leave — you can&apos;t change this here.
        </div>
      </div>
    );
  }

  // Summary view
  if (!isEditing) {
    const cfgMap = {
      office: { label: "In Office",           Icon: Building2, bg: "bg-[#e2f5ec]", fg: "text-[#0f9d6e]" },
      wfh:    { label: "Working from Home",   Icon: Home,      bg: "bg-[#e7eeff]", fg: "text-[#2f6bff]" },
    };
    const cfg = cfgMap[mode] ?? cfgMap.office;
    const details = ["today"];
    if (lateTime)  details.push(`starting ${fmt12(lateTime)}`);
    if (earlyTime) details.push(`signing off ${fmt12(earlyTime)}`);
    if (stepOut)   details.push(`out ${fmt12(stepOut.from)} – ${fmt12(stepOut.to)}`);

    return (
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[13px] font-semibold ${cfg.bg} ${cfg.fg}`}>
              <cfg.Icon size={14} />{cfg.label}
            </span>
            <span className="text-[13.5px] text-slate-500">
              {details.map((d, i) => (
                <span key={i}>
                  {i > 0 && <span className="mx-1.5 text-slate-300">·</span>}
                  {i > 0 ? <b className="font-semibold text-slate-700">{d}</b> : d}
                </span>
              ))}
            </span>
          </div>
          <button
            onClick={() => setIsEditing(true)}
            className="border border-slate-200 bg-white text-[13px] font-semibold text-slate-600 px-4 py-2 rounded-lg hover:border-blue-400 hover:text-blue-600 transition-colors shrink-0"
          >
            Edit
          </button>
        </div>
      </div>
    );
  }

  const statusUnset = !user.office_status || user.office_status === "OUT";

  // Setter view
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      {/* Prompt */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <span className={`w-2 h-2 rounded-full shrink-0 ${statusUnset ? "bg-red-500 ring-4 ring-red-100 animate-pulse" : "bg-amber-400 ring-4 ring-amber-100"}`} />
        <span className="text-[15px] font-semibold text-slate-800">Set your status for today</span>
        {statusUnset && <span className="text-[14px] font-semibold text-red-500 bg-red-50 border border-red-200 px-4 py-1.5 rounded-full">Pending</span>}
        {!statusUnset && <span className="text-[12.5px] text-slate-400">— this is how your team sees you</span>}
      </div>

      {/* Segmented control */}
      <div className="inline-flex bg-[#eef1f6] border border-slate-200 rounded-xl p-1 gap-1">
        {[
          { id: "office", label: "In Office",         Icon: Building2 },
          { id: "wfh",    label: "Working from Home",  Icon: Home      },
        ].map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setMode(id)}
            className={`
              inline-flex items-center gap-2 px-4 py-2.5 rounded-[9px] text-[14px] transition-all
              ${mode === id
                ? `bg-white shadow-sm font-semibold ${id === "office" ? "text-[#0f9d6e]" : "text-[#2f6bff]"}`
                : "text-slate-600 font-medium hover:bg-slate-200"
              }
            `}
          >
            <Icon size={16} strokeWidth={2} />
            {label}
          </button>
        ))}
      </div>

      {/* Timing chips */}
      {mode && (
        <div className="mt-4 relative" ref={popRef}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-slate-400 mr-1">Add timing:</span>

            {/* Late start */}
            {lateTime ? (
              <span className="inline-flex items-center gap-1.5 border border-amber-400 bg-amber-50 text-amber-700 px-3 py-1.5 rounded-full text-[13px] font-semibold">
                <Check size={12} />from {fmt12(lateTime)}
                <button onMouseDown={e => { e.stopPropagation(); setLateTime(null); setOpenPop(null); }} className="opacity-60 hover:opacity-100 font-bold leading-none">×</button>
              </span>
            ) : (
              <button onClick={() => setOpenPop(openPop === "late" ? null : "late")} className="inline-flex items-center gap-1.5 border border-dashed border-slate-300 bg-white text-slate-600 px-3 py-1.5 rounded-full text-[13px] font-medium hover:border-amber-400 hover:text-amber-600 hover:bg-amber-50 transition-all">
                <Clock size={13} />Late start
              </button>
            )}

            {/* Early finish */}
            {earlyTime ? (
              <span className="inline-flex items-center gap-1.5 border border-amber-400 bg-amber-50 text-amber-700 px-3 py-1.5 rounded-full text-[13px] font-semibold">
                <Check size={12} />until {fmt12(earlyTime)}
                <button onMouseDown={e => { e.stopPropagation(); setEarlyTime(null); setOpenPop(null); }} className="opacity-60 hover:opacity-100 font-bold leading-none">×</button>
              </span>
            ) : (
              <button onClick={() => setOpenPop(openPop === "early" ? null : "early")} className="inline-flex items-center gap-1.5 border border-dashed border-slate-300 bg-white text-slate-600 px-3 py-1.5 rounded-full text-[13px] font-medium hover:border-amber-400 hover:text-amber-600 hover:bg-amber-50 transition-all">
                <ArrowUpRight size={13} />Early finish
              </button>
            )}

            {/* Stepping out */}
            {stepOut ? (
              <span className="inline-flex items-center gap-1.5 border border-amber-400 bg-amber-50 text-amber-700 px-3 py-1.5 rounded-full text-[13px] font-semibold">
                <Check size={12} />out {fmt12(stepOut.from)} – {fmt12(stepOut.to)}
                <button onMouseDown={e => { e.stopPropagation(); setStepOut(null); setOpenPop(null); }} className="opacity-60 hover:opacity-100 font-bold leading-none">×</button>
              </span>
            ) : (
              <button onClick={() => setOpenPop(openPop === "out" ? null : "out")} className="inline-flex items-center gap-1.5 border border-dashed border-slate-300 bg-white text-slate-600 px-3 py-1.5 rounded-full text-[13px] font-medium hover:border-amber-400 hover:text-amber-600 hover:bg-amber-50 transition-all">
                <LogOut size={13} />Stepping out
              </button>
            )}
          </div>

          {/* Popovers */}
          {openPop === "late" && (
            <TimePopover
              title="Starting from"
              times={LATE_TIMES}
              quickTimes={LATE_QUICK}
              onPick={t => { setLateTime(t); setOpenPop(null); }}
            />
          )}
          {openPop === "early" && (
            <TimePopover
              title="Signing off at"
              times={EARLY_TIMES}
              quickTimes={EARLY_QUICK}
              onPick={t => { setEarlyTime(t); setOpenPop(null); }}
            />
          )}
          {openPop === "out" && (
            <div className="absolute top-full left-0 mt-2 z-50 w-64 bg-white border border-slate-200 rounded-xl shadow-xl p-4">
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-3">Stepping out between</p>
              <div className="flex items-center gap-2 mb-3">
                <select value={outFrom} onChange={e => setOutFrom(e.target.value)} className="flex-1 border border-slate-200 rounded-lg p-2 text-[13px]">
                  {OUT_TIMES.map(t => <option key={t} value={t}>{fmt12(t)}</option>)}
                </select>
                <span className="text-slate-400 text-[13px]">–</span>
                <select value={outTo} onChange={e => setOutTo(e.target.value)} className="flex-1 border border-slate-200 rounded-lg p-2 text-[13px]">
                  {OUT_TIMES.map(t => <option key={t} value={t}>{fmt12(t)}</option>)}
                </select>
              </div>
              <button
                onMouseDown={e => { e.stopPropagation(); setStepOut({ from: outFrom, to: outTo }); setOpenPop(null); }}
                className="w-full bg-slate-900 text-white text-[13px] font-semibold py-2 rounded-lg hover:bg-slate-800 transition-colors"
              >
                Apply
              </button>
            </div>
          )}
        </div>
      )}

      {/* Save button */}
      <div className="mt-5">
        <button
          onClick={saveStatus}
          disabled={!mode || saving}
          className="inline-flex items-center gap-2 bg-blue-600 text-white px-5 py-3 rounded-xl text-[14px] font-semibold shadow-md shadow-blue-200 hover:bg-blue-700 disabled:bg-slate-200 disabled:shadow-none disabled:text-slate-400 disabled:cursor-not-allowed transition-all"
        >
          {saving ? "Saving…" : "Set my status"}
        </button>
      </div>
    </div>
  );
}

// ─── Event strip widgets ───────────────────────────────────────────────────────

function EventWidget({ icon: Icon, iconBg, iconColor, title, subtitle, count, children }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 flex flex-col h-[300px]">
      <div className="flex items-center gap-3 mb-4 shrink-0">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${iconBg}`}>
          <Icon size={17} strokeWidth={2} className={iconColor} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[16px] font-semibold text-slate-700 truncate">{title}</span>
            {subtitle && <span className="text-[12px] text-slate-400 font-normal shrink-0">({subtitle})</span>}
          </div>
        </div>
        {count != null && (
          <span className="text-[13px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 shrink-0">
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
        <p className="text-[13.5px] text-slate-400">No birthdays in the next 30 days</p>
      ) : (
        <div className="space-y-2.5">
          {items.map(b => (
            <div key={b.user_id} className="flex items-center gap-2.5">
              <Avatar name={b.name} size="xs" />
              <p className="text-[14px] font-medium text-slate-700 flex-1 truncate">{b.name}</p>
              <span className="text-[13px] text-violet-600 font-medium shrink-0">{daysLabel(b.days_until)}</span>
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
        <p className="text-[13.5px] text-slate-400">No anniversaries in the next 30 days</p>
      ) : (
        <div className="space-y-2.5">
          {items.map(a => (
            <div key={a.user_id} className="flex items-center gap-2.5">
              <Avatar name={a.name} size="xs" />
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-medium text-slate-700 truncate">{a.name}</p>
                <p className="text-[12px] text-slate-400">{a.years} yr{a.years !== 1 ? "s" : ""}</p>
              </div>
              <span className="text-[13px] text-teal-600 font-medium shrink-0">{daysLabel(a.days_until)}</span>
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
        <p className="text-[13.5px] text-slate-400">No catchups scheduled</p>
      ) : (
        <div className="space-y-2.5">
          {merged.map(c => {
            const isManager = c.manager_id === currentUserId || c.alternate_manager_id === currentUserId;
            const personName = isManager ? (c.employee?.name ?? "Team member") : (c.manager?.name ?? "Manager");
            return (
              <div key={c.id} className="flex items-start gap-2.5">
                <Avatar name={personName} size="xs" />
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-medium text-slate-700 truncate">{personName}</p>
                  <p className="text-[12px] text-slate-400">{formatDateTime(c.date_and_time)}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </EventWidget>
  );
}

function OnLeaveTodayWidget({ items }) {
  return (
    <EventWidget icon={UserX} iconBg="bg-amber-100" iconColor="text-amber-600" title="On Leave Today" count={items.length}>
      {items.length === 0 ? (
        <p className="text-[13.5px] text-slate-400">Everyone's in today</p>
      ) : (
        <div className="space-y-2.5">
          {items.map(l => (
            <div key={l.user_id} className="flex items-center gap-2.5">
              <Avatar name={l.name} size="xs" />
              <p className="text-[14px] font-medium text-slate-700 flex-1 truncate">{l.name}</p>
              <Badge variant="yellow">
                {LEAVE_TYPE_META[l.leave_type]?.label ?? l.leave_type}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </EventWidget>
  );
}

function UpcomingLeavesWidget({ items }) {
  return (
    <EventWidget icon={CalendarOff} iconBg="bg-orange-100" iconColor="text-orange-600" title="Upcoming Leaves" subtitle="next 30 days" count={items.length}>
      {items.length === 0 ? (
        <p className="text-[13.5px] text-slate-400">No upcoming leaves</p>
      ) : (
        <div className="space-y-2.5">
          {items.map((l, i) => (
            <div key={`${l.user_id}-${l.start_date}-${i}`} className="flex items-center gap-2.5">
              <Avatar name={l.name} size="xs" />
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-medium text-slate-700 truncate">{l.name}</p>
                <p className="text-[12px] text-slate-400">
                  {formatDateShort(l.start_date)}
                  {l.end_date !== l.start_date ? ` – ${formatDateShort(l.end_date)}` : ""}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </EventWidget>
  );
}

function NeedsYouItem({ iconBg, iconColor, icon: Icon, title, subtitle }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-slate-100 last:border-b-0 first:pt-0 last:pb-0">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${iconBg}`}>
        <Icon size={15} strokeWidth={2} className={iconColor} />
      </div>
      <div className="min-w-0">
        <p className="text-[14px] font-semibold text-slate-800 leading-snug">{title}</p>
        <p className="text-[12.5px] text-slate-400 mt-0.5">{subtitle}</p>
      </div>
    </div>
  );
}

function NeedsYouWidget({ pendingApprovalsCount, catchupsAsManager, catchupsAsEmployee, statusNotSet }) {
  const allCatchupIds = new Set([...catchupsAsManager.map(c => c.id), ...catchupsAsEmployee.map(c => c.id)]);
  const totalCatchups = allCatchupIds.size;

  const items = [];

  if (statusNotSet) {
    items.push({
      key: "status",
      iconBg: "bg-red-100",
      iconColor: "text-red-600",
      icon: MapPin,
      title: "Set your status for today",
      subtitle: "Your team doesn't know where you're working from",
    });
  }

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
        <p className="text-[13.5px] text-slate-400">You're all caught up</p>
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
  const currentYear = new Date().getFullYear().toString();
  const items = (holidays ?? []).filter(h => h.date >= today && h.date.startsWith(currentYear));

  return (
    <EventWidget icon={CalendarDays} iconBg="bg-red-100" iconColor="text-red-500" title="Upcoming Holidays" count={items.length}>
      {items.length === 0 ? (
        <p className="text-[13.5px] text-slate-400">No more holidays this year</p>
      ) : (
        <div className="space-y-2.5">
          {items.map(h => {
            const d = new Date(h.date + "T00:00:00");
            const dayName = d.toLocaleString("en-US", { weekday: "long" });
            const monthShort = d.toLocaleString("en-US", { month: "short" }).toUpperCase();
            return (
              <div key={h.date} className="flex items-center gap-3">
                <div className="w-[35px] shrink-0 rounded-[7px] overflow-hidden border border-slate-200 shadow-sm bg-white">
                  <div className="bg-red-500 text-white text-[8px] font-bold tracking-wide text-center leading-none py-[3.5px]">
                    {monthShort}
                  </div>
                  <div className="text-[14.5px] font-bold text-slate-800 text-center leading-none py-[3.5px]">
                    {d.getDate()}
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] font-medium text-slate-700 truncate">{h.name}</p>
                  <p className="text-[12px] text-slate-400">{dayName}</p>
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
  { id: "all",    label: "All" },
  { id: "office", label: "In Office",    Icon: Building2,    iconColor: "text-[#0f9d6e]" },
  { id: "wfh",    label: "WFH",          Icon: Home,         iconColor: "text-[#2f6bff]" },
  { id: "leave",  label: "On Leave",     Icon: MapPin,       iconColor: "text-[#7c5cf0]" },
  { id: "sep" },
  { id: "late",   label: "Late start",   Icon: Clock,        iconColor: "text-[#d97706]" },
  { id: "early",  label: "Early finish", Icon: ArrowUpRight, iconColor: "text-[#d97706]" },
];

function TeamCard({ member, onLeaveIds, isMe, onSelect }) {
  const status = getUserStatus(member, onLeaveIds);
  const { variant, label } = statusBadgeProps(status);
  const isOnLeave = status === "leave";
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(member)}
      onKeyDown={e => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(member);
        }
      }}
      className={`
        bg-white rounded-xl border border-slate-200 p-5 flex items-center gap-4
        hover:shadow-md transition-shadow cursor-pointer text-left
        focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400
        ${isMe ? "ring-1 ring-blue-200 border-blue-200" : ""}
      `}
    >
      <Avatar name={member.name} size="md" />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-slate-900 text-[14.5px] leading-snug truncate">
          {member.name}{isMe && <span className="text-[12px] text-blue-400 font-normal ml-1">(you)</span>}
        </p>
        <p className="text-[13px] text-slate-500 mt-0.5 truncate">{member.role}</p>
        <div className="mt-2 flex flex-wrap gap-1">
          <Badge variant={variant}>{label}</Badge>
          {!isOnLeave && member.late_arrive_eta && (
            <Badge variant="yellow">Late · {member.late_arrive_eta.slice(0, 5)}</Badge>
          )}
          {!isOnLeave && member.early_exit_eta && (
            <Badge variant="orange">Early · {member.early_exit_eta.slice(0, 5)}</Badge>
          )}
          {!isOnLeave && member.stepping_out_from && member.stepping_out_to && (
            <Badge variant="blue">
              Out · {member.stepping_out_from.slice(0, 5)} – {member.stepping_out_to.slice(0, 5)}
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}

function TeamSection({ users, summary }) {
  const [filter, setFilter] = useState("all");
  const [selectedMember, setSelectedMember] = useState(null);
  const { user: currentUser } = useUser();

  const onLeaveIds = useMemo(
    () => new Set((summary?.team_on_leave_today ?? []).map(l => l.user_id)),
    [summary]
  );

  const counts = useMemo(() => {
    const c = { all: users.length, office: 0, wfh: 0, late: 0, early: 0, leave: 0 };
    for (const u of users) {
      if (onLeaveIds.has(u.id)) { c.leave++; continue; }
      if (u.office_status === "IN")  c.office++;
      else if (u.office_status === "WFH") c.wfh++;
      if (u.late_arrive_eta)  c.late++;
      if (u.early_exit_eta)   c.early++;
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
        return false;
      })
      .sort((a, b) => (b.id === currentUser.id) - (a.id === currentUser.id));
  }, [users, filter, onLeaveIds, currentUser.id]);

  return (
    <div>
      <SectionLabel>Your Team</SectionLabel>

      <div className="flex flex-wrap items-center gap-2 mb-5">
        <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-400 mr-1 shrink-0">
          <Filter size={14} />Filter by status
        </span>
        {STATUS_FILTERS.map(({ id, label, Icon, iconColor }) => {
          if (id === "sep") return <div key="sep" className="w-px h-5 bg-slate-200 mx-1" />;
          const active = filter === id;
          const n = counts[id] ?? 0;
          const zero = id !== "all" && n === 0;
          return (
            <button
              key={id}
              onClick={() => !zero && setFilter(id)}
              className={`
                inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12.5px] font-medium border transition-all
                ${active
                  ? "bg-[#1e2430] border-[#1e2430] text-white"
                  : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                }
                ${zero ? "opacity-40 cursor-not-allowed" : ""}
              `}
            >
              {Icon && <Icon size={13} className={active ? "text-white" : iconColor} />}
              {label}
              <span className={`text-[11px] font-semibold px-1.5 rounded-full ${active ? "bg-white/20 text-white" : "bg-[#eef1f6] text-slate-500"}`}>
                {n}
              </span>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map(u => (
          <TeamCard
            key={u.id}
            member={u}
            onLeaveIds={onLeaveIds}
            isMe={u.id === currentUser.id}
            onSelect={setSelectedMember}
          />
        ))}
        {filtered.length === 0 && (
          <p className="col-span-full text-[13px] text-slate-400 py-4">No team members match this filter.</p>
        )}
      </div>

      <ProfileSidebar
        member={selectedMember}
        onLeaveIds={onLeaveIds}
        onClose={() => setSelectedMember(null)}
      />
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

  const isOnLeave = useMemo(
    () => (summary?.team_on_leave_today ?? []).some(l => l.user_id === user.id),
    [summary, user.id]
  );

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
          <StatusBar user={user} setUser={handleUserUpdate} isOnLeave={isOnLeave} />
        </div>
      </div>

      {/* ── Event strip ──
          Row 1 (4 cols): Needs You | On Leave Today | Upcoming Leaves | Upcoming Holidays
          Row 2 (3 cols): Catchups | Birthdays | Anniversaries
      ── */}
      <div className="mt-8">
        <SectionLabel>What's happening</SectionLabel>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <NeedsYouWidget
            pendingApprovalsCount={summary.pending_approvals_count ?? 0}
            catchupsAsManager={summary.upcoming_catchups_as_manager ?? []}
            catchupsAsEmployee={summary.my_catchups_upcoming ?? []}
            statusNotSet={!isOnLeave && (!user.office_status || user.office_status === "OUT")}
          />
          <OnLeaveTodayWidget items={summary.team_on_leave_today ?? []} />
          <UpcomingLeavesWidget items={summary.team_leaves_upcoming ?? []} />
          <UpcomingHolidaysWidget holidays={holidays} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
          <CatchupsWidget
            asEmployee={summary.my_catchups_upcoming ?? []}
            asManager={summary.upcoming_catchups_as_manager ?? []}
            currentUserId={user.id}
          />
          <BirthdaysWidget     items={summary.birthdays_upcoming    ?? []} />
          <AnniversariesWidget items={summary.anniversaries_upcoming ?? []} />
        </div>
      </div>

      {/* ── Team calendar ── */}
      <div className="mt-8">
        <SectionLabel>Team Calendar</SectionLabel>
        <TeamCalendar />
      </div>

      {/* ── Team ── */}
      <div className="mt-8">
        <TeamSection users={allUsers} summary={summary} />
      </div>
    </div>
  );
}

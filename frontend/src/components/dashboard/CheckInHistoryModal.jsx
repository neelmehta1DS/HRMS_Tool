import { useEffect, useMemo, useState } from "react";
import { X, Check, AlertTriangle } from "lucide-react";
import Modal from "../ui/Modal";
import Avatar from "../ui/Avatar";
import Spinner from "../ui/Spinner";
import { formatTimeOfDay, toISODate } from "../../lib/utils";
import { getStatusHistory, getUserLeaveSummary } from "../../lib/api";

const WFH_POLICY_PER_WEEK = 1;
const FETCH_DAYS = 90; // widest range we ever show

const RANGES = [
  { id: "30", label: "Last month", days: 30 },
  { id: "90", label: "Last 3 months", days: 90 },
];
const VIEWS = [
  { id: "calendar", label: "Calendar" },
  { id: "list", label: "List" },
];

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

// A working day resolves to exactly one of these. Weekends are shown greyed on
// the calendar but never counted. Order here is the order of the stat cards.
const KINDS = {
  office:  { label: "In office", cellBg: "#2563eb", cellText: "#ffffff", dot: "#3b82f6", pillBg: "#eff6ff", pillText: "#1d4ed8" },
  wfh:     { label: "WFH",       cellBg: "#059669", cellText: "#ffffff", dot: "#10b981", pillBg: "#ecfdf5", pillText: "#047857" },
  leave:   { label: "On leave",  cellBg: "#fbbf24", cellText: "#ffffff", dot: "#fbbf24", pillBg: "#fffbeb", pillText: "#b45309" },
  holiday: { label: "Holiday",   cellBg: "#a78bfa", cellText: "#ffffff", dot: "#a78bfa", pillBg: "#f5f3ff", pillText: "#6d28d9" },
  none:    { label: "No status", cellBg: "#f1f5f9", cellText: "#94a3b8", dot: "#cbd5e1", pillBg: "#f1f5f9", pillText: "#64748b" },
};
const STAT_LABELS = { office: "In office", wfh: "WFH", leave: "On leave", holiday: "Holidays", none: "No status" };

function fyLabel(d = new Date()) {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `FY ${y}–${String(y + 1).slice(2)} (Apr–Mar)`;
}

function statusToKind(s) {
  if (s === "IN") return "office";
  if (s === "WFH") return "wfh";
  return "none";
}

function mondayKey(d) {
  const m = new Date(d);
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return toISODate(m);
}

/** Every day from `days` ago up to and including today, oldest first. */
function buildDays({ statusDays, leaveDates, holidaysByDate, days }) {
  const byDate = new Map((statusDays || []).map((d) => [d.business_date, d]));
  const onLeave = new Set(leaveDates || []);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - (days - 1));

  const out = [];
  for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    const date = new Date(d);
    const iso = toISODate(date);
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
    const holiday = holidaysByDate.get(iso);
    const entry = byDate.get(iso);

    let kind;
    if (isWeekend) kind = "weekend";
    else if (holiday) kind = "holiday";
    else if (onLeave.has(iso)) kind = "leave";
    else kind = statusToKind(entry?.final_status);

    out.push({ date, iso, kind, holiday, isWeekend, clockedInAt: entry?.clocked_in_at });
  }
  return out;
}

function Segmented({ options, value, onChange, ariaLabel }) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="inline-flex gap-1 bg-slate-100 rounded-xl p-1">
      {options.map((o) => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.id)}
            className={`px-4 py-2 text-[13.5px] font-semibold rounded-lg transition-colors ${
              active ? "bg-white text-[#4f46e5] shadow-sm" : "text-slate-500 hover:text-slate-800"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function StatCard({ kind, count }) {
  return (
    <div className="border border-slate-200 rounded-xl px-4 py-3.5">
      <div className="flex items-center gap-2.5">
        <span className="w-3 h-3 rounded" style={{ background: KINDS[kind].dot }} />
        <span className="text-[26px] font-bold text-slate-900 leading-none">{count}</span>
      </div>
      <p className="text-[13.5px] text-slate-400 mt-1.5">{STAT_LABELS[kind]}</p>
    </div>
  );
}

function DayCell({ day }) {
  if (day.isWeekend) {
    return (
      <div className="h-11 rounded-lg bg-slate-50 flex items-center justify-center text-[13.5px] text-slate-300">
        {day.date.getDate()}
      </div>
    );
  }
  const label = day.holiday
    ? `${day.iso} · ${day.holiday}`
    : `${day.iso} · ${KINDS[day.kind].label}`;
  return (
    <div
      title={label}
      className="h-11 rounded-lg flex items-center justify-center text-[13.5px] font-semibold"
      style={{ background: KINDS[day.kind].cellBg, color: KINDS[day.kind].cellText }}
    >
      {day.date.getDate()}
    </div>
  );
}

function MonthCard({ label, days }) {
  // Align the first day shown to its weekday column (Monday-first).
  const lead = (days[0].date.getDay() + 6) % 7;
  return (
    <div className="border border-slate-200 rounded-2xl p-5">
      <p className="text-[15px] font-bold text-slate-900 mb-3">{label}</p>
      <div className="grid grid-cols-7 gap-2 mb-1">
        {WEEKDAYS.map((d, i) => (
          <span key={i} className="text-center text-[11.5px] font-medium text-slate-400">{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-2">
        {Array.from({ length: lead }).map((_, i) => <span key={`pad-${i}`} />)}
        {days.map((day) => <DayCell key={day.iso} day={day} />)}
      </div>
    </div>
  );
}

export default function CheckInHistoryModal({ open, onClose, member, holidays }) {
  const [range, setRange] = useState("30");
  const [view, setView] = useState("calendar");
  const [statusDays, setStatusDays] = useState(null);
  const [leaveDates, setLeaveDates] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (open) { setRange("30"); setView("calendar"); }
  }, [open]);

  useEffect(() => {
    if (!open || !member) return;
    let cancelled = false;
    setStatusDays(null);
    setLeaveDates(null);
    setFailed(false);
    Promise.all([
      getStatusHistory(member.id, FETCH_DAYS),
      getUserLeaveSummary(member.id, FETCH_DAYS),
    ])
      .then(([days, summary]) => {
        if (cancelled) return;
        setStatusDays(days);
        setLeaveDates(summary.leave_dates);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [open, member?.id]);

  const holidaysByDate = useMemo(
    () => new Map((holidays || []).map((h) => [h.date, h.name])),
    [holidays]
  );

  const rangeDays = RANGES.find((r) => r.id === range).days;
  const loaded = statusDays != null && leaveDates != null;

  const days = useMemo(() => {
    if (!loaded) return [];
    return buildDays({ statusDays, leaveDates, holidaysByDate, days: rangeDays });
  }, [loaded, statusDays, leaveDates, holidaysByDate, rangeDays]);

  const counts = useMemo(() => {
    const tally = { office: 0, wfh: 0, leave: 0, holiday: 0, none: 0 };
    for (const d of days) if (d.kind in tally) tally[d.kind] += 1;
    return tally;
  }, [days]);

  const wfhPerWeek = useMemo(() => {
    const weeks = new Set(days.filter((d) => d.kind in KINDS).map((d) => mondayKey(d.date)));
    return weeks.size ? counts.wfh / weeks.size : 0;
  }, [days, counts]);

  const withinPolicy = wfhPerWeek <= WFH_POLICY_PER_WEEK + 1e-9;

  // Calendar view: group into month cards, oldest month first (chronological).
  const months = useMemo(() => {
    const groups = new Map();
    for (const d of days) {
      const key = `${d.date.getFullYear()}-${d.date.getMonth()}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(d);
    }
    return [...groups.values()].map((g) => ({
      label: g[0].date.toLocaleDateString("en-GB", { month: "short", year: "numeric" }),
      days: g,
    }));
  }, [days]);

  // List view: working days only, newest first.
  const listDays = useMemo(
    () => days.filter((d) => !d.isWeekend).reverse(),
    [days]
  );

  if (!open || !member) return null;

  return (
    <Modal open={open} onClose={onClose} size="2xl" panelClassName="max-h-[92vh] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-7 py-5 border-b border-slate-100 shrink-0">
        <div className="flex items-center gap-3.5">
          <Avatar name={member.name} size="lg" />
          <div>
            <h2 className="text-[20px] font-bold text-slate-900 leading-tight">{member.name}</h2>
            <p className="text-[13.5px] text-slate-400 mt-0.5">Check-in history · {fyLabel()}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-700 transition-colors"
        >
          <X size={18} />
        </button>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-x-12 gap-y-4 px-7 py-5 border-b border-slate-100 shrink-0">
        <div>
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Range</p>
          <Segmented options={RANGES} value={range} onChange={setRange} ariaLabel="Date range" />
        </div>
        <div>
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">View</p>
          <Segmented options={VIEWS} value={view} onChange={setView} ariaLabel="View mode" />
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-7 py-6">
        {failed && <p className="text-[14px] text-slate-400 py-10 text-center">Couldn&apos;t load check-in history.</p>}

        {!failed && !loaded && <div className="flex justify-center py-16"><Spinner /></div>}

        {loaded && (
          <>
            {/* Stat cards */}
            <div className="grid grid-cols-5 gap-3">
              {Object.keys(STAT_LABELS).map((kind) => (
                <StatCard key={kind} kind={kind} count={counts[kind]} />
              ))}
            </div>

            {/* Policy banner */}
            <div
              className={`flex items-center gap-2.5 mt-4 rounded-xl px-4 py-3 text-[14px] ${
                withinPolicy
                  ? "bg-emerald-50 border border-emerald-200 text-emerald-800"
                  : "bg-amber-50 border border-amber-200 text-amber-800"
              }`}
            >
              {withinPolicy ? <Check size={16} className="shrink-0" /> : <AlertTriangle size={16} className="shrink-0" />}
              <span>
                Averaging <b>{wfhPerWeek.toFixed(1)} WFH days/week</b> —{" "}
                {withinPolicy
                  ? `within the ${WFH_POLICY_PER_WEEK} day/week policy.`
                  : `above the ${WFH_POLICY_PER_WEEK} day/week policy.`}
              </span>
            </div>

            {/* Content */}
            <div className="mt-6">
              {days.length === 0 ? (
                <p className="text-[14px] text-slate-400 py-10 text-center">No check-in history for this range.</p>
              ) : view === "calendar" ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
                  {months.map((m) => <MonthCard key={m.label} label={m.label} days={m.days} />)}
                </div>
              ) : (
                <div className="border border-slate-200 rounded-2xl overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-100">
                        <th className="text-left text-[11.5px] font-semibold text-slate-400 uppercase tracking-wider py-3 px-5">Date</th>
                        <th className="text-left text-[11.5px] font-semibold text-slate-400 uppercase tracking-wider py-3 px-5">Day</th>
                        <th className="text-left text-[11.5px] font-semibold text-slate-400 uppercase tracking-wider py-3 px-5">Status</th>
                        <th className="text-left text-[11.5px] font-semibold text-slate-400 uppercase tracking-wider py-3 px-5">Check-in time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {listDays.map((d, i) => {
                        const time = (d.kind === "office" || d.kind === "wfh") && d.clockedInAt
                          ? formatTimeOfDay(d.clockedInAt) : "—";
                        return (
                          <tr key={d.iso} className={`hover:bg-slate-50/70 transition-colors ${i > 0 ? "border-t border-slate-100" : ""}`}>
                            <td className="py-3.5 px-5 text-[14px] font-medium text-slate-800 whitespace-nowrap">
                              {d.date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                            </td>
                            <td className="py-3.5 px-5 text-[14px] text-slate-500">
                              {d.date.toLocaleDateString("en-US", { weekday: "short" })}
                            </td>
                            <td className="py-3.5 px-5">
                              <span
                                className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[13px] font-semibold"
                                style={{ background: KINDS[d.kind].pillBg, color: KINDS[d.kind].pillText }}
                              >
                                <span className="w-2 h-2 rounded-full" style={{ background: KINDS[d.kind].dot }} />
                                {d.kind === "holiday" && d.holiday ? d.holiday : KINDS[d.kind].label}
                              </span>
                            </td>
                            <td className="py-3.5 px-5 text-[14px] text-slate-700 whitespace-nowrap">{time}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

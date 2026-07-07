import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Plus, Trash2, AlertTriangle, ChevronDown, CalendarDays, Info, ChevronLeft, ChevronRight } from "lucide-react";
import { useUser } from "../contexts/UserContext";
import {
  getMyLeaves,
  getManagerLeaves,
  getLeaveLimits,
  getHolidays,
  getLeaveRules,
  createLeave,
  approveLeave,
  rejectLeave,
  deleteLeave,
} from "../lib/api";
import {
  formatDate,
  formatDateShort,
  isManager,
  isL2,
  getLeaveStatus,
  countBusinessDays,
} from "../lib/utils";
import Avatar from "../components/ui/Avatar";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import Modal from "../components/ui/Modal";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import Spinner from "../components/ui/Spinner";

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function isWorkingDay(d, holidaySet) {
  const dow = d.getDay();
  return dow >= 1 && dow <= 5 && !holidaySet.has(isoDate(d));
}

function addWorkingDays(from, n, holidaySet) {
  const d = new Date(from);
  let count = 0;
  while (count < n) {
    d.setDate(d.getDate() + 1);
    if (isWorkingDay(d, holidaySet)) count++;
  }
  return d;
}

// Returns the date that is the nth working day starting from (and including) start
function nthWorkingDay(start, n, holidaySet) {
  const d = new Date(start);
  let count = isWorkingDay(d, holidaySet) ? 1 : 0;
  while (count < n) {
    d.setDate(d.getDate() + 1);
    if (isWorkingDay(d, holidaySet)) count++;
  }
  return d;
}

function getNoticeRequired(duration, rules) {
  if (!Array.isArray(rules)) return 1;
  for (const rule of rules) {
    const lo = rule.min ?? 1;
    const hi = rule.max;
    if (duration >= lo && (hi == null || duration <= hi)) return rule.notice ?? 1;
  }
  return 1;
}

function earliestCasualStart(today, duration, holidaySet, rules) {
  const notice = getNoticeRequired(duration, rules);
  return addWorkingDays(today, notice, holidaySet);
}

function fmtCal(d) {
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function getStatusBadge(leave) {
  const status = getLeaveStatus(leave);
  if (status === "rejected") return <Badge variant="red">Rejected</Badge>;
  if (status === "approved") return <Badge variant="green">Approved</Badge>;
  if (status === "pending_l2") return <Badge variant="yellow">Awaiting L2</Badge>;
  return <Badge variant="yellow">Pending approval</Badge>;
}

function getTypeBadge(leave_type) {
  if (leave_type === "sick") return <Badge variant="orange">Sick</Badge>;
  return <Badge variant="blue">Casual</Badge>;
}

function DateStamp({ start_date, end_date, leave_type }) {
  const isMultiDay = start_date !== end_date;
  const borderClass =
    leave_type === "sick" ? "border-l-4 border-amber-500" : "border-l-4 border-blue-500";

  const startDay = parseInt(start_date.split("-")[2], 10);
  const startMonth = new Date(start_date + "T00:00:00")
    .toLocaleString("en-US", { month: "short" })
    .toUpperCase();

  if (!isMultiDay) {
    return (
      <div className={`${borderClass} pl-3 min-w-[48px] flex flex-col items-center`}>
        <span className="text-2xl font-bold text-slate-900 leading-none">{startDay}</span>
        <span className="text-[10px] font-semibold tracking-widest text-slate-500 mt-0.5">
          {startMonth}
        </span>
      </div>
    );
  }

  const endDay = parseInt(end_date.split("-")[2], 10);
  const endMonth = new Date(end_date + "T00:00:00")
    .toLocaleString("en-US", { month: "short" })
    .toUpperCase();

  return (
    <div className={`${borderClass} pl-3 min-w-[48px] flex flex-col items-center`}>
      <span className="text-2xl font-bold text-slate-900 leading-none">{startDay}</span>
      <span className="text-[10px] font-semibold tracking-widest text-slate-500 mt-0.5">
        {startMonth}
      </span>
      <span className="text-[10px] text-slate-400 my-0.5">─</span>
      <span className="text-2xl font-bold text-slate-900 leading-none">{endDay}</span>
      <span className="text-[10px] font-semibold tracking-widest text-slate-500 mt-0.5">
        {endMonth}
      </span>
    </div>
  );
}

function LeaveCard({ leave, onDelete, holidays }) {
  const status = getLeaveStatus(leave);
  const isPending = status === "pending_l1" || status === "pending_l2";
  const isUpcoming = status === "approved" && leave.start_date >= todayStr();
  const showDelete = isPending || isUpcoming;

  const isSameDay = leave.start_date === leave.end_date;
  const dayCount = countBusinessDays(leave.start_date, leave.end_date, holidays || []);
  const dateText = isSameDay
    ? formatDateShort(leave.start_date)
    : `${formatDateShort(leave.start_date)} – ${formatDateShort(leave.end_date)}`;
  const dayLabel = `${dayCount}d`;
  const isCasual = leave.leave_type === "casual";

  return (
    <div className="group flex items-stretch gap-3 py-2.5 border-b border-slate-100 last:border-b-0 last:pb-0 first:pt-0">
      <div className={`w-[3px] rounded-full shrink-0 ${isCasual ? "bg-blue-400" : "bg-amber-400"}`} />
      <div className="flex-1 min-w-0">
        <span className="text-[14.5px] font-semibold text-slate-800 truncate">
          {dateText}
          <span className="text-slate-300 mx-1.5">·</span>
          <span className={`font-medium ${isCasual ? "text-blue-500" : "text-amber-500"}`}>
            {isCasual ? "Casual" : "Sick"}
          </span>
        </span>
        {leave.over_limit && (
          <div className="mt-1">
            <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-px">
              Over limit
            </span>
          </div>
        )}
        {leave.note && (
          <p className="text-[11.5px] text-slate-400 mt-0.5 truncate italic">"{leave.note}"</p>
        )}
        {leave.approvals?.find(a => a.status === "rejected")?.rejection_note && (
          <p className="text-[11.5px] text-red-400 mt-0.5 truncate">
            ↩ {leave.approvals.find(a => a.status === "rejected").rejection_note}
          </p>
        )}
      </div>
      {showDelete && (
        <button
          onClick={() => onDelete(leave.id)}
          className="text-slate-400 hover:text-red-500 shrink-0 self-center transition-colors"
          title="Delete"
        >
          <Trash2 size={15} />
        </button>
      )}
    </div>
  );
}

function SectionHeader({ title, count }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-[13px] font-semibold text-slate-500 uppercase tracking-wider">
        {title}
      </span>
      <span className="inline-flex items-center justify-center h-5 min-w-[20px] px-1.5 rounded-full bg-slate-200 text-slate-600 text-[11px] font-semibold">
        {count}
      </span>
    </div>
  );
}

function ManagerLeaveCard({ leave, onApprove, onReject, holidays }) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectError, setRejectError] = useState("");
  const [loading, setLoading] = useState(false);

  const isSameDay = leave.start_date === leave.end_date;
  const dayCount = countBusinessDays(leave.start_date, leave.end_date, holidays || []);

  const dateRangeText = isSameDay
    ? `${formatDate(leave.start_date)} · 1 day`
    : `${formatDateShort(leave.start_date)} – ${formatDateShort(leave.end_date)} · ${dayCount} day${dayCount !== 1 ? "s" : ""}`;

  async function handleApprove() {
    setLoading(true);
    try {
      await onApprove(leave.id);
    } finally {
      setLoading(false);
    }
  }

  async function handleRejectSubmit() {
    if (!rejectReason.trim()) {
      setRejectError("Reason is required.");
      return;
    }
    setLoading(true);
    try {
      await onReject(leave.id, rejectReason.trim());
      setRejectOpen(false);
      setRejectReason("");
      setRejectError("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 hover:shadow-sm transition-shadow">
      <div className="flex items-start gap-3">
        <Avatar name={leave.user.name} size="sm" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[13px] font-semibold text-slate-900">{leave.user.name}</span>
              {leave.is_exception && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-700 bg-red-50 border border-red-300 rounded px-1.5 py-0.5 uppercase tracking-wide">
                  Exception
                </span>
              )}
              {leave.over_limit && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                  <AlertTriangle size={10} />
                  Over limit
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleApprove}
                disabled={loading}
                className="text-[12px] font-medium px-3 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors disabled:opacity-50"
              >
                Approve
              </button>
              <button
                onClick={() => {
                  setRejectOpen(!rejectOpen);
                  setRejectError("");
                }}
                disabled={loading}
                className="text-[12px] font-medium px-3 py-1 rounded-lg bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 transition-colors disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          </div>
          <p className="text-[12px] text-slate-500 mt-1">
            {leave.leave_type === "sick" ? "Sick" : "Casual"} · {dateRangeText}
          </p>
          {leave.note && (
            <p className="text-[12px] text-slate-500 italic mt-0.5">"{leave.note}"</p>
          )}
        </div>
      </div>
      {rejectOpen && (
        <div className="mt-3 pl-10">
          <div className="bg-slate-50 rounded-lg border border-slate-200 p-3">
            <p className="text-[12px] font-medium text-slate-700 mb-2">Rejection reason</p>
            <textarea
              value={rejectReason}
              onChange={(e) => {
                setRejectReason(e.target.value);
                setRejectError("");
              }}
              placeholder="Enter reason for rejection..."
              className="w-full text-[13px] border border-slate-200 rounded-lg px-3 py-2 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              rows={2}
            />
            {rejectError && (
              <p className="text-[12px] text-red-600 mt-1">{rejectError}</p>
            )}
            <div className="flex gap-2 mt-2">
              <button
                onClick={handleRejectSubmit}
                disabled={loading}
                className="text-[12px] font-medium px-3 py-1 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                Submit
              </button>
              <button
                onClick={() => {
                  setRejectOpen(false);
                  setRejectReason("");
                  setRejectError("");
                }}
                className="text-[12px] font-medium px-3 py-1 rounded-lg bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LeavePieCard({ label, taken, limit, color }) {
  const isOver = taken > limit;
  const pct = limit > 0 ? Math.min(taken / limit, 1) : 0;
  const r = 46;
  const cx = 60;
  const cy = 60;
  const circumference = 2 * Math.PI * r;
  const fillColor = isOver ? "#ef4444" : color === "casual" ? "#3b82f6" : "#22c55e";
  const remaining = Math.max(0, limit - taken);

  return (
    <div className="bg-white rounded-3xl border border-slate-100 shadow-md flex flex-col items-center py-4 px-16">
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-[0.14em] mb-4">
        {label} Leave
      </p>

      <svg width="120" height="120" viewBox="0 0 120 120">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e8ecf2" strokeWidth="14" />
        {pct > 0 && (
          <circle
            cx={cx} cy={cy} r={r}
            fill="none"
            stroke={fillColor}
            strokeWidth="14"
            strokeDasharray={`${pct * circumference} ${circumference}`}
            strokeLinecap="round"
            transform={`rotate(-90 ${cx} ${cy})`}
          />
        )}
      </svg>

      <div className="mt-4 text-center">
        <div className="flex items-baseline justify-center">
          <span className={`text-[36px] font-bold leading-none tracking-tight ${isOver ? "text-red-600" : "text-slate-800"}`}>
            {taken}
          </span>
          <span className="text-[18px] text-slate-400 font-light leading-none ml-0.5">/{limit}</span>
        </div>
        <p className={`text-[12px] mt-2 ${isOver ? "text-red-500 font-medium" : "text-slate-400"}`}>
          {isOver ? `${taken - limit} over limit` : `${remaining} remaining`}
        </p>
      </div>
    </div>
  );
}

// ─── Leave modal calendar ──────────────────────────────────────────────────────

function LeaveCalendar({ selected, onSelect, minDate, holidaySet, duration, open }) {
  const today = new Date();
  today.setHours(12, 0, 0, 0);

  const [view, setView] = useState(() => {
    const base = minDate || today;
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  useEffect(() => {
    if (open && minDate) {
      setView(new Date(minDate.getFullYear(), minDate.getMonth(), 1));
    }
  }, [open, minDate?.toISOString().slice(0, 7)]);

  const year  = view.getFullYear();
  const month = view.getMonth();
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7; // Mon=0
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const endDate = selected && duration ? nthWorkingDay(new Date(selected), duration, holidaySet) : null;

  function isDisabled(d) {
    if (d < today && isoDate(d) !== isoDate(today)) return true;
    if (d.getDay() === 0 || d.getDay() === 6) return true;
    if (holidaySet.has(isoDate(d))) return true;
    if (minDate && d < minDate) return true;
    return false;
  }

  const canPrev = !(year === today.getFullYear() && month === today.getMonth());
  const DOWS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

  return (
    <div className="w-[300px] bg-white border border-slate-200 rounded-xl shadow-xl p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <button
          type="button"
          disabled={!canPrev}
          onClick={() => setView(new Date(year, month - 1, 1))}
          className="w-7 h-7 rounded-lg border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronLeft size={14} />
        </button>
        <span className="text-[14px] font-semibold text-slate-700">
          {view.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
        </span>
        <button
          type="button"
          onClick={() => setView(new Date(year, month + 1, 1))}
          className="w-7 h-7 rounded-lg border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-50"
        >
          <ChevronRight size={14} />
        </button>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 mb-1">
        {DOWS.map(d => (
          <div key={d} className="text-center text-[11px] font-semibold text-slate-400 py-1">{d}</div>
        ))}
      </div>

      {/* Cells */}
      <div className="grid grid-cols-7 gap-y-0.5">
        {Array.from({ length: firstDow }).map((_, i) => <div key={`pad-${i}`} />)}
        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
          const d = new Date(year, month, day, 12);
          const iso = isoDate(d);
          const dis  = isDisabled(d);
          const isTod = isoDate(d) === isoDate(today);
          const isSel = selected && iso === selected;
          const isHol = holidaySet.has(iso);
          const inRng = selected && endDate && d > new Date(selected) && d <= endDate;

          return (
            <button
              key={day}
              type="button"
              disabled={dis}
              onClick={() => onSelect(iso)}
              title={isHol ? "Holiday" : undefined}
              className={`
                relative h-9 rounded-lg text-[13.5px] transition-colors
                ${isSel ? "bg-[#2f6bff] text-white font-semibold" : ""}
                ${inRng && !isSel ? "bg-[#eef3ff]" : ""}
                ${!isSel && !inRng && !dis ? "hover:bg-[#eef3ff]" : ""}
                ${dis ? "text-slate-300 cursor-not-allowed" : "text-slate-700"}
                ${isTod && !isSel ? "ring-1 ring-inset ring-slate-400 font-semibold" : ""}
              `}
            >
              {day}
              {isHol && (
                <span className={`absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full ${isSel ? "bg-white" : "bg-red-400"}`} />
              )}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex gap-4 mt-3 pt-3 border-t border-slate-100 text-[11px] text-slate-400">
        <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block" />Holiday</span>
        <span>Weekends &amp; past dates off</span>
      </div>
    </div>
  );
}

// ─── Request leave modal ───────────────────────────────────────────────────────

function RequestLeaveModal({ open, onClose, holidays, leaveRules, onSuccess, hideException }) {
  const [leaveType, setLeaveType] = useState(null);
  const [duration, setDuration]   = useState(1);
  const [startDate, setStartDate] = useState(null); // ISO string | null
  const [note, setNote]           = useState("");
  const [error, setError]         = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showInfo, setShowInfo]   = useState(false);
  const [showCal, setShowCal]     = useState(false);
  const [exception, setException] = useState(false);
  const calRef  = useRef(null);
  const infoRef = useRef(null);

  const todayDate = useMemo(() => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    return d;
  }, []);

  const holidaySet = useMemo(() => new Set((holidays || []).map(h => h.date)), [holidays]);
  const noticeRules = leaveRules?.casual_advance_notice ?? [];

  const minStart = useMemo(() => {
    if (!leaveType || leaveType === "sick" || exception) return todayDate;
    return earliestCasualStart(todayDate, duration, holidaySet, noticeRules);
  }, [leaveType, duration, holidaySet, noticeRules, exception, todayDate]);

  const endDate = useMemo(() => {
    if (!startDate) return null;
    return nthWorkingDay(new Date(startDate), duration, holidaySet);
  }, [startDate, duration, holidaySet]);

  // Reset on open/close
  useEffect(() => {
    if (!open) return;
    setLeaveType(null);
    setDuration(1);
    setStartDate(null);
    setNote("");
    setError("");
    setSubmitting(false);
    setShowInfo(false);
    setShowCal(false);
    setException(false);
  }, [open]);

  // Auto-set today for sick
  useEffect(() => {
    if (leaveType === "sick") {
      setStartDate(isoDate(todayDate));
      setDuration(1);
    } else {
      setStartDate(null);
    }
    setException(false);
    setError("");
  }, [leaveType]);

  // Click-outside for calendar and info popover
  useEffect(() => {
    function handler(e) {
      if (calRef.current  && !calRef.current.contains(e.target))  setShowCal(false);
      if (infoRef.current && !infoRef.current.contains(e.target)) setShowInfo(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function applyDuration(n) {
    const clamped = Math.max(1, n);
    setDuration(clamped);
    setStartDate(null); // re-pick date when duration changes
  }

  // Status indicator
  const statusInfo = useMemo(() => {
    if (!startDate || !leaveType) return null;
    if (exception) {
      return { kind: "exc", text: "Needs your manager's approval — explain why in your note." };
    }
    if (leaveType === "casual") {
      return { kind: "good", text: "Ready — needs manager approval." };
    }
    // sick
    const now = new Date();
    const cutoff = now.getHours() * 60 + now.getMinutes() < 8 * 60 + 30;
    if (cutoff) return { kind: "good", text: "No approval needed." };
    return { kind: "info", text: "After 8:30 AM — logged as a late sick note." };
  }, [startDate, leaveType, exception]);

  const earliestLabel = leaveType === "casual" && !exception
    ? fmtCal(minStart)
    : null;

  async function handleSubmit() {
    if (!note.trim()) { setError("Note is required."); return; }
    if (!startDate)   { setError("Start date is required."); return; }
    setSubmitting(true);
    try {
      await createLeave({
        leave_type:   leaveType,
        note:         note.trim(),
        start_date:   startDate,
        end_date:     endDate ? isoDate(endDate) : startDate,
        is_exception: exception,
      });
      onSuccess();
      onClose();
    } catch (ex) {
      setError(ex?.response?.data?.detail || "Failed to submit leave request.");
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = !!startDate && !!note.trim() && !submitting;

  return (
    <Modal open={open} onClose={onClose} size="md">
      {/* Custom header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
        <h2 className="text-[22px] font-bold text-slate-900 tracking-tight">Request leave</h2>
        <div className="flex items-center gap-3">
          {/* Leave rules info popover */}
          <div className="relative" ref={infoRef}>
            <button
              type="button"
              onClick={() => setShowInfo(v => !v)}
              className="inline-flex items-center gap-1.5 border border-slate-200 rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold text-slate-600 hover:border-slate-300 transition-colors"
            >
              <Info size={14} className="text-[#2f6bff]" />
              Leave rules
            </button>
            {showInfo && (
              <div className="absolute right-0 top-full mt-2 z-50 w-80 bg-white border border-slate-200 rounded-xl shadow-xl p-4 text-left">
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Casual leave</p>
                <p className="text-[12.5px] text-slate-600 leading-relaxed mb-3">
                  Book ahead by working days: <b className="text-slate-800">1 day → 3</b>, <b className="text-slate-800">2 → 7</b>, <b className="text-slate-800">3 → 14</b>, <b className="text-slate-800">4+ → 30</b>. Always needs manager approval.
                </p>
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Sick leave</p>
                <p className="text-[12.5px] text-slate-600 leading-relaxed mb-2">
                  <b className="text-slate-800">Sudden illness:</b> log before 8:30 AM, no approval.
                </p>
                <div className="text-[11.5px] text-slate-400 border-t border-slate-100 pt-3 mt-1">
                  Weekends &amp; public holidays don&apos;t count as leave.
                </div>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
          >
            ×
          </button>
        </div>
      </div>

      <div className="px-6 pt-5 pb-2 space-y-5">
        {/* Leave type */}
        <div>
          <p className="text-[12px] font-semibold text-slate-400 uppercase tracking-wider mb-3">What kind of leave?</p>
          <div className="grid grid-cols-2 gap-3">
            {[
              { id: "casual", title: "Casual", sub: "Planned time off" },
              { id: "sick",   title: "Sick",   sub: "Illness or medical" },
            ].map(({ id, title, sub }) => (
              <button
                key={id}
                type="button"
                onClick={() => setLeaveType(id)}
                className={`
                  border-[1.5px] rounded-xl p-4 text-center transition-all
                  ${leaveType === id
                    ? id === "casual"
                      ? "border-[#2f6bff] bg-[#eef3ff]"
                      : "border-[#c47510] bg-[#fdf6e7]"
                    : "border-slate-200 bg-white hover:border-slate-300"
                  }
                `}
              >
                <p className={`text-[16px] font-semibold ${leaveType === id ? (id === "casual" ? "text-[#2f6bff]" : "text-[#c47510]") : "text-slate-600"}`}>{title}</p>
                <p className="text-[11.5px] text-slate-400 mt-1">{sub}</p>
              </button>
            ))}
          </div>
        </div>

        {leaveType && (
          <>
            {/* Duration */}
            <div>
              <p className="text-[12px] font-semibold text-slate-400 uppercase tracking-wider mb-3">How long?</p>
              <div className="flex items-center gap-3 flex-wrap">
                {/* Stepper */}
                <div className="inline-flex items-center border-[1.5px] border-slate-200 rounded-xl overflow-hidden">
                  <button
                    type="button"
                    disabled={duration <= 1 || leaveType === "sick"}
                    onClick={() => applyDuration(duration - 1)}
                    className="w-11 h-12 text-[20px] text-slate-500 hover:bg-slate-50 disabled:text-slate-300 disabled:cursor-not-allowed border-r border-slate-200 transition-colors"
                  >−</button>
                  <div className="flex items-center justify-center gap-1.5 min-w-[108px] h-12 border-r border-slate-200">
                    <input
                      type="number"
                      min={1}
                      value={duration}
                      disabled={leaveType === "sick"}
                      onChange={e => applyDuration(parseInt(e.target.value) || 1)}
                      className="w-9 text-right text-[16px] font-bold text-slate-800 border-none outline-none bg-transparent disabled:text-slate-400"
                    />
                    <span className="text-[15px] font-semibold text-slate-500">{duration === 1 ? "day" : "days"}</span>
                  </div>
                  <button
                    type="button"
                    disabled={leaveType === "sick"}
                    onClick={() => applyDuration(duration + 1)}
                    className="w-11 h-12 text-[20px] text-slate-500 hover:bg-slate-50 disabled:text-slate-300 disabled:cursor-not-allowed transition-colors"
                  >+</button>
                </div>
                {/* Quick chips */}
                <div className="flex gap-2">
                  {[1, 2, 3, 4].map(n => (
                    <button
                      key={n}
                      type="button"
                      disabled={leaveType === "sick" && n !== 1}
                      onClick={() => applyDuration(n)}
                      className={`w-11 h-12 border-[1.5px] rounded-xl text-[14px] font-semibold transition-all ${
                        duration === n ? "border-[#2f6bff] bg-[#eef3ff] text-[#2f6bff]" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 disabled:opacity-40 disabled:cursor-not-allowed"
                      }`}
                    >{n}</button>
                  ))}
                </div>
              </div>
              {earliestLabel && (
                <p className="text-[13px] text-slate-500 mt-3">Earliest start: <b className="font-semibold text-slate-700">{earliestLabel}</b></p>
              )}
              {exception && leaveType === "casual" && (
                <div className="mt-3 flex items-start gap-2 bg-[#f0ecfe] border border-[#cfc2f7] text-[#7c5cf0] rounded-xl px-3 py-2.5 text-[12.5px] leading-relaxed">
                  <Info size={15} className="mt-0.5 shrink-0" />
                  <span><b>Exception mode.</b> Notice rules are waived — your manager approves this personally. <button type="button" onClick={() => setException(false)} className="underline font-semibold">Cancel exception</button></span>
                </div>
              )}
            </div>

            {/* Date picker */}
            <div>
              <p className="text-[12px] font-semibold text-slate-400 uppercase tracking-wider mb-3">
                {leaveType === "sick" ? "Which day?" : "When does it start?"}
              </p>
              <div className="relative" ref={calRef}>
                <button
                  type="button"
                  disabled={leaveType === "sick"}
                  onClick={() => setShowCal(v => !v)}
                  className={`flex items-center justify-between gap-3 w-full max-w-[280px] border-[1.5px] rounded-xl px-4 py-3 text-[15px] transition-colors ${
                    startDate ? "text-slate-800 border-slate-300" : "text-slate-400 border-slate-200"
                  } ${leaveType === "sick" ? "bg-slate-50 cursor-not-allowed" : "bg-white hover:border-slate-300 cursor-pointer"}`}
                >
                  <span>{startDate ? fmtCal(new Date(startDate + "T12:00:00")) : "Select a date"}</span>
                  <CalendarDays size={16} className="text-slate-400 shrink-0" />
                </button>
                {showCal && (
                  <div className="absolute top-full left-0 mt-2 z-50">
                    <LeaveCalendar
                      selected={startDate}
                      onSelect={iso => { setStartDate(iso); setShowCal(false); setError(""); }}
                      minDate={minStart}
                      holidaySet={holidaySet}
                      duration={duration}
                      open={showCal}
                    />
                  </div>
                )}
              </div>

              {startDate && endDate && (
                <p className="text-[13px] text-slate-500 mt-2.5">
                  Ends <b className="font-semibold text-slate-700">{fmtCal(endDate)}</b>
                  <span className="mx-1.5 text-slate-300">·</span>
                  {duration} business day{duration !== 1 ? "s" : ""}
                </p>
              )}

              {statusInfo && (
                <div className={`mt-2.5 flex items-center gap-2 text-[13.5px] rounded-xl px-3 py-2.5 ${
                  statusInfo.kind === "good" ? "bg-[#e9f7f0] border border-[#bfe8d4] text-[#0b6b4c]" :
                  statusInfo.kind === "exc"  ? "bg-[#f0ecfe] border border-[#cfc2f7] text-[#7c5cf0]" :
                  "bg-slate-50 border border-slate-200 text-slate-600"
                }`}>
                  <span dangerouslySetInnerHTML={{ __html: statusInfo.text }} />
                </div>
              )}

              {leaveType === "casual" && !exception && !hideException && (
                <p className="text-[12.5px] text-slate-400 mt-2.5">
                  Need it sooner?{" "}
                  <button type="button" onClick={() => { setException(true); setStartDate(null); }} className="text-[#7c5cf0] font-semibold underline">
                    Request an exception →
                  </button>
                </p>
              )}
            </div>

            {/* Note */}
            <div>
              <p className="text-[12px] font-semibold text-slate-400 uppercase tracking-wider mb-3">
                Note <span className="text-red-500">*</span>
              </p>
              <textarea
                value={note}
                onChange={e => { setNote(e.target.value); setError(""); }}
                placeholder="Reason for leave…"
                rows={3}
                className="w-full border-[1.5px] border-slate-200 rounded-xl px-4 py-3 text-[15px] font-[inherit] text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#2f6bff] focus:ring-3 focus:ring-[#eef3ff] resize-none transition-colors"
              />
            </div>
          </>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <p className="text-[13px] text-red-700">{error}</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-100">
        <button
          type="button"
          onClick={onClose}
          className="px-5 py-3 rounded-xl border-[1.5px] border-slate-200 bg-white text-[15px] font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit || !leaveType}
          className={`px-5 py-3 rounded-xl text-[15px] font-semibold text-white transition-all disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 ${
            exception ? "bg-[#7c5cf0] hover:bg-[#6b4fd8]" : "bg-[#2f6bff] hover:bg-[#1f57e0]"
          }`}
        >
          {submitting ? "Submitting…" : exception ? "Send to manager" : leaveType === "sick" ? "Log sick leave" : "Submit request"}
        </button>
      </div>
    </Modal>
  );
}

function HolidaysModal({ open, onClose, holidays }) {
  const today = todayStr();

  const grouped = {};
  (holidays || []).forEach((h) => {
    const month = new Date(h.date + "T00:00:00").toLocaleString("en-US", {
      month: "long",
      year: "numeric",
    });
    if (!grouped[month]) grouped[month] = [];
    grouped[month].push(h);
  });

  return (
    <Modal open={open} onClose={onClose} title="Public Holidays" size="lg">
      <div className="p-6">
      <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-1">
        {Object.keys(grouped).length === 0 && (
          <p className="text-[15px] text-slate-400 text-center py-4">No holidays listed.</p>
        )}
        {Object.entries(grouped).map(([month, items]) => (
          <div key={month}>
            <p className="text-[12px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
              {month}
            </p>
            <div className="space-y-1">
              {items.map((h) => {
                const isPast = h.date < today;
                const d = new Date(h.date + "T00:00:00");
                const dayName = d.toLocaleString("en-US", { weekday: "short" });
                const formatted = d.toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                });
                return (
                  <div
                    key={h.date}
                    className={`flex items-center justify-between py-2 px-3 rounded-lg ${
                      isPast ? "opacity-40" : "bg-slate-50"
                    }`}
                  >
                    <span
                      className={`text-[15px] font-medium ${
                        isPast ? "text-slate-400" : "text-slate-800"
                      }`}
                    >
                      {h.name}
                    </span>
                    <span
                      className={`text-[14px] ${isPast ? "text-slate-400" : "text-slate-500"}`}
                    >
                      {dayName}, {formatted}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      </div>
    </Modal>
  );
}

export default function Leaves() {
  const { user } = useUser();

  const [myLeaves, setMyLeaves] = useState(null);
  const [managerLeaves, setManagerLeaves] = useState([]);
  const [limits, setLimits] = useState(null);
  const [holidays, setHolidays] = useState([]);
  const [leaveRules, setLeaveRules] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [showRequest, setShowRequest] = useState(false);
  const [showHolidays, setShowHolidays] = useState(false);
  const [prevOpen, setPrevOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const userIsManager = isManager(user);
  const userIsL2 = isL2(user);

  const fetchMyLeaves = useCallback(async () => {
    const data = await getMyLeaves();
    setMyLeaves(data);
  }, []);

  const fetchManagerLeaves = useCallback(async () => {
    if (!userIsManager) return;
    const data = await getManagerLeaves();
    setManagerLeaves(data);
  }, [userIsManager]);

  useEffect(() => {
    async function init() {
      setLoading(true);
      setError("");
      try {
        const promises = [getMyLeaves(), getLeaveLimits(), getHolidays(), getLeaveRules()];
        if (userIsManager) promises.push(getManagerLeaves());
        const results = await Promise.all(promises);
        setMyLeaves(results[0]);
        setLimits(results[1]);
        setHolidays(results[2]);
        setLeaveRules(results[3]);
        if (userIsManager) setManagerLeaves(results[4]);
      } catch {
        setError("Failed to load leave data. Please refresh.");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [userIsManager]);

  function handleDelete(id) {
    setConfirmDeleteId(id);
  }

  async function doDelete() {
    setDeleting(true);
    try {
      await deleteLeave(confirmDeleteId);
      setMyLeaves((prev) => {
        if (!prev) return prev;
        return {
          pending: prev.pending.filter((l) => l.id !== confirmDeleteId),
          upcoming: prev.upcoming.filter((l) => l.id !== confirmDeleteId),
          rejected: prev.rejected.filter((l) => l.id !== confirmDeleteId),
          previous: prev.previous.filter((l) => l.id !== confirmDeleteId),
        };
      });
      setConfirmDeleteId(null);
    } catch {
      // silently ignore
    } finally {
      setDeleting(false);
    }
  }

  async function handleApprove(id) {
    await approveLeave(id);
    setManagerLeaves((prev) => prev.filter((l) => l.id !== id));
    await fetchMyLeaves();
  }

  async function handleReject(id, reason) {
    await rejectLeave(id, reason);
    setManagerLeaves((prev) => prev.filter((l) => l.id !== id));
    await fetchMyLeaves();
  }

  async function handleRequestSuccess() {
    await fetchMyLeaves();
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[300px]">
        <Spinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4">
          <p className="text-[13px] text-red-700">{error}</p>
        </div>
      </div>
    );
  }

  const sickTaken = user?.sick_leaves_taken ?? 0;
  const casualTaken = user?.casual_leaves_taken ?? 0;
  const sickLimit = limits?.sick ?? null;
  const casualLimit = limits?.casual ?? null;

  const scrollSections = [
    { key: "pending", title: "Pending", items: myLeaves?.pending || [] },
    { key: "upcoming", title: "Upcoming", items: myLeaves?.upcoming || [] },
    { key: "rejected", title: "Rejected", items: myLeaves?.rejected || [] },
  ];
  const previousItems = myLeaves?.previous || [];

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
            <h1 className="text-2xl font-bold text-slate-900">My Leaves</h1>
            <p className="text-[13.5px] text-slate-400 mt-0.5">Manage your time off</p>
          </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="xl" onClick={() => setShowHolidays(true)}>
            <CalendarDays size={17} />
            Holidays
          </Button>
          <Button variant="primary" size="xl" onClick={() => setShowRequest(true)}>
            <Plus size={17} />
            {userIsL2 ? "Log Leave" : "Request Leave"}
          </Button>
        </div>
      </div>

      {/* Leave balance */}
      {!userIsL2 && (casualLimit !== null || sickLimit !== null) && (
        <div className="grid grid-cols-2 gap-4 mb-8">
          {casualLimit !== null && <LeavePieCard label="Casual" taken={casualTaken} limit={casualLimit} color="casual" />}
          {sickLimit !== null && <LeavePieCard label="Sick"   taken={sickTaken}   limit={sickLimit}   color="sick"   />}
        </div>
      )}

      {/* Personal leave sections — scrollable cards (hidden for L2) */}
      {!userIsL2 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
          {scrollSections.map(({ key, title, items }) => (
            <div key={key} className="bg-white rounded-xl border border-slate-200 p-5 flex flex-col h-[260px]">
              <div className="flex items-center gap-2 mb-4 shrink-0">
                <span className="text-[15px] font-semibold text-slate-700 flex-1">{title}</span>
                {items.length > 0 && (
                  <span className="text-[12px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 shrink-0">
                    {items.length}
                  </span>
                )}
              </div>
              <div className="flex-1 overflow-y-auto pr-0.5">
                {items.length === 0 ? (
                  <p className="text-[12.5px] text-slate-400">Nothing here.</p>
                ) : (
                  items.map((leave) => (
                    <LeaveCard
                      key={leave.id}
                      leave={leave}
                      onDelete={handleDelete}
                      holidays={holidays}
                    />
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Manager approval section */}
      {userIsManager && (
        <div className="mt-2 pt-8 border-t border-slate-200">
          <SectionHeader title="Pending Approvals" count={managerLeaves.length} />
          {managerLeaves.length === 0 ? (
            <p className="text-[13px] text-slate-400">No pending approvals.</p>
          ) : (
            <div className="space-y-3">
              {managerLeaves.map((leave) => (
                <ManagerLeaveCard
                  key={leave.id}
                  leave={leave}
                  onApprove={handleApprove}
                  onReject={handleReject}
                  holidays={holidays}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Previous leaves — collapsible (hidden for L2) */}
      {!userIsL2 && (
        <div className="mt-8 pt-6 border-t border-slate-200">
          <button
            onClick={() => setPrevOpen((v) => !v)}
            className="flex items-center gap-2 w-full text-left group mb-1"
          >
            <span className="text-[13px] font-semibold text-slate-500 uppercase tracking-wider">
              Previous
            </span>
            <span className="inline-flex items-center justify-center h-5 min-w-[20px] px-1.5 rounded-full bg-slate-200 text-slate-600 text-[11px] font-semibold">
              {previousItems.length}
            </span>
            <ChevronDown
              size={15}
              className={`ml-1 text-slate-400 transition-transform duration-200 ${prevOpen ? "rotate-180" : ""}`}
            />
          </button>
          {prevOpen && (
            <div className="mt-3 space-y-3">
              {previousItems.length === 0 ? (
                <p className="text-[13px] text-slate-400">Nothing here.</p>
              ) : (
                previousItems.map((leave) => (
                  <LeaveCard
                    key={leave.id}
                    leave={leave}
                    onDelete={handleDelete}
                    holidays={holidays}
                  />
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      <RequestLeaveModal
        open={showRequest}
        onClose={() => setShowRequest(false)}
        holidays={holidays}
        leaveRules={leaveRules}
        onSuccess={handleRequestSuccess}
        hideException={userIsL2}
      />
      <HolidaysModal
        open={showHolidays}
        onClose={() => setShowHolidays(false)}
        holidays={holidays}
      />
      <ConfirmDialog
        open={confirmDeleteId !== null}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={doDelete}
        title="Delete leave request?"
        message="This will permanently delete the leave request. This cannot be undone."
        loading={deleting}
      />
    </div>
  );
}

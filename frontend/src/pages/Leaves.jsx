import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  Plus, X, Trash2, AlertTriangle, ChevronLeft, ChevronRight,
  Info, CalendarDays, Check, Clock, ChevronDown, AlertCircle, Pencil,
} from "lucide-react";
import { useUser } from "../contexts/UserContext";
import {
  getMyLeaves, getManagerLeaves, getTeamAllLeaves, getLeaveLimits,
  getHolidays, getLeaveRules, getLeaveBalances,
  createLeave, updateLeave, approveLeave, rejectLeave, deleteLeave,
} from "../lib/api";
import {
  formatDate, formatDateShort, isManager, isL2, getLeaveStatus, countBusinessDays,
  LEAVE_TYPE_META,
} from "../lib/utils";
import Avatar from "../components/ui/Avatar";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import Modal from "../components/ui/Modal";
import Tooltip from "../components/ui/Tooltip";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import Spinner from "../components/ui/Spinner";

// ─── Constants ────────────────────────────────────────────────────────────────

const SPECIAL_SUBTYPES = [
  { id: "bereavement", label: "Bereavement",       note: "Up to 3 days",            limit: 3   },
  { id: "marriage",    label: "Marriage",           note: "Up to 10 days",           limit: 10  },
  { id: "maternity",   label: "Maternity",          note: "26 weeks (130 working days)", limit: 130 },
  { id: "paternity",   label: "Paternity",          note: "Up to 14 days",           limit: 14  },
  { id: "lwp",         label: "Leave Without Pay",  note: "No day limit",            limit: null},
];

// ─── Date helpers ─────────────────────────────────────────────────────────────

function isoDate(d) { return d.toISOString().slice(0, 10); }
function todayStr() { return new Date().toISOString().split("T")[0]; }

function isWorkingDay(d, holidaySet) {
  const dow = d.getDay();
  return dow >= 1 && dow <= 5 && !holidaySet.has(isoDate(d));
}

function nthWorkingDay(start, n, holidaySet) {
  const d = new Date(start);
  let count = isWorkingDay(d, holidaySet) ? 1 : 0;
  while (count < n) {
    d.setDate(d.getDate() + 1);
    if (isWorkingDay(d, holidaySet)) count++;
  }
  return d;
}

function calendarDaysFromToday(isoStr) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(isoStr + "T00:00:00");
  return Math.round((target - today) / 86400000);
}

function addCalendarDays(dateObj, n) {
  const d = new Date(dateObj);
  d.setDate(d.getDate() + n);
  return d;
}

function getNoticeRequired(duration, rules) {
  if (!Array.isArray(rules) || !rules.length) return 0;
  for (const rule of rules) {
    if (duration >= (rule.min ?? 1) && (rule.max == null || duration <= rule.max)) {
      return rule.notice ?? 0;
    }
  }
  return 0;
}

function fmtCal(d) {
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function fmtDateRange(start, end) {
  if (start === end) return formatDate(start);
  return `${formatDateShort(start)} → ${formatDateShort(end)}`;
}

function fmtDecidedAt(isoStr) {
  const d = new Date(isoStr);
  const day = d.getDate();
  const month = d.toLocaleString("en-US", { month: "short" });
  const time = d.toLocaleString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${day} ${month}, ${time}`;
}

function fmtTime(isoStr) {
  return new Date(isoStr).toLocaleString("en-US", { hour: "numeric", minute: "2-digit" });
}

function dedupById(leaves) {
  const seen = new Set();
  return leaves.filter(l => (seen.has(l.id) ? false : (seen.add(l.id), true)));
}

function sortByStartDesc(leaves) {
  return [...leaves].sort((a, b) => b.start_date.localeCompare(a.start_date));
}

function leaveLabel(type) { return LEAVE_TYPE_META[type]?.label ?? type; }
function leaveColor(type) { return LEAVE_TYPE_META[type]?.color ?? "#94a3b8"; }
function leaveBg(type)    { return LEAVE_TYPE_META[type]?.bg    ?? "#e2e8f0"; }
function leaveText(type)  { return LEAVE_TYPE_META[type]?.text  ?? "#334155"; }

function derivedStatus(leave) {
  if (leave.status === "rejected") return "declined";
  if (leave.status === "approved" && leave.start_date >= todayStr()) return "scheduled";
  if (leave.status === "approved") return "previous";
  const nextPending = leave.approvals?.find(a => a.status === "pending");
  if (nextPending?.step > 1) return "pending_l2";
  return "pending";
}

// ─── LeaveCalendar ────────────────────────────────────────────────────────────

function LeaveCalendar({ selected, onSelect, minDate, holidaySet, duration, open }) {
  const today = new Date(); today.setHours(12, 0, 0, 0);

  const [view, setView] = useState(() => {
    const base = minDate || today;
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  useEffect(() => {
    if (open && minDate) setView(new Date(minDate.getFullYear(), minDate.getMonth(), 1));
  }, [open, minDate?.toISOString?.().slice(0, 7)]);

  const year = view.getFullYear(), month = view.getMonth();
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const endDate = selected && duration ? nthWorkingDay(new Date(selected), duration, holidaySet) : null;

  function isDisabled(d) {
    if (isoDate(d) !== isoDate(today) && d < today) return true;
    if (d.getDay() === 0 || d.getDay() === 6) return true;
    if (holidaySet.has(isoDate(d))) return true;
    if (minDate && d < minDate) return true;
    return false;
  }

  const canPrev = !(year === today.getFullYear() && month === today.getMonth());
  const DOWS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

  return (
    <div className="w-[300px] bg-white border border-slate-200 rounded-xl shadow-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <button type="button" disabled={!canPrev} onClick={() => setView(new Date(year, month - 1, 1))}
          className="w-7 h-7 rounded-lg border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-50 disabled:opacity-30">
          <ChevronLeft size={14} />
        </button>
        <span className="text-[14px] font-semibold text-slate-700">
          {view.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
        </span>
        <button type="button" onClick={() => setView(new Date(year, month + 1, 1))}
          className="w-7 h-7 rounded-lg border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-50">
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="grid grid-cols-7 mb-1">
        {DOWS.map(d => <div key={d} className="text-center text-[11px] font-semibold text-slate-400 py-1">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {Array.from({ length: firstDow }).map((_, i) => <div key={`pad-${i}`} />)}
        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
          const d = new Date(year, month, day, 12);
          const iso = isoDate(d), dis = isDisabled(d);
          const isTod = isoDate(d) === isoDate(today), isSel = selected && iso === selected;
          const isHol = holidaySet.has(iso);
          const inRng = selected && endDate && d > new Date(selected) && d <= endDate;
          return (
            <button key={day} type="button" disabled={dis} onClick={() => onSelect(iso)} title={isHol ? "Holiday" : undefined}
              className={`relative h-9 rounded-lg text-[13.5px] transition-colors
                ${isSel ? "bg-[#2f6bff] text-white font-semibold" : ""}
                ${inRng && !isSel ? "bg-[#eef3ff]" : ""}
                ${!isSel && !inRng && !dis ? "hover:bg-[#eef3ff]" : ""}
                ${dis ? "text-slate-300 cursor-not-allowed" : "text-slate-700"}
                ${isTod && !isSel ? "ring-1 ring-inset ring-slate-400 font-semibold" : ""}
              `}>
              {day}
              {isHol && <span className={`absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full ${isSel ? "bg-white" : "bg-red-400"}`} />}
            </button>
          );
        })}
      </div>
      <div className="flex gap-4 mt-3 pt-3 border-t border-slate-100 text-[11px] text-slate-400">
        <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block" />Holiday</span>
        <span>Weekends &amp; past dates unavailable</span>
      </div>
    </div>
  );
}

// ─── Edit leave modal ─────────────────────────────────────────────────────────

function EditLeaveModal({ open, onClose, leave, holidays, leaveRules, onSuccess }) {
  const [duration, setDuration]   = useState(1);
  const [startDate, setStartDate] = useState(null);
  const [note, setNote]           = useState("");
  const [error, setError]         = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showCal, setShowCal]     = useState(false);
  const calRef = useRef(null);

  const holidaySet = useMemo(() => new Set((holidays || []).map(h => h.date)), [holidays]);
  const noticeRules = leaveRules?.earned_advance_notice ?? [];

  const isEarned = leave?.leave_type === "earned";
  const isSC     = leave?.leave_type === "sick_and_casual";

  // Init from the leave being edited
  useEffect(() => {
    if (!open || !leave) return;
    setNote(leave.note || "");
    setStartDate(leave.start_date);
    const d = countBusinessDays(leave.start_date, leave.end_date, holidays || []);
    setDuration(Math.max(1, d));
    setError("");
    setSubmitting(false);
    setShowCal(false);
  }, [open, leave?.id]);

  const noticeCalDays = useMemo(() => {
    if (!isEarned || leave?.is_exception) return 0;
    return getNoticeRequired(duration, noticeRules);
  }, [isEarned, duration, noticeRules, leave?.is_exception]);

  const minStartDate = useMemo(() => {
    const today = new Date(); today.setHours(12, 0, 0, 0);
    return noticeCalDays > 0 ? addCalendarDays(today, noticeCalDays) : today;
  }, [noticeCalDays]);

  const endDate = useMemo(() => {
    if (!startDate) return null;
    return nthWorkingDay(new Date(startDate), duration, holidaySet);
  }, [startDate, duration, holidaySet]);

  function applyDuration(n) {
    setDuration(Math.max(1, n));
    setStartDate(null);
  }

  useEffect(() => {
    function handler(e) {
      if (calRef.current && !calRef.current.contains(e.target)) setShowCal(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // The limit is not checked here — the API 422 surfaces in the error banner.
  const disabledReason = useMemo(() => {
    if (submitting) return "Saving your changes…";
    if (!startDate) return "Pick a start date.";
    if (!note.trim()) return "Add a note explaining this leave.";
    return null;
  }, [submitting, startDate, note]);

  async function handleSubmit() {
    if (!note.trim())  { setError("Note is required."); return; }
    if (!startDate)    { setError("Start date is required."); return; }
    setSubmitting(true);
    try {
      await updateLeave(leave.id, {
        note:       note.trim(),
        start_date: startDate,
        end_date:   endDate ? isoDate(endDate) : startDate,
      });
      onSuccess();
      onClose();
    } catch (ex) {
      setError(ex?.response?.data?.detail || "Failed to update leave request.");
    } finally {
      setSubmitting(false);
    }
  }

  const meta = LEAVE_TYPE_META[leave?.leave_type] ?? { label: leave?.leave_type, color: "#94a3b8" };

  return (
    <Modal open={open} onClose={onClose} size="md">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
        <div>
          <h2 className="text-[22px] font-bold text-slate-900 tracking-tight">Edit leave request</h2>
          <div className="flex items-center gap-2 mt-1">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: meta.color }} />
            <span className="text-[13.5px] font-semibold" style={{ color: meta.color }}>{meta.label}</span>
            {leave?.is_exception && (
              <span className="text-[12px] font-bold text-amber-900 bg-amber-100 border border-amber-300 rounded-md px-2.5 py-1 uppercase tracking-wider">Exception</span>
            )}
          </div>
        </div>
        <button type="button" onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
          <X size={18} />
        </button>
      </div>

      <div className="px-6 pt-5 pb-2 space-y-5 max-h-[75vh] overflow-y-auto">
        {/* Duration (not for S&C) */}
        {!isSC && (
          <div>
            <p className="text-[12px] font-semibold text-slate-400 uppercase tracking-wider mb-3">Duration</p>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="inline-flex items-center border-[1.5px] border-slate-200 rounded-xl overflow-hidden">
                <button type="button" disabled={duration <= 1} onClick={() => applyDuration(duration - 1)}
                  className="w-11 h-12 text-[20px] text-slate-500 hover:bg-slate-50 disabled:text-slate-300 disabled:cursor-not-allowed border-r border-slate-200 transition-colors">−</button>
                <div className="flex items-center justify-center gap-1.5 min-w-[108px] h-12 border-r border-slate-200">
                  <input type="number" min={1} value={duration}
                    onChange={e => applyDuration(parseInt(e.target.value) || 1)}
                    className="w-9 text-right text-[16px] font-bold text-slate-800 border-none outline-none bg-transparent" />
                  <span className="text-[15px] font-semibold text-slate-500">{duration === 1 ? "day" : "days"}</span>
                </div>
                <button type="button" onClick={() => applyDuration(duration + 1)}
                  className="w-11 h-12 text-[20px] text-slate-500 hover:bg-slate-50 transition-colors">+</button>
              </div>
              <div className="flex gap-2">
                {[1, 2, 3, 5].map(n => (
                  <button key={n} type="button" onClick={() => applyDuration(n)}
                    className={`w-11 h-12 border-[1.5px] rounded-xl text-[14px] font-semibold transition-all
                      ${duration === n ? "border-[#2f6bff] bg-[#eef3ff] text-[#2f6bff]" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"}`}
                  >{n}</button>
                ))}
              </div>
            </div>
            {isEarned && !leave?.is_exception && noticeCalDays > 0 && (
              <p className="text-[13px] text-slate-500 mt-3">
                {duration} day{duration !== 1 ? "s" : ""} of earned leave needs{" "}
                <b className="text-slate-700">{noticeCalDays} calendar days</b> notice.
                Earliest start: <b className="text-slate-700">{fmtCal(minStartDate)}</b>
              </p>
            )}
          </div>
        )}

        {/* Date picker */}
        <div>
          <p className="text-[12px] font-semibold text-slate-400 uppercase tracking-wider mb-3">
            {isSC ? "Date" : "Start date"}
          </p>
          <div className="relative" ref={calRef}>
            <button type="button" onClick={() => setShowCal(v => !v)}
              className={`flex items-center justify-between gap-3 w-full max-w-[280px] border-[1.5px] rounded-xl px-4 py-3 text-[15px] transition-colors cursor-pointer bg-white hover:border-slate-300
                ${startDate ? "text-slate-800 border-slate-300" : "text-slate-400 border-slate-200"}`}>
              <span>{startDate ? fmtCal(new Date(startDate + "T12:00:00")) : "Select a date"}</span>
              <CalendarDays size={16} className="text-slate-400 shrink-0" />
            </button>
            {showCal && (
              <div className="absolute top-full left-0 mt-2 z-50">
                <LeaveCalendar selected={startDate}
                  onSelect={iso => { setStartDate(iso); setShowCal(false); setError(""); }}
                  minDate={minStartDate} holidaySet={holidaySet} duration={duration} open={showCal} />
              </div>
            )}
          </div>
          {startDate && endDate && duration > 1 && (
            <p className="text-[13px] text-slate-500 mt-2.5">
              Ends <b className="font-semibold text-slate-700">{fmtCal(endDate)}</b>
              <span className="mx-1.5 text-slate-300">·</span>
              {duration} working days
            </p>
          )}
        </div>

        {/* Note */}
        <div>
          <p className="text-[12px] font-semibold text-slate-400 uppercase tracking-wider mb-3">
            Note <span className="text-red-500">*</span>
          </p>
          <textarea value={note} onChange={e => { setNote(e.target.value); setError(""); }}
            placeholder="Reason for leave…" rows={3}
            className="w-full border-[1.5px] border-slate-200 rounded-xl px-4 py-3 text-[15px] font-[inherit] text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#2f6bff] focus:ring-3 focus:ring-[#eef3ff] resize-none transition-colors" />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <p className="text-[13px] text-red-700">{error}</p>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-100">
        <button type="button" onClick={onClose}
          className="px-5 py-3 rounded-xl border-[1.5px] border-slate-200 bg-white text-[15px] font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
          Cancel
        </button>
        <Tooltip content={disabledReason}>
          <button type="button" onClick={handleSubmit} disabled={!!disabledReason}
            className="px-5 py-3 rounded-xl text-[15px] font-semibold text-white bg-[#2f6bff] hover:bg-[#1f57e0] transition-all disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400">
            {submitting ? "Saving…" : "Save changes"}
          </button>
        </Tooltip>
      </div>
    </Modal>
  );
}

// ─── Request leave modal (Phase 3) ────────────────────────────────────────────

function RequestLeaveModal({ open, onClose, holidays, leaveRules, unconstrained = false, isAdmin = false, balances, onSuccess }) {
  const [category, setCategory]     = useState(null); // "earned"|"sick_and_casual"|"special"
  const [specialType, setSpecialType] = useState("");
  const [duration, setDuration]     = useState(1);
  const [startDate, setStartDate]   = useState(null);
  const [note, setNote]             = useState("");
  const [isException, setIsException] = useState(false);
  const [error, setError]           = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showCal, setShowCal]       = useState(false);
  const [showInfo, setShowInfo]     = useState(false);
  const calRef  = useRef(null);
  const infoRef = useRef(null);

  const holidaySet = useMemo(() => new Set((holidays || []).map(h => h.date)), [holidays]);
  const noticeRules = leaveRules?.earned_advance_notice ?? [];
  const cutoffHour = leaveRules?.sick_and_casual_cutoff_hour ?? 10;
  const cutoffMin  = leaveRules?.sick_and_casual_cutoff_min  ?? 0;

  const noticeCalDays = useMemo(() => {
    if (unconstrained || category !== "earned" || isException) return 0;
    return getNoticeRequired(duration, noticeRules);
  }, [unconstrained, category, duration, noticeRules, isException]);

  const minStartDate = useMemo(() => {
    const today = new Date(); today.setHours(12, 0, 0, 0);
    if (noticeCalDays > 0) return addCalendarDays(today, noticeCalDays);
    return today;
  }, [noticeCalDays]);

  const endDate = useMemo(() => {
    if (!startDate) return null;
    return nthWorkingDay(new Date(startDate), duration, holidaySet);
  }, [startDate, duration, holidaySet]);

  // For S&C auto-approve check
  const willAutoApprove = useMemo(() => {
    if (category !== "sick_and_casual") return false;
    if (startDate !== todayStr()) return false;
    const now = new Date();
    return (now.getHours() * 60 + now.getMinutes()) < (cutoffHour * 60 + cutoffMin);
  }, [category, startDate, cutoffHour, cutoffMin]);

  // Reset on close/open
  useEffect(() => {
    if (!open) return;
    setCategory(null); setSpecialType(""); setDuration(1); setStartDate(null);
    setNote(""); setIsException(false); setError(""); setSubmitting(false);
    setShowCal(false); setShowInfo(false);
  }, [open]);

  // S&C defaults to today
  useEffect(() => {
    if (category === "sick_and_casual") setStartDate(todayStr());
    else setStartDate(null);
    setDuration(1); setIsException(false); setError("");
  }, [category]);

  // Changing duration for earned forces date re-pick
  function applyDuration(n) {
    setDuration(Math.max(1, n));
    setStartDate(null);
  }

  // Click-outside
  useEffect(() => {
    function handler(e) {
      if (calRef.current  && !calRef.current.contains(e.target))  setShowCal(false);
      if (infoRef.current && !infoRef.current.contains(e.target)) setShowInfo(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const leaveType = category === "special" ? specialType : category;

  // balances.taken counts approved days only, matching what the API enforces.
  const limitEntry     = leaveType ? balances?.[leaveType] : null;
  const limitRemaining = limitEntry?.limit != null ? limitEntry.limit - limitEntry.taken : null;
  const isOverLimit    = !isAdmin && limitRemaining != null && duration > limitRemaining;

  const overLimitText = useMemo(() => {
    if (!isOverLimit) return null;
    const label = LEAVE_TYPE_META[leaveType]?.label ?? leaveType;
    const dayWord = duration === 1 ? "day" : "days";
    return `This exceeds your ${label} limit. You have ${Math.max(0, limitRemaining)} of ` +
           `${limitEntry.limit} days remaining and this request is ${duration} working ${dayWord}. ` +
           `Submit is disabled until you shorten it.`;
  }, [isOverLimit, leaveType, limitRemaining, limitEntry, duration]);

  async function handleSubmit() {
    if (!note.trim())    { setError("Note is required."); return; }
    if (!startDate)      { setError("Start date is required."); return; }
    if (category === "special" && !specialType) { setError("Please select a leave type."); return; }
    setSubmitting(true);
    try {
      await createLeave({
        leave_type:   leaveType,
        note:         note.trim(),
        start_date:   startDate,
        end_date:     endDate ? isoDate(endDate) : startDate,
        is_exception: isException,
      });
      onSuccess();
      onClose();
    } catch (ex) {
      setError(ex?.response?.data?.detail || "Failed to submit leave request.");
    } finally {
      setSubmitting(false);
    }
  }

  // Ordered so the user sees the most actionable blocker first. null = submittable.
  const disabledReason = useMemo(() => {
    if (submitting) return "Submitting your request…";
    if (!category) return "Choose a leave type.";
    if (category === "special" && !specialType) return "Choose which type of special leave.";
    if (!startDate) return "Pick a start date.";
    if (!note.trim()) return "Add a note explaining this leave.";
    if (isOverLimit) return overLimitText;
    return null;
  }, [submitting, category, specialType, startDate, note, isOverLimit, overLimitText]);

  // Status hint
  const statusHint = useMemo(() => {
    if (!startDate || !category) return null;
    if (unconstrained) return { kind: "good", text: "Logged instantly — no approval needed." };
    if (isException) return null; // exception banner already shown in the duration section
    if (category === "sick_and_casual") {
      const fmtCutoff = `${cutoffHour % 12 || 12}:${String(cutoffMin).padStart(2, "0")} ${cutoffHour < 12 ? "AM" : "PM"}`;
      if (willAutoApprove) return { kind: "good", text: `Auto-approved — submitted before ${fmtCutoff}, no manager needed.` };
      if (startDate === todayStr()) return { kind: "warn", text: `After ${fmtCutoff} cutoff — needs manager approval.` };
      return { kind: "info", text: "Future Sick & Casual leave — no advance notice required." };
    }
    return { kind: "info", text: "Needs manager approval." };
  }, [unconstrained, startDate, category, isException, willAutoApprove, cutoffHour, cutoffMin]);

  const submitLabel = unconstrained ? "Log leave"
    : isException ? "Send exception request"
    : willAutoApprove ? "Log sick leave"
    : "Submit request";

  const CATEGORIES = [
    { id: "earned",          label: "Earned",         sub: "Planned time off" },
    { id: "sick_and_casual", label: "Sick & Casual",  sub: "Illness or short personal" },
    { id: "special",         label: "Special",        sub: "Marriage, bereavement & more" },
  ];

  return (
    <Modal open={open} onClose={onClose} size="md">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
        <h2 className="text-[22px] font-bold text-slate-900 tracking-tight">{unconstrained ? "Log leave" : "Request leave"}</h2>
        <div className="flex items-center gap-3">
          {/* Info popover */}
          <div className="relative" ref={infoRef}>
            <button type="button" onClick={() => setShowInfo(v => !v)}
              className="inline-flex items-center gap-1.5 border border-slate-200 rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold text-slate-600 hover:border-slate-300 transition-colors">
              <Info size={14} className="text-[#2f6bff]" />Leave rules
            </button>
            {showInfo && (
              <div className="absolute right-0 top-full mt-2 z-50 w-80 bg-white border border-slate-200 rounded-xl shadow-xl p-4 text-left">
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Earned leave</p>
                <p className="text-[12.5px] text-slate-600 leading-relaxed mb-3">
                  Calendar-day notice required: <b>1–2 days → 14 cal days</b>, <b>3–4 → 21</b>, <b>5+ → 30</b>. Always needs approval.
                </p>
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Sick & Casual</p>
                <p className="text-[12.5px] text-slate-600 leading-relaxed mb-3">
                  Same-day before <b>{cutoffHour % 12 || 12}:00 {cutoffHour < 12 ? "AM" : "PM"}</b> → auto-approved. Otherwise needs approval. No advance notice for future dates.
                </p>
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Special</p>
                <p className="text-[12.5px] text-slate-600 leading-relaxed mb-2">
                  Bereavement (3d), Marriage (10d), Maternity (26wk), Paternity (14d), LWP — all go through 2-step approval.
                </p>
                <div className="text-[11.5px] text-slate-400 border-t border-slate-100 pt-2">
                  Weekends &amp; public holidays don&apos;t count as leave days.
                </div>
              </div>
            )}
          </div>
          <button type="button" onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="px-6 pt-5 pb-2 space-y-5 max-h-[75vh] overflow-y-auto">
        {/* Category picker */}
        <div>
          <p className="text-[12px] font-semibold text-slate-400 uppercase tracking-wider mb-3">What kind of leave?</p>
          <div className="grid grid-cols-3 gap-3">
            {CATEGORIES.map(({ id, label, sub }) => (
              <button key={id} type="button" onClick={() => setCategory(id)}
                className={`border-[1.5px] rounded-xl p-3 text-center transition-all
                  ${category === id ? "border-[#2f6bff] bg-[#eef3ff]" : "border-slate-200 bg-white hover:border-slate-300"}`}>
                <p className={`text-[14px] font-semibold ${category === id ? "text-[#2f6bff]" : "text-slate-700"}`}>{label}</p>
                <p className="text-[11px] text-slate-400 mt-0.5 leading-tight">{sub}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Special sub-type */}
        {category === "special" && (
          <div>
            <p className="text-[12px] font-semibold text-slate-400 uppercase tracking-wider mb-3">Which type?</p>
            <select value={specialType} onChange={e => { setSpecialType(e.target.value); setDuration(1); setStartDate(null); }}
              className="w-full border-[1.5px] border-slate-200 rounded-xl px-4 py-3 text-[15px] text-slate-800 bg-white focus:outline-none focus:border-[#2f6bff] appearance-none">
              <option value="">Select leave type…</option>
              {SPECIAL_SUBTYPES.map(s => (
                <option key={s.id} value={s.id}>{s.label} — {s.note}</option>
              ))}
            </select>
          </div>
        )}

        {/* Duration (not shown for S&C) */}
        {category && category !== "sick_and_casual" && (category !== "special" || specialType) && (
          <div>
            <p className="text-[12px] font-semibold text-slate-400 uppercase tracking-wider mb-3">How long?</p>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="inline-flex items-center border-[1.5px] border-slate-200 rounded-xl overflow-hidden">
                <button type="button" disabled={duration <= 1} onClick={() => applyDuration(duration - 1)}
                  className="w-11 h-12 text-[20px] text-slate-500 hover:bg-slate-50 disabled:text-slate-300 disabled:cursor-not-allowed border-r border-slate-200 transition-colors">−</button>
                <div className="flex items-center justify-center gap-1.5 min-w-[108px] h-12 border-r border-slate-200">
                  <input type="number" min={1} value={duration}
                    onChange={e => applyDuration(parseInt(e.target.value) || 1)}
                    className="w-9 text-right text-[16px] font-bold text-slate-800 border-none outline-none bg-transparent" />
                  <span className="text-[15px] font-semibold text-slate-500">{duration === 1 ? "day" : "days"}</span>
                </div>
                <button type="button" onClick={() => applyDuration(duration + 1)}
                  className="w-11 h-12 text-[20px] text-slate-500 hover:bg-slate-50 disabled:text-slate-300 transition-colors">+</button>
              </div>
              <div className="flex gap-2">
                {[1, 2, 3, 5].map(n => (
                  <button key={n} type="button" onClick={() => applyDuration(n)}
                    className={`w-11 h-12 border-[1.5px] rounded-xl text-[14px] font-semibold transition-all
                      ${duration === n ? "border-[#2f6bff] bg-[#eef3ff] text-[#2f6bff]" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"}`}
                  >{n}</button>
                ))}
              </div>
            </div>

            {/* Notice info for earned */}
            {category === "earned" && !isException && noticeCalDays > 0 && (
              <p className="text-[13px] text-slate-500 mt-3">
                {duration} working day{duration !== 1 ? "s" : ""} of earned leave needs{" "}
                <b className="text-slate-700">{noticeCalDays} calendar days</b> notice.
                Earliest start: <b className="text-slate-700">{fmtCal(minStartDate)}</b>
              </p>
            )}
            {category === "earned" && isException && (
              <div className="mt-3 flex items-start gap-2 bg-[#f0ecfe] border border-[#cfc2f7] text-[#7c5cf0] rounded-xl px-3 py-2.5 text-[12.5px] leading-relaxed">
                <Info size={15} className="mt-0.5 shrink-0" />
                <span><b>Exception mode.</b> Notice rules waived — routes directly to your skip manager.{" "}
                  <button type="button" onClick={() => { setIsException(false); setStartDate(null); setError(""); }} className="underline font-semibold">Cancel exception</button>
                </span>
              </div>
            )}
          </div>
        )}

        {/* Date picker */}
        {category && (category !== "special" || specialType) && (
          <div>
            <p className="text-[12px] font-semibold text-slate-400 uppercase tracking-wider mb-3">
              {category === "sick_and_casual" ? "Which day?" : "When does it start?"}
            </p>
            <div className="relative" ref={calRef}>
              <button type="button"
                onClick={() => setShowCal(v => !v)}
                className={`flex items-center justify-between gap-3 w-full max-w-[280px] border-[1.5px] rounded-xl px-4 py-3 text-[15px] transition-colors cursor-pointer
                  ${startDate ? "text-slate-800 border-slate-300" : "text-slate-400 border-slate-200"}
                  bg-white hover:border-slate-300`}>
                <span>{startDate ? fmtCal(new Date(startDate + "T12:00:00")) : "Select a date"}</span>
                <CalendarDays size={16} className="text-slate-400 shrink-0" />
              </button>
              {showCal && (
                <div className="absolute top-full left-0 mt-2 z-50">
                  <LeaveCalendar selected={startDate}
                    onSelect={iso => { setStartDate(iso); setShowCal(false); setError(""); }}
                    minDate={minStartDate} holidaySet={holidaySet} duration={duration} open={showCal} />
                </div>
              )}
            </div>

            {startDate && endDate && duration > 1 && (
              <p className="text-[13px] text-slate-500 mt-2.5">
                Ends <b className="font-semibold text-slate-700">{fmtCal(endDate)}</b>
                <span className="mx-1.5 text-slate-300">·</span>
                {duration} working days
              </p>
            )}

            {statusHint && (
              <div className={`mt-2.5 flex items-center gap-2 text-[13px] rounded-xl px-3 py-2.5
                ${statusHint.kind === "good" ? "bg-[#e9f7f0] border border-[#bfe8d4] text-[#0b6b4c]"
                : statusHint.kind === "exc"  ? "bg-[#f0ecfe] border border-[#cfc2f7] text-[#7c5cf0]"
                : statusHint.kind === "warn" ? "bg-amber-50 border border-amber-200 text-amber-800"
                : "bg-slate-50 border border-slate-200 text-slate-600"}`}>
                {statusHint.text}
              </div>
            )}

            {category === "earned" && !isException && !unconstrained && (
              <p className="text-[12.5px] text-slate-400 mt-2.5">
                Need it sooner?{" "}
                <button type="button" onClick={() => { setIsException(true); setStartDate(null); }}
                  className="text-[#7c5cf0] font-semibold underline">Request an exception →</button>
              </p>
            )}
          </div>
        )}

        {/* Note */}
        {category && (category !== "special" || specialType) && (
          <div>
            <p className="text-[12px] font-semibold text-slate-400 uppercase tracking-wider mb-3">
              Note <span className="text-red-500">*</span>
            </p>
            <textarea value={note} onChange={e => { setNote(e.target.value); setError(""); }}
              placeholder="Reason for leave…" rows={3}
              className="w-full border-[1.5px] border-slate-200 rounded-xl px-4 py-3 text-[15px] font-[inherit] text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[#2f6bff] focus:ring-3 focus:ring-[#eef3ff] resize-none transition-colors" />
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <p className="text-[13px] text-red-700">{error}</p>
          </div>
        )}

        {isOverLimit && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex gap-2.5">
            <AlertTriangle size={16} className="text-red-600 shrink-0 mt-0.5" />
            <p className="text-[14px] text-red-700 leading-snug">
              <span className="font-semibold">
                This exceeds your {LEAVE_TYPE_META[leaveType]?.label ?? leaveType} limit.
              </span>{" "}
              You have {Math.max(0, limitRemaining)} of {limitEntry.limit} days remaining and this
              request is {duration} working {duration === 1 ? "day" : "days"}. Submit is disabled
              until you shorten it.
            </p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-100">
        <button type="button" onClick={onClose}
          className="px-5 py-3 rounded-xl border-[1.5px] border-slate-200 bg-white text-[15px] font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
          Cancel
        </button>
        <Tooltip content={disabledReason} variant={isOverLimit ? "danger" : "default"}>
          <button type="button" onClick={handleSubmit} disabled={!!disabledReason}
            className={`px-5 py-3 rounded-xl text-[15px] font-semibold text-white transition-all disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400
              ${isException ? "bg-[#7c5cf0] hover:bg-[#6b4fd8]" : "bg-[#2f6bff] hover:bg-[#1f57e0]"}`}>
            {submitting ? "Submitting…" : submitLabel}
          </button>
        </Tooltip>
      </div>
    </Modal>
  );
}

// ─── Balance cards (Phase 4) ──────────────────────────────────────────────────

function BalanceProgressCard({ label, type, taken, limit }) {
  const pct = limit > 0 ? Math.min(taken / limit, 1) : 0;
  const remaining = limit != null ? Math.max(0, limit - taken) : null;
  const isOver = limit != null && taken > limit;
  const color = LEAVE_TYPE_META[type]?.color ?? "#3b82f6";

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5">
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-3">{label}</p>
      <div className="flex items-end justify-between mb-3">
        <div>
          <span className={`text-[32px] font-bold leading-none ${isOver ? "text-red-600" : "text-slate-900"}`}>
            {remaining ?? "∞"}
          </span>
          {limit != null && <span className="text-[14px] text-slate-400 ml-1">of {limit} left</span>}
        </div>
        <span className="text-[12px] text-slate-400">{taken} used</span>
      </div>
      {limit != null && (
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all"
            style={{ width: `${pct * 100}%`, backgroundColor: isOver ? "#ef4444" : color }} />
        </div>
      )}
    </div>
  );
}

function SpecialBalanceCard({ balances }) {
  const specials = ["bereavement", "marriage", "maternity", "paternity", "lwp"];
  const taken = specials.filter(t => (balances?.[t]?.taken ?? 0) > 0);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5">
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-3">Special Leaves</p>
      {taken.length === 0 ? (
        <p className="text-[13px] text-slate-400 pt-1">No special leave taken this year.</p>
      ) : (
        <div className="space-y-2">
          {taken.map(type => {
            const meta = LEAVE_TYPE_META[type];
            const b = balances[type];
            return (
              <div key={type} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: meta.color }} />
                  <span className="text-[13px] text-slate-700">{meta.label}</span>
                </div>
                <span className="text-[13px] font-semibold text-slate-600">
                  {b.taken}d {b.limit != null ? `/ ${b.limit}d` : ""}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Action Required panel ────────────────────────────────────────────────────

function ActionRequiredPanel({ leaves, holidays, onApprove, onReject, onOpenDrawer }) {
  if (!leaves.length) return null;
  return (
    <div className="mb-6 bg-white border border-amber-200 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 bg-[#fffaf1]">
        <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
        <span className="text-[16px] font-bold text-slate-900">Action required</span>
        <span className="text-[13px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-3 py-1">
          {leaves.length} awaiting your approval
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-y border-slate-100">
              <th className="text-left text-[12px] font-semibold text-slate-400 uppercase tracking-wider py-3.5 pl-6 pr-6">Employee</th>
              <th className="text-left text-[12px] font-semibold text-slate-400 uppercase tracking-wider py-3.5 px-6">Leave</th>
              <th className="text-left text-[12px] font-semibold text-slate-400 uppercase tracking-wider py-3.5 px-6">Dates</th>
              <th className="text-left text-[12px] font-semibold text-slate-400 uppercase tracking-wider py-3.5 px-6">Reason</th>
              <th className="text-left text-[12px] font-semibold text-slate-400 uppercase tracking-wider py-3.5 px-6">Applied</th>
              <th className="py-3.5 pr-6 pl-6" />
            </tr>
          </thead>
          <tbody>
            {leaves.map((leave, i) => {
              const days = countBusinessDays(leave.start_date, leave.end_date, holidays || []);
              return (
                <tr key={leave.id}
                  className={`cursor-pointer hover:bg-slate-50 transition-colors ${i > 0 ? "border-t border-slate-100" : ""}`}
                  onClick={() => onOpenDrawer(leave, "manager")}>
                  {/* Employee */}
                  <td className="py-5 pl-6 pr-6 whitespace-nowrap">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={leave.user.name} size="sm" />
                      <span className="text-[14.5px] font-semibold text-slate-900">{leave.user.name}</span>
                    </div>
                  </td>
                  {/* Leave */}
                  <td className="py-5 px-6 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-2 rounded-full px-5 py-2 text-[15px] font-semibold"
                        style={{ backgroundColor: leaveBg(leave.leave_type), color: leaveText(leave.leave_type) }}>
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: leaveText(leave.leave_type) }} />
                        {leaveLabel(leave.leave_type)}
                      </span>
                      {leave.is_exception && (
                        <span className="text-[12px] font-bold text-amber-900 bg-amber-100 border border-amber-300 rounded-md px-2.5 py-1 uppercase tracking-wider">Exception</span>
                      )}
                    </div>
                  </td>
                  {/* Dates */}
                  <td className="py-5 px-6">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[14px] font-medium text-slate-800 whitespace-nowrap">{fmtDateRange(leave.start_date, leave.end_date)}</span>
                      <span className="text-[12.5px] text-slate-400">{days} day{days !== 1 ? "s" : ""}</span>
                    </div>
                  </td>
                  {/* Reason */}
                  <td className="py-5 px-6">
                    <p className="text-[14px] text-slate-500 truncate w-[250px]">{leave.note || "—"}</p>
                  </td>
                  {/* Applied */}
                  <td className="py-5 px-6 whitespace-nowrap">
                    <span className="text-[14px] font-medium text-slate-700">
                      {leave.created_at ? formatDateShort(leave.created_at.split("T")[0]) : "—"}
                    </span>
                    {leave.created_at && (
                      <span className="text-[13px] text-slate-400 ml-1.5">· {fmtTime(leave.created_at)}</span>
                    )}
                  </td>
                  {/* Actions */}
                  <td className="py-5 pr-6 pl-6 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => onApprove(leave.id)}
                        className="text-[14px] font-semibold px-5 py-2.5 rounded-xl bg-[#5b52f0] text-white hover:bg-[#4a41e0] transition-colors">
                        Approve
                      </button>
                      <button onClick={() => onReject(leave)}
                        className="text-[14px] font-semibold px-4 py-2.5 rounded-xl text-red-600 hover:bg-red-50 transition-colors">
                        Decline
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Leave table components ────────────────────────────────────────────────────

function LeaveTypeChip({ type }) {
  const meta = LEAVE_TYPE_META[type] ?? { label: type, text: "#334155", bg: "#e2e8f0" };
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold"
      style={{ backgroundColor: meta.bg, color: meta.text }}>
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: meta.text }} />
      {meta.label}
    </span>
  );
}

const DOT = ({ color }) => <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${color}`} />;

const STATUS_BADGE_CLS = "text-[13.5px] font-semibold px-4 py-[5.5px]";

function StatusBadge({ status }) {
  if (status === "scheduled")  return <Badge variant="blue"   className={STATUS_BADGE_CLS}><DOT color="bg-blue-700" />Scheduled</Badge>;
  if (status === "previous")   return <Badge variant="slate"  className={STATUS_BADGE_CLS}><DOT color="bg-slate-500" />Previous</Badge>;
  if (status === "declined")   return <Badge variant="red"    className={STATUS_BADGE_CLS}><DOT color="bg-red-700" />Declined</Badge>;
  if (status === "pending_l2") return <Badge variant="yellow" className={STATUS_BADGE_CLS}><DOT color="bg-amber-700" />Pending approval</Badge>;
  return <Badge variant="yellow" className={STATUS_BADGE_CLS}><DOT color="bg-amber-700" />Pending approval</Badge>;
}

function ApprovalChainCell({ leave }) {
  const approvals = leave.approvals ?? [];
  if (!approvals.length) return <span className="text-[13px] text-slate-400">—</span>;

  const sorted = [...approvals].sort((a, b) => a.step - b.step);
  const firstPendingIdx = sorted.findIndex(a => a.status === "pending");

  function nameColor(a, idx) {
    if (a.status === "approved") return "text-emerald-600 font-semibold";
    if (a.status === "rejected") return "text-red-500 font-semibold";
    if (idx === firstPendingIdx) return "text-amber-600 font-semibold";
    return "text-slate-300 font-medium";
  }

  // Compute status note
  let note = null;
  if (leave.status === "rejected") {
    const rej = sorted.find(a => a.status === "rejected");
    const when = rej?.decided_at ? fmtDecidedAt(rej.decided_at) : null;
    note = <span className="text-red-500">Declined{when ? ` · ${when}` : ""}</span>;
  } else if (leave.status === "approved") {
    const last = sorted.filter(a => a.decided_at).sort((a,b) => b.decided_at.localeCompare(a.decided_at))[0];
    const when = last?.decided_at ? fmtDecidedAt(last.decided_at) : null;
    note = <span className="text-slate-400">Approved{when ? ` · ${when}` : ""}</span>;
  } else {
    const lastApproved = sorted.filter(a => a.status === "approved").sort((a,b) => b.step - a.step)[0];
    const pendingApproval = sorted.find(a => a.status === "pending");
    if (lastApproved) {
      const firstName = lastApproved.approver.name.split(" ")[0];
      const when = lastApproved.decided_at ? fmtDecidedAt(lastApproved.decided_at) : null;
      note = <span className="text-slate-400">{firstName} approved{when ? ` · ${when}` : ""}</span>;
    } else if (pendingApproval) {
      note = <span className="text-slate-400">Awaiting {pendingApproval.approver.name.split(" ")[0]}</span>;
    }
  }

  return (
    <div>
      <div className="flex items-center gap-0.5 flex-wrap">
        {sorted.map((a, i) => (
          <span key={a.id} className="flex items-center gap-0.5">
            {i > 0 && <span className="text-slate-300 text-[12px] mx-1">→</span>}
            <span className={`text-[14px] ${nameColor(a, i)}`}>
              {a.approver.name.split(" ")[0]}
            </span>
          </span>
        ))}
      </div>
      {note && <p className="text-[12px] mt-0.5 leading-snug">{note}</p>}
    </div>
  );
}

function LeaveTableRow({ leave, holidays, onDelete, onEdit, onClick, showEmployee }) {
  const status = derivedStatus(leave);
  const days = countBusinessDays(leave.start_date, leave.end_date, holidays || []);
  const isPending   = status === "pending" || status === "pending_l2";
  const isScheduled = status === "scheduled";

  return (
    <tr className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors" onClick={onClick}>
      {showEmployee && (
        <td className="py-4 pl-6 pr-4 w-[300px]">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar name={leave.user.name} size="sm" />
            <span className="text-[15px] font-semibold text-slate-800 truncate">{leave.user.name}</span>
          </div>
        </td>
      )}
      <td className="py-4 px-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-2 rounded-full px-5 py-2 text-[15px] font-semibold"
              style={{ backgroundColor: leaveBg(leave.leave_type), color: leaveText(leave.leave_type) }}>
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: leaveText(leave.leave_type) }} />
              {leaveLabel(leave.leave_type)}
            </span>
            {leave.is_exception && (
              <span className="text-[12px] font-bold text-amber-900 bg-amber-100 border border-amber-300 rounded-md px-2.5 py-1 uppercase tracking-wider">Exception</span>
            )}
            {leave.over_limit && (
              <span className="inline-flex items-center gap-0.5 text-[10.5px] font-medium text-red-900 bg-red-100 rounded px-1.5 py-px">
                <AlertTriangle size={9} />Over limit
              </span>
            )}
          </div>
          {leave.note && <p className="text-[12.5px] text-slate-400 truncate max-w-[200px]">{leave.note}</p>}
        </div>
      </td>
      <td className="py-4 px-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-[14px] font-medium text-slate-800 whitespace-nowrap">{fmtDateRange(leave.start_date, leave.end_date)}</span>
          <span className="text-[12.5px] text-slate-400">{days} day{days !== 1 ? "s" : ""}</span>
        </div>
      </td>
      <td className="py-4 px-4"><StatusBadge status={status} /></td>
      <td className="py-4 px-4"><ApprovalChainCell leave={leave} /></td>
      <td className="py-4 px-4 text-right" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 justify-end">
          {isPending && onEdit && (
            <button onClick={(e) => { e.stopPropagation(); onEdit(leave); }} title="Edit"
              className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
              <Pencil size={17} />
            </button>
          )}
          {(isPending || isScheduled) && onDelete && (
            <button onClick={(e) => { e.stopPropagation(); onDelete(leave.id); }}
              className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors">
              <Trash2 size={17} />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

function LeaveTable({ leaves, holidays, onDelete, onEdit, onRowClick, showEmployee }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50">
            {showEmployee && <th className="text-left text-[12px] font-semibold text-slate-400 uppercase tracking-wider py-3.5 pl-6 pr-4 w-[300px]">Employee</th>}
            <th className="text-left text-[12px] font-semibold text-slate-400 uppercase tracking-wider py-3.5 px-4">Leave</th>
            <th className="text-left text-[12px] font-semibold text-slate-400 uppercase tracking-wider py-3.5 px-4">Dates</th>
            <th className="text-left text-[12px] font-semibold text-slate-400 uppercase tracking-wider py-3.5 px-4">Status</th>
            <th className="text-left text-[12px] font-semibold text-slate-400 uppercase tracking-wider py-3.5 px-4">Approved by</th>
            <th className="py-3.5 px-3" />
          </tr>
        </thead>
        <tbody>
          {leaves.length === 0 ? (
            <tr>
              <td colSpan={showEmployee ? 6 : 5} className="py-12 text-center text-[15px] text-slate-400">
                No leaves to show.
              </td>
            </tr>
          ) : (
            leaves.map(leave => (
              <LeaveTableRow key={leave.id} leave={leave} holidays={holidays}
                onDelete={onDelete} onEdit={onEdit} onClick={() => onRowClick(leave)}
                showEmployee={showEmployee} />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function FilterChips({ options, active, onChange }) {
  return (
    <div className="flex gap-2 flex-wrap">
      {options.map(({ id, label, count }) => (
        <button key={id} onClick={() => onChange(id)}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[13.5px] font-medium transition-all
            ${active === id ? "bg-slate-900 text-white" : "bg-white border border-slate-200 text-slate-600 hover:border-slate-300"}`}>
          {label}
          {count != null && (
            <span className={`text-[11.5px] font-semibold px-1.5 rounded-full ${active === id ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"}`}>
              {count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ─── Side Drawer ──────────────────────────────────────────────────────────────

function ApprovalSteps({ leave }) {
  const approvals = leave?.approvals;
  if (!approvals?.length) return null;

  const sorted = [...approvals].sort((a, b) => a.step - b.step);
  const firstPendingIdx = sorted.findIndex(a => a.status === "pending");

  function circleStyle(a, idx) {
    if (a.status === "approved") return "bg-emerald-50 border-2 border-emerald-400 text-emerald-500";
    if (a.status === "rejected") return "bg-red-50 border-2 border-red-400 text-red-500";
    if (idx === firstPendingIdx) return "bg-amber-50 border-2 border-amber-400 text-amber-500";
    return "bg-white border-2 border-slate-200 text-slate-300";
  }

  function nameColor(a, idx) {
    if (a.status === "approved") return "text-emerald-600";
    if (a.status === "rejected") return "text-red-500";
    if (idx === firstPendingIdx) return "text-slate-900";
    return "text-slate-400";
  }

  function statusLine(a, idx) {
    if (a.status === "approved") return { text: `Approved${a.decided_at ? ` · ${fmtDecidedAt(a.decided_at)}` : ""}`, cls: "text-emerald-500" };
    if (a.status === "rejected") return { text: `Declined${a.decided_at ? ` · ${fmtDecidedAt(a.decided_at)}` : ""}`, cls: "text-red-500" };
    if (idx === firstPendingIdx) return { text: "Pending", cls: "text-amber-600" };
    return { text: "Waiting", cls: "text-slate-400" };
  }

  return (
    <div>
      {sorted.map((a, idx) => {
        const isLast = idx === sorted.length - 1;
        const { text, cls } = statusLine(a, idx);
        return (
          <div key={a.id} className="flex gap-4">
            <div className="flex flex-col items-center">
              <div className={`w-6 h-6 rounded-full shrink-0 ${circleStyle(a, idx)}`} />
              {!isLast && <div className="w-px bg-slate-200 flex-1 my-1" style={{ minHeight: 24 }} />}
            </div>
            <div className={`${isLast ? "pb-0" : "pb-6"} min-w-0`}>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">{a.approver.role}</p>
              <p className={`text-[15px] font-bold leading-snug ${nameColor(a, idx)}`}>{a.approver.name}</p>
              <p className={`text-[13px] font-medium mt-0.5 ${cls}`}>{text}</p>
              {a.rejection_note && <p className="text-[12.5px] text-red-500 italic mt-1">"{a.rejection_note}"</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BalanceBar({ type, entry }) {
  if (!entry || entry.limit == null) return null;
  const meta = LEAVE_TYPE_META[type];
  const pct = Math.min(entry.taken / entry.limit, 1) * 100;
  const remaining = Math.max(0, entry.limit - entry.taken);
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2 w-[132px] shrink-0">
        <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: meta.color }} />
        <span className="text-[13.5px] font-medium text-slate-700">{meta.label}</span>
      </div>
      <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: meta.color }} />
      </div>
      <span className="text-[13.5px] font-semibold text-slate-800 shrink-0 whitespace-nowrap">
        {remaining} of {entry.limit} left
      </span>
    </div>
  );
}

function EmployeeBalanceBlock({ balances, name }) {
  if (!balances) return null;
  const firstName = (name || "").split(" ")[0];
  const title = name ? `${firstName}'s leave balance` : "Your leave balance";

  const specials = ["bereavement", "marriage", "maternity", "paternity", "lwp"];
  const takenSpecials = specials
    .filter(t => (balances[t]?.taken ?? 0) > 0)
    .map(t => `${LEAVE_TYPE_META[t].label} ${balances[t].taken}d`);

  return (
    <div className="bg-slate-50 rounded-xl p-4">
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-3">{title}</p>
      <div className="space-y-2.5">
        <BalanceBar type="earned" entry={balances.earned} />
        <BalanceBar type="sick_and_casual" entry={balances.sick_and_casual} />
      </div>
      {takenSpecials.length > 0 && (
        <div className="border-t border-slate-200 mt-3 pt-3">
          <p className="text-[13px] text-slate-500">
            <span className="font-medium text-slate-600">Special taken</span> · {takenSpecials.join(", ")}
          </p>
        </div>
      )}
    </div>
  );
}

function SideDrawer({ leave, context, holidays, onClose, onDelete, onApprove, onRejectOpen, balances }) {
  if (!leave) return null;
  const days = countBusinessDays(leave.start_date, leave.end_date, holidays || []);
  const status = derivedStatus(leave);
  const meta = LEAVE_TYPE_META[leave.leave_type] ?? { label: leave.leave_type, color: "#94a3b8", bg: "#f8fafc" };
  const rejectionNote = leave.approvals?.find(a => a.status === "rejected")?.rejection_note;
  const isOwn = context === "own";
  const isManager = context === "manager";
  // Manager/readonly views show the employee's balances (from the leave payload);
  // own view uses the logged-in user's balances.
  const balanceSource = isOwn ? balances : leave.user_balances;
  const showActions = isManager && (status === "pending" || status === "pending_l2");

  return (
    <div className="fixed inset-0 z-40 flex justify-end" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/20" />
      {/* Panel */}
      <div className="relative w-[440px] max-w-full h-full bg-white shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b border-slate-100">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2.5">
              <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: meta.color }} />
              <span className="text-[19px] font-bold text-slate-900">{meta.label}</span>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 transition-colors">
              <X size={18} />
            </button>
          </div>
          <div className="mt-3">
            <StatusBadge status={status} />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Exception callout */}
          {leave.is_exception && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-3 py-3 text-[13px]">
              <Info size={15} className="mt-0.5 shrink-0" />
              <span><b>Exception request</b> — notice rules waived, routed to skip manager.</span>
            </div>
          )}

          {/* Over limit */}
          {leave.over_limit && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl px-3 py-3 text-[13px]">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <span>This leave exceeds the {meta.label} limit for the year.</span>
            </div>
          )}

          {/* Employee (manager / readonly view) */}
          {!isOwn && (
            <div>
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Employee</p>
              <div className="flex items-center gap-2.5">
                <Avatar name={leave.user.name} size="sm" />
                <span className="text-[15.5px] font-semibold text-slate-900">{leave.user.name}</span>
              </div>
            </div>
          )}

          {/* Details grid */}
          <div className="grid grid-cols-2 gap-y-5 gap-x-4">
            {[
              { label: "Dates",      value: fmtDateRange(leave.start_date, leave.end_date) },
              { label: "Duration",   value: `${days} day${days !== 1 ? "s" : ""}` },
              { label: "Applied on", value: leave.created_at ? fmtDecidedAt(leave.created_at) : "—" },
              { label: "Leave type", value: meta.label },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">{label}</p>
                <p className="text-[15px] font-semibold text-slate-900">{value}</p>
              </div>
            ))}
          </div>

          {/* Balance block */}
          <EmployeeBalanceBlock balances={balanceSource} name={isOwn ? null : leave.user.name} />

          {/* Reason */}
          {leave.note && (
            <div>
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Reason</p>
              <div className="bg-slate-50 rounded-xl px-4 py-3.5 border border-slate-100">
                <p className="text-[14.5px] text-slate-700 leading-relaxed">{leave.note}</p>
              </div>
            </div>
          )}

          {/* Decline note */}
          {rejectionNote && (
            <div className="bg-red-50 border border-red-100 rounded-xl p-4">
              <p className="text-[11px] font-semibold text-red-400 uppercase tracking-wider mb-1">Decline reason</p>
              <p className="text-[14px] text-red-700">"{rejectionNote}"</p>
            </div>
          )}

          {/* Approval chain */}
          {leave.approvals?.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-4">Approval chain</p>
              <ApprovalSteps leave={leave} />
            </div>
          )}
        </div>

        {/* Footer actions */}
        {(showActions || (isOwn && (status === "pending" || status === "pending_l2" || status === "scheduled"))) && (
          <div className="border-t border-slate-100 px-6 py-4">
            {isOwn && (status === "pending" || status === "pending_l2" || status === "scheduled") && (
              <button onClick={() => { onClose(); onDelete(leave.id); }}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-[1.5px] border-red-200 text-red-600 text-[15px] font-semibold hover:bg-red-50 transition-colors">
                <Trash2 size={16} /> Withdraw leave
              </button>
            )}
            {showActions && (
              <div className="flex items-center gap-3">
                <button onClick={() => { onClose(); onApprove(leave.id); }}
                  className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl bg-[#5b52f0] text-white text-[15px] font-semibold hover:bg-[#4a41e0] transition-colors">
                  <Check size={17} /> Approve
                </button>
                <button onClick={() => onRejectOpen(leave)}
                  className="flex-1 flex items-center justify-center py-3.5 rounded-xl text-red-600 text-[15px] font-semibold hover:bg-red-50 transition-colors">
                  Decline
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Reject dialog ────────────────────────────────────────────────────────────

function RejectModal({ open, onClose, onReject }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (!open) { setReason(""); setError(""); } }, [open]);

  async function handleSubmit() {
    if (!reason.trim()) { setError("Reason is required."); return; }
    setLoading(true);
    try { await onReject(reason.trim()); onClose(); }
    catch { setError("Failed to reject leave."); }
    finally { setLoading(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Decline leave request" size="sm">
      <div className="p-6">
        <p className="text-[13px] text-slate-600 mb-4">Please provide a reason for declining this leave request.</p>
        <textarea value={reason} onChange={e => { setReason(e.target.value); setError(""); }} rows={3} placeholder="Reason for declining…"
          className="w-full border-[1.5px] border-slate-200 rounded-xl px-4 py-3 text-[14px] font-[inherit] placeholder-slate-400 focus:outline-none focus:border-[#2f6bff] resize-none" />
        {error && <p className="text-[12px] text-red-600 mt-2">{error}</p>}
        <div className="flex gap-3 mt-4">
          <Button variant="secondary" size="md" onClick={onClose} disabled={loading}>Cancel</Button>
          <button onClick={handleSubmit} disabled={loading}
            className="px-5 py-2.5 rounded-xl bg-red-600 text-white text-[14px] font-semibold hover:bg-red-700 disabled:opacity-50 transition-colors">
            {loading ? "Declining…" : "Decline"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Holidays tab ─────────────────────────────────────────────────────────────

function HolidaysTab({ holidays }) {
  const today = todayStr();
  const grouped = {};
  (holidays || []).forEach(h => {
    const month = new Date(h.date + "T00:00:00").toLocaleString("en-US", { month: "long", year: "numeric" });
    if (!grouped[month]) grouped[month] = [];
    grouped[month].push(h);
  });

  const nextUp = holidays.find(h => h.date >= today);

  return (
    <div className="space-y-6">
      {Object.entries(grouped).map(([month, items]) => (
        <div key={month}>
          <p className="text-[12px] font-semibold text-slate-400 uppercase tracking-wider mb-2">{month}</p>
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            {items.map((h, i) => {
              const isPast = h.date < today;
              const isNext = h.date === nextUp?.date;
              const d = new Date(h.date + "T00:00:00");
              const dayName = d.toLocaleString("en-US", { weekday: "long" });
              const formatted = d.toLocaleString("en-US", { month: "short", day: "numeric" });
              return (
                <div key={h.date} className={`flex items-center justify-between py-3 px-5 ${i > 0 ? "border-t border-slate-100" : ""} ${isPast ? "opacity-40" : ""}`}>
                  <div className="flex items-center gap-3">
                    {isNext && <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5 uppercase tracking-wide">Next up</span>}
                    <span className={`text-[14px] font-medium ${isPast ? "text-slate-500" : "text-slate-800"}`}>{h.name}</span>
                  </div>
                  <span className="text-[13px] text-slate-500">{dayName}, {formatted}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {Object.keys(grouped).length === 0 && <p className="text-[14px] text-slate-400 py-8 text-center">No holidays listed.</p>}
    </div>
  );
}

// ─── Main Leaves page (Phase 4) ───────────────────────────────────────────────

export default function Leaves() {
  const { user } = useUser();

  const [myLeaves,      setMyLeaves]      = useState(null);
  const [managerLeaves, setManagerLeaves] = useState([]);
  const [teamLeaves,    setTeamLeaves]    = useState(null);
  const [balances,      setBalances]      = useState(null);
  const [limits,        setLimits]        = useState(null);
  const [holidays,      setHolidays]      = useState([]);
  const [leaveRules,    setLeaveRules]    = useState(null);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState("");

  const [activeTab,   setActiveTab]   = useState("my");
  const [myFilter,    setMyFilter]    = useState("all");
  const [teamFilter,  setTeamFilter]  = useState("all");

  const [showRequest,    setShowRequest]    = useState(false);
  const [editLeave,      setEditLeave]      = useState(null);
  const [drawerLeave,    setDrawerLeave]    = useState(null);
  const [drawerContext,  setDrawerContext]  = useState("own");
  const [rejectLeaveObj, setRejectLeaveObj] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deleting,       setDeleting]       = useState(false);

  const userIsManager = isManager(user);
  const userIsL2      = isL2(user);

  const fetchMyLeaves = useCallback(async () => {
    const data = await getMyLeaves();
    setMyLeaves(data);
  }, []);

  const fetchManagerLeaves = useCallback(async () => {
    if (!userIsManager) return;
    const data = await getManagerLeaves();
    setManagerLeaves(data);
  }, [userIsManager]);

  const fetchTeamLeaves = useCallback(async () => {
    if (!userIsManager) return;
    const data = await getTeamAllLeaves();
    setTeamLeaves(data);
  }, [userIsManager]);

  const fetchBalances = useCallback(async () => {
    const data = await getLeaveBalances();
    setBalances(data);
  }, []);

  useEffect(() => {
    async function init() {
      setLoading(true);
      try {
        const promises = [getMyLeaves(), getLeaveLimits(), getHolidays(), getLeaveRules(), getLeaveBalances()];
        if (userIsManager) promises.push(getManagerLeaves(), getTeamAllLeaves());
        const results = await Promise.all(promises);
        setMyLeaves(results[0]);
        setLimits(results[1]);
        setHolidays(results[2]);
        setLeaveRules(results[3]);
        setBalances(results[4]);
        if (userIsManager) {
          setManagerLeaves(results[5]);
          setTeamLeaves(results[6]);
        }
      } catch { setError("Failed to load leave data. Please refresh."); }
      finally { setLoading(false); }
    }
    init();
  }, [userIsManager]);

  async function handleApprove(id) {
    await approveLeave(id);
    setManagerLeaves(prev => prev.filter(l => l.id !== id));
    await Promise.all([fetchMyLeaves(), fetchBalances(), fetchTeamLeaves()]);
  }

  async function handleReject(leave, reason) {
    await rejectLeave(leave.id, reason);
    setManagerLeaves(prev => prev.filter(l => l.id !== leave.id));
    await Promise.all([fetchMyLeaves(), fetchTeamLeaves()]);
  }

  async function doDelete() {
    setDeleting(true);
    try {
      await deleteLeave(confirmDeleteId);
      setMyLeaves(prev => prev ? {
        pending:  prev.pending.filter(l => l.id !== confirmDeleteId),
        upcoming: prev.upcoming.filter(l => l.id !== confirmDeleteId),
        rejected: prev.rejected.filter(l => l.id !== confirmDeleteId),
        previous: prev.previous.filter(l => l.id !== confirmDeleteId),
      } : prev);
      setConfirmDeleteId(null);
      setDrawerLeave(null);
      await Promise.all([fetchBalances(), fetchTeamLeaves()]);
    } catch { /* silently ignore */ }
    finally { setDeleting(false); }
  }

  // My leaves flat list sorted by start_date desc
  const allMyLeaves = useMemo(() => {
    if (!myLeaves) return [];
    return [
      ...(myLeaves.pending  || []),
      ...(myLeaves.upcoming || []),
      ...(myLeaves.rejected || []),
      ...(myLeaves.previous || []),
    ].sort((a, b) => b.start_date.localeCompare(a.start_date));
  }, [myLeaves]);

  const filteredMyLeaves = useMemo(() => {
    switch (myFilter) {
      case "pending":   return [...(myLeaves?.pending || [])].sort((a,b) => b.start_date.localeCompare(a.start_date));
      case "scheduled": return [...(myLeaves?.upcoming || [])].sort((a,b) => b.start_date.localeCompare(a.start_date));
      case "previous":  return [...(myLeaves?.previous || [])].sort((a,b) => b.start_date.localeCompare(a.start_date));
      case "declined":  return [...(myLeaves?.rejected || [])].sort((a,b) => b.start_date.localeCompare(a.start_date));
      default:          return allMyLeaves;
    }
  }, [myFilter, myLeaves, allMyLeaves]);

  // Team leaves = every leave across the whole org, bucketed by status. Same for
  // L1 and L2 (both fetch /leaves/team).
  const allTeamLeaves = useMemo(
    () => sortByStartDesc(dedupById([
      ...(teamLeaves?.pending  || []),
      ...(teamLeaves?.upcoming || []),
      ...(teamLeaves?.previous || []),
      ...(teamLeaves?.rejected || []),
    ])),
    [teamLeaves],
  );

  const filteredTeamLeaves = useMemo(() => {
    switch (teamFilter) {
      case "pending":   return sortByStartDesc(teamLeaves?.pending  || []);
      case "scheduled": return sortByStartDesc(teamLeaves?.upcoming || []);
      case "previous":  return sortByStartDesc(teamLeaves?.previous || []);
      case "declined":  return sortByStartDesc(teamLeaves?.rejected || []);
      default:          return allTeamLeaves;
    }
  }, [teamFilter, teamLeaves, allTeamLeaves]);

  const myCounts = {
    all:       allMyLeaves.length,
    pending:   (myLeaves?.pending?.length ?? 0),
    scheduled: (myLeaves?.upcoming?.length ?? 0),
    previous:  (myLeaves?.previous?.length ?? 0),
    declined:  (myLeaves?.rejected?.length ?? 0),
  };

  const teamCounts = {
    all:       allTeamLeaves.length,
    pending:   (teamLeaves?.pending?.length  ?? 0),
    scheduled: (teamLeaves?.upcoming?.length ?? 0),
    previous:  (teamLeaves?.previous?.length ?? 0),
    declined:  (teamLeaves?.rejected?.length ?? 0),
  };

  if (loading) return <div className="p-8 flex items-center justify-center min-h-[300px]"><Spinner /></div>;
  if (error) return (
    <div className="p-8">
      <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4">
        <p className="text-[13px] text-red-700">{error}</p>
      </div>
    </div>
  );

  const tabs = [
    { id: "my",       label: "My Leaves",   count: null },
    ...(userIsManager ? [{ id: "team", label: "Team Leaves", count: null }] : []),
    { id: "holidays", label: "Holidays",    count: null },
  ];

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Leaves</h1>
          <p className="text-[13.5px] text-slate-400 mt-0.5">Manage time off</p>
        </div>
        <button onClick={() => setShowRequest(true)}
          className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-blue-600 text-white text-[17px] font-bold hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-500">
          <Plus size={19} strokeWidth={2.5} />
          {userIsL2 ? "Log Leave" : "Request Leave"}
        </button>
      </div>

      {/* Balance cards */}
      {balances && limits && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <BalanceProgressCard label="Earned Leave" type="earned"
            taken={balances.earned?.taken ?? 0} limit={balances.earned?.limit ?? limits.earned} />
          <BalanceProgressCard label="Sick & Casual" type="sick_and_casual"
            taken={balances.sick_and_casual?.taken ?? 0} limit={balances.sick_and_casual?.limit ?? limits.sick_and_casual} />
          <SpecialBalanceCard balances={balances} />
        </div>
      )}

      {/* Action Required */}
      {userIsManager && (
        <ActionRequiredPanel
          leaves={managerLeaves}
          holidays={holidays}
          onApprove={handleApprove}
          onReject={leave => setRejectLeaveObj(leave)}
          onOpenDrawer={(leave, ctx) => { setDrawerLeave(leave); setDrawerContext(ctx); }}
        />
      )}

      {/* Tabs */}
      <div className="flex gap-0 border-b border-slate-200 mb-6">
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-3 text-[14px] font-medium border-b-2 transition-colors
              ${activeTab === tab.id ? "border-[#2f6bff] text-[#2f6bff]" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
            {tab.label}
            {tab.count != null && tab.count > 0 && (
              <span className={`text-[11px] font-semibold px-1.5 rounded-full ${activeTab === tab.id ? "bg-[#eef3ff] text-[#2f6bff]" : "bg-slate-100 text-slate-500"}`}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "my" && (
        <div>
          <div className="mb-4">
            <FilterChips
              active={myFilter}
              onChange={f => setMyFilter(f)}
              options={[
                { id: "all",       label: "All",              count: myCounts.all },
                { id: "pending",   label: "Pending approval", count: myCounts.pending },
                { id: "scheduled", label: "Scheduled",        count: myCounts.scheduled },
                { id: "previous",  label: "Previous",         count: myCounts.previous },
                { id: "declined",  label: "Declined",         count: myCounts.declined },
              ]}
            />
          </div>
          <LeaveTable leaves={filteredMyLeaves} holidays={holidays}
            onDelete={id => setConfirmDeleteId(id)}
            onEdit={leave => setEditLeave(leave)}
            onRowClick={leave => { setDrawerLeave(leave); setDrawerContext("own"); }}
            showEmployee={false} />
        </div>
      )}

      {activeTab === "team" && userIsManager && (
        <div>
          <div className="mb-4">
            <FilterChips
              active={teamFilter}
              onChange={f => setTeamFilter(f)}
              options={[
                { id: "all",       label: "All",              count: teamCounts.all },
                { id: "pending",   label: "Pending approval", count: teamCounts.pending },
                { id: "scheduled", label: "Scheduled",        count: teamCounts.scheduled },
                { id: "previous",  label: "Previous",         count: teamCounts.previous },
                { id: "declined",  label: "Declined",         count: teamCounts.declined },
              ]}
            />
          </div>
          <LeaveTable leaves={filteredTeamLeaves} holidays={holidays}
            onDelete={null}
            onRowClick={leave => {
              const isOwn = leave.user?.id === user?.id;
              const isPending = managerLeaves.some(l => l.id === leave.id);
              setDrawerLeave(leave);
              setDrawerContext(isOwn ? "own" : isPending ? "manager" : "readonly");
            }}
            showEmployee={true} />
        </div>
      )}

      {activeTab === "holidays" && <HolidaysTab holidays={holidays} />}

      {/* Side Drawer */}
      {drawerLeave && (
        <SideDrawer
          leave={drawerLeave}
          context={drawerContext}
          holidays={holidays}
          balances={balances}
          onClose={() => setDrawerLeave(null)}
          onDelete={id => { setDrawerLeave(null); setConfirmDeleteId(id); }}
          onApprove={async id => { setDrawerLeave(null); await handleApprove(id); }}
          onRejectOpen={leave => { setDrawerLeave(null); setRejectLeaveObj(leave); }}
        />
      )}

      {/* Modals */}
      <EditLeaveModal open={!!editLeave} onClose={() => setEditLeave(null)}
        leave={editLeave} holidays={holidays} leaveRules={leaveRules}
        onSuccess={async () => { await Promise.all([fetchMyLeaves(), fetchBalances(), fetchTeamLeaves()]); }} />

      <RequestLeaveModal open={showRequest} onClose={() => setShowRequest(false)}
        holidays={holidays} leaveRules={leaveRules} unconstrained={userIsL2}
        isAdmin={!!user?.is_admin} balances={balances}
        onSuccess={async () => { await Promise.all([fetchMyLeaves(), fetchBalances(), fetchTeamLeaves()]); }} />

      <RejectModal open={!!rejectLeaveObj} onClose={() => setRejectLeaveObj(null)}
        onReject={reason => handleReject(rejectLeaveObj, reason)} />

      <ConfirmDialog open={confirmDeleteId !== null} onClose={() => setConfirmDeleteId(null)}
        onConfirm={doDelete} loading={deleting}
        title="Withdraw leave request?"
        message="This will permanently delete the leave request and cannot be undone." />
    </div>
  );
}

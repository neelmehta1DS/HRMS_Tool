import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  Plus, X, Trash2, AlertTriangle, ChevronLeft, ChevronRight,
  Info, CalendarDays, Check, Clock, ChevronDown, AlertCircle, Pencil,
} from "lucide-react";
import { useUser } from "../contexts/UserContext";
import {
  getMyLeaves, getManagerLeaves, getTeamAllLeaves, getLeaveLimits,
  getHolidays, getLeaveRules, getLeaveBalances, getMyHygiene,
  createLeave, updateLeave, approveLeave, rejectLeave, deleteLeave,
  adminCreateLeave, getUsers,
} from "../lib/api";
import {
  formatDate, formatDateShort, isManager, isL2, getLeaveStatus, countBusinessDays,
  LEAVE_TYPE_META, balanceKey,
} from "../lib/utils";
import Avatar from "../components/ui/Avatar";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import Modal from "../components/ui/Modal";
import Tooltip from "../components/ui/Tooltip";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import Spinner from "../components/ui/Spinner";
import FilterChips from "../components/ui/FilterChips";
import LeaveTable from "../components/leaves/LeaveTable";
import LeaveSideDrawer from "../components/leaves/LeaveSideDrawer";
import { PlanningHygieneCard } from "../components/leaves/LeaveHygiene";
import { fmtDateRange, leaveBg, leaveLabel, leaveText } from "../components/leaves/leaveDisplay";

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

// The date that is `n` working days after `dateObj` (weekends/holidays skipped),
// mirroring the backend's add_working_days. Used for casual-leave notice.
function addWorkingDays(dateObj, n, holidaySet) {
  const d = new Date(dateObj);
  let count = 0;
  while (count < n) {
    d.setDate(d.getDate() + 1);
    if (isWorkingDay(d, holidaySet)) count++;
  }
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

// ─── LeaveCalendar ────────────────────────────────────────────────────────────

function LeaveCalendar({ selected, onSelect, minDate, holidaySet, duration, open, allowAny = false }) {
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
    // Admins logging leave on someone's behalf may pick any date at all —
    // past, weekend or holiday — so no day is off-limits.
    if (allowAny) return false;
    if (isoDate(d) !== isoDate(today) && d < today) return true;
    if (d.getDay() === 0 || d.getDay() === 6) return true;
    if (holidaySet.has(isoDate(d))) return true;
    if (minDate && d < minDate) return true;
    return false;
  }

  const canPrev = allowAny || !(year === today.getFullYear() && month === today.getMonth());
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

  const isEarned = leave?.leave_type === "earned";
  const isCasual = leave?.leave_type === "casual";
  const isSick   = leave?.leave_type === "sick";

  // Earned and casual are notice-gated off different ladders; sick is pinned to today.
  const noticeRules = isEarned ? (leaveRules?.earned_advance_notice ?? [])
    : isCasual ? (leaveRules?.casual_advance_notice ?? [])
    : [];

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
    if (!noticeRules.length || leave?.is_exception) return 0;
    return getNoticeRequired(duration, noticeRules);
  }, [duration, noticeRules, leave?.is_exception]);

  // Casual notice is counted in working days, earned in calendar days.
  const minStartDate = useMemo(() => {
    const today = new Date(); today.setHours(12, 0, 0, 0);
    if (noticeCalDays <= 0) return today;
    return isCasual ? addWorkingDays(today, noticeCalDays, holidaySet) : addCalendarDays(today, noticeCalDays);
  }, [noticeCalDays, isCasual, holidaySet]);

  const endDate = useMemo(() => {
    if (!startDate) return null;
    return nthWorkingDay(new Date(startDate), duration, holidaySet);
  }, [startDate, duration, holidaySet]);

  function applyDuration(n) {
    setDuration(Math.max(1, n));
    if (!isSick) setStartDate(null); // sick stays pinned to today
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
        {/* Duration — every leave type can span multiple working days */}
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
          {!leave?.is_exception && noticeCalDays > 0 && (
            <p className="text-[13px] text-slate-500 mt-3">
              {duration} day{duration !== 1 ? "s" : ""} of {leave?.leave_type} leave needs{" "}
              <b className="text-slate-700">{noticeCalDays} {isCasual ? "working" : "calendar"} days</b> notice.
              Earliest start: <b className="text-slate-700">{fmtCal(minStartDate)}</b>
            </p>
          )}
        </div>

        {/* Date picker */}
        <div>
          <p className="text-[12px] font-semibold text-slate-400 uppercase tracking-wider mb-3">Start date</p>
          {isSick ? (
            /* The API rejects any sick start date but today, so moving it is not offered. */
            <div className="group relative inline-block max-w-[280px] w-full">
              <div tabIndex={0}
                aria-describedby="edit-sick-date-note"
                className="flex items-center justify-between gap-3 w-full border-[1.5px] border-slate-200 rounded-xl px-4 py-3
                           text-[15px] text-slate-800 bg-slate-50 cursor-not-allowed
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                <span>{startDate ? fmtCal(new Date(startDate + "T12:00:00")) : "—"}</span>
                <CalendarDays size={16} className="text-slate-400 shrink-0" />
              </div>
              <p id="edit-sick-date-note"
                className="mt-2 text-[12.5px] font-medium text-red-600 opacity-0 transition-opacity
                           group-hover:opacity-100 group-focus-within:opacity-100">
                Start date must be today for sick leaves.
              </p>
            </div>
          ) : (
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
          )}
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

// ─── Styled dropdown ──────────────────────────────────────────────────────────

// A styled replacement for a native <select>. `options` is [{ id, label, note? }].
// The menu is portalled to <body> with fixed positioning so it floats above the
// modal instead of being clipped by its scroll container — a real dropdown.
function StyledDropdown({ value, onSelect, options, placeholder }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos]   = useState(null);
  const triggerRef = useRef(null);
  const menuRef    = useRef(null);
  const selected = options.find(o => o.id === value);

  function toggle() {
    if (!open && triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, left: r.left, width: r.width });
    }
    setOpen(o => !o);
  }

  useEffect(() => {
    if (!open) return;
    function onDown(e) {
      if (triggerRef.current?.contains(e.target)) return;
      if (menuRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    // A native dropdown detaches on scroll; closing keeps the menu from drifting.
    const close = () => setOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <>
      <button ref={triggerRef} type="button" onClick={toggle}
        className={`flex items-center justify-between gap-3 w-full border-[1.5px] rounded-xl px-4 py-3 text-[15px] transition-colors cursor-pointer bg-white hover:border-slate-300
          ${selected ? "text-slate-800 border-slate-300" : "text-slate-400 border-slate-200"}`}>
        <span className="flex items-center gap-2.5 min-w-0">
          {selected?.avatar && <Avatar name={selected.avatar} size="sm" />}
          <span className="truncate">
            {selected ? selected.label : placeholder}
            {selected && selected.note && <span className="text-slate-400 font-normal"> · {selected.note}</span>}
          </span>
        </span>
        <ChevronDown size={16} className={`text-slate-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && pos && createPortal(
        <div ref={menuRef}
          style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width, zIndex: 60 }}
          className="bg-white border border-slate-200 rounded-xl shadow-xl p-1.5 max-h-72 overflow-y-auto">
          {options.map(o => {
            const active = value === o.id;
            return (
              <button key={o.id} type="button"
                onClick={() => { onSelect(o.id); setOpen(false); }}
                className={`w-full flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition-colors
                  ${active ? "bg-[#eef3ff]" : "hover:bg-slate-50"}`}>
                <span className="flex items-center gap-2.5 min-w-0">
                  {o.avatar && <Avatar name={o.avatar} size="sm" />}
                  <span className="min-w-0">
                    <span className={`block text-[14px] font-semibold truncate ${active ? "text-[#2f6bff]" : "text-slate-700"}`}>{o.label}</span>
                    {o.note && <span className="block text-[12px] text-slate-400 mt-0.5 truncate">{o.note}</span>}
                  </span>
                </span>
                {active && <Check size={16} className="text-[#2f6bff] shrink-0" />}
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
}

// ─── Request leave modal (Phase 3) ────────────────────────────────────────────

export function RequestLeaveModal({ open, onClose, holidays, leaveRules, unconstrained = false, isAdmin = false, adminForUser = null, users = null, defaultTargetId = null, balances, onSuccess }) {
  const [category, setCategory]     = useState(null); // "earned"|"sick"|"casual"|"special"
  const [specialType, setSpecialType] = useState("");
  const [duration, setDuration]     = useState(1);
  const [startDate, setStartDate]   = useState(null);
  const [note, setNote]             = useState("");
  const [isException, setIsException] = useState(false);
  const [adminTargetId, setAdminTargetId] = useState(null);
  const [error, setError]           = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showCal, setShowCal]       = useState(false);
  const [showInfo, setShowInfo]     = useState(false);
  const calRef  = useRef(null);
  const infoRef = useRef(null);

  // When the modal isn't handed a fixed target, an admin picks the employee the
  // leave is for from a dropdown. Everyone else logs only for themselves.
  const showEmployeePicker = isAdmin && !adminForUser && Array.isArray(users) && users.length > 0;
  const target = adminForUser ?? (showEmployeePicker ? users.find(u => u.id === adminTargetId) ?? null : null);

  const holidaySet = useMemo(() => new Set((holidays || []).map(h => h.date)), [holidays]);

  // Sick must start today — except for admins and managerless users, whom the
  // backend exempts from every date rule, so they keep a real picker.
  const isSickCategory = category === "sick" && !unconstrained;

  const earnedNoticeRules = leaveRules?.earned_advance_notice ?? [];
  const casualNoticeRules = leaveRules?.casual_advance_notice ?? [];
  const cutoffHour = leaveRules?.sick_cutoff_hour ?? 10;
  const cutoffMin  = leaveRules?.sick_cutoff_min  ?? 0;

  // Earned and casual are both notice-gated, off different ladders. Sick and the
  // special types have no ladder, so they contribute no minimum start date.
  const noticeRules = category === "earned" ? earnedNoticeRules
    : category === "casual" ? casualNoticeRules
    : [];

  const noticeCalDays = useMemo(() => {
    if (unconstrained || isException || !noticeRules.length) return 0;
    return getNoticeRequired(duration, noticeRules);
  }, [unconstrained, duration, noticeRules, isException]);

  // Casual notice is counted in working days, earned in calendar days.
  const minStartDate = useMemo(() => {
    const today = new Date(); today.setHours(12, 0, 0, 0);
    if (noticeCalDays <= 0) return today;
    return category === "casual"
      ? addWorkingDays(today, noticeCalDays, holidaySet)
      : addCalendarDays(today, noticeCalDays);
  }, [noticeCalDays, category, holidaySet]);

  const endDate = useMemo(() => {
    if (!startDate) return null;
    return nthWorkingDay(new Date(startDate), duration, holidaySet);
  }, [startDate, duration, holidaySet]);

  // Sick always starts today, so the cutoff alone decides auto-approval.
  const willAutoApprove = useMemo(() => {
    if (category !== "sick") return false;
    const now = new Date();
    return (now.getHours() * 60 + now.getMinutes()) < (cutoffHour * 60 + cutoffMin);
  }, [category, cutoffHour, cutoffMin]);

  // Reset on close/open
  useEffect(() => {
    if (!open) return;
    setCategory(null); setSpecialType(""); setDuration(1); setStartDate(null);
    setNote(""); setIsException(false); setError(""); setSubmitting(false);
    setShowCal(false); setShowInfo(false); setAdminTargetId(defaultTargetId);
  }, [open, defaultTargetId]);

  // Sick is pinned to today — the backend rejects any other start date.
  useEffect(() => {
    if (category === "sick" && !unconstrained) setStartDate(todayStr());
    else setStartDate(null);
    setDuration(1); setIsException(false); setError("");
  }, [category, unconstrained]);

  // Changing duration moves the notice minimum, so the picked date may no longer
  // be legal — force a re-pick. Sick has no ladder and is pinned to today.
  function applyDuration(n) {
    setDuration(Math.max(1, n));
    if (!isSickCategory) setStartDate(null);
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
  // Sick and casual share one pool, so the balance is keyed by that pool, not by
  // the type. The warning names the pool — a casual request can be blocked by
  // sick days already taken, and the copy has to explain that.
  const limitType = leaveType ? balanceKey(leaveType) : null;

  // balances.taken counts approved days only, matching what the API enforces.
  const limitEntry     = limitType ? balances?.[limitType] : null;
  const limitRemaining = limitEntry?.limit != null ? limitEntry.limit - limitEntry.taken : null;
  const isOverLimit    = !isAdmin && limitRemaining != null && duration > limitRemaining;

  const overLimitText = useMemo(() => {
    if (!isOverLimit) return null;
    const label = LEAVE_TYPE_META[limitType]?.label ?? limitType;
    const dayWord = duration === 1 ? "day" : "days";
    return `This exceeds your ${label} limit. You have ${Math.max(0, limitRemaining)} of ` +
           `${limitEntry.limit} days remaining and this request is ${duration} working ${dayWord}. ` +
           `Submit is disabled until you shorten it.`;
  }, [isOverLimit, limitType, limitRemaining, limitEntry, duration]);

  async function handleSubmit() {
    if (!note.trim())    { setError("Note is required."); return; }
    if (!startDate)      { setError("Start date is required."); return; }
    if (category === "special" && !specialType) { setError("Please select a leave type."); return; }
    setSubmitting(true);
    try {
      const payload = {
        leave_type:   leaveType,
        note:         note.trim(),
        start_date:   startDate,
        end_date:     endDate ? isoDate(endDate) : startDate,
        is_exception: isException,
      };
      // Acting on another user's behalf posts to the admin endpoint, which
      // records the leave as approved and skips notice and overlap checks.
      if (target) await adminCreateLeave(target.id, payload);
      else await createLeave(payload);
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
    if (showEmployeePicker && !target) return "Choose an employee.";
    if (!category) return "Choose a leave type.";
    if (category === "special" && !specialType) return "Choose which type of special leave.";
    if (!startDate) return "Pick a start date.";
    if (!note.trim()) return "Add a note explaining this leave.";
    if (isOverLimit) return overLimitText;
    return null;
  }, [submitting, showEmployeePicker, target, category, specialType, startDate, note, isOverLimit, overLimitText]);

  // Status hint
  const statusHint = useMemo(() => {
    if (!startDate || !category) return null;
    if (unconstrained) return { kind: "good", text: "Logged instantly — no approval needed." };
    if (isException) return null; // exception banner already shown in the duration section
    if (category === "sick") {
      const fmtCutoff = `${cutoffHour % 12 || 12}:${String(cutoffMin).padStart(2, "0")} ${cutoffHour < 12 ? "AM" : "PM"}`;
      return willAutoApprove
        ? { kind: "good", text: `Auto-approved — submitted before ${fmtCutoff}, no manager needed.` }
        : { kind: "warn", text: `After ${fmtCutoff} cutoff — needs manager approval.` };
    }
    return { kind: "info", text: "Needs manager approval." };
  }, [unconstrained, startDate, category, isException, willAutoApprove, cutoffHour, cutoffMin]);

  const submitLabel = unconstrained ? "Log leave"
    : isException ? "Send exception request"
    : willAutoApprove ? "Log sick leave"
    : "Submit request";

  const CATEGORIES = [
    { id: "earned",  label: "Earned",  sub: "Planned time off" },
    { id: "sick",    label: "Sick",    sub: "Out ill today" },
    { id: "casual",  label: "Casual",  sub: "Planned short break" },
    { id: "special", label: "Special", sub: "Marriage, bereavement & more" },
  ];

  return (
    <Modal open={open} onClose={onClose} size="md">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
        <h2 className="text-[22px] font-bold text-slate-900 tracking-tight">
          {target ? `Log leave for ${target.name}` : unconstrained ? "Log leave" : "Request leave"}
        </h2>
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
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Sick</p>
                <p className="text-[12.5px] text-slate-600 leading-relaxed mb-3">
                  Must start <b>today</b>. Submitted before{" "}
                  <b>{cutoffHour % 12 || 12}:{String(cutoffMin).padStart(2, "0")} {cutoffHour < 12 ? "AM" : "PM"}</b> → auto-approved.
                  Otherwise needs approval.
                </p>
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Casual</p>
                <p className="text-[12.5px] text-slate-600 leading-relaxed mb-3">
                  Working-day notice required:{" "}
                  {casualNoticeRules.map((r, i) => (
                    <span key={r.min}>
                      {i > 0 && ", "}
                      <b>{r.max == null ? `${r.min}+` : r.min === r.max ? `${r.min}` : `${r.min}–${r.max}`}
                        {" "}{r.max === 1 ? "day" : "days"} → {r.notice}</b>
                    </span>
                  ))}. Always needs approval.
                </p>
                <p className="text-[12.5px] text-slate-500 leading-relaxed mb-3">
                  Sick and Casual share one annual allowance.
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
        {/* Employee picker — admins only */}
        {showEmployeePicker && (
          <div>
            <p className="text-[12px] font-semibold text-slate-400 uppercase tracking-wider mb-3">Who is this for?</p>
            <StyledDropdown
              value={adminTargetId}
              onSelect={(id) => setAdminTargetId(id)}
              options={users.map(u => ({ id: u.id, label: u.name, note: u.role || undefined, avatar: u.name }))}
              placeholder="Select an employee…"
            />
          </div>
        )}

        {/* Category picker */}
        <div>
          <p className="text-[12px] font-semibold text-slate-400 uppercase tracking-wider mb-3">What kind of leave?</p>
          <div className="grid grid-cols-2 gap-3">
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
            <StyledDropdown
              value={specialType}
              onSelect={(id) => { setSpecialType(id); setDuration(1); setStartDate(null); setError(""); }}
              options={SPECIAL_SUBTYPES}
              placeholder="Select leave type…"
            />
          </div>
        )}

        {/* Duration — every category can span multiple working days */}
        {category && (category !== "special" || specialType) && (
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

            {/* Notice info for the ladder-gated types */}
            {!isException && noticeCalDays > 0 && (
              <p className="text-[13px] text-slate-500 mt-3">
                {duration} working day{duration !== 1 ? "s" : ""} of {category} leave needs{" "}
                <b className="text-slate-700">{noticeCalDays} {category === "casual" ? "working" : "calendar"} days</b> notice.
                Earliest start: <b className="text-slate-700">{fmtCal(minStartDate)}</b>
              </p>
            )}
            {(category === "earned" || category === "casual") && isException && (
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
              {isSickCategory ? "Which day?" : "When does it start?"}
            </p>
            {isSickCategory ? (
              /* Sick always starts today, so the trigger is inert. The note is
                 revealed on hover and on keyboard focus, not just hover. */
              <div className="group relative inline-block max-w-[280px] w-full">
                <div tabIndex={0}
                  aria-describedby="sick-date-note"
                  className="flex items-center justify-between gap-3 w-full border-[1.5px] border-slate-200 rounded-xl px-4 py-3
                             text-[15px] text-slate-800 bg-slate-50 cursor-not-allowed
                             focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                  <span>{fmtCal(new Date(todayStr() + "T12:00:00"))}</span>
                  <CalendarDays size={16} className="text-slate-400 shrink-0" />
                </div>
                <p id="sick-date-note"
                  className="mt-2 text-[12.5px] font-medium text-red-600 opacity-0 transition-opacity
                             group-hover:opacity-100 group-focus-within:opacity-100">
                  Start date must be today for sick leaves.
                </p>
              </div>
            ) : (
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
                    minDate={minStartDate} holidaySet={holidaySet} duration={duration} open={showCal}
                    allowAny={!!target} />
                </div>
              )}
            </div>
            )}

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

            {(category === "earned" || category === "casual") && !isException && !unconstrained && (
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
                This exceeds your {LEAVE_TYPE_META[limitType]?.label ?? limitType} limit.
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

// ─── Reject dialog ────────────────────────────────────────────────────────────

function RejectModal({ open, onClose, onReject }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (!open) { setReason(""); setError(""); } }, [open]);

  async function handleSubmit() {
    setLoading(true);
    try { await onReject(reason.trim() || null); onClose(); }
    catch { setError("Failed to reject leave."); }
    finally { setLoading(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Decline leave request" size="sm">
      <div className="p-6">
        <p className="text-[13px] text-slate-600 mb-4">Add a reason for declining this request — optional, but it helps the requester.</p>
        <textarea value={reason} onChange={e => { setReason(e.target.value); setError(""); }} rows={3} placeholder="Reason for declining… (optional)"
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
  const [hygiene,       setHygiene]       = useState(null);
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
  const [allUsers,       setAllUsers]       = useState([]);

  const userIsManager = isManager(user);
  const userIsL2      = isL2(user);
  const userIsAdmin   = !!user?.is_admin;

  // Admins log leave on any employee's behalf, so they need the full roster.
  useEffect(() => {
    if (!userIsAdmin) return;
    getUsers().then(setAllUsers).catch(() => setAllUsers([]));
  }, [userIsAdmin]);

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

  // Managerless (L2) leads get null — the card and drawer block then render nothing.
  const fetchHygiene = useCallback(async () => {
    const data = await getMyHygiene();
    setHygiene(data);
  }, []);

  useEffect(() => {
    async function init() {
      setLoading(true);
      try {
        const promises = [getMyLeaves(), getLeaveLimits(), getHolidays(), getLeaveRules(), getLeaveBalances(), getMyHygiene()];
        if (userIsManager) promises.push(getManagerLeaves(), getTeamAllLeaves());
        const results = await Promise.all(promises);
        setMyLeaves(results[0]);
        setLimits(results[1]);
        setHolidays(results[2]);
        setLeaveRules(results[3]);
        setBalances(results[4]);
        setHygiene(results[5]);
        if (userIsManager) {
          setManagerLeaves(results[6]);
          setTeamLeaves(results[7]);
        }
      } catch { setError("Failed to load leave data. Please refresh."); }
      finally { setLoading(false); }
    }
    init();
  }, [userIsManager]);

  async function handleApprove(id) {
    await approveLeave(id);
    setManagerLeaves(prev => prev.filter(l => l.id !== id));
    await Promise.all([fetchMyLeaves(), fetchBalances(), fetchHygiene(), fetchTeamLeaves()]);
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
      await Promise.all([fetchBalances(), fetchHygiene(), fetchTeamLeaves()]);
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

      {/* Balance cards — a fourth Planning Hygiene card sits at the right for
          everyone with a manager; L2 leads have no score, so the row stays at 3. */}
      {balances && limits && (
        <div className={`grid ${hygiene ? "grid-cols-4" : "grid-cols-3"} gap-4 mb-6`}>
          <BalanceProgressCard label="Earned Leave" type="earned"
            taken={balances.earned?.taken ?? 0} limit={balances.earned?.limit ?? limits.earned} />
          <BalanceProgressCard label="Sick & Casual" type="sick_and_casual"
            taken={balances.sick_and_casual?.taken ?? 0} limit={balances.sick_and_casual?.limit ?? limits.sick_and_casual} />
          <SpecialBalanceCard balances={balances} />
          <PlanningHygieneCard hygiene={hygiene} />
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
        <LeaveSideDrawer
          leave={drawerLeave}
          context={drawerContext}
          holidays={holidays}
          balances={balances}
          hygiene={hygiene}
          onClose={() => setDrawerLeave(null)}
          onDelete={id => { setDrawerLeave(null); setConfirmDeleteId(id); }}
          onEdit={leave => { setDrawerLeave(null); setEditLeave(leave); }}
          onApprove={async id => { setDrawerLeave(null); await handleApprove(id); }}
          onRejectOpen={leave => { setDrawerLeave(null); setRejectLeaveObj(leave); }}
        />
      )}

      {/* Modals */}
      <EditLeaveModal open={!!editLeave} onClose={() => setEditLeave(null)}
        leave={editLeave} holidays={holidays} leaveRules={leaveRules}
        onSuccess={async () => { await Promise.all([fetchMyLeaves(), fetchBalances(), fetchHygiene(), fetchTeamLeaves()]); }} />

      <RequestLeaveModal open={showRequest} onClose={() => setShowRequest(false)}
        holidays={holidays} leaveRules={leaveRules} unconstrained={userIsL2 || userIsAdmin}
        isAdmin={userIsAdmin} users={userIsAdmin ? allUsers : null} defaultTargetId={user?.id}
        balances={balances}
        onSuccess={async () => { await Promise.all([fetchMyLeaves(), fetchBalances(), fetchHygiene(), fetchTeamLeaves()]); }} />

      <RejectModal open={!!rejectLeaveObj} onClose={() => setRejectLeaveObj(null)}
        onReject={reason => handleReject(rejectLeaveObj, reason)} />

      <ConfirmDialog open={confirmDeleteId !== null} onClose={() => setConfirmDeleteId(null)}
        onConfirm={doDelete} loading={deleting}
        title="Withdraw leave request?"
        message="This will permanently delete the leave request and cannot be undone." />
    </div>
  );
}

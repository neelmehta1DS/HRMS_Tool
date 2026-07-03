import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, AlertTriangle, ChevronDown } from "lucide-react";
import { useUser } from "../contexts/UserContext";
import {
  getMyLeaves,
  getManagerLeaves,
  getLeaveLimits,
  getHolidays,
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
  countDays,
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
        {leave.rejection_note && (
          <p className="text-[11.5px] text-red-400 mt-0.5 truncate">↩ {leave.rejection_note}</p>
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

function RequestLeaveModal({ open, onClose, holidays, onSuccess }) {
  const [leaveType, setLeaveType] = useState("casual");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const today = todayStr();

  useEffect(() => {
    if (!open) return;
    setLeaveType("casual");
    setStartDate("");
    setEndDate("");
    setNote("");
    setError("");
    setSubmitting(false);
  }, [open]);

  useEffect(() => {
    if (leaveType === "sick") {
      setStartDate(today);
      setEndDate(today);
    } else {
      setStartDate("");
      setEndDate("");
    }
    setError("");
  }, [leaveType]);

  const effectiveEnd = endDate || startDate;
  const businessDays =
    startDate && effectiveEnd && effectiveEnd >= startDate
      ? countBusinessDays(startDate, effectiveEnd, holidays || [])
      : startDate
      ? 1
      : null;

  function validate() {
    if (!note.trim()) return "Note is required.";
    if (!startDate) return "Start date is required.";

    const end = endDate || startDate;

    if (end < startDate) return "End date cannot be before start date.";

    if (leaveType === "sick") {
      if (startDate !== today || end !== today) {
        return "Sick leave can only be requested for today.";
      }
    } else {
      const isSingleDay = end === startDate;
      const daysUntil = countDays(today, startDate);
      if (isSingleDay) {
        if (startDate <= today) {
          return "Single-day casual leave must be submitted at least 1 day in advance.";
        }
      } else {
        if (daysUntil < 5) {
          return "Multi-day casual leave must be submitted at least 5 days in advance.";
        }
      }
    }

    return null;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setSubmitting(true);
    try {
      await createLeave({
        leave_type: leaveType,
        note: note.trim(),
        start_date: startDate,
        end_date: endDate || startDate,
      });
      onSuccess();
      onClose();
    } catch (ex) {
      setError(ex?.response?.data?.detail || "Failed to submit leave request.");
    } finally {
      setSubmitting(false);
    }
  }

  const minCasualStart = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split("T")[0];
  })();

  return (
    <Modal open={open} onClose={onClose} title="Request Leave" size="md">
      <form onSubmit={handleSubmit} className="p-6 space-y-5">
        <div>
          <label className="block text-[12px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
            Leave type
          </label>
          <div className="flex gap-2">
            {["casual", "sick"].map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setLeaveType(type)}
                className={`flex-1 py-2 rounded-lg text-[13px] font-semibold border transition-all ${
                  leaveType === type
                    ? type === "sick"
                      ? "bg-amber-50 border-amber-400 text-amber-700"
                      : "bg-blue-50 border-blue-400 text-blue-700"
                    : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                }`}
              >
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[12px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
              Start date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setError("");
              }}
              disabled={leaveType === "sick"}
              min={leaveType === "casual" ? minCasualStart : today}
              max={leaveType === "sick" ? today : undefined}
              className="w-full text-[13px] border border-slate-200 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-400"
            />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
              End date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setError("");
              }}
              disabled={leaveType === "sick"}
              min={startDate || (leaveType === "casual" ? minCasualStart : today)}
              className="w-full text-[13px] border border-slate-200 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-400"
            />
          </div>
        </div>

        {businessDays !== null && (
          <p className="text-[12px] text-slate-500">
            <span className="font-semibold text-slate-700">{businessDays}</span>{" "}
            business day{businessDays !== 1 ? "s" : ""}
          </p>
        )}

        <div>
          <label className="block text-[12px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
            Note <span className="text-red-500">*</span>
          </label>
          <textarea
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              setError("");
            }}
            placeholder="Reason for leave..."
            rows={3}
            className="w-full text-[13px] border border-slate-200 rounded-lg px-3 py-2 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <p className="text-[12px] text-red-700">{error}</p>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-1">
          <Button variant="secondary" size="md" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="md" type="submit" disabled={submitting}>
            {submitting ? "Submitting..." : "Submit Request"}
          </Button>
        </div>
      </form>
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
          <p className="text-[13px] text-slate-400 text-center py-4">No holidays listed.</p>
        )}
        {Object.entries(grouped).map(([month, items]) => (
          <div key={month}>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
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
                      className={`text-[13px] font-medium ${
                        isPast ? "text-slate-400" : "text-slate-800"
                      }`}
                    >
                      {h.name}
                    </span>
                    <span
                      className={`text-[12px] ${isPast ? "text-slate-400" : "text-slate-500"}`}
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
        const promises = [getMyLeaves(), getLeaveLimits(), getHolidays()];
        if (userIsManager) promises.push(getManagerLeaves());
        const results = await Promise.all(promises);
        setMyLeaves(results[0]);
        setLimits(results[1]);
        setHolidays(results[2]);
        if (userIsManager) setManagerLeaves(results[3]);
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
          <Button variant="secondary" size="md" onClick={() => setShowHolidays(true)}>
            Holiday Calendar
          </Button>
          <Button variant="primary" size="md" onClick={() => setShowRequest(true)}>
            <Plus size={16} className="mr-1.5" />
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
        onSuccess={handleRequestSuccess}
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

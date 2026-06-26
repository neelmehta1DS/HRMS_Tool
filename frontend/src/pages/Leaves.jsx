import { useState, useEffect } from "react";
import { Plus, X, CalendarDays, PartyPopper } from "lucide-react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import Avatar from "../components/ui/Avatar";
import { formatDate, getLeaveStatus, isIC, isL1, isL2 } from "../lib/utils";
import { createLeave, approveLeave, rejectLeave, getManagerLeaves, getMyBalance, getHolidays, getLeaveLimits } from "../lib/api";

function LeavePieCard({ label, used, total, color }) {
  const remaining = Math.max(total - used, 0);
  const data = [
    { name: "Used", value: used },
    { name: "Remaining", value: remaining },
  ];
  const COLORS = [color, "#e2e8f0"];

  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm flex flex-col items-center">
      <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">{label}</p>
      <div className="w-28 h-28">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} cx="50%" cy="50%" innerRadius={32} outerRadius={50} dataKey="value" startAngle={90} endAngle={-270}>
              {data.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
            </Pie>
            <Tooltip formatter={(v, n) => [`${v} days`, n]} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="text-center mt-2">
        <p className="text-2xl font-bold text-slate-800">{used}<span className="text-sm font-normal text-slate-400">/{total}</span></p>
        <p className="text-xs text-slate-400 mt-0.5">{remaining} remaining</p>
      </div>
    </div>
  );
}


function LeaveCard({ leave }) {
  const status = getLeaveStatus(leave);
  const statusBadge = {
    pending_l1: "bg-amber-50 text-amber-600",
    pending_l2: "bg-blue-50 text-blue-600",
    approved: "bg-emerald-50 text-emerald-600",
    rejected: "bg-red-50 text-red-500",
  }[status];
  const statusLabel = {
    pending_l1: "Pending",
    pending_l2: "Pending L2",
    approved: "Approved",
    rejected: "Rejected",
  }[status];

  return (
    <div className="bg-white rounded-xl border border-slate-100 p-4">
      <div className="flex items-center gap-2 mb-0.5">
        <span className="text-sm font-semibold text-slate-800 capitalize">{leave.leave_type}</span>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusBadge}`}>{statusLabel}</span>
      </div>
      <p className="text-xs text-slate-400">
        {formatDate(leave.start_date)}{leave.start_date !== leave.end_date ? " → " + formatDate(leave.end_date) : ""}
      </p>
      {leave.note && <p className="text-xs mt-1 italic text-slate-400">{leave.note}</p>}
    </div>
  );
}

function ApprovalCard({ leave, onApprove, onReject }) {
  const status = getLeaveStatus(leave);
  return (
    <div className="bg-white rounded-xl border border-slate-100 p-5 flex items-start gap-4">
      <Avatar name={leave.user?.name || "?"} size="lg" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <p className="font-semibold text-sm text-slate-800">{leave.user?.name}</p>
          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-slate-100 text-slate-500 capitalize">{leave.leave_type}</span>
          {status === "pending_l2" && (
            <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-blue-50 text-blue-600">Needs L2</span>
          )}
        </div>
        <p className="text-xs text-slate-400">
          {formatDate(leave.start_date)}{leave.start_date !== leave.end_date ? " → " + formatDate(leave.end_date) : ""}
        </p>
        {leave.note && <p className="text-xs mt-1 italic text-slate-400">{leave.note}</p>}
      </div>
      <div className="flex gap-2 flex-shrink-0">
        <button onClick={() => onReject(leave)}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-50 text-red-500 hover:bg-red-100 transition-colors">
          Reject
        </button>
        <button onClick={() => onApprove(leave.id)}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors">
          Approve
        </button>
      </div>
    </div>
  );
}

function RejectReasonModal({ leave, onClose, onSubmit }) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!reason.trim()) { setError("A reason is required."); return; }
    setSubmitting(true);
    try {
      await onSubmit(reason.trim());
    } catch (e) {
      setError(e.response?.data?.detail || "Failed to reject leave.");
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="font-semibold text-slate-800">Reject Leave</h3>
          <button onClick={onClose} className="text-slate-400"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-3">
          <p className="text-sm text-slate-500">
            Rejecting <span className="font-medium text-slate-700">{leave.user?.name}</span>'s{" "}
            <span className="capitalize">{leave.leave_type}</span> leave
            ({formatDate(leave.start_date)}{leave.start_date !== leave.end_date ? " → " + formatDate(leave.end_date) : ""}).
          </p>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5 text-slate-400">
              Reason <span className="text-red-400">*</span>
            </label>
            <textarea value={reason} onChange={e => { setReason(e.target.value); setError(""); }}
              placeholder="Explain why this leave is being rejected…" rows={3}
              className="w-full px-4 py-3 text-sm rounded-xl border border-slate-200 bg-slate-50 text-slate-800 focus:outline-none focus:ring-2 focus:ring-red-500/20 resize-none placeholder:text-slate-300" />
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
        <div className="flex gap-2 px-6 pb-6">
          <button onClick={onClose}
            className="flex-1 py-3 text-sm font-semibold rounded-xl text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors">
            Cancel
          </button>
          <button onClick={submit} disabled={submitting || !reason.trim()}
            className="flex-1 py-3 text-sm font-semibold text-white bg-red-500 hover:bg-red-600 disabled:opacity-50 rounded-xl transition-colors">
            {submitting ? "Rejecting…" : "Reject Leave"}
          </button>
        </div>
      </div>
    </div>
  );
}

function HolidaysModal({ holidays, onClose }) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="font-semibold text-slate-800">Holiday Calendar 2026</h3>
          <button onClick={onClose} className="text-slate-400"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-6 py-4 max-h-[60vh] overflow-y-auto space-y-1">
          {holidays.map(h => {
            const isPast = h.date < today;
            const isToday = h.date === today;
            return (
              <div key={h.date}
                className={`flex items-center justify-between py-2.5 border-b border-slate-50 last:border-0 ${isPast ? "opacity-40" : ""}`}>
                <div>
                  <p className={`text-sm font-medium ${isToday ? "text-blue-600" : "text-slate-800"}`}>{h.name}</p>
                  <p className="text-xs text-slate-400">
                    {new Date(h.date + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}
                  </p>
                </div>
                {isToday && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">Today</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function validateLeaveForm(form) {
  const today = new Date().toISOString().slice(0, 10);
  const start = form.start_date;
  const end = form.end_date || start;

  if (!start) return "Start date is required.";
  if (end < start) return "End date cannot be before start date.";

  if (form.leave_type === "sick") {
    if (start !== today || (form.end_date && form.end_date !== today))
      return "Sick leave can only be applied for today.";
  }

  if (form.leave_type === "casual") {
    const advance = Math.round((new Date(start + "T00:00:00") - new Date(today + "T00:00:00")) / 86400000);
    const isMulti = form.end_date && form.end_date > start;
    const min = isMulti ? 5 : 1;
    if (advance < min) {
      const earliest = new Date(new Date(today + "T00:00:00").getTime() + min * 86400000).toISOString().slice(0, 10);
      return `Casual (${isMulti ? "multi-day" : "single-day"}) needs ${min} day(s) notice. Earliest start: ${earliest}.`;
    }
  }

  if (!form.note.trim()) return "Note is required.";
  return null;
}

function RequestLeaveModal({ onClose, onSuccess, isLogOnly }) {
  const [form, setForm] = useState({ leave_type: "casual", start_date: "", end_date: "", note: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    const validationError = validateLeaveForm(form);
    if (validationError) { setError(validationError); return; }
    setSubmitting(true);
    setError("");
    try {
      await createLeave({ ...form, end_date: form.end_date || undefined });
      onSuccess();
      onClose();
    } catch (e) {
      setError(e.response?.data?.detail || "Failed to submit leave.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="font-semibold text-slate-800">{isLogOnly ? "Log leave" : "Request leave"}</h3>
          <button onClick={onClose} className="text-slate-400"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5 text-slate-400">
              Type <span className="text-red-400">*</span>
            </label>
            <select value={form.leave_type}
              onChange={e => setForm(p => ({ ...p, leave_type: e.target.value }))}
              className="w-full px-4 py-3 text-sm rounded-xl border border-slate-200 bg-slate-50 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20">
              <option value="casual">Casual</option>
              <option value="sick">Sick Leave</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5 text-slate-400">
                Start date <span className="text-red-400">*</span>
              </label>
              <input type="date" value={form.start_date}
                onChange={e => setForm(p => ({ ...p, start_date: e.target.value }))}
                className="w-full px-3 py-3 text-sm rounded-xl border border-slate-200 bg-slate-50 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5 text-slate-400">
                End date <span className="font-normal normal-case text-slate-300">(optional)</span>
              </label>
              <input type="date" value={form.end_date}
                onChange={e => setForm(p => ({ ...p, end_date: e.target.value }))}
                className="w-full px-3 py-3 text-sm rounded-xl border border-slate-200 bg-slate-50 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5 text-slate-400">
              Note <span className="text-red-400">*</span>
            </label>
            <textarea value={form.note} onChange={e => { setForm(p => ({ ...p, note: e.target.value })); setError(""); }}
              placeholder="Any additional details…" rows={3}
              className="w-full px-4 py-3 text-sm rounded-xl border border-slate-200 bg-slate-50 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none placeholder:text-slate-300" />
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
        <div className="flex gap-2 px-6 pb-6">
          <button onClick={onClose}
            className="flex-1 py-3 text-sm font-semibold rounded-xl text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors">
            Cancel
          </button>
          <button onClick={submit} disabled={submitting}
            className="flex-1 py-3 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-xl transition-colors">
            {submitting ? "Submitting…" : (isLogOnly ? "Log leave" : "Submit request")}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Leaves({ currentUser, myLeaves, onRefresh }) {
  const [showModal, setShowModal] = useState(false);
  const [showHolidays, setShowHolidays] = useState(false);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [holidays, setHolidays] = useState([]);
  const [limits, setLimits] = useState({ sick: 0, casual: 0 });
  const [balance, setBalance] = useState({ sick_taken: 0, casual_taken: 0 });
  const [pendingApprovals, setPendingApprovals] = useState([]);

  const ic = isIC(currentUser);
  const l1 = isL1(currentUser);
  const l2 = isL2(currentUser);
  const isLogOnly = l2 && !l1 && !ic;

  useEffect(() => {
    if (l1 || l2) {
      getManagerLeaves().then(setPendingApprovals).catch(() => {});
    }
    if (ic || l1) {
      getMyBalance().then(setBalance).catch(() => {});
    }
    getHolidays().then(setHolidays).catch(() => {});
    getLeaveLimits().then(setLimits).catch(() => {});
  }, []);

  async function refreshApprovals() {
    if (l1 || l2) {
      getManagerLeaves().then(setPendingApprovals).catch(() => {});
    }
  }

  async function handleApprove(id) {
    try {
      await approveLeave(id);
      onRefresh();
      refreshApprovals();
      getMyBalance().then(setBalance).catch(() => {});
    } catch {}
  }

  async function submitReject(reason) {
    await rejectLeave(rejectTarget.id, reason);
    setRejectTarget(null);
    onRefresh();
    refreshApprovals();
  }

  const { pending = [], upcoming = [], rejected = [], previous = [] } = myLeaves;

  return (
    <div className="p-8 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">My Leaves</h1>
          <p className="text-sm mt-0.5 text-slate-400">Manage your time off</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowHolidays(true)}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold rounded-xl transition-colors">
            <PartyPopper className="w-4 h-4" /> Holidays
          </button>
          {(ic || l1 || l2) && (
            <button onClick={() => setShowModal(true)}
              className="flex items-center gap-1.5 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm shadow-blue-200">
              <Plus className="w-4 h-4" /> {l2 && !l1 && !ic ? "Log leave" : "Request leave"}
            </button>
          )}
        </div>
      </div>

      {/* Leave balance summary — not shown for pure L2 */}
      {(ic || l1) && (
        <div className="grid grid-cols-2 gap-3 mb-8">
          <LeavePieCard label="Casual Leave" used={balance.casual_taken} total={limits.casual} color="#3b82f6" />
          <LeavePieCard label="Sick Leave" used={balance.sick_taken} total={limits.sick} color="#10b981" />
        </div>
      )}

      {/* My leaves — IC and L1: full history */}
      {(ic || l1) && (
        <>
          {[
            { title: "Pending", items: pending, borderColor: "border-amber-100", badge: "bg-amber-50 text-amber-600", badgeLabel: "Pending" },
            { title: "Upcoming", items: upcoming, borderColor: "border-emerald-100", badge: "bg-emerald-50 text-emerald-600", badgeLabel: "Approved" },
          ].map(section => (
            <section key={section.title} className="mb-7">
              <h2 className="text-xs font-bold uppercase tracking-widest mb-3 text-slate-400">
                {section.title} · {section.items.length}
              </h2>
              {section.items.length === 0
                ? <p className="text-sm py-2 text-slate-300">None</p>
                : <div className="space-y-2">
                    {section.items.map(l => (
                      <div key={l.id} className={`bg-white rounded-xl border ${section.borderColor} p-4`}>
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-sm font-semibold text-slate-800 capitalize">{l.leave_type}</span>
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${section.badge}`}>{section.badgeLabel}</span>
                        </div>
                        <p className="text-xs text-slate-400">
                          {formatDate(l.start_date)}{l.start_date !== l.end_date ? " → " + formatDate(l.end_date) : ""}
                        </p>
                        {l.note && <p className="text-xs mt-1 italic text-slate-400">{l.note}</p>}
                      </div>
                    ))}
                  </div>
              }
            </section>
          ))}

          {rejected.length > 0 && (
            <section className="mb-7">
              <h2 className="text-xs font-bold uppercase tracking-widest mb-3 text-slate-400">
                Rejected · {rejected.length}
              </h2>
              <div className="space-y-2">
                {rejected.map(l => {
                  const rejectedByL1 = l.approved_by_l1 === false;
                  const rejectorName = rejectedByL1
                    ? l.user?.manager?.name
                    : l.user?.manager?.manager?.name;
                  return (
                    <div key={l.id} className="bg-white rounded-xl border border-red-100 p-4">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-semibold text-slate-800 capitalize">{l.leave_type}</span>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-500">Rejected</span>
                      </div>
                      <p className="text-xs text-slate-400">
                        {formatDate(l.start_date)}{l.start_date !== l.end_date ? " → " + formatDate(l.end_date) : ""}
                      </p>
                      {l.note && <p className="text-xs mt-1 italic text-slate-400">{l.note}</p>}
                      {l.rejection_note && (
                        <div className="mt-2 pt-2 border-t border-red-50">
                          <p className="text-xs text-red-500">
                            <span className="font-semibold">{rejectorName || "Manager"}</span>: {l.rejection_note}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section className="mb-8">
            <h2 className="text-xs font-bold uppercase tracking-widest mb-3 text-slate-400">
              Previous · {previous.length}
            </h2>
            {previous.length === 0
              ? <p className="text-sm py-2 text-slate-300">None</p>
              : <div className="space-y-2">
                  {previous.map(l => <LeaveCard key={l.id} leave={l} />)}
                </div>
            }
          </section>
        </>
      )}

      {/* Pure L2: upcoming logged leaves only */}
      {isLogOnly && (
        <section className="mb-7">
          <h2 className="text-xs font-bold uppercase tracking-widest mb-3 text-slate-400">
            Upcoming · {upcoming.length}
          </h2>
          {upcoming.length === 0
            ? <p className="text-sm py-2 text-slate-300">None</p>
            : <div className="space-y-2">
                {upcoming.map(l => (
                  <div key={l.id} className="bg-white rounded-xl border border-emerald-100 p-4">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-semibold text-slate-800 capitalize">{l.leave_type}</span>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600">Logged</span>
                    </div>
                    <p className="text-xs text-slate-400">
                      {formatDate(l.start_date)}{l.start_date !== l.end_date ? " → " + formatDate(l.end_date) : ""}
                    </p>
                    {l.note && <p className="text-xs mt-1 italic text-slate-400">{l.note}</p>}
                  </div>
                ))}
              </div>
          }
        </section>
      )}

      {/* Approvals section — L1 and L2 */}
      {(l1 || l2) && (
        <section className="mb-8">
          <h2 className="text-xs font-bold uppercase tracking-widest mb-3 text-slate-400">
            Pending Approvals · {pendingApprovals.length}
          </h2>
          {pendingApprovals.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-100 p-10 text-center">
              <CalendarDays className="w-8 h-8 mx-auto mb-2 text-slate-200" />
              <p className="text-sm text-slate-400">No pending requests</p>
            </div>
          ) : (
            <div className="space-y-3">
              {pendingApprovals.map(l => (
                <ApprovalCard key={l.id} leave={l} onApprove={handleApprove} onReject={setRejectTarget} />
              ))}
            </div>
          )}
        </section>
      )}

      {rejectTarget && (
        <RejectReasonModal
          leave={rejectTarget}
          onClose={() => setRejectTarget(null)}
          onSubmit={submitReject}
        />
      )}
      {showHolidays && (
        <HolidaysModal holidays={holidays} onClose={() => setShowHolidays(false)} />
      )}
      {showModal && (
        <RequestLeaveModal
          onClose={() => setShowModal(false)}
          onSuccess={() => { onRefresh(); if (!isLogOnly) getMyBalance().then(setBalance).catch(() => {}); }}
          isLogOnly={isLogOnly}
        />
      )}
    </div>
  );
}

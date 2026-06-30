import { useState } from "react";
import { Plus, X, Bell, FileText, Video } from "lucide-react";
import Avatar from "../components/ui/Avatar";
import { formatDate, isIC, isL1, isL2 } from "../lib/utils";
import { createCatchup } from "../lib/api";

function getCatchupStatus(catchup) {
  return new Date(catchup.date_and_time) > new Date() ? "scheduled" : "completed";
}

function statusMeta(status) {
  if (status === "completed") return { label: "Completed", badge: "bg-emerald-50 text-emerald-600" };
  if (status === "missed")    return { label: "Missed",    badge: "bg-red-50 text-red-500" };
  return                             { label: "Scheduled", badge: "bg-blue-50 text-blue-600" };
}

function CatchupCard({ catchup, users }) {
  const member = users.find(u => u.id === catchup.employee_id);
  const name = member?.name || `User ${catchup.employee_id}`;
  const status = getCatchupStatus(catchup);
  const meta = statusMeta(status);

  return (
    <div className="bg-white rounded-xl border border-slate-100 p-4 flex items-center gap-3">
      <Avatar name={name} size="md" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-800">{name}</p>
        <p className="text-xs text-slate-400">
          {formatDate(catchup.date_and_time.slice(0,10))} · {catchup.date_and_time.slice(11,16)}
        </p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {catchup.notes_doc_link && (
          <a href={catchup.notes_doc_link} target="_blank" rel="noreferrer"
            className="flex items-center gap-1 text-[10px] font-semibold text-blue-600 hover:text-blue-700">
            <FileText className="w-3 h-3" /> Notes
          </a>
        )}
        {catchup.meeting_link && (
          <a href={catchup.meeting_link} target="_blank" rel="noreferrer"
            className="flex items-center gap-1 text-[10px] font-semibold text-emerald-600 hover:text-emerald-700">
            <Video className="w-3 h-3" /> Join
          </a>
        )}
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${meta.badge}`}>{meta.label}</span>
      </div>
    </div>
  );
}

function CreateCatchupModal({ users, currentUser, onClose, onSuccess }) {
  const [form, setForm] = useState({ employee_id: "", date: "", time: "15:00" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Only show direct reports and skip-level reports (backend enforces the same check)
  const eligible = users.filter(u => {
    if (u.id === currentUser.id) return false;
    if (u.manager_id === currentUser.id) return true;
    const mgr = users.find(m => m.id === u.manager_id);
    return mgr?.manager_id === currentUser.id;
  });

  async function submit() {
    if (!form.employee_id || !form.date) return;
    setSubmitting(true);
    setError("");
    try {
      await createCatchup({
        employee_id: parseInt(form.employee_id),
        date_and_time: `${form.date}T${form.time}:00`,
      });
      onSuccess();
      onClose();
    } catch (e) {
      setError(e.response?.data?.detail || "Failed to create catch-up");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="font-semibold text-slate-800">Create catch-up</h3>
          <button onClick={onClose} className="text-slate-400"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5 text-slate-400">
              Team member <span className="text-red-400">*</span>
            </label>
            <select value={form.employee_id}
              onChange={e => setForm(p => ({ ...p, employee_id: e.target.value }))}
              className="w-full px-4 py-3 text-sm rounded-xl border border-slate-200 bg-slate-50 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20">
              <option value="">Select team member…</option>
              {eligible.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5 text-slate-400">
                Date <span className="text-red-400">*</span>
              </label>
              <input type="date" value={form.date}
                onChange={e => setForm(p => ({ ...p, date: e.target.value }))}
                className="w-full px-3 py-3 text-sm rounded-xl border border-slate-200 bg-slate-50 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5 text-slate-400">Time</label>
              <input type="time" value={form.time}
                onChange={e => setForm(p => ({ ...p, time: e.target.value }))}
                className="w-full px-3 py-3 text-sm rounded-xl border border-slate-200 bg-slate-50 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
            </div>
          </div>
          <p className="text-[11px] text-slate-400">
            A Google Doc will be auto-generated in a standard catch-up format, and the participant will receive a reminder.
          </p>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
        <div className="flex gap-2 px-6 pb-6">
          <button onClick={onClose}
            className="flex-1 py-3 text-sm font-semibold rounded-xl text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors">
            Cancel
          </button>
          <button onClick={submit} disabled={submitting}
            className="flex-1 py-3 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-xl transition-colors">
            {submitting ? "Scheduling…" : "Schedule"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Catchups({ currentUser, users, myCatchups, managerCatchups, onRefresh }) {
  const [showModal, setShowModal] = useState(false);

  const ic = isIC(currentUser);
  const l1 = isL1(currentUser);
  const l2 = isL2(currentUser);
  const manager = l1 || l2;

  // Employees see their own catchups; managers see their team's
  const catchups = manager ? managerCatchups : myCatchups;
  const upcoming = catchups?.upcoming || [];
  const previous = catchups?.previous || [];

  const completed = previous.filter(c => getCatchupStatus(c) === "completed");
  const missed    = previous.filter(c => getCatchupStatus(c) === "missed");
  const total     = upcoming.length + previous.length;
  const completionRate = total ? Math.round((completed.length / total) * 100) : 0;

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Catch-ups</h1>
          <p className="text-sm mt-0.5 text-slate-400">
            {manager
              ? "Schedule and track 1:1 catch-ups with your team"
              : "Your scheduled catch-ups and notes"}
          </p>
        </div>
        {manager && (
          <button onClick={() => setShowModal(true)}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm shadow-blue-200">
            <Plus className="w-4 h-4" /> Create catch-up
          </button>
        )}
      </div>

      {/* Completion summary — managers only */}
      {manager && (
        <div className="bg-white rounded-2xl border border-slate-100 p-5 mb-6 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Completion status</p>
            <span className="text-sm font-bold text-slate-800">{completionRate}%</span>
          </div>
          <div className="h-2 rounded-full overflow-hidden mb-3 bg-slate-100">
            <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${completionRate}%` }} />
          </div>
          <div className="flex gap-4 text-xs text-slate-400">
            <span><span className="font-semibold text-emerald-600">{completed.length}</span> completed</span>
            <span><span className="font-semibold text-blue-500">{upcoming.length}</span> on track</span>
            {missed.length > 0 && <span><span className="font-semibold text-red-500">{missed.length}</span> missed</span>}
          </div>
        </div>
      )}

      {/* Upcoming */}
      <section className="mb-7">
        <h2 className="text-xs font-bold uppercase tracking-widest mb-3 text-slate-400">
          Upcoming · {upcoming.length}
        </h2>
        {upcoming.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-100 p-8 text-center">
            <Bell className="w-8 h-8 mx-auto mb-2 text-slate-200" />
            <p className="text-sm text-slate-400">No catch-ups scheduled</p>
          </div>
        ) : (
          <div className="space-y-2">
            {upcoming.map(c => <CatchupCard key={c.id} catchup={c} users={users} />)}
          </div>
        )}
      </section>

      {/* Past */}
      {previous.length > 0 && (
        <section>
          <h2 className="text-xs font-bold uppercase tracking-widest mb-3 text-slate-400">
            Past · {previous.length}
          </h2>
          <div className="space-y-2">
            {[...previous]
              .sort((a,b) => b.date_and_time.localeCompare(a.date_and_time))
              .map(c => <CatchupCard key={c.id} catchup={c} users={users} />)}
          </div>
        </section>
      )}

      {showModal && (
        <CreateCatchupModal
          users={users}
          currentUser={currentUser}
          onClose={() => setShowModal(false)}
          onSuccess={onRefresh}
        />
      )}
    </div>
  );
}
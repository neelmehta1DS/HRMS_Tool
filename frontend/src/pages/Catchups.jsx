import { useState, useEffect } from "react";
import { Plus, Calendar, Clock, Trash2, Pencil } from "lucide-react";

function GoogleDocsIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" fill="#4285F4" />
      <path d="M14 2v6h6" fill="#A8C7FA" />
      <line x1="8" y1="13" x2="16" y2="13" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="8" y1="16.5" x2="16" y2="16.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="8" y1="9.5" x2="12" y2="9.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function GoogleMeetIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="2" y="6" width="13" height="12" rx="2" fill="#FBBC04" />
      <path d="M15 10.2L22 7v10l-7-3.2V10.2z" fill="#FBBC04" />
    </svg>
  );
}
import { useUser } from "../contexts/UserContext";
import { getMyCatchups, getManagerCatchups, getUsers, createCatchup, updateCatchup, deleteCatchup } from "../lib/api";
import { formatDateTime, isManager } from "../lib/utils";
import Avatar from "../components/ui/Avatar";
import Button from "../components/ui/Button";
import Modal from "../components/ui/Modal";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import Spinner from "../components/ui/Spinner";
import TimePicker from "../components/ui/TimePicker";

// ─── helpers ────────────────────────────────────────────────────────────────

function SectionHeader({ title, count }) {
  return (
    <div className="flex items-center gap-2.5 mb-4">
      <span className="text-[13px] font-semibold text-slate-500 uppercase tracking-wider">
        {title}
      </span>
      <span className="text-[11px] font-semibold bg-slate-200 text-slate-500 px-2 py-0.5 rounded-full">
        {count}
      </span>
    </div>
  );
}

function EmptyState({ icon: Icon, message }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 gap-2">
      <Icon size={24} className="text-slate-300" />
      <p className="text-[13px] text-slate-400">{message}</p>
    </div>
  );
}

function CatchupCard({ catchup, viewMode, users, isPrevious, currentUserId, onDelete, onEdit }) {
  const personName =
    viewMode === "manager"
      ? (users.find((u) => u.id === catchup.employee_id)?.name ?? "Team Member")
      : `Catchup with ${catchup.manager?.name ?? "Manager"}`;

  const avatarName =
    viewMode === "manager"
      ? (users.find((u) => u.id === catchup.employee_id)?.name ?? "Team Member")
      : (catchup.manager?.name ?? "Manager");

  const canManage = currentUserId === catchup.manager_id || currentUserId === catchup.alternate_manager_id;

  const hasNotes = catchup.notes_doc_link && catchup.notes_doc_link !== "";
  const hasMeeting = catchup.meeting_link && catchup.meeting_link !== "";
  const done = catchup.background_creation_finished;

  const dateBadgeClass = isPrevious
    ? "text-[11px] font-medium bg-slate-100 text-slate-500 px-2.5 py-1 rounded-lg whitespace-nowrap"
    : "text-[11px] font-medium bg-blue-50 text-blue-700 px-2.5 py-1 rounded-lg whitespace-nowrap";

  return (
    <div
      className={`bg-white rounded-xl border border-slate-200 p-4 flex items-start gap-4 ${
        isPrevious ? "opacity-80" : ""
      }`}
    >
      <Avatar name={avatarName} size="md" />

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <span className="text-[14px] font-semibold text-slate-900 truncate">
            {personName}
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            {isPrevious && (
              <span className="text-[11px] font-medium bg-slate-100 text-slate-500 px-2.5 py-1 rounded-lg">
                Completed
              </span>
            )}
            <span className={dateBadgeClass}>
              {new Date(catchup.date_and_time).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </span>
            {canManage && (
              <>
                <button
                  onClick={() => onEdit(catchup)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                  title="Edit"
                >
                  <Pencil size={14} strokeWidth={2} />
                </button>
                <button
                  onClick={() => onDelete(catchup.id)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                  title="Delete"
                >
                  <Trash2 size={14} strokeWidth={2} />
                </button>
              </>
            )}
          </div>
        </div>

        <p className="text-[13px] text-slate-500 mt-0.5">
          {formatDateTime(catchup.date_and_time)}
        </p>

        <div className="flex items-center gap-3 mt-2">
          {hasNotes && hasMeeting ? (
            <>
              <a
                href={catchup.notes_doc_link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[12px] text-[#4285F4] hover:text-[#1a56db] transition-colors"
              >
                <GoogleDocsIcon />
                Notes
              </a>
              <span className="text-slate-300 text-[12px]">·</span>
              <a
                href={catchup.meeting_link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[12px] text-slate-600 hover:text-slate-900 transition-colors"
              >
                <GoogleMeetIcon />
                Join Meeting
              </a>
            </>
          ) : hasNotes ? (
            <>
              <a
                href={catchup.notes_doc_link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[12px] text-[#4285F4] hover:text-[#1a56db] transition-colors"
              >
                <GoogleDocsIcon />
                Notes
              </a>
              <span className="text-slate-300 text-[12px]">·</span>
              {done
                ? <span className="text-[12px] text-red-400">Meeting creation failed</span>
                : <span className="text-[12px] text-slate-400">Meeting link being prepared...</span>
              }
            </>
          ) : hasMeeting ? (
            <>
              {done
                ? <span className="text-[12px] text-red-400">Doc creation failed</span>
                : <span className="text-[12px] text-slate-400">Doc being prepared...</span>
              }
              <span className="text-slate-300 text-[12px]">·</span>
              <a
                href={catchup.meeting_link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[12px] text-slate-600 hover:text-slate-900 transition-colors"
              >
                <GoogleMeetIcon />
                Join Meeting
              </a>
            </>
          ) : done ? (
            <span className="text-[12px] text-red-400">
              Failed to create doc &amp; meeting
            </span>
          ) : (
            <span className="text-[12px] text-slate-400">
              Doc &amp; meeting link being prepared...
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function CatchupList({ catchups, viewMode, users, isPrevious, currentUserId, onDelete, onEdit }) {
  if (!catchups || catchups.length === 0) {
    return isPrevious ? (
      <EmptyState icon={Clock} message="No previous catchups yet" />
    ) : (
      <EmptyState icon={Calendar} message="No upcoming catchups" />
    );
  }
  return (
    <div className="space-y-3">
      {catchups.map((c) => (
        <CatchupCard
          key={c.id}
          catchup={c}
          viewMode={viewMode}
          users={users}
          isPrevious={isPrevious}
          currentUserId={currentUserId}
          onDelete={onDelete}
          onEdit={onEdit}
        />
      ))}
    </div>
  );
}

// ─── Schedule Modal ──────────────────────────────────────────────────────────

function ScheduleModal({ open, onClose, users, currentUser, onSuccess }) {
  const [employeeId, setEmployeeId] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const directReports = users.filter((u) => u.manager_id === currentUser.id);
  const skipReports = users.filter(
    (u) => u.manager?.manager?.id === currentUser.id
  );
  const directIds = new Set(directReports.map((d) => d.id));
  const skipOnly = skipReports.filter((s) => !directIds.has(s.id));

  const minDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  function handleClose() {
    setEmployeeId("");
    setDate("");
    setTime("10:00");
    setError("");
    onClose();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (!employeeId) {
      setError("Please select a team member.");
      return;
    }
    if (!date || date < minDate) {
      setError("Please select a future date.");
      return;
    }
    const dateAndTime = `${date}T${time}:00`;
    setSubmitting(true);
    try {
      await createCatchup({ employee_id: parseInt(employeeId, 10), date_and_time: dateAndTime });
      handleClose();
      onSuccess();
    } catch (err) {
      setError(
        err?.response?.data?.detail ?? "Failed to schedule catchup. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="Schedule Catchup" size="md">
      <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
        <div className="space-y-1.5">
          <label className="block text-[13px] font-medium text-slate-700">
            Select team member
          </label>
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">Choose a team member...</option>
            {directReports.length > 0 && (
              <optgroup label="Direct Reports">
                {directReports.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </optgroup>
            )}
            {skipOnly.length > 0 && (
              <optgroup label="Indirect Reports">
                {skipOnly.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </optgroup>
            )}
            {directReports.length === 0 && skipOnly.length === 0 && (
              <option disabled>No team members found</option>
            )}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="block text-[13px] font-medium text-slate-700">
              Date
            </label>
            <input
              type="date"
              value={date}
              min={minDate}
              onChange={(e) => setDate(e.target.value)}
              required
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-[13px] font-medium text-slate-700">
              Time
            </label>
            <TimePicker value={time} onChange={setTime} />
          </div>
        </div>

        {error && (
          <p className="text-[12px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex justify-end pt-1">
          <Button type="submit" variant="primary" size="md" disabled={submitting}>
            {submitting ? "Scheduling..." : "Schedule Catchup"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Edit Modal ──────────────────────────────────────────────────────────────

function EditModal({ open, onClose, catchup, users, currentUser, onSuccess }) {
  const directReports = users.filter((u) => u.manager_id === currentUser.id);
  const skipReports = users.filter((u) => u.manager?.manager?.id === currentUser.id);
  const directIds = new Set(directReports.map((d) => d.id));
  const skipOnly = skipReports.filter((s) => !directIds.has(s.id));

  const initialDate = catchup?.date_and_time?.slice(0, 10) ?? "";
  const initialTime = catchup?.date_and_time?.slice(11, 16) ?? "10:00";

  const [employeeId, setEmployeeId] = useState(String(catchup?.employee_id ?? ""));
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState(initialTime);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (catchup) {
      setEmployeeId(String(catchup.employee_id));
      setDate(catchup.date_and_time?.slice(0, 10) ?? "");
      setTime(catchup.date_and_time?.slice(11, 16) ?? "10:00");
      setError("");
    }
  }, [catchup]);

  function handleClose() {
    setError("");
    onClose();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!date) { setError("Please select a date."); return; }
    const payload = {};
    if (parseInt(employeeId, 10) !== catchup.employee_id) payload.employee_id = parseInt(employeeId, 10);
    const newDateTime = `${date}T${time}:00`;
    if (newDateTime !== catchup.date_and_time?.slice(0, 19)) payload.date_and_time = newDateTime;
    if (!Object.keys(payload).length) { handleClose(); return; }
    setSubmitting(true);
    try {
      await updateCatchup(catchup.id, payload);
      handleClose();
      onSuccess();
    } catch (err) {
      setError(err?.response?.data?.detail ?? "Failed to update catchup. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="Edit Catchup" size="md">
      <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
        <div className="space-y-1.5">
          <label className="block text-[13px] font-medium text-slate-700">Team member</label>
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            {directReports.length > 0 && (
              <optgroup label="Direct Reports">
                {directReports.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </optgroup>
            )}
            {skipOnly.length > 0 && (
              <optgroup label="Indirect Reports">
                {skipOnly.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </optgroup>
            )}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="block text-[13px] font-medium text-slate-700">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-[13px] font-medium text-slate-700">Time</label>
            <TimePicker value={time} onChange={setTime} />
          </div>
        </div>

        {error && (
          <p className="text-[12px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
        )}

        <div className="flex justify-end pt-1">
          <Button type="submit" variant="primary" size="md" disabled={submitting}>
            {submitting ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function Catchups() {
  const { user } = useUser();
  const managerMode = isManager(user);

  const [myCatchups, setMyCatchups] = useState(null);
  const [managerCatchups, setManagerCatchups] = useState(null);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editCatchup, setEditCatchup] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");
      try {
        const myData = await getMyCatchups();
        setMyCatchups(myData);

        if (managerMode) {
          const [mgData, usersData] = await Promise.all([
            getManagerCatchups(),
            getUsers(),
          ]);
          setManagerCatchups(mgData);
          setUsers(usersData);
        }
      } catch {
        setError("Failed to load catchups. Please refresh the page.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [managerMode]);

  async function refresh() {
    try {
      const [myData, mgData] = await Promise.all([
        getMyCatchups(),
        managerMode ? getManagerCatchups() : Promise.resolve(null),
      ]);
      setMyCatchups(myData);
      if (mgData) setManagerCatchups(mgData);
    } catch {
      // silently fail on refresh
    }
  }

  function handleDelete(id) {
    setConfirmDeleteId(id);
  }

  async function doDelete() {
    setDeleting(true);
    try {
      await deleteCatchup(confirmDeleteId);
      setConfirmDeleteId(null);
      refresh();
    } catch {
      // silently fail
    } finally {
      setDeleting(false);
    }
  }

  function handleEdit(catchup) {
    setEditCatchup(catchup);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Spinner />
      </div>
    );
  }

  const myCatchupsHasItems =
    myCatchups &&
    ((myCatchups.upcoming?.length ?? 0) > 0 || (myCatchups.previous?.length ?? 0) > 0);

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Catchups</h1>
        {managerMode && (
          <Button
            variant="primary"
            size="md"
            onClick={() => setModalOpen(true)}
          >
            <Plus size={15} />
            Schedule Catchup
          </Button>
        )}
      </div>

      {error && (
        <div className="mb-6 text-[13px] text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      {/* Manager View */}
      {managerMode && managerCatchups ? (
        <>
          {/* Upcoming (manager view) */}
          <div>
            <SectionHeader
              title="Upcoming Catchups"
              count={managerCatchups.upcoming?.length ?? 0}
            />
            <CatchupList
              catchups={managerCatchups.upcoming}
              viewMode="manager"
              users={users}
              isPrevious={false}
              currentUserId={user.id}
              onDelete={handleDelete}
              onEdit={handleEdit}
            />
          </div>

          {/* Previous (manager view) */}
          <div className="mt-8">
            <SectionHeader
              title="Previous Catchups"
              count={managerCatchups.previous?.length ?? 0}
            />
            <CatchupList
              catchups={managerCatchups.previous}
              viewMode="manager"
              users={users}
              isPrevious={true}
              currentUserId={user.id}
              onDelete={handleDelete}
              onEdit={handleEdit}
            />
          </div>

          {/* Own catchups as employee (secondary section) */}
          {myCatchupsHasItems && (
            <div className="mt-8 pt-8 border-t border-slate-200">
              <h2 className="text-[15px] font-semibold text-slate-700 mb-6">
                Your Catchups
              </h2>

              <div>
                <SectionHeader
                  title="Upcoming"
                  count={myCatchups.upcoming?.length ?? 0}
                />
                <CatchupList
                  catchups={myCatchups.upcoming}
                  viewMode="employee"
                  users={users}
                  isPrevious={false}
                />
              </div>

              {(myCatchups.previous?.length ?? 0) > 0 && (
                <div className="mt-8">
                  <SectionHeader
                    title="Previous"
                    count={myCatchups.previous?.length ?? 0}
                  />
                  <CatchupList
                    catchups={myCatchups.previous}
                    viewMode="employee"
                    users={users}
                    isPrevious={true}
                  />
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        /* IC / Employee View */
        myCatchups && (
          <>
            <div>
              <SectionHeader
                title="Upcoming Catchups"
                count={myCatchups.upcoming?.length ?? 0}
              />
              <CatchupList
                catchups={myCatchups.upcoming}
                viewMode="employee"
                users={users}
                isPrevious={false}
              />
            </div>

            <div className="mt-8">
              <SectionHeader
                title="Previous Catchups"
                count={myCatchups.previous?.length ?? 0}
              />
              <CatchupList
                catchups={myCatchups.previous}
                viewMode="employee"
                users={users}
                isPrevious={true}
              />
            </div>
          </>
        )
      )}

      {/* Schedule Modal */}
      {managerMode && (
        <ScheduleModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          users={users}
          currentUser={user}
          onSuccess={refresh}
        />
      )}

      {/* Edit Modal */}
      <EditModal
        open={!!editCatchup}
        onClose={() => setEditCatchup(null)}
        catchup={editCatchup}
        users={users}
        currentUser={user}
        onSuccess={() => { setEditCatchup(null); refresh(); }}
      />

      {/* Delete Confirm */}
      <ConfirmDialog
        open={confirmDeleteId !== null}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={doDelete}
        title="Delete catchup?"
        message="This will permanently delete the catchup and cancel the calendar invite. This cannot be undone."
        loading={deleting}
      />
    </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Pencil, Plus, Trash2, UserPlus, CalendarDays, Link2 } from "lucide-react";
import Avatar from "../../components/ui/Avatar";
import Badge from "../../components/ui/Badge";
import Button from "../../components/ui/Button";
import ConfirmDialog from "../../components/ui/ConfirmDialog";
import Spinner from "../../components/ui/Spinner";
import FilterChips from "../../components/ui/FilterChips";
import CheckInLog from "../../components/dashboard/CheckInLog";
import LeaveTable from "../../components/leaves/LeaveTable";
import LeaveSideDrawer from "../../components/leaves/LeaveSideDrawer";
import UserSelect from "../../components/admin/UserSelect";
import UserFormModal from "../../components/admin/UserFormModal";
import LeaveFormModal from "../../components/admin/LeaveFormModal";
import CatchupFormModal from "../../components/admin/CatchupFormModal";
import { PlanningHygieneCard } from "../../components/leaves/LeaveHygiene";
import { RequestLeaveModal } from "../Leaves";
import {
  adminDeleteCatchup, adminDeleteLeave, adminDeleteUser,
  getAdminUsers, getHolidays, getLeaveRules, getUserHygiene, getUserOverview,
} from "../../lib/api";
import {
  LEAVE_TYPE_META, eachDayISO,
  formatDateShort, formatDateTime, formatDateLong,
} from "../../lib/utils";

const LAST_USER_KEY = "admin:lastUser";

function Section({ title, description, action, children }) {
  return (
    <section className="bg-white border border-slate-200 rounded-2xl p-6">
      <div className="flex items-start justify-between mb-5">
        <div>
          <h2 className="text-[16px] font-semibold text-slate-900">{title}</h2>
          {description && <p className="text-[13px] text-slate-400 mt-0.5">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function RowActions({ onEdit, onDelete, label }) {
  return (
    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
      <button
        onClick={onEdit}
        aria-label={`Edit ${label}`}
        className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        <Pencil size={14} />
      </button>
      <button
        onClick={onDelete}
        aria-label={`Delete ${label}`}
        className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function BalanceCard({ type, entry }) {
  const { remaining, taken, limit } = entry;
  const overLimit = remaining != null && remaining < 0;

  return (
    <div className={`border rounded-xl p-3.5 ${overLimit ? "border-red-200 bg-red-50/50" : "border-slate-200"}`}>
      <p className={`text-[20px] font-bold leading-none ${overLimit ? "text-red-600" : "text-slate-900"}`}>
        {overLimit ? Math.abs(remaining) : (remaining ?? "\u221e")}
        <span className={`text-[12px] font-normal ml-1.5 ${overLimit ? "text-red-500" : "text-slate-400"}`}>
          {overLimit ? "over limit" : "left"}
        </span>
      </p>
      <p className="text-[12.5px] font-medium text-slate-600 mt-1.5">{LEAVE_TYPE_META[type].label}</p>
      <p className="text-[11.5px] text-slate-400 mt-0.5">
        {taken} taken{limit != null && ` of ${limit}`}
      </p>
    </div>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="flex items-baseline gap-4 py-1.5">
      <span className="text-[13.5px] text-slate-400 w-32 shrink-0">{label}</span>
      <span className="text-[14px] text-slate-800 font-medium">{value || "—"}</span>
    </div>
  );
}

export default function UserManagement() {
  const [users, setUsers] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [leaveRules, setLeaveRules] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();

  // The URL is the source of truth, so refresh, back and a shared link all work.
  // Session storage only seeds it, for when you arrive from the sidebar link,
  // which carries no query string. It dies with the tab, which is the right
  // lifetime — a selection from last week is noise, not memory.
  const selectedId = Number(searchParams.get("user")) || null;

  const setSelectedId = useCallback((id) => {
    if (id) sessionStorage.setItem(LAST_USER_KEY, String(id));
    else sessionStorage.removeItem(LAST_USER_KEY);
    setSearchParams(id ? { user: String(id) } : {}, { replace: true });
  }, [setSearchParams]);

  const [overview, setOverview] = useState(null);
  const [hygiene, setHygiene] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [tab, setTab] = useState("leaves");
  const [weeks, setWeeks] = useState(4);

  const [editingUser, setEditingUser] = useState(null);   // user object, or "new"
  const [editingLeave, setEditingLeave] = useState(null); // leave object, or "new"
  const [editingCatchup, setEditingCatchup] = useState(null);
  const [drawerLeave, setDrawerLeave] = useState(null);   // leave shown in the side drawer
  const [confirm, setConfirm] = useState(null);           // { title, message, onConfirm }
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    Promise.all([getAdminUsers(), getHolidays(), getLeaveRules()])
      .then(([u, h, r]) => {
        setUsers(u);
        setHolidays(h);
        setLeaveRules(r);

        // Only restore someone who still exists: a remembered id can outlive the
        // person, and asking the server for a deleted user just shows an error.
        if (selectedId) return;
        const remembered = Number(sessionStorage.getItem(LAST_USER_KEY));
        if (remembered && u.some((x) => x.id === remembered)) setSelectedId(remembered);
        else if (remembered) sessionStorage.removeItem(LAST_USER_KEY);
      })
      .catch(() => setError("Couldn't load users."));
    // Runs once: this seeds the selection, it does not track it.
  }, []);

  const refresh = useCallback(async () => {
    if (!selectedId) return;
    setLoading(true);
    setError("");
    try {
      // Hygiene loads in parallel with the overview; it self-hides on null so
      // a failure or a managerless (L2) user just renders nothing.
      const [ov, hy] = await Promise.all([
        getUserOverview(selectedId),
        getUserHygiene(selectedId).catch(() => null),
      ]);
      setOverview(ov);
      setHygiene(hy);
    } catch (e) {
      // A remembered or shared id can point at someone since deleted.
      if (e?.response?.status === 404) {
        setSelectedId(null);
      } else {
        setError("Couldn't load this user.");
      }
      setOverview(null);
      setHygiene(null);
    } finally {
      setLoading(false);
    }
  }, [selectedId, setSelectedId]);

  useEffect(() => { setOverview(null); setHygiene(null); refresh(); }, [refresh]);

  // The check-in log paints leave days; derive them from the approved leaves we
  // already have rather than asking the server again.
  const leaveDates = useMemo(() => {
    if (!overview) return [];
    return overview.leaves
      .filter((l) => l.status === "approved")
      .flatMap((l) => eachDayISO(l.start_date, l.end_date));
  }, [overview]);

  async function reloadUsers() {
    setUsers(await getAdminUsers());
  }

  function askDeleteUser() {
    setConfirm({
      title: `Delete ${overview.user.name}?`,
      message: "This removes their leaves, catchups and check-in history for good. Anyone reporting to them moves up to their manager. This cannot be undone.",
      onConfirm: async () => {
        await adminDeleteUser(selectedId);
        setSelectedId(null);
        setOverview(null);
        await reloadUsers();
      },
    });
  }

  // LeaveTable hands the delete callback an id, not the leave.
  function askDeleteLeave(leaveId) {
    const leave = overview.leaves.find((l) => l.id === leaveId);
    setDrawerLeave(null);
    setConfirm({
      title: "Delete this leave?",
      message: `${LEAVE_TYPE_META[leave.leave_type].label} leave on ${formatDateShort(leave.start_date)}. Their balance will be recalculated.`,
      onConfirm: async () => { await adminDeleteLeave(leaveId); await refresh(); },
    });
  }

  function askDeleteCatchup(catchup) {
    setConfirm({
      title: "Delete this catchup?",
      message: `Scheduled for ${formatDateTime(catchup.date_and_time)}. Any calendar event stays in place.`,
      onConfirm: async () => { await adminDeleteCatchup(catchup.id); await refresh(); },
    });
  }

  async function runConfirm() {
    setDeleting(true);
    try {
      await confirm.onConfirm();
      setConfirm(null);
    } catch (e) {
      setError(e?.response?.data?.detail ?? "That didn't work.");
      setConfirm(null);
    } finally {
      setDeleting(false);
    }
  }

  const user = overview?.user;

  return (
    <div className="flex flex-col h-full">
      <div className="px-8 pt-7 pb-6 shrink-0 bg-white border-b border-slate-200">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">User Management</h1>
            <p className="text-[13.5px] text-slate-500 mt-1">
              Everything about one person, and the power to change all of it.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-[300px]">
              <UserSelect users={users} value={selectedId} onChange={setSelectedId} placeholder="Select a user" />
            </div>
            <Button variant="secondary" onClick={() => setEditingUser("new")}>
              <UserPlus size={15} />
              New user
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-8 py-6">
        <div className="max-w-6xl mx-auto space-y-6">
          {error && (
            <p role="alert" className="text-[13.5px] text-red-700 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
              {error}
            </p>
          )}

          {!selectedId && (
            <div className="text-center py-24">
              <p className="text-[15px] text-slate-500">Pick someone to see and edit their record.</p>
            </div>
          )}

          {selectedId && loading && !overview && (
            <div className="flex justify-center py-24"><Spinner /></div>
          )}

          {overview && (
            <>
              {/* Details */}
              <Section
                title="Details"
                action={
                  <div className="flex items-center gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setEditingUser(user)}>
                      <Pencil size={13} />
                      Edit
                    </Button>
                    <Button variant="danger" size="sm" onClick={askDeleteUser}>
                      <Trash2 size={13} />
                      Delete user
                    </Button>
                  </div>
                }
              >
                <div className="flex items-center gap-4 mb-5">
                  <Avatar name={user.name} size="lg" />
                  <div className="min-w-0">
                    <p className="text-[17px] font-bold text-slate-900 truncate">{user.name}</p>
                    <p className="text-[13.5px] text-slate-500 truncate">{user.role}</p>
                  </div>
                  {user.is_admin && <Badge variant="violet">Admin</Badge>}
                </div>

                <div className="grid grid-cols-2 gap-x-8">
                  <div>
                    <DetailRow label="Email" value={user.email} />
                    <DetailRow label="Phone" value={user.phone_number} />
                    <DetailRow label="Reports to" value={user.manager?.name} />
                    <DetailRow label="Slack ID" value={user.slack_user_id} />
                  </div>
                  <div>
                    <DetailRow label="Joined" value={user.joining_date && formatDateLong(user.joining_date)} />
                    <DetailRow label="Birthday" value={user.birthday && formatDateLong(user.birthday)} />
                    <DetailRow label="Current status" value={user.office_status ?? "Not set"} />
                  </div>
                </div>
              </Section>

              {/* Tabs */}
              <FilterChips
                tabs
                label="Records"
                active={tab}
                onChange={setTab}
                options={[
                  { id: "leaves", label: "Leaves", count: overview.leaves.length },
                  { id: "catchups", label: "Catchups", count: overview.catchups.length },
                  { id: "checkin", label: "Check-in Log" },
                ]}
              />

              {tab === "leaves" && (
                <div className={`grid ${hygiene ? "grid-cols-1 lg:grid-cols-4" : "grid-cols-1"} gap-6`}>
                  <div className={hygiene ? "lg:col-span-3" : ""}>
                    <Section title="Leave Balances" description={`${new Date().getFullYear()}`}>
                      <div className="grid grid-cols-4 xl:grid-cols-7 gap-3">
                        {Object.entries(overview.balances).map(([type, entry]) => (
                          <BalanceCard key={type} type={type} entry={entry} />
                        ))}
                      </div>
                    </Section>
                  </div>
                  {hygiene && (
                    <div className="lg:col-span-1">
                      <PlanningHygieneCard hygiene={hygiene} />
                    </div>
                  )}
                </div>
              )}

              {tab === "leaves" && (
                <Section
                  title="Leaves"
                  description="Every leave, past and future. Click a row for the full record."
                  action={
                    <Button variant="primary" size="lg" onClick={() => setEditingLeave("new")}>
                      <Plus size={15} />
                      Add leave
                    </Button>
                  }
                >
                  <LeaveTable
                    leaves={overview.leaves}
                    holidays={holidays}
                    onEdit={setEditingLeave}
                    onDelete={askDeleteLeave}
                    onRowClick={setDrawerLeave}
                    unrestricted
                  />
                </Section>
              )}

              {tab === "catchups" && (
                <Section
                  title="Catchups"
                  description="One-on-ones with their manager"
                  action={
                    <Button variant="secondary" size="sm" onClick={() => setEditingCatchup("new")}>
                      <Plus size={13} />
                      Add catchup
                    </Button>
                  }
                >
                  {overview.catchups.length === 0 ? (
                    <p className="text-[14px] text-slate-400 py-6 text-center">No catchups on record.</p>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {overview.catchups.map((catchup) => (
                        <div key={catchup.id} className="group flex items-center gap-4 py-3">
                          <CalendarDays size={17} className="text-slate-300 shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-[14.5px] font-semibold text-slate-900">
                              {formatDateTime(catchup.date_and_time)}
                            </p>
                            <p className="text-[12.5px] text-slate-400 mt-0.5">
                              with {catchup.manager.name}
                              {catchup.alternate_manager && ` \u00b7 alternate ${catchup.alternate_manager.name}`}
                            </p>
                          </div>
                          {catchup.meeting_link && (
                            <a
                              href={catchup.meeting_link} target="_blank" rel="noreferrer"
                              className="text-slate-400 hover:text-blue-600 transition-colors"
                              aria-label="Open meeting link"
                            >
                              <Link2 size={15} />
                            </a>
                          )}
                          <RowActions
                            label={`catchup on ${formatDateTime(catchup.date_and_time)}`}
                            onEdit={() => setEditingCatchup(catchup)}
                            onDelete={() => askDeleteCatchup(catchup)}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </Section>
              )}

              {tab === "checkin" && (
                <Section
                  title="Check-in Log"
                  description="Read-only. The status log records what happened."
                  action={
                    <div role="tablist" aria-label="History range" className="flex gap-1 bg-slate-100 rounded-lg p-1">
                      {[[4, "1 month"], [13, "3 months"]].map(([w, label]) => (
                        <button
                          key={w}
                          role="tab"
                          aria-selected={weeks === w}
                          onClick={() => setWeeks(w)}
                          className={`px-3 py-1.5 text-[12.5px] font-medium rounded-md transition-colors ${
                            weeks === w ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  }
                >
                  <CheckInLog
                    statusDays={overview.status_days}
                    leaveDates={leaveDates}
                    holidays={holidays}
                    weeks={weeks}
                  />
                </Section>
              )}
            </>
          )}
        </div>
      </div>

      <UserFormModal
        open={editingUser !== null}
        onClose={() => setEditingUser(null)}
        onSaved={async () => { await reloadUsers(); await refresh(); }}
        user={editingUser === "new" ? null : editingUser}
        users={users}
      />

      {selectedId && (
        <>
          {/* New leaves go through the same modal employees use, targeted at this
              user. Editing an existing leave keeps the admin-only form, which can
              change type and status. */}
          <RequestLeaveModal
            open={editingLeave === "new"}
            onClose={() => setEditingLeave(null)}
            onSuccess={() => { setEditingLeave(null); refresh(); }}
            holidays={holidays}
            leaveRules={leaveRules}
            balances={overview?.balances}
            unconstrained
            isAdmin
            adminForUser={user}
          />
          <LeaveFormModal
            open={editingLeave !== null && editingLeave !== "new"}
            onClose={() => setEditingLeave(null)}
            onSaved={refresh}
            userId={selectedId}
            leave={editingLeave === "new" ? null : editingLeave}
            holidays={holidays}
          />
          <CatchupFormModal
            open={editingCatchup !== null}
            onClose={() => setEditingCatchup(null)}
            onSaved={refresh}
            userId={selectedId}
            catchup={editingCatchup === "new" ? null : editingCatchup}
            users={users}
          />
        </>
      )}

      {/* Admin edits from the table's own buttons, so the drawer shows no actions. */}
      <LeaveSideDrawer
        leave={drawerLeave}
        context="admin"
        holidays={holidays}
        balances={overview?.balances}
        onClose={() => setDrawerLeave(null)}
      />

      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        onConfirm={runConfirm}
        title={confirm?.title}
        message={confirm?.message}
        loading={deleting}
      />
    </div>
  );
}

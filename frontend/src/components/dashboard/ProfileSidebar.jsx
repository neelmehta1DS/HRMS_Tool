import { useEffect, useState } from "react";
import { Plus, X, CalendarRange } from "lucide-react";
import Avatar from "../ui/Avatar";
import Badge from "../ui/Badge";
import Button from "../ui/Button";
import Spinner from "../ui/Spinner";
import CheckInLog from "./CheckInLog";
import CheckInHistoryModal from "./CheckInHistoryModal";
import UpcomingLeaves from "./UpcomingLeaves";
import { useUser } from "../../contexts/UserContext";
import { RequestLeaveModal } from "../../pages/Leaves";
import { HygieneDetailBlock } from "../leaves/LeaveHygiene";
import {
  LEAVE_TYPE_META,
  formatDateLong,
  formatBirthday,
  formatTimeOfDay,
  getUserStatus,
  statusBadgeProps,
  toISODate,
} from "../../lib/utils";
import { getHolidays, getLeaveRules, getStatusHistory, getUserBalances, getUserHygiene, getUserLeaveSummary } from "../../lib/api";

const BALANCE_TYPES = ["earned", "sick_and_casual", "bereavement", "marriage", "maternity", "paternity"];

function DetailRow({ label, value }) {
  return (
    <div className="flex items-baseline gap-4 py-1.5">
      <span className="text-[15px] text-slate-400 w-28 shrink-0">{label}</span>
      <span className="text-[15px] text-slate-800 font-medium">{value ?? "—"}</span>
    </div>
  );
}

function SectionHeading({ children }) {
  return (
    <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-3">
      {children}
    </p>
  );
}

function BalanceCard({ type, entry }) {
  const meta = LEAVE_TYPE_META[type];
  const { taken, limit, remaining } = entry;
  // limit === 0 would make the fill NaN; an over-drawn balance would overflow it.
  const fill = limit > 0 ? Math.min(100, (taken / limit) * 100) : 100;

  return (
    <div className="border border-slate-200 rounded-xl p-4">
      <p className="text-[22px] font-bold text-slate-900 leading-none">
        {remaining}
        <span className="text-[13px] font-normal text-slate-400 ml-1.5">left</span>
      </p>
      <p className="text-[13.5px] font-semibold text-slate-700 mt-1.5">{meta.label}</p>
      <div className="mt-3 h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${fill}%`, background: meta.color }} />
      </div>
    </div>
  );
}

const LOG_DAYS = 28;

export default function ProfileSidebar({ member, onLeaveIds, onClose, onSelectMember }) {
  const { user: currentUser } = useUser();
  const isAdmin = !!currentUser?.is_admin;
  // A non-admin viewing their own card can request leave for themselves.
  const isSelf = !!member && member.id === currentUser?.id;
  const canRequestOwn = !isAdmin && isSelf;
  const showLeaveButton = isAdmin || canRequestOwn;

  const [balances, setBalances] = useState(null);
  const [hygiene, setHygiene] = useState(null);
  const [failed, setFailed] = useState(false);

  const [statusDays, setStatusDays] = useState(null);
  const [leaveSummary, setLeaveSummary] = useState(null);
  const [holidays, setHolidays] = useState(null);
  const [historyFailed, setHistoryFailed] = useState(false);

  // The request modal needs the rules, and a bump to reload the member's data
  // after a leave is logged/requested.
  const [leaveRules, setLeaveRules] = useState(null);
  const [addingLeave, setAddingLeave] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const handler = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    if (!showLeaveButton) return;
    getLeaveRules().then(setLeaveRules).catch(() => setLeaveRules(null));
  }, [showLeaveButton]);

  useEffect(() => {
    if (!member) return;
    let cancelled = false;
    setBalances(null);
    setFailed(false);
    getUserBalances(member.id)
      .then((b) => { if (!cancelled) setBalances(b); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [member?.id, refreshKey]);

  // Hygiene: admins see everyone's; other users see only their own. The block
  // self-hides on null, so L2 leads and unauthorised views render nothing.
  useEffect(() => {
    if (!member) return;
    let cancelled = false;
    setHygiene(null);
    if (!isAdmin && !isSelf) return;
    getUserHygiene(member.id)
      .then((h) => { if (!cancelled) setHygiene(h); })
      .catch(() => { /* self-hides */ });
    return () => { cancelled = true; };
  }, [member?.id, refreshKey, isAdmin, isSelf]);

  // A day cannot be classified without all three, so they load and fail as a unit.
  useEffect(() => {
    if (!member) return;
    let cancelled = false;
    setStatusDays(null);
    setLeaveSummary(null);
    setHolidays(null);
    setHistoryFailed(false);
    Promise.all([
      getStatusHistory(member.id, LOG_DAYS),
      getUserLeaveSummary(member.id, LOG_DAYS),
      getHolidays(),
    ])
      .then(([days, summary, hols]) => {
        if (cancelled) return;
        setStatusDays(days);
        setLeaveSummary(summary);
        setHolidays(hols);
      })
      .catch(() => { if (!cancelled) setHistoryFailed(true); });
    return () => { cancelled = true; };
  }, [member?.id, refreshKey]);

  if (!member) return null;

  const status = getUserStatus(member, onLeaveIds);
  const { variant, label } = statusBadgeProps(status);

  const today = statusDays?.find((d) => d.business_date === toISODate(new Date()));
  const showClockIn = today && (status === "office" || status === "wfh");

  return (
    <>
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />

      <div className="absolute right-0 top-0 h-full w-full max-w-[440px] bg-white shadow-xl flex flex-col">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 z-10 p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
        >
          <X size={16} />
        </button>

        <div className="flex-1 overflow-y-auto">
        {/* Header */}
        <div className="px-7 pt-7 pb-6 border-b border-slate-100">
          <div className="flex items-center gap-4">
            <Avatar name={member.name} size="xl" />
            <div className="min-w-0">
              <h2 className="text-[20px] font-bold text-slate-900 truncate">{member.name}</h2>
              <p className="text-[13.5px] text-slate-500 mt-0.5 truncate">{member.role}</p>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Badge variant={variant}>{label}</Badge>
            {showClockIn && (
              <span className="text-[12.5px] text-slate-400">
                Clocked in at {formatTimeOfDay(today.clocked_in_at)}
              </span>
            )}
          </div>
        </div>

        {/* Employee details */}
        <div className="px-7 py-6 border-b border-slate-100">
          <SectionHeading>Employee Details</SectionHeading>
          <DetailRow label="Role" value={member.role} />
          {member.manager && onSelectMember ? (
            <div className="flex items-baseline gap-4 py-1.5">
              <span className="text-[15px] text-slate-400 w-28 shrink-0">Reports to</span>
              <button
                onClick={() => onSelectMember(member.manager.id)}
                className="text-[15px] text-blue-600 font-medium hover:underline text-left"
              >
                {member.manager.name}
              </button>
            </div>
          ) : (
            <DetailRow label="Reports to" value={member.manager?.name} />
          )}
          <DetailRow label="Joined" value={member.joining_date && formatDateLong(member.joining_date)} />
          <DetailRow label="Birthday" value={member.birthday && formatBirthday(member.birthday)} />
        </div>

        {/* Contact */}
        <div className="px-7 py-6 border-b border-slate-100">
          <SectionHeading>Contact</SectionHeading>
          <div className="flex items-baseline gap-4 py-1.5">
            <span className="text-[15px] text-slate-400 w-28 shrink-0">Email</span>
            <a href={`mailto:${member.email}`} className="text-[15px] text-blue-600 font-medium hover:underline truncate">
              {member.email}
            </a>
          </div>
          <div className="flex items-baseline gap-4 py-1.5">
            <span className="text-[15px] text-slate-400 w-28 shrink-0">Phone</span>
            {member.phone_number ? (
              <a href={`tel:${member.phone_number.replace(/\s+/g, "")}`} className="text-[15px] text-blue-600 font-medium hover:underline">
                {member.phone_number}
              </a>
            ) : (
              <span className="text-[15px] text-slate-800 font-medium">—</span>
            )}
          </div>
        </div>

        {/* Leave balance */}
        <div className="px-7 py-6 border-b border-slate-100">
          <SectionHeading>Leave Balance · {new Date().getFullYear()}</SectionHeading>

          {failed && <p className="text-[13.5px] text-slate-400">Couldn&apos;t load leave balances.</p>}

          {!failed && !balances && (
            <div className="flex justify-center py-6"><Spinner /></div>
          )}

          {balances && (
            <>
              <div className="grid grid-cols-2 gap-3">
                {BALANCE_TYPES.map((t) => (
                  <BalanceCard key={t} type={t} entry={balances[t]} />
                ))}
              </div>
              <div className="mt-3 border border-dashed border-slate-300 rounded-xl px-4 py-3">
                <p className="text-[13.5px] font-semibold text-slate-700">Leave without pay</p>
                <p className="text-[12px] text-slate-400 mt-0.5">When paid balance is exhausted</p>
              </div>
            </>
          )}
        </div>

        {/* Planning hygiene — mirrors the leaves side drawer's order (balances,
            then hygiene). Renders nothing if hygiene is null. */}
        {hygiene && (
          <div className="px-7 py-6 border-b border-slate-100">
            <SectionHeading>Planning Hygiene</SectionHeading>
            <HygieneDetailBlock hygiene={hygiene} />
          </div>
        )}

        {/* Upcoming leaves */}
        <div className="px-7 py-6 border-b border-slate-100">
          <SectionHeading>Upcoming Leaves</SectionHeading>

          {historyFailed && <p className="text-[13.5px] text-slate-400">Couldn&apos;t load upcoming leaves.</p>}
          {!historyFailed && !leaveSummary && <div className="flex justify-center py-6"><Spinner /></div>}
          {leaveSummary && <UpcomingLeaves leaves={leaveSummary.upcoming} />}
        </div>

        {/* Check-in log */}
        <div className="px-7 py-6">
          <SectionHeading>Check-in Log</SectionHeading>

          {historyFailed && <p className="text-[13.5px] text-slate-400">Couldn&apos;t load the check-in log.</p>}
          {!historyFailed && !statusDays && <div className="flex justify-center py-6"><Spinner /></div>}
          {statusDays && leaveSummary && holidays && (
            <CheckInLog
              statusDays={statusDays}
              leaveDates={leaveSummary.leave_dates}
              holidays={holidays}
            />
          )}

          <button
            onClick={() => setShowHistory(true)}
            className="mt-5 inline-flex items-center gap-2 border border-slate-200 rounded-xl px-4 py-2.5 text-[14px] font-semibold text-blue-600 hover:bg-slate-50 transition-colors"
          >
            <CalendarRange size={16} />
            View full history →
          </button>
        </div>
        </div>

        {/* Always-visible action row */}
        {showLeaveButton && (
          <div className="border-t border-slate-200 px-7 py-4 bg-white">
            <Button variant="primary" size="xl" className="w-full" onClick={() => setAddingLeave(true)}>
              <Plus size={16} />
              {isAdmin ? "Add leave" : "Request leave"}
            </Button>
          </div>
        )}
      </div>
    </div>

    {showLeaveButton && (
      <RequestLeaveModal
        open={addingLeave}
        onClose={() => setAddingLeave(false)}
        onSuccess={() => { setAddingLeave(false); setRefreshKey((k) => k + 1); }}
        holidays={holidays ?? []}
        leaveRules={leaveRules}
        balances={balances}
        unconstrained={isAdmin}
        isAdmin={isAdmin}
        adminForUser={isAdmin ? member : null}
      />
    )}

    <CheckInHistoryModal
      open={showHistory}
      onClose={() => setShowHistory(false)}
      member={member}
      holidays={holidays ?? []}
    />
    </>
  );
}

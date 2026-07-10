import { useEffect, useState } from "react";
import { X } from "lucide-react";
import Avatar from "../ui/Avatar";
import Badge from "../ui/Badge";
import Spinner from "../ui/Spinner";
import CheckInLog from "./CheckInLog";
import UpcomingLeaves from "./UpcomingLeaves";
import {
  LEAVE_TYPE_META,
  formatDateLong,
  formatDayMonth,
  formatTimeOfDay,
  getUserStatus,
  statusBadgeProps,
  toISODate,
} from "../../lib/utils";
import { getHolidays, getStatusHistory, getUserBalances, getUserLeaveSummary } from "../../lib/api";

const BALANCE_TYPES = ["earned", "sick_and_casual", "bereavement", "marriage", "maternity", "paternity"];

function DetailRow({ label, value }) {
  return (
    <div className="flex items-baseline gap-4 py-1.5">
      <span className="text-[13.5px] text-slate-400 w-28 shrink-0">{label}</span>
      <span className="text-[13.5px] text-slate-800 font-medium">{value ?? "—"}</span>
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

export default function ProfileSidebar({ member, onLeaveIds, onClose }) {
  const [balances, setBalances] = useState(null);
  const [failed, setFailed] = useState(false);

  const [statusDays, setStatusDays] = useState(null);
  const [leaveSummary, setLeaveSummary] = useState(null);
  const [holidays, setHolidays] = useState(null);
  const [historyFailed, setHistoryFailed] = useState(false);

  useEffect(() => {
    const handler = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    if (!member) return;
    let cancelled = false;
    setBalances(null);
    setFailed(false);
    getUserBalances(member.id)
      .then((b) => { if (!cancelled) setBalances(b); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [member?.id]);

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
  }, [member?.id]);

  if (!member) return null;

  const status = getUserStatus(member, onLeaveIds);
  const { variant, label } = statusBadgeProps(status);

  const today = statusDays?.find((d) => d.business_date === toISODate(new Date()));
  const showClockIn = today && (status === "office" || status === "wfh");

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />

      <div className="absolute right-0 top-0 h-full w-full max-w-[440px] bg-white shadow-xl overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
        >
          <X size={16} />
        </button>

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
          <DetailRow label="Reports to" value={member.manager?.name} />
          <DetailRow label="Joined" value={member.joining_date && formatDateLong(member.joining_date)} />
          <DetailRow label="Birthday" value={member.birthday && formatDayMonth(member.birthday)} />
        </div>

        {/* Contact */}
        <div className="px-7 py-6 border-b border-slate-100">
          <SectionHeading>Contact</SectionHeading>
          <div className="flex items-baseline gap-4 py-1.5">
            <span className="text-[13.5px] text-slate-400 w-28 shrink-0">Email</span>
            <a href={`mailto:${member.email}`} className="text-[13.5px] text-blue-600 font-medium hover:underline truncate">
              {member.email}
            </a>
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
        </div>
      </div>
    </div>
  );
}

import Badge from "../ui/Badge";
import { LEAVE_TYPE_META, countDays, formatDateShort } from "../../lib/utils";

function daysUntil(startISO) {
  const start = new Date(startISO + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((start - today) / 86400000);
}

function whenLabel(startISO) {
  const days = daysUntil(startISO);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

function dateRange(leave) {
  const days = countDays(leave.start_date, leave.end_date);
  const span = leave.start_date === leave.end_date
    ? formatDateShort(leave.start_date)
    : `${formatDateShort(leave.start_date)} – ${formatDateShort(leave.end_date)}`;
  return `${span} · ${days} ${days === 1 ? "day" : "days"}`;
}

function LeaveRow({ leave }) {
  const start = new Date(leave.start_date + "T00:00:00");
  const meta = LEAVE_TYPE_META[leave.leave_type];

  return (
    <div className="flex items-center gap-4 border border-slate-200 rounded-xl px-4 py-3">
      <div className="w-11 shrink-0 text-center">
        <p className="text-[10.5px] font-bold uppercase tracking-wider text-red-500">
          {start.toLocaleDateString("en-GB", { month: "short" })}
        </p>
        <p className="text-[21px] font-bold text-slate-900 leading-none mt-0.5">{start.getDate()}</p>
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-[14.5px] font-semibold text-slate-900 truncate">{meta.label} leave</p>
        <p className="text-[12.5px] text-slate-400 mt-0.5">{dateRange(leave)}</p>
      </div>

      <Badge variant="violet">{whenLabel(leave.start_date)}</Badge>
    </div>
  );
}

export default function UpcomingLeaves({ leaves }) {
  if (leaves.length === 0) {
    return <p className="text-[13.5px] text-slate-400">No leave booked.</p>;
  }

  return (
    <div className="space-y-2.5">
      {leaves.map((leave) => <LeaveRow key={leave.id} leave={leave} />)}
    </div>
  );
}

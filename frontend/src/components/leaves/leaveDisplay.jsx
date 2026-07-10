import Badge from "../ui/Badge";
import { LEAVE_TYPE_META, formatDate, formatDateShort } from "../../lib/utils";

export function todayStr() {
  return new Date().toISOString().split("T")[0];
}

export function fmtDateRange(start, end) {
  if (start === end) return formatDate(start);
  return `${formatDateShort(start)} → ${formatDateShort(end)}`;
}

export function fmtDecidedAt(isoStr) {
  const d = new Date(isoStr);
  const day = d.getDate();
  const month = d.toLocaleString("en-US", { month: "short" });
  const time = d.toLocaleString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${day} ${month}, ${time}`;
}

export function leaveLabel(type) { return LEAVE_TYPE_META[type]?.label ?? type; }
export function leaveColor(type) { return LEAVE_TYPE_META[type]?.color ?? "#94a3b8"; }
export function leaveBg(type)    { return LEAVE_TYPE_META[type]?.bg    ?? "#e2e8f0"; }
export function leaveText(type)  { return LEAVE_TYPE_META[type]?.text  ?? "#334155"; }

/** The status a person actually cares about, which is not the same as leave.status. */
export function derivedStatus(leave) {
  if (leave.status === "rejected") return "declined";
  if (leave.status === "approved" && leave.start_date >= todayStr()) return "scheduled";
  if (leave.status === "approved") return "previous";
  const nextPending = leave.approvals?.find((a) => a.status === "pending");
  if (nextPending?.step > 1) return "pending_l2";
  return "pending";
}

const DOT = ({ color }) => <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${color}`} />;

const STATUS_BADGE_CLS = "text-[13.5px] font-semibold px-4 py-[5.5px]";

export function StatusBadge({ status }) {
  if (status === "scheduled")  return <Badge variant="blue"   className={STATUS_BADGE_CLS}><DOT color="bg-blue-700" />Scheduled</Badge>;
  if (status === "previous")   return <Badge variant="slate"  className={STATUS_BADGE_CLS}><DOT color="bg-slate-500" />Previous</Badge>;
  if (status === "declined")   return <Badge variant="red"    className={STATUS_BADGE_CLS}><DOT color="bg-red-700" />Declined</Badge>;
  return <Badge variant="yellow" className={STATUS_BADGE_CLS}><DOT color="bg-amber-700" />Pending approval</Badge>;
}

import { AlertTriangle, Pencil, Trash2 } from "lucide-react";
import Avatar from "../ui/Avatar";
import { countBusinessDays } from "../../lib/utils";
import {
  StatusBadge, derivedStatus, fmtDateRange, fmtDecidedAt,
  leaveBg, leaveLabel, leaveText,
} from "./leaveDisplay";

function ApprovalChainCell({ leave }) {
  const approvals = leave.approvals ?? [];
  if (!approvals.length) return <span className="text-[13px] text-slate-400">—</span>;

  const sorted = [...approvals].sort((a, b) => a.step - b.step);
  const firstPendingIdx = sorted.findIndex((a) => a.status === "pending");

  function nameColor(a, idx) {
    if (a.status === "approved") return "text-emerald-600 font-semibold";
    if (a.status === "rejected") return "text-red-500 font-semibold";
    if (idx === firstPendingIdx) return "text-amber-600 font-semibold";
    return "text-slate-300 font-medium";
  }

  let note = null;
  if (leave.status === "rejected") {
    const rej = sorted.find((a) => a.status === "rejected");
    const when = rej?.decided_at ? fmtDecidedAt(rej.decided_at) : null;
    note = <span className="text-red-500">Declined{when ? ` · ${when}` : ""}</span>;
  } else if (leave.status === "approved") {
    const last = sorted.filter((a) => a.decided_at).sort((a, b) => b.decided_at.localeCompare(a.decided_at))[0];
    const when = last?.decided_at ? fmtDecidedAt(last.decided_at) : null;
    note = <span className="text-slate-400">Approved{when ? ` · ${when}` : ""}</span>;
  } else {
    const lastApproved = sorted.filter((a) => a.status === "approved").sort((a, b) => b.step - a.step)[0];
    const pendingApproval = sorted.find((a) => a.status === "pending");
    if (lastApproved) {
      const firstName = lastApproved.approver.name.split(" ")[0];
      const when = lastApproved.decided_at ? fmtDecidedAt(lastApproved.decided_at) : null;
      note = <span className="text-slate-400">{firstName} approved{when ? ` · ${when}` : ""}</span>;
    } else if (pendingApproval) {
      note = <span className="text-slate-400">Awaiting {pendingApproval.approver.name.split(" ")[0]}</span>;
    }
  }

  return (
    <div>
      <div className="flex items-center gap-0.5 flex-wrap">
        {sorted.map((a, i) => (
          <span key={a.id} className="flex items-center gap-0.5">
            {i > 0 && <span className="text-slate-300 text-[12px] mx-1">→</span>}
            <span className={`text-[14px] ${nameColor(a, i)}`}>{a.approver.name.split(" ")[0]}</span>
          </span>
        ))}
      </div>
      {note && <p className="text-[12px] mt-0.5 leading-snug">{note}</p>}
    </div>
  );
}

function LeaveTableRow({ leave, holidays, onDelete, onEdit, onClick, showEmployee, unrestricted }) {
  const status = derivedStatus(leave);
  const days = countBusinessDays(leave.start_date, leave.end_date, holidays || []);
  const isPending = status === "pending" || status === "pending_l2";
  const isScheduled = status === "scheduled";

  // An admin edits and deletes any leave at any age; everyone else is bound by
  // what the leave routes will actually accept.
  const canEdit = unrestricted || isPending;
  const canDelete = unrestricted || isPending || isScheduled;

  return (
    <tr className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors" onClick={onClick}>
      {showEmployee && (
        <td className="py-4 pl-6 pr-4 w-[300px]">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar name={leave.user.name} size="sm" />
            <span className="text-[15px] font-semibold text-slate-800 truncate">{leave.user.name}</span>
          </div>
        </td>
      )}
      <td className="py-4 px-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-2 rounded-full px-5 py-2 text-[15px] font-semibold"
              style={{ backgroundColor: leaveBg(leave.leave_type), color: leaveText(leave.leave_type) }}>
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: leaveText(leave.leave_type) }} />
              {leaveLabel(leave.leave_type)}
            </span>
            {leave.is_exception && (
              <span className="text-[12px] font-bold text-amber-900 bg-amber-100 border border-amber-300 rounded-md px-2.5 py-1 uppercase tracking-wider">Exception</span>
            )}
            {leave.over_limit && (
              <span className="inline-flex items-center gap-0.5 text-[10.5px] font-medium text-red-900 bg-red-100 rounded px-1.5 py-px">
                <AlertTriangle size={9} />Over limit
              </span>
            )}
          </div>
          {leave.note && <p className="text-[12.5px] text-slate-400 truncate max-w-[200px]">{leave.note}</p>}
        </div>
      </td>
      <td className="py-4 px-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-[14px] font-medium text-slate-800 whitespace-nowrap">{fmtDateRange(leave.start_date, leave.end_date)}</span>
          <span className="text-[12.5px] text-slate-400">{days} day{days !== 1 ? "s" : ""}</span>
        </div>
      </td>
      <td className="py-4 px-4"><StatusBadge status={status} /></td>
      <td className="py-4 px-4"><ApprovalChainCell leave={leave} /></td>
      <td className="py-4 px-4 text-right" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 justify-end">
          {canEdit && onEdit && (
            <button onClick={(e) => { e.stopPropagation(); onEdit(leave); }} title="Edit"
              aria-label={`Edit ${leaveLabel(leave.leave_type)} leave`}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
              <Pencil size={17} />
            </button>
          )}
          {canDelete && onDelete && (
            <button onClick={(e) => { e.stopPropagation(); onDelete(leave.id); }}
              aria-label={`Delete ${leaveLabel(leave.leave_type)} leave`}
              className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors">
              <Trash2 size={17} />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

export default function LeaveTable({ leaves, holidays, onDelete, onEdit, onRowClick, showEmployee, unrestricted }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50">
            {showEmployee && <th className="text-left text-[12px] font-semibold text-slate-400 uppercase tracking-wider py-3.5 pl-6 pr-4 w-[300px]">Employee</th>}
            <th className="text-left text-[12px] font-semibold text-slate-400 uppercase tracking-wider py-3.5 px-4">Leave</th>
            <th className="text-left text-[12px] font-semibold text-slate-400 uppercase tracking-wider py-3.5 px-4">Dates</th>
            <th className="text-left text-[12px] font-semibold text-slate-400 uppercase tracking-wider py-3.5 px-4">Status</th>
            <th className="text-left text-[12px] font-semibold text-slate-400 uppercase tracking-wider py-3.5 px-4">Approved by</th>
            <th className="py-3.5 px-3" />
          </tr>
        </thead>
        <tbody>
          {leaves.length === 0 ? (
            <tr>
              <td colSpan={showEmployee ? 6 : 5} className="py-12 text-center text-[15px] text-slate-400">
                No leaves to show.
              </td>
            </tr>
          ) : (
            leaves.map((leave) => (
              <LeaveTableRow key={leave.id} leave={leave} holidays={holidays}
                onDelete={onDelete} onEdit={onEdit} onClick={() => onRowClick(leave)}
                showEmployee={showEmployee} unrestricted={unrestricted} />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

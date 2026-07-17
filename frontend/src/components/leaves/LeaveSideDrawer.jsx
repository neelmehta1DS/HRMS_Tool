import { AlertTriangle, Check, Info, Pencil, Trash2, X } from "lucide-react";
import Avatar from "../ui/Avatar";
import { LEAVE_TYPE_META, countBusinessDays } from "../../lib/utils";
import { StatusBadge, derivedStatus, fmtDateRange, fmtDecidedAt } from "./leaveDisplay";
import { HygieneDetailBlock } from "./LeaveHygiene";

function ApprovalSteps({ leave }) {
  const approvals = leave?.approvals;
  if (!approvals?.length) return null;

  const sorted = [...approvals].sort((a, b) => a.step - b.step);
  const firstPendingIdx = sorted.findIndex((a) => a.status === "pending");

  function circleStyle(a, idx) {
    if (a.status === "approved") return "bg-emerald-50/50 border-2 border-emerald-500 text-emerald-600";
    if (a.status === "rejected") return "bg-red-50 border-2 border-red-400 text-red-500";
    if (idx === firstPendingIdx) return "bg-amber-50 border-2 border-amber-400 text-amber-500";
    return "bg-white border-2 border-slate-200 text-slate-300";
  }

  function nameColor(a, idx) {
    if (a.status === "approved") return "text-slate-900";
    if (a.status === "rejected") return "text-red-500";
    if (idx === firstPendingIdx) return "text-slate-900";
    return "text-slate-400";
  }

  function statusLine(a, idx) {
    if (a.status === "approved") return { text: `Approved${a.decided_at ? ` · ${fmtDecidedAt(a.decided_at)}` : ""}`, cls: "text-emerald-600" };
    if (a.status === "rejected") return { text: `Declined${a.decided_at ? ` · ${fmtDecidedAt(a.decided_at)}` : ""}`, cls: "text-red-500" };
    if (idx === firstPendingIdx) return { text: "Pending", cls: "text-amber-600" };
    return { text: "Waiting", cls: "text-slate-400" };
  }

  return (
    <div>
      {sorted.map((a, idx) => {
        const isLast = idx === sorted.length - 1;
        const { text, cls } = statusLine(a, idx);
        return (
          <div key={a.id} className="flex gap-4">
            <div className="flex flex-col items-center">
              <div className={`w-6 h-6 rounded-full shrink-0 ${circleStyle(a, idx)}`} />
              {!isLast && <div className="w-px bg-slate-200 flex-1 my-1" style={{ minHeight: 24 }} />}
            </div>
            <div className={`${isLast ? "pb-0" : "pb-6"} min-w-0`}>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">{a.approver.role}</p>
              <p className={`text-[15px] font-bold leading-snug ${nameColor(a, idx)}`}>{a.approver.name}</p>
              <p className={`text-[13px] font-medium mt-0.5 ${cls}`}>{text}</p>
              {a.rejection_note && <p className="text-[12.5px] text-red-500 italic mt-1">&quot;{a.rejection_note}&quot;</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BalanceBar({ type, entry }) {
  if (!entry || entry.limit == null) return null;
  const meta = LEAVE_TYPE_META[type];
  const pct = Math.min(entry.taken / entry.limit, 1) * 100;
  const remaining = Math.max(0, entry.limit - entry.taken);
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2 w-[132px] shrink-0">
        <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: meta.color }} />
        <span className="text-[13.5px] font-medium text-slate-700">{meta.label}</span>
      </div>
      <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: meta.color }} />
      </div>
      <span className="text-[13.5px] font-semibold text-slate-800 shrink-0 whitespace-nowrap">
        {remaining} of {entry.limit} left
      </span>
    </div>
  );
}

function EmployeeBalanceBlock({ balances, name }) {
  if (!balances) return null;
  const firstName = (name || "").split(" ")[0];
  const title = name ? `${firstName}'s leave balance` : "Your leave balance";

  const specials = ["bereavement", "marriage", "maternity", "paternity", "lwp"];
  const takenSpecials = specials
    .filter((t) => (balances[t]?.taken ?? 0) > 0)
    .map((t) => `${LEAVE_TYPE_META[t].label} ${balances[t].taken}d`);

  return (
    <div className="bg-slate-50 rounded-xl p-4">
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-3">{title}</p>
      <div className="space-y-2.5">
        <BalanceBar type="earned" entry={balances.earned} />
        <BalanceBar type="sick_and_casual" entry={balances.sick_and_casual} />
      </div>
      {takenSpecials.length > 0 && (
        <div className="border-t border-slate-200 mt-3 pt-3">
          <p className="text-[13px] text-slate-500">
            <span className="font-medium text-slate-600">Special taken</span> · {takenSpecials.join(", ")}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * `context` is "own", "manager" or "admin".
 *  - own: shows a withdraw button, and the signed-in user's balances
 *  - manager: shows approve/decline on a pending leave
 *  - admin: read-and-edit; the page owns the buttons, so this shows none
 */
export default function LeaveSideDrawer({
  leave, context, holidays, onClose, onDelete, onEdit, onApprove, onRejectOpen, balances, hygiene,
}) {
  if (!leave) return null;
  const days = countBusinessDays(leave.start_date, leave.end_date, holidays || []);
  const status = derivedStatus(leave);
  const meta = LEAVE_TYPE_META[leave.leave_type] ?? { label: leave.leave_type, color: "#94a3b8", bg: "#f8fafc" };
  const rejectionNote = leave.approvals?.find((a) => a.status === "rejected")?.rejection_note;
  const isOwn = context === "own";
  const isManager = context === "manager";

  // A leave from the manager view carries the employee's balances; the own view
  // and the admin page pass them in directly. Hygiene follows the same rule and
  // is null for L2 leads, so the block renders nothing for them.
  const balanceSource = isOwn ? balances : (leave.user_balances ?? balances);
  const hygieneSource = isOwn ? hygiene : (leave.user_hygiene ?? hygiene);
  const showManagerActions = isManager && (status === "pending" || status === "pending_l2");
  const showWithdraw = isOwn && (status === "pending" || status === "pending_l2" || status === "scheduled");
  // Editable whenever the leaves route accepts it — same rule the table's pencil uses.
  const showEdit = isOwn && onEdit && (status === "pending" || status === "pending_l2");

  return (
    <div className="fixed inset-0 z-40 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/20" />
      <div className="relative w-[440px] max-w-full h-full bg-white shadow-2xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 pt-5 pb-4 border-b border-slate-100">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2.5">
              <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: meta.color }} />
              <span className="text-[19px] font-bold text-slate-900">{meta.label}</span>
            </div>
            <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 transition-colors">
              <X size={18} />
            </button>
          </div>
          <div className="mt-3"><StatusBadge status={status} /></div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {leave.is_exception && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-3 py-3 text-[13px]">
              <Info size={15} className="mt-0.5 shrink-0" />
              <span><b>Exception request</b> — notice rules waived, routed to skip manager.</span>
            </div>
          )}

          {leave.over_limit && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl px-3 py-3 text-[13px]">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <span>This leave exceeds the {meta.label} limit for the year.</span>
            </div>
          )}

          {!isOwn && leave.user && (
            <div>
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Employee</p>
              <div className="flex items-center gap-2.5">
                <Avatar name={leave.user.name} size="sm" />
                <span className="text-[15.5px] font-semibold text-slate-900">{leave.user.name}</span>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-y-5 gap-x-4">
            {[
              { label: "Dates",      value: fmtDateRange(leave.start_date, leave.end_date) },
              { label: "Duration",   value: `${days} day${days !== 1 ? "s" : ""}` },
              { label: "Applied on", value: leave.created_at ? fmtDecidedAt(leave.created_at) : "—" },
              { label: "Leave type", value: meta.label },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">{label}</p>
                <p className="text-[15px] font-semibold text-slate-900">{value}</p>
              </div>
            ))}
          </div>

          <EmployeeBalanceBlock balances={balanceSource} name={isOwn ? null : leave.user?.name} />

          <HygieneDetailBlock hygiene={hygieneSource} />

          {leave.note && (
            <div>
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">Reason</p>
              <div className="bg-slate-50 rounded-xl px-4 py-3.5 border border-slate-100">
                <p className="text-[14.5px] text-slate-700 leading-relaxed">{leave.note}</p>
              </div>
            </div>
          )}

          {rejectionNote && (
            <div className="bg-red-50 border border-red-100 rounded-xl p-4">
              <p className="text-[11px] font-semibold text-red-400 uppercase tracking-wider mb-1">Decline reason</p>
              <p className="text-[14px] text-red-700">&quot;{rejectionNote}&quot;</p>
            </div>
          )}

          {leave.approvals?.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-4">Approval chain</p>
              <ApprovalSteps leave={leave} />
            </div>
          )}
        </div>

        {(showManagerActions || showWithdraw || showEdit) && (
          <div className="border-t border-slate-100 px-6 py-4">
            {(showEdit || showWithdraw) && (
              <div className="flex items-center gap-3">
                {showEdit && (
                  <button onClick={() => { onClose(); onEdit(leave); }}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border-[1.5px] border-slate-200 text-slate-700 text-[15px] font-semibold hover:bg-slate-50 transition-colors">
                    <Pencil size={16} /> Edit
                  </button>
                )}
                {showWithdraw && (
                  <button onClick={() => { onClose(); onDelete(leave.id); }}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border-[1.5px] border-red-200 text-red-600 text-[15px] font-semibold hover:bg-red-50 transition-colors">
                    <Trash2 size={16} /> Withdraw leave
                  </button>
                )}
              </div>
            )}
            {showManagerActions && (
              <div className="flex items-center gap-3">
                <button onClick={() => { onClose(); onApprove(leave.id); }}
                  className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl bg-[#5b52f0] text-white text-[15px] font-semibold hover:bg-[#4a41e0] transition-colors">
                  <Check size={17} /> Approve
                </button>
                <button onClick={() => onRejectOpen(leave)}
                  className="flex-1 flex items-center justify-center py-3.5 rounded-xl text-red-600 text-[15px] font-semibold hover:bg-red-50 transition-colors">
                  Decline
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

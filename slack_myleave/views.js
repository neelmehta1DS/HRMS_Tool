// views.js
// Block Kit builders for the approval flow — accept user objects from the backend API.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Format an ISO date string (YYYY-MM-DD) the friendly way, e.g. '20 Jul 2026'.
// Parsed by hand to avoid Date() timezone shifts.
function fmtDate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

// Human-friendly date range with no raw ISO dates.
// Single day → '20 Jul 2026'. Same-year → '20 Jul → 22 Jul 2026'.
// Cross-year → '28 Dec 2025 → 3 Jan 2026'.
function dateRange(start, end) {
  if (start === end) return fmtDate(start);
  const [sy, sm, sd] = String(start).split('-').map(Number);
  if (sy === Number(String(end).split('-')[0])) {
    return `${sd} ${MONTHS[sm - 1]} → ${fmtDate(end)}`;
  }
  return `${fmtDate(start)} → ${fmtDate(end)}`;
}

// Display labels for leave types — must mirror LEAVE_TYPE_LABELS in the backend
// (backend/models/leaves.py) so both surfaces read identically.
const LEAVE_TYPE_LABELS = {
  earned: 'Earned',
  sick: 'Sick',
  casual: 'Casual',
  sick_and_casual: 'Sick & Casual',
  bereavement: 'Bereavement',
  marriage: 'Marriage',
  maternity: 'Maternity',
  paternity: 'Paternity',
  lwp: 'Leave Without Pay',
};

// The display label for a leave type, e.g. 'lwp' → 'Leave Without Pay'.
function typeLabel(leaveType) {
  return LEAVE_TYPE_LABELS[leaveType] ||
    String(leaveType).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// A user-facing noun phrase, e.g. 'Earned leave', but 'Leave Without Pay' as-is
// (never 'Leave Without Pay leave'). Mirrors leave_phrase() in the backend.
function leavePhrase(leaveType) {
  const label = typeLabel(leaveType);
  return /leave/i.test(label) ? label : `${label} leave`;
}

// ---------- DM: approval request sent to a manager ----------
// leave      — backend LeaveResponse object
// applicant  — BotUserResponse (the person whose leave it is)
// days       — number of working days
function approverMessage(leave, applicant, days, overLimit = false) {
  const dateStr = dateRange(leave.start_date, leave.end_date);
  const phrase = leavePhrase(leave.leave_type);
  const firstName = (applicant.name || '').split(' ')[0] || applicant.name;
  const overLimitLine = overLimit
    ? `\n⚠️ This request will exceed ${firstName}'s ${phrase.toLowerCase()} balance.`
    : '';
  const exceptionLine = leave.is_exception
    ? '\n🚨 Exception request — notice-period rules were waived.'
    : '';
  return {
    text: `Leave approval needed for ${applicant.name}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Leave approval needed*\n` +
                `*${applicant.name}* (${applicant.role}) has requested time off and needs your approval.\n\n` +
                `*Type:*  ${phrase}\n` +
                `*Dates:*  ${dateStr}  (${days} working day${days === 1 ? '' : 's'})\n` +
                `*Note:*  ${leave.note || '—'}` +
                overLimitLine +
                exceptionLine,
        },
      },
      {
        type: 'actions',
        elements: [
          { type: 'button', action_id: 'leave_approve', style: 'primary',
            text: { type: 'plain_text', text: 'Approve' }, value: String(leave.id) },
          { type: 'button', action_id: 'leave_reject', style: 'danger',
            text: { type: 'plain_text', text: 'Reject' }, value: String(leave.id) },
        ],
      },
    ],
  };
}

// ---------- Modal: reject reason ----------
function rejectReasonView(leaveId, channel, ts) {
  return {
    type: 'modal',
    callback_id: 'leave_reject_reason',
    private_metadata: JSON.stringify({ leaveId, channel, ts }),
    title: { type: 'plain_text', text: 'Reject Leave' },
    submit: { type: 'plain_text', text: 'Reject' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [{
      type: 'input', block_id: 'reason', optional: true,
      label: { type: 'plain_text', text: 'Reason for rejection' },
      hint: { type: 'plain_text', text: 'Optional — leave blank to decline without a note.' },
      element: { type: 'plain_text_input', action_id: 'val', multiline: true },
    }],
  };
}

// Plain text blocks to overwrite an approver DM after a decision.
// leave — backend LeaveResponse; summaryLine — mrkdwn string
function decidedBlocks(leave, summaryLine) {
  const applicantName = leave.user?.name || 'Unknown';
  const dateStr = dateRange(leave.start_date, leave.end_date);
  return [{ type: 'section', text: { type: 'mrkdwn',
    text: `*${applicantName}* · ${leavePhrase(leave.leave_type)} · ${dateStr}\n${summaryLine}` } }];
}

module.exports = { approverMessage, rejectReasonView, decidedBlocks, fmtDate, dateRange, typeLabel, leavePhrase };

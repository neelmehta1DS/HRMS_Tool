// views.js
// Block Kit builders — accept user objects from the backend API, not PEOPLE names.

const dayjs = require('dayjs');
const { today } = require('./leaveRules');

const TOTALS = require('../leave_limits.json');

// ---------- Modal: main menu ----------
function menuView(user, balance) {
  return {
    type: 'modal',
    callback_id: 'leave_menu',
    title: { type: 'plain_text', text: 'Leave Management' },
    close: { type: 'plain_text', text: 'Close' },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Hi ${user.name}*  ·  ${user.role}\n` +
                `:beach_with_umbrella: Sick *${balance.sick}* left  ·  ` +
                `:palm_tree: Casual *${balance.casual}* left`,
        },
      },
      { type: 'divider' },
      {
        type: 'actions',
        elements: [
          { type: 'button', action_id: 'leave_apply', style: 'primary',
            text: { type: 'plain_text', text: 'Apply for Leave' } },
          { type: 'button', action_id: 'leave_balance',
            text: { type: 'plain_text', text: 'My Balance' } },
          { type: 'button', action_id: 'leave_holidays',
            text: { type: 'plain_text', text: 'Holiday Calendar' } },
          { type: 'button', action_id: 'leave_availability',
            text: { type: 'plain_text', text: 'Team Availability' } },
        ],
      },
    ],
  };
}

// ---------- Modal: apply form (pushed) ----------
function applyView(user) {
  const t = today();
  return {
    type: 'modal',
    callback_id: 'leave_apply_submit',
    private_metadata: JSON.stringify({ slackId: user.slack_user_id }),
    title: { type: 'plain_text', text: 'Apply for Leave' },
    submit: { type: 'plain_text', text: 'Submit' },
    close: { type: 'plain_text', text: 'Back' },
    blocks: [
      {
        type: 'input', block_id: 'type',
        label: { type: 'plain_text', text: 'Leave type' },
        element: {
          type: 'radio_buttons', action_id: 'val',
          options: [
            { text: { type: 'plain_text', text: 'Sick' }, value: 'sick' },
            { text: { type: 'plain_text', text: 'Casual (advance notice required)' }, value: 'casual' },
          ],
        },
      },
      {
        type: 'input', block_id: 'start',
        label: { type: 'plain_text', text: 'Start date' },
        element: { type: 'datepicker', action_id: 'val', initial_date: t },
      },
      {
        type: 'input', block_id: 'end', optional: true,
        label: { type: 'plain_text', text: 'End date (leave blank for a single day)' },
        element: { type: 'datepicker', action_id: 'val' },
      },
      {
        type: 'input', block_id: 'note',
        label: { type: 'plain_text', text: 'Note' },
        element: { type: 'plain_text_input', action_id: 'val', multiline: true,
          placeholder: { type: 'plain_text', text: 'Keep it short' } },
      },
      {
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: ':information_source: Sick = today only. Casual single-day needs 1 day notice; ' +
                'multi-day needs 5 days notice. Weekends & holidays are not counted.',
        }],
      },
    ],
  };
}

// ---------- Modal: balance (pushed, read-only) ----------
function balanceView(user, balance) {
  const lines = [
    `*${user.name}* · ${user.role}`,
    '',
    `:beach_with_umbrella: *Sick leave:*  ${balance.sick_taken} used of ${TOTALS.sick}  ·  *${balance.sick} remaining*`,
    `:palm_tree: *Casual leave:*  ${balance.casual_taken} used of ${TOTALS.casual}  ·  *${balance.casual} remaining*`,
  ];
  return {
    type: 'modal',
    callback_id: 'leave_balance_view',
    title: { type: 'plain_text', text: 'My Balance' },
    close: { type: 'plain_text', text: 'Close' },
    blocks: [{ type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } }],
  };
}

// ---------- Modal: holidays (pushed, read-only) ----------
function holidaysView(holidays) {
  const upcoming = [...holidays].sort((a, b) => a.date.localeCompare(b.date));
  const text = upcoming.map((h) =>
    `• *${dayjs(h.date).format('ddd, DD MMM YYYY')}* — ${h.name}`
  ).join('\n');
  return {
    type: 'modal',
    callback_id: 'leave_holidays_view',
    title: { type: 'plain_text', text: 'Holiday Calendar' },
    close: { type: 'plain_text', text: 'Close' },
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: text || '_No holidays configured._' } },
    ],
  };
}

// ---------- DM: approval request sent to a manager ----------
// leave      — backend LeaveResponse object
// applicant  — BotUserResponse (the person whose leave it is)
// stepLabel  — e.g. "Step 1 of 2" or "Single approval"
// days       — number of working days
function approverMessage(leave, applicant, stepLabel, days) {
  const dateStr = leave.start_date === leave.end_date
    ? leave.start_date
    : `${leave.start_date} → ${leave.end_date}`;
  const typeLabel = leave.leave_type === 'wfh' ? 'WFH' : leave.leave_type.charAt(0).toUpperCase() + leave.leave_type.slice(1);
  return {
    text: `Leave request #${leave.id} from ${applicant.name}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Leave request* \`#${leave.id}\`  ·  _${stepLabel}_\n` +
                `*From:* ${applicant.name} (${applicant.role})\n` +
                `*Type:* ${typeLabel}\n` +
                `*Dates:* ${dateStr}  (*${days}* working day${days === 1 ? '' : 's'})\n` +
                `*Note:* ${leave.note || '—'}`,
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

// ---------- Modal: team availability ----------
function teamAvailabilityView(data) {
  const today = dayjs().format('ddd, D MMM YYYY');
  const blocks = [
    { type: 'context', elements: [{ type: 'mrkdwn', text: `:calendar: *${today}*` }] },
    { type: 'divider' },
  ];

  // On Leave section
  blocks.push({ type: 'section', text: { type: 'mrkdwn',
    text: `:palm_tree: *On Leave Today*  ·  ${data.on_leave.length}` } });

  if (data.on_leave.length === 0) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '_Nobody is on leave today._' } });
  } else {
    const lines = data.on_leave.map(p => {
      const isMultiDay = p.end_date > dayjs().format('YYYY-MM-DD');
      const until = isMultiDay ? `  ·  back ${dayjs(p.end_date).add(1, 'day').format('D MMM')}` : '';
      return `• *${p.name}* — ${p.leave_type}${until}`;
    });
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } });
  }

  blocks.push({ type: 'divider' });

  // Available section — grouped by status
  blocks.push({ type: 'section', text: { type: 'mrkdwn',
    text: `:white_check_mark: *Available*  ·  ${data.available.length}` } });

  if (data.available.length === 0) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '_Everyone is on leave!_' } });
  } else {
    const groups = [
      { key: 'In Office',     emoji: ':office:',             label: 'In Office'       },
      { key: 'WFH',           emoji: ':house_with_garden:',  label: 'Working From Home' },
      { key: 'Out of Office', emoji: ':bust_in_silhouette:', label: 'Out of Office'   },
    ];
    for (const g of groups) {
      const people = data.available.filter(p => p.status === g.key);
      if (people.length === 0) continue;
      blocks.push({ type: 'section', text: { type: 'mrkdwn',
        text: `${g.emoji} *${g.label}*\n${people.map(p => `• ${p.name}`).join('\n')}` } });
    }
  }

  return {
    type: 'modal',
    callback_id: 'team_availability_view',
    title: { type: 'plain_text', text: 'Team Availability' },
    close: { type: 'plain_text', text: 'Close' },
    blocks,
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
      type: 'input', block_id: 'reason',
      label: { type: 'plain_text', text: 'Reason for rejection' },
      element: { type: 'plain_text_input', action_id: 'val', multiline: true },
    }],
  };
}

// Plain text blocks to overwrite an approver DM after a decision.
// leave — backend LeaveResponse; summaryLine — mrkdwn string
function decidedBlocks(leave, summaryLine) {
  const applicantName = leave.user?.name || 'Unknown';
  return [{ type: 'section', text: { type: 'mrkdwn',
    text: `\`#${leave.id}\` · ${applicantName}\n${summaryLine}` } }];
}

module.exports = {
  menuView, applyView, balanceView, holidaysView,
  approverMessage, rejectReasonView, decidedBlocks, teamAvailabilityView,
};

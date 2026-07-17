// app.js
require('dotenv').config();
const { App } = require('@slack/bolt');

const rules = require('./leaveRules');
const store = require('./store');   // kept only for holidaySet (working-day math)
const api   = require('./api');
const V     = require('./views');

const DEMO_MODE    = String(process.env.DEMO_MODE).toLowerCase() === 'true';
const DEMO_USER_ID = process.env.DEMO_USER_ID || null;   // Slack ID — all DMs go here in demo mode

const app = new App({
  token:     process.env.SLACK_BOT_TOKEN,
  appToken:  process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

// ---------- Helpers ----------

// In DEMO_MODE, override the acting identity to DEMO_USER_ID so one person can test the full flow.
function effectiveSlackId(rawId) {
  return DEMO_MODE && DEMO_USER_ID ? DEMO_USER_ID : rawId;
}

// Send a DM. In DEMO_MODE every DM is redirected to DEMO_USER_ID.
async function dm(client, targetSlackId, payload) {
  const dest = DEMO_MODE ? DEMO_USER_ID : targetSlackId;
  if (!dest) {
    console.warn(`[skip DM] No Slack ID for target and DEMO_USER_ID is not set.`);
    return null;
  }
  return client.chat.postMessage({ channel: dest, ...payload }).catch(err => {
    console.error('[DM error]', err.message);
  });
}

// ---------- Approve ----------
app.action('leave_approve', async ({ ack, body, client }) => {
  await ack();
  const leaveId        = body.actions[0].value;
  const approverSlack  = effectiveSlackId(body.user.id);

  let leave;
  try {
    leave = await api.approveLeave(leaveId, approverSlack);
  } catch (e) {
    console.error('[approve error]', e.response?.data || e.message);
    await client.chat.postEphemeral({
      channel: body.channel.id, user: body.user.id,
      text: e.response?.data?.detail || 'Could not approve — please try again.',
    }).catch(() => {});
    return;
  }

  const nextStep = leave.approvals.find(a => a.status === 'pending');

  await client.chat.update({
    channel: body.channel.id, ts: body.message.ts,
    text: `You approved ${leave.user?.name || 'the'}'s leave request`,
    blocks: V.decidedBlocks(leave, ':white_check_mark: You approved this request.'),
  }).catch(() => {});

  const days    = rules.businessDays(leave.start_date, leave.end_date, store.holidaySet);
  const dateStr = V.dateRange(leave.start_date, leave.end_date);
  const phrase  = V.leavePhrase(leave.leave_type);

  if (leave.status === 'approved') {
    // Fully approved — notify applicant
    await dm(client, leave.user?.slack_user_id, {
      text: `Your ${phrase} request was approved.`,
      blocks: [{ type: 'section', text: { type: 'mrkdwn',
        text: `:tada: Your *${phrase}* request for *${dateStr}* was approved. Enjoy!` } }],
    });
  } else if (nextStep && nextStep.approver.slack_user_id) {
    // Step approved but more remain — forward to the next approver.
    // The applicant is intentionally not notified until a final decision.
    const nextMsg = await dm(client, nextStep.approver.slack_user_id,
      V.approverMessage(leave, leave.user, days));
    if (nextMsg?.ts) {
      await api.setApprovalMessage(nextStep.id, nextMsg.channel, nextMsg.ts).catch(() => {});
    }
  }
});

// ---------- Reject → reason modal ----------
app.action('leave_reject', async ({ ack, body, client }) => {
  await ack();
  const leaveId = body.actions[0].value;
  await client.views.open({
    trigger_id: body.trigger_id,
    view: V.rejectReasonView(leaveId, body.channel.id, body.message.ts),
  });
});

app.view('leave_reject_reason', async ({ ack, body, view, client }) => {
  await ack();
  const { leaveId, channel, ts } = JSON.parse(view.private_metadata);
  const reason        = view.state.values.reason?.val?.value?.trim() || '(no reason given)';
  const approverSlack = effectiveSlackId(body.user.id);

  let leave;
  try {
    leave = await api.rejectLeave(leaveId, approverSlack, reason);
  } catch (e) {
    console.error('[reject error]', e.response?.data || e.message);
    return;
  }

  // Resolve approver's display name
  const approver = await api.getUser(approverSlack).catch(() => null);
  const approverName = approver?.name || 'Manager';

  await client.chat.update({
    channel, ts,
    text: `You rejected ${leave.user?.name || 'the'}'s leave request`,
    blocks: V.decidedBlocks(leave, `:x: You rejected this request. Reason: ${reason}`),
  }).catch(() => {});

  const phrase = V.leavePhrase(leave.leave_type);
  const dateStr = V.dateRange(leave.start_date, leave.end_date);
  await dm(client, leave.user?.slack_user_id, {
    text: `Your ${phrase} request was rejected.`,
    blocks: [{ type: 'section', text: { type: 'mrkdwn',
      text: `:x: Your *${phrase}* request for *${dateStr}* was rejected by *${approverName}*.\n` +
            `*Reason:* ${reason}` } }],
  });
});

(async () => {
  await app.start();
  console.log('⚡ LeaveBot running (Socket Mode).' + (DEMO_MODE ? `  DEMO_MODE on — all DMs → ${DEMO_USER_ID}` : ''));
})();

// app.js
require('dotenv').config();
const { App } = require('@slack/bolt');

const rules = require('./leaveRules');
const store = require('./store');   // kept only for HOLIDAYS / holidaySet
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

const TOTALS = require('../leave_policy.json').limits;
function makeBalance(user) {
  return {
    sick:         TOTALS.sick   - user.sick_taken,
    casual:       TOTALS.casual - user.casual_taken,
    sick_taken:   user.sick_taken,
    casual_taken: user.casual_taken,
  };
}

// Fetch user from backend, posting an ephemeral on failure.
async function fetchUser(slackId, { channel, userId, client }) {
  try {
    return await api.getUser(slackId);
  } catch (e) {
    const is404 = e.response?.status === 404;
    const text = is404
      ? "You're not linked to the HRMS system yet. Ask an admin to set your Slack ID in the tool."
      : "Couldn't reach the HRMS backend. Please try again in a moment.";
    if (channel) {
      await client.chat.postEphemeral({ channel, user: userId, text }).catch(() => {});
    }
    return null;
  }
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

// ---------- /myleave → menu modal ----------
app.command('/myleave', async ({ ack, body, client }) => {
  await ack();
  const slackId = effectiveSlackId(body.user_id);
  const user = await fetchUser(slackId, { channel: body.channel_id, userId: body.user_id, client });
  if (!user) return;

  await client.views.open({
    trigger_id: body.trigger_id,
    view: V.menuView(user, makeBalance(user)),
  });
});

// ---------- Menu buttons ----------
app.action('leave_apply', async ({ ack, body, client }) => {
  await ack();
  const slackId = effectiveSlackId(body.user.id);
  const user = await fetchUser(slackId, { channel: body.channel?.id, userId: body.user.id, client });
  if (!user) return;
  await client.views.push({ trigger_id: body.trigger_id, view: V.applyView(user) });
});

app.action('leave_balance', async ({ ack, body, client }) => {
  await ack();
  const slackId = effectiveSlackId(body.user.id);
  const user = await fetchUser(slackId, { channel: body.channel?.id, userId: body.user.id, client });
  if (!user) return;
  await client.views.push({ trigger_id: body.trigger_id, view: V.balanceView(user, makeBalance(user)) });
});

app.action('leave_holidays', async ({ ack, body, client }) => {
  await ack();
  await client.views.push({ trigger_id: body.trigger_id, view: V.holidaysView(store.HOLIDAYS) });
});

app.action('leave_availability', async ({ ack, body, client }) => {
  await ack();
  try {
    const data = await api.getTeamAvailability();
    await client.views.push({ trigger_id: body.trigger_id, view: V.teamAvailabilityView(data) });
  } catch (e) {
    console.error('[availability error]', e.message);
  }
});

// ---------- Apply form submit ----------
app.view('leave_apply_submit', async ({ ack, body, view, client }) => {
  const { slackId } = JSON.parse(view.private_metadata);
  const vals       = view.state.values;
  const leave_type = vals.type?.val?.selected_option?.value;
  const start_date = vals.start?.val?.selected_date;
  const end_date   = vals.end?.val?.selected_date || start_date;
  const note       = vals.note?.val?.value?.trim();

  // Client-side date validation (balance check is done server-side)
  const validation = rules.validate({
    type: leave_type, start: start_date, end: end_date,
    balances: null,          // skip balance check — backend is the source of truth
    holidaySet: store.holidaySet,
  });
  if (!leave_type) validation.errors.type = 'Pick a leave type.';
  if (!note)       validation.errors.note  = 'Note is required.';

  if (Object.keys(validation.errors).length) {
    await ack({ response_action: 'errors', errors: validation.errors });
    return;
  }

  // Submit to backend
  let leave;
  try {
    leave = await api.createLeave({ slackUserId: slackId, leave_type, start_date, end_date, note });
  } catch (e) {
    const detail = e.response?.data?.detail || 'Could not submit leave — please try again.';
    await ack({ response_action: 'errors', errors: { start: detail } });
    return;
  }
  await ack();

  const days    = rules.businessDays(start_date, end_date, store.holidaySet);
  const dateStr = start_date === end_date ? start_date : `${start_date} → ${end_date}`;

  // Auto-approved (sick leave or no manager chain)
  if (leave.status === 'approved') {
    await dm(client, slackId, {
      text: `Leave #${leave.id} auto-approved.`,
      blocks: [{ type: 'section', text: { type: 'mrkdwn',
        text: `:white_check_mark: *Leave #${leave.id} auto-approved & logged.*\n` +
              `${leave_type} · ${dateStr} · ${days} working day(s).` } }],
    });
    return;
  }

  // Notify applicant — approver names come from the approval steps
  const firstStep  = leave.approvals[0];
  const secondStep = leave.approvals.find(a => a.step > firstStep.step);
  const awaitingText = `*${firstStep.approver.name}*` + (secondStep ? `, then *${secondStep.approver.name}*.` : '.');
  await dm(client, slackId, {
    text: `Leave #${leave.id} submitted.`,
    blocks: [{ type: 'section', text: { type: 'mrkdwn',
      text: `:hourglass_flowing_sand: *Leave #${leave.id} submitted* — ${leave_type} · ${dateStr} · ${days} working day(s).\n` +
            `Awaiting approval from ${awaitingText}` } }],
  });

  // DM the first approver
  if (firstStep.approver.slack_user_id) {
    const stepLabel  = secondStep ? 'Step 1 of 2' : 'Single approval';
    const taken      = leave_type === 'sick' ? leave.user.sick_leaves_taken : leave.user.casual_leaves_taken;
    const overLimit  = (taken + days) > (TOTALS[leave_type] || 0);
    const firstMsg   = await dm(client, firstStep.approver.slack_user_id,
      V.approverMessage(leave, leave.user, stepLabel, days, overLimit));
    if (firstMsg?.ts) {
      await api.setApprovalMessage(firstStep.id, firstMsg.channel, firstMsg.ts).catch(() => {});
    }
  }
});

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

  const nextStep    = leave.approvals.find(a => a.status === 'pending');
  const summaryLine = leave.status === 'approved'
    ? ':white_check_mark: *Approved* (fully).'
    : ':white_check_mark: *Approved* — awaiting further approval.';

  await client.chat.update({
    channel: body.channel.id, ts: body.message.ts,
    text: `Approved leave #${leaveId}`,
    blocks: V.decidedBlocks(leave, summaryLine),
  }).catch(() => {});

  const days    = rules.businessDays(leave.start_date, leave.end_date, store.holidaySet);
  const dateStr = leave.start_date === leave.end_date ? leave.start_date : `${leave.start_date} → ${leave.end_date}`;

  if (leave.status === 'approved') {
    // Fully approved — notify applicant
    await dm(client, leave.user?.slack_user_id, {
      text: `Leave #${leave.id} approved!`,
      blocks: [{ type: 'section', text: { type: 'mrkdwn',
        text: `:tada: *Leave #${leave.id} fully approved!*\n` +
              `${leave.leave_type} · ${dateStr} · ${days} working day(s).` } }],
    });
  } else if (nextStep) {
    // Step approved but more remain — notify applicant and DM next approver
    const justApproved = leave.approvals.find(a => a.status === 'approved');
    const approverName = justApproved?.approver.name || 'Manager';

    await dm(client, leave.user?.slack_user_id, {
      text: `Leave #${leave.id} update`,
      blocks: [{ type: 'section', text: { type: 'mrkdwn',
        text: `:arrow_forward: *Leave #${leave.id}* — ${approverName} approved. ` +
              `Now awaiting *${nextStep.approver.name}*.` } }],
    });

    if (nextStep.approver.slack_user_id) {
      const nextMsg = await dm(client, nextStep.approver.slack_user_id,
        V.approverMessage(leave, leave.user, 'Step 2 of 2', days));
      if (nextMsg?.ts) {
        await api.setApprovalMessage(nextStep.id, nextMsg.channel, nextMsg.ts).catch(() => {});
      }
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
    text: `Rejected leave #${leaveId}`,
    blocks: V.decidedBlocks(leave, `:x: *Rejected* by ${approverName}.\n_Reason:_ ${reason}`),
  }).catch(() => {});

  await dm(client, leave.user?.slack_user_id, {
    text: `Leave #${leave.id} rejected.`,
    blocks: [{ type: 'section', text: { type: 'mrkdwn',
      text: `:x: *Leave #${leave.id} was rejected* by ${approverName}.\n_Reason:_ ${reason}` } }],
  });
});

(async () => {
  await app.start();
  console.log('⚡ LeaveBot running (Socket Mode).' + (DEMO_MODE ? `  DEMO_MODE on — all DMs → ${DEMO_USER_ID}` : ''));
})();

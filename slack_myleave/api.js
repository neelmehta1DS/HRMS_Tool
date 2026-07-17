// api.js
// Thin HTTP client for the HRMS backend /bot/* endpoints.
// All calls include X-Internal-Key so the backend can verify they come from this bot.

const axios = require('axios');

const BASE = process.env.BACKEND_URL || 'http://localhost:8000';
const KEY  = process.env.INTERNAL_API_KEY || '';

const client = axios.create({
  baseURL: BASE,
  headers: { 'x-internal-key': KEY, 'Content-Type': 'application/json' },
  timeout: 8000,
});

/**
 * Returns { id, name, role, role_level, slack_user_id,
 *           l1_manager: { id, name, role, slack_user_id } | null,
 *           l2_manager: { id, name, role, slack_user_id } | null }
 */
async function getUser(slackUserId) {
  const res = await client.get(`/bot/user/${encodeURIComponent(slackUserId)}`);
  return res.data;
}

async function getLeave(leaveId) {
  const res = await client.get(`/bot/leaves/${leaveId}`);
  return res.data;
}

async function approveLeave(leaveId, approverSlackId) {
  const res = await client.patch(`/bot/leaves/${leaveId}/approve`, { slack_user_id: approverSlackId });
  return res.data;
}

async function rejectLeave(leaveId, approverSlackId, reason) {
  const res = await client.patch(`/bot/leaves/${leaveId}/reject`, {
    slack_user_id: approverSlackId,
    reason: reason || '',
  });
  return res.data;
}

async function setApprovalMessage(approvalId, channel, ts) {
  const res = await client.patch(`/bot/leave-approvals/${approvalId}/message`, { channel, ts });
  return res.data;
}

module.exports = { getUser, getLeave, approveLeave, rejectLeave, setApprovalMessage };

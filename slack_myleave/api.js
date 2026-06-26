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
 *           sick_taken, casual_taken, wfh_taken,
 *           l1_manager: { id, name, role, slack_user_id } | null,
 *           l2_manager: { id, name, role, slack_user_id } | null }
 */
async function getUser(slackUserId) {
  const res = await client.get(`/bot/user/${encodeURIComponent(slackUserId)}`);
  return res.data;
}

/**
 * Returns a LeaveResponse (same shape as the web app).
 * Throws AxiosError on 4xx/5xx.
 */
async function createLeave({ slackUserId, leave_type, start_date, end_date, note }) {
  const res = await client.post('/bot/leaves', {
    slack_user_id: slackUserId,
    leave_type,
    start_date,
    end_date,
    note: note || null,
  });
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

async function setLeaveMessage(leaveId, level, channel, ts) {
  const res = await client.patch(`/bot/leaves/${leaveId}/message`, { level, channel, ts });
  return res.data;
}

module.exports = { getUser, createLeave, getLeave, approveLeave, rejectLeave, setLeaveMessage };

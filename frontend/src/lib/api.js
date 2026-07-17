import axios from "axios";

// Backend base URL. Set VITE_API_URL at build time in production; falls back to
// the local dev server when unset.
export const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

const api = axios.create({
  baseURL: API_URL,
  withCredentials: true,
});

// Auth
export const getMe = () => api.get("/auth/me").then(r => r.data);
export const logout = () => api.post("/auth/logout").then(r => r.data);

// Users
export const getUsers = () => api.get("/users").then(r => r.data);
export const updateStatus = (data) => api.patch("/users/me/status", data).then(r => r.data);
export const getStatusHistory = (id, days = 28) =>
  api.get(`/users/${id}/status-history`, { params: { days } }).then(r => r.data);

// Dashboard
export const getDashboardSummary = () => api.get("/dashboard/summary").then(r => r.data);
export const getCalendarEvents = (start, end) =>
  api.get("/dashboard/calendar", { params: { start, end } }).then(r => r.data);

// Leaves
export const getMyLeaves = () => api.get("/leaves/me").then(r => r.data);
export const getTeamLeaves = () => api.get("/leaves").then(r => r.data);
export const getTeamAllLeaves = () => api.get("/leaves/team").then(r => r.data);
export const getManagerLeaves = () => api.get("/leaves/manager/me").then(r => r.data);
export const createLeave = (data) => api.post("/leaves", data).then(r => r.data);
export const approveLeave = (id) => api.patch(`/leaves/${id}/approve`).then(r => r.data);
export const rejectLeave = (id, reason) => api.patch(`/leaves/${id}/reject`, { reason }).then(r => r.data);
export const deleteLeave = (id) => api.delete(`/leaves/${id}`);
export const updateLeave = (id, data) => api.put(`/leaves/${id}`, data).then(r => r.data);
export const getLeaveBalances = () => api.get("/leaves/me/balances").then(r => r.data);
export const getUserBalances = (id) => api.get(`/leaves/${id}/balances`).then(r => r.data);
export const getUserLeaveSummary = (id, days = 28) =>
  api.get(`/leaves/${id}/summary`, { params: { days } }).then(r => r.data);
export const getMyHygiene = () => api.get("/leaves/me/hygiene").then(r => r.data);
export const getUserHygiene = (id) => api.get(`/leaves/${id}/hygiene`).then(r => r.data);
export const getHolidays = () => api.get("/leaves/holidays").then(r => r.data);
export const getLeaveLimits = () => api.get("/leaves/limits").then(r => r.data);
export const getLeaveRules = () => api.get("/leaves/rules").then(r => r.data);
export const updateLeaveRules = (data) => api.put("/admin/leaves/rules", data).then(r => r.data);

// Catchups
export const getMyCatchups = () => api.get("/catchups/me").then(r => r.data);
export const getManagerCatchups = () => api.get("/catchups/manager/me").then(r => r.data);
export const createCatchup = (data) => api.post("/catchups", data).then(r => r.data);
export const updateCatchup = (id, data) => api.patch(`/catchups/${id}`, data).then(r => r.data);
export const deleteCatchup = (id) => api.delete(`/catchups/${id}`);

// Admin
export const getAdminUsers = () => api.get("/admin/users").then(r => r.data);
export const adminUpdateUser = (id, data) => api.patch(`/admin/users/${id}`, data).then(r => r.data);
export const adminCreateUser = (data) => api.post("/admin/users", data).then(r => r.data);
export const adminDeleteUser = (id) => api.delete(`/admin/users/${id}`);
export const getUserOverview = (id) => api.get(`/admin/users/${id}/overview`).then(r => r.data);

export const adminCreateLeave = (userId, data) => api.post(`/admin/users/${userId}/leaves`, data).then(r => r.data);
export const adminUpdateLeave = (leaveId, data) => api.put(`/admin/leaves/${leaveId}`, data).then(r => r.data);
export const adminDeleteLeave = (leaveId) => api.delete(`/admin/leaves/${leaveId}`);

export const adminCreateCatchup = (userId, data) => api.post(`/admin/users/${userId}/catchups`, data).then(r => r.data);
export const adminUpdateCatchup = (id, data) => api.patch(`/admin/catchups/${id}`, data).then(r => r.data);
export const adminDeleteCatchup = (id) => api.delete(`/admin/catchups/${id}`);
export const updateLeaveLimits = (data) => api.put("/admin/leaves/limits", data).then(r => r.data);
export const addHoliday = (data) => api.post("/admin/leaves/holidays", data).then(r => r.data);
export const updateHoliday = (date, data) => api.put(`/admin/leaves/holidays/${date}`, data).then(r => r.data);
export const deleteHoliday = (date) => api.delete(`/admin/leaves/holidays/${date}`);

import axios from "axios";

const api = axios.create({
  baseURL: "http://localhost:8000",
  withCredentials: true,
});

// Auth
export const getMe = () => api.get("/auth/me").then(r => r.data);
export const logout = () => api.post("/auth/logout").then(r => r.data);

// Users
export const getUsers = () => api.get("/users").then(r => r.data);
export const updateStatus = (data) => api.patch("/users/me/status", data).then(r => r.data);

// Dashboard
export const getDashboardSummary = () => api.get("/dashboard/summary").then(r => r.data);

// Leaves
export const getMyLeaves = () => api.get("/leaves/me").then(r => r.data);
export const getTeamLeaves = () => api.get("/leaves").then(r => r.data);
export const getManagerLeaves = () => api.get("/leaves/manager/me").then(r => r.data);
export const createLeave = (data) => api.post("/leaves", data).then(r => r.data);
export const approveLeave = (id) => api.patch(`/leaves/${id}/approve`).then(r => r.data);
export const rejectLeave = (id, reason) => api.patch(`/leaves/${id}/reject`, { reason }).then(r => r.data);
export const deleteLeave = (id) => api.delete(`/leaves/${id}`);
export const getHolidays = () => api.get("/leaves/holidays").then(r => r.data);
export const getLeaveLimits = () => api.get("/leaves/limits").then(r => r.data);

// Catchups
export const getMyCatchups = () => api.get("/catchups/me").then(r => r.data);
export const getManagerCatchups = () => api.get("/catchups/manager/me").then(r => r.data);
export const createCatchup = (data) => api.post("/catchups", data).then(r => r.data);
export const updateCatchup = (id, data) => api.patch(`/catchups/${id}`, data).then(r => r.data);
export const deleteCatchup = (id) => api.delete(`/catchups/${id}`);

// Admin
export const getAdminUsers = () => api.get("/admin/users").then(r => r.data);
export const adminUpdateUser = (id, data) => api.patch(`/admin/users/${id}`, data).then(r => r.data);
export const updateLeaveLimits = (data) => api.put("/admin/leaves/limits", data).then(r => r.data);
export const addHoliday = (data) => api.post("/admin/leaves/holidays", data).then(r => r.data);
export const updateHoliday = (date, data) => api.put(`/admin/leaves/holidays/${date}`, data).then(r => r.data);
export const deleteHoliday = (date) => api.delete(`/admin/leaves/holidays/${date}`);

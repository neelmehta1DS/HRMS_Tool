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

// Leaves
export const getMyLeaves = () => api.get("/leaves/me").then(r => r.data);
export const getTeamLeaves = () => api.get("/leaves").then(r => r.data);
export const getManagerLeaves = () => api.get("/leaves/manager/me").then(r => r.data);
export const createLeave = (data) => api.post("/leaves", data).then(r => r.data);
export const approveLeave = (id) => api.patch(`/leaves/${id}/approve`).then(r => r.data);
export const rejectLeave = (id, reason) => api.patch(`/leaves/${id}/reject`, { reason }).then(r => r.data);
export const deleteLeave = (id) => api.delete(`/leaves/${id}`).then(r => r.data);
export const getMyBalance = () => api.get("/leaves/me/balance").then(r => r.data);
export const getHolidays = () => api.get("/leaves/holidays").then(r => r.data);
export const getLeaveLimits = () => api.get("/leaves/limits").then(r => r.data);

// Catchups
export const getMyCatchups = () => api.get("/catchups/me").then(r => r.data);
export const getManagerCatchups = () => api.get("/catchups/manager/me").then(r => r.data);
export const createCatchup = (data) => api.post("/catchups", data).then(r => r.data);
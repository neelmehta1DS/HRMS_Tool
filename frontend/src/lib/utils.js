export const LEAVE_TYPE_META = {
  earned:          { label: "Earned",            color: "#3b82f6", bg: "#dbeafe", text: "#1e3a8a" },
  sick_and_casual: { label: "Sick & Casual",     color: "#15803d", bg: "#dcfce7", text: "#14532d" },
  bereavement:     { label: "Bereavement",       color: "#8b5cf6", bg: "#ede9fe", text: "#4c1d95" },
  marriage:        { label: "Marriage",          color: "#ec4899", bg: "#fce7f3", text: "#831843" },
  maternity:       { label: "Maternity",         color: "#06b6d4", bg: "#cffafe", text: "#164e63" },
  paternity:       { label: "Paternity",         color: "#0ea5e9", bg: "#e0f2fe", text: "#0c4a6e" },
  lwp:             { label: "Leave Without Pay", color: "#64748b", bg: "#e2e8f0", text: "#334155" },
};

const AVATAR_PALETTE = [
  "#3B82F6", "#6366F1", "#8B5CF6", "#EC4899",
  "#F43F5E", "#F97316", "#EAB308", "#22C55E",
  "#14B8A6", "#06B6D4", "#0EA5E9", "#A855F7",
];

export function getInitials(name = "") {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((x) => x[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function avatarColor(name = "") {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) & 0xfffffff;
  }
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

export function getGreeting() {
  const h = new Date().getHours();
  if (h < 6) return "Good night";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 21) return "Good evening";
  return "Good night";
}

export function formatDate(s) {
  return new Date(s + "T00:00:00").toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

export function formatDateShort(s) {
  return new Date(s + "T00:00:00").toLocaleDateString("en-US", {
    month: "short", day: "numeric",
  });
}

export function formatDateLong(s) {
  return new Date(s + "T00:00:00").toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });
}

// Status timestamps arrive as naive IST, so parsing them as local is correct.
export function formatTimeOfDay(s) {
  return new Date(s).toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit",
  });
}

// Birthdays store a year that we never surface.
export function formatDayMonth(s) {
  return new Date(s + "T00:00:00").toLocaleDateString("en-GB", {
    day: "numeric", month: "short",
  });
}

export function formatDateTime(s) {
  return new Date(s).toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

export function getLeaveStatus(leave) {
  if (leave.status === "rejected") return "rejected";
  if (leave.status === "approved") return "approved";
  const nextPending = leave.approvals?.find(a => a.status === "pending");
  if (nextPending?.step > 1) return "pending_l2";
  return "pending_l1";
}

export function isIC(user) { return user?.role_level === "ic"; }
export function isL1(user) { return user?.role_level === "l1_manager"; }
export function isL2(user) { return user?.role_level === "l2_lead"; }
export function isManager(user) { return isL1(user) || isL2(user); }

export function getDefaultETA() {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 15);
  return d.toTimeString().slice(0, 5);
}

export function countBusinessDays(startStr, endStr, holidays = []) {
  const holidaySet = new Set(holidays.map(h => h.date));
  let count = 0;
  let d = new Date(startStr + "T00:00:00");
  const end = new Date(endStr + "T00:00:00");
  while (d <= end) {
    const dow = d.getDay();
    const iso = d.toISOString().slice(0, 10);
    if (dow !== 0 && dow !== 6 && !holidaySet.has(iso)) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

export function countDays(startDate, endDate) {
  const start = new Date(startDate + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");
  return Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
}

// Local-safe. toISOString() converts to UTC first, which lands on the previous
// day for anyone west of Greenwich.
export function toISODate(d) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function eachDayISO(startISO, endISO) {
  const days = [];
  const d = new Date(startISO + "T00:00:00");
  const end = new Date(endISO + "T00:00:00");
  while (d <= end) {
    days.push(toISODate(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

export function getUserStatus(user, onLeaveIds = new Set()) {
  if (onLeaveIds.has(user.id)) return "leave";
  if (user.office_status === "WFH") return "wfh";
  if (user.office_status === "IN") return "office";
  return "out"; // null (status not set) or any legacy value
}

export function statusBadgeProps(status) {
  switch (status) {
    case "office": return { variant: "green", label: "In Office" };
    case "wfh":    return { variant: "teal",  label: "WFH" };
    case "leave":  return { variant: "red",   label: "On Leave" };
    default:       return { variant: "slate", label: "Status Not Set" };
  }
}

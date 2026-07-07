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

export function getUserStatus(user, onLeaveIds = new Set()) {
  if (onLeaveIds.has(user.id)) return "leave";
  if (user.office_status === "WFH") return "wfh";
  if (user.office_status === "IN") return "office";
  return "out"; // null (status not set) or any legacy value
}

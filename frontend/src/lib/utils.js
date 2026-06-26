const AVATAR_PALETTE = [
  "bg-blue-500",
  "bg-indigo-500",
  "bg-violet-500",
  "bg-rose-500",
  "bg-pink-500",
  "bg-orange-500",
  "bg-amber-600",
  "bg-emerald-600",
  "bg-teal-600",
  "bg-sky-500",
  "bg-purple-500",
  "bg-cyan-600",
];

export function getInitials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((x) => x[0])
    .join("")
    .toUpperCase();
}

export function avatarBg(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) & 0xfffffff;
  }
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
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

export function getLeaveStatus(leave) {
  if (leave.approved_by_l1 === false || leave.approved_by_l2 === false) return "rejected";
  if (leave.approved_by_l1 === true && leave.approved_by_l2 === true) return "approved";
  if (leave.approved_by_l1 === true && leave.approved_by_l2 === null) return "pending_l2";
  return "pending_l1";
}

export function isIC(user) { return user.role_level === "ic"; }
export function isL1(user) { return user.role_level === "l1_manager"; }
export function isL2(user) { return user.role_level === "l2_lead"; }
export function isManager(user) { return isL1(user) || isL2(user); }

export function getDefaultETA() {
  const d = new Date();
  d.setMinutes(d.getMinutes() + 15);
  return d.toTimeString().slice(0, 5);
}

export function countDays(startDate, endDate) {
  const start = new Date(startDate + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");
  return Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
}
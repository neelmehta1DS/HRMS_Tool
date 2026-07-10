export const ROLE_COLORS = {
  l2_lead: "#3b82f6",
  l1_manager: "#8b5cf6",
  ic: "#64748b",
};

export const ROLE_LABELS = {
  l2_lead: "L2 Lead",
  l1_manager: "Manager",
  ic: "IC",
};

export function roleColor(level) {
  return ROLE_COLORS[level] ?? "#64748b";
}

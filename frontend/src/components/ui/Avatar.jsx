import { getInitials, avatarColor } from "../../lib/utils";

const SIZES = {
  xs: { wh: "w-6 h-6", text: "text-[10px]" },
  sm: { wh: "w-7 h-7", text: "text-[11px]" },
  md: { wh: "w-9 h-9", text: "text-[13px]" },
  lg: { wh: "w-11 h-11", text: "text-[15px]" },
  xl: { wh: "w-14 h-14", text: "text-[18px]" },
};

export default function Avatar({ name = "", size = "md" }) {
  const { wh, text } = SIZES[size] ?? SIZES.md;
  return (
    <div
      className={`${wh} ${text} rounded-full flex items-center justify-center text-white font-semibold shrink-0`}
      style={{ background: avatarColor(name) }}
    >
      {getInitials(name)}
    </div>
  );
}

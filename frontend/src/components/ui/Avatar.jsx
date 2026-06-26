import { getInitials, avatarBg } from "../../lib/utils";

const sizes = {
  sm: "w-7 h-7 text-[10px]",
  md: "w-9 h-9 text-xs",
  lg: "w-10 h-10 text-sm",
};

export default function Avatar({ name, size = "md" }) {
  return (
    <div className={`${sizes[size]} ${avatarBg(name)} rounded-full flex items-center justify-center text-white font-bold flex-shrink-0`}>
      {getInitials(name)}
    </div>
  );
}
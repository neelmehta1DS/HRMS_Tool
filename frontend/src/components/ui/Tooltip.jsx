import { useId, useState } from "react";

const variants = {
  default: "bg-slate-800 text-white",
  danger:  "bg-red-600 text-white",
};

const sides = {
  top:    "bottom-full left-1/2 -translate-x-1/2 mb-2",
  bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
};

/**
 * Shows `content` on hover or focus. Safe to wrap a disabled button: a disabled
 * control receives no pointer events, so the hover is handled by this wrapper
 * and the child is opted out with pointer-events-none.
 *
 * A disabled button is not keyboard-focusable, so the focus path only applies
 * when the child is enabled. That is intentional — an enabled control needs no
 * explanation, but it keeps the tooltip reachable for non-button children.
 */
export default function Tooltip({ content, variant = "default", side = "top", children }) {
  const [open, setOpen] = useState(false);
  const id = useId();

  if (!content) return children;

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <span
        aria-describedby={open ? id : undefined}
        className="inline-flex [&>button:disabled]:pointer-events-none"
      >
        {children}
      </span>

      {open && (
        <span
          role="tooltip"
          id={id}
          className={`absolute z-50 ${sides[side] ?? sides.top} w-max max-w-[280px] rounded-lg px-3 py-2
            text-[13px] leading-snug font-medium shadow-lg pointer-events-none
            ${variants[variant] ?? variants.default}`}
        >
          {content}
        </span>
      )}
    </span>
  );
}

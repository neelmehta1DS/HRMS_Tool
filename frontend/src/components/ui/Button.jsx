const base =
  "inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed";

const variants = {
  primary:   "bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500",
  secondary: "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 focus:ring-slate-300",
  ghost:     "text-slate-600 hover:bg-slate-100 focus:ring-slate-200",
  danger:    "bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 focus:ring-red-300",
};

const sizes = {
  sm: "px-3 py-1.5 text-[12px]",
  md: "px-4 py-2 text-[13px]",
  lg: "px-5 py-2.5 text-[14px]",
  xl: "px-6 py-3 text-[15px]",
};

export default function Button({ children, variant = "primary", size = "md", className = "", ...props }) {
  return (
    <button className={`${base} ${variants[variant] ?? variants.primary} ${sizes[size] ?? sizes.md} ${className}`} {...props}>
      {children}
    </button>
  );
}

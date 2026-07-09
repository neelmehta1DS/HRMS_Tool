const variants = {
  blue:   "bg-blue-100 text-blue-900 ring-1 ring-blue-200",
  green:  "bg-emerald-100 text-emerald-900 ring-1 ring-emerald-200",
  yellow: "bg-amber-100 text-amber-900 ring-1 ring-amber-200",
  red:    "bg-red-100 text-red-900 ring-1 ring-red-200",
  violet: "bg-violet-100 text-violet-900 ring-1 ring-violet-200",
  teal:   "bg-teal-100 text-teal-900 ring-1 ring-teal-200",
  slate:  "bg-slate-200 text-slate-800 ring-1 ring-slate-300",
  orange: "bg-orange-100 text-orange-900 ring-1 ring-orange-200",
};

export default function Badge({ children, variant = "slate", className = "" }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[12px] font-medium ${variants[variant] ?? variants.slate} ${className}`}>
      {children}
    </span>
  );
}

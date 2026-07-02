const variants = {
  blue:   "bg-blue-50 text-blue-700 ring-1 ring-blue-100",
  green:  "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100",
  yellow: "bg-amber-50 text-amber-700 ring-1 ring-amber-100",
  red:    "bg-red-50 text-red-700 ring-1 ring-red-100",
  violet: "bg-violet-50 text-violet-700 ring-1 ring-violet-100",
  teal:   "bg-teal-50 text-teal-700 ring-1 ring-teal-100",
  slate:  "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
  orange: "bg-orange-50 text-orange-700 ring-1 ring-orange-100",
};

export default function Badge({ children, variant = "slate", className = "" }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${variants[variant] ?? variants.slate} ${className}`}>
      {children}
    </span>
  );
}

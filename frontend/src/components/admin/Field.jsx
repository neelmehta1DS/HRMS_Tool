const inputClass =
  "w-full text-[14.5px] bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 " +
  "placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500";

export function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="block text-[12px] font-semibold text-slate-500 mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-[12px] text-slate-400 mt-1">{hint}</span>}
    </label>
  );
}

export function TextInput(props) {
  return <input {...props} className={inputClass} />;
}

export function Select({ children, ...props }) {
  return <select {...props} className={inputClass}>{children}</select>;
}

/**
 * Pill chips with an optional count.
 *
 * `tabs` switches on tablist semantics. Leave it off for filters that narrow one
 * list, turn it on when each chip swaps the panel beneath it — a screen reader
 * should hear "tab" only when the chips actually behave like tabs.
 */
export default function FilterChips({ options, active, onChange, tabs = false, label }) {
  return (
    <div
      className="flex gap-2 flex-wrap"
      {...(tabs ? { role: "tablist", "aria-label": label } : {})}
    >
      {options.map(({ id, label: optionLabel, count }) => {
        const isActive = active === id;
        return (
          <button
            key={id}
            onClick={() => onChange(id)}
            {...(tabs ? { role: "tab", "aria-selected": isActive } : {})}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[13.5px] font-medium transition-all
              focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500
              ${isActive
                ? "bg-slate-900 text-white"
                : "bg-white border border-slate-200 text-slate-600 hover:border-slate-300"}`}
          >
            {optionLabel}
            {count != null && (
              <span className={`text-[11.5px] font-semibold px-1.5 rounded-full ${
                isActive ? "bg-white/20 text-white" : "bg-slate-100 text-slate-500"
              }`}>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

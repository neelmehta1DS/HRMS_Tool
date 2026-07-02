import { useState, useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";

export const TIME_OPTIONS = (() => {
  const opts = [];
  for (let h = 10; h <= 19; h++) {
    for (let m = 0; m < 60; m += 15) {
      if (h === 19 && m > 0) break;
      const h0 = String(h).padStart(2, "0");
      const m0 = String(m).padStart(2, "0");
      const isPM = h >= 12;
      const h12 = h === 12 ? 12 : h > 12 ? h - 12 : h;
      opts.push({ value: `${h0}:${m0}`, label: `${h12}:${m0} ${isPM ? "PM" : "AM"}` });
    }
  }
  return opts;
})();

export function snapTime(raw, fallback) {
  if (!raw) return fallback;
  return TIME_OPTIONS.find(o => o.value === raw)?.value ?? fallback;
}

export default function TimePicker({ value, onChange, disabled, className = "" }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const listRef = useRef(null);

  const selected = TIME_OPTIONS.find(o => o.value === value);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e) {
      if (!containerRef.current?.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  // Scroll selected option into view when opening
  useEffect(() => {
    if (!open || !listRef.current) return;
    const active = listRef.current.querySelector("[data-selected='true']");
    if (active) active.scrollIntoView({ block: "center" });
  }, [open]);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(v => !v)}
        className={`
          flex items-center justify-between w-full
          bg-white border rounded-lg px-3 py-2
          text-[13px] font-medium text-slate-700
          hover:border-slate-300 transition-colors
          focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500
          disabled:opacity-50 disabled:cursor-not-allowed
          ${open ? "border-blue-500 ring-2 ring-blue-500" : "border-slate-200"}
        `}
      >
        <span>{selected?.label ?? "Select time"}</span>
        <ChevronDown
          size={14}
          strokeWidth={2}
          className={`text-slate-400 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute z-50 mt-1.5 w-full bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
          <div ref={listRef} className="max-h-52 overflow-y-auto py-1 scrollbar-thin">
            {TIME_OPTIONS.map(({ value: v, label }) => {
              const isSelected = v === value;
              return (
                <button
                  key={v}
                  type="button"
                  data-selected={isSelected}
                  onClick={() => { onChange(v); setOpen(false); }}
                  className={`
                    w-full text-left px-3 py-2 text-[13px] transition-colors
                    ${isSelected
                      ? "bg-blue-50 text-blue-700 font-semibold"
                      : "text-slate-700 hover:bg-slate-50"
                    }
                  `}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { Info } from "lucide-react";

// Band → colour treatment. Names mirror the backend's BANDS in core/leave_hygiene.py.
const BAND_STYLES = {
  Excellent:         { badge: "text-emerald-700 bg-emerald-50 border-emerald-200", bar: "#059669" },
  Good:              { badge: "text-blue-700 bg-blue-50 border-blue-200",          bar: "#2563eb" },
  Fair:              { badge: "text-amber-700 bg-amber-50 border-amber-200",       bar: "#d97706" },
  "Needs attention": { badge: "text-red-700 bg-red-50 border-red-200",            bar: "#dc2626" },
};

export function bandStyle(band) {
  return BAND_STYLES[band] ?? BAND_STYLES.Fair;
}

/** Hover/click popover explaining how the score is calculated. */
export function HygieneInfoButton({ align = "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button type="button" aria-label="How planning hygiene is calculated"
        onClick={() => setOpen((v) => !v)}
        className="text-slate-300 hover:text-slate-500 transition-colors">
        <Info size={16} />
      </button>
      {open && (
        <div className={`absolute top-full mt-2 z-50 w-72 bg-white border border-slate-200 rounded-xl shadow-xl p-4 text-left cursor-default
          ${align === "right" ? "right-0" : "left-0"}`}
          onClick={(e) => e.stopPropagation()}>
          <p className="text-[12px] font-bold text-slate-500 uppercase tracking-wider mb-2">How this is calculated</p>
          <p className="text-[13px] text-slate-600 leading-relaxed mb-2.5">
            Starts at <b>100</b> and drops over the last 12 months for two things:
          </p>
          <ul className="text-[13px] text-slate-600 leading-relaxed mb-2.5 space-y-1.5">
            <li>• <b>Exceptions</b> — leaves that bypass the normal notice rules.</li>
            <li>• <b>HoP-logged absences</b> — days your Head of Product had to record for you.</li>
          </ul>
          <p className="text-[13px] text-slate-600 leading-relaxed mb-2.5">
            Recent events count for more; they fade to half weight after 6 months and drop off entirely after a year.
          </p>
          <div className="text-[12px] text-slate-500 border-t border-slate-100 pt-2.5 leading-relaxed">
            <b className="text-emerald-700">90+</b> Excellent · <b className="text-blue-700">75–89</b> Good ·{" "}
            <b className="text-amber-700">55–74</b> Fair · <b className="text-red-700">&lt;55</b> Needs attention
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The large card shown next to the leave-balance cards on the Leaves page.
 * Renders nothing when `hygiene` is null (L2 leads have no score).
 */
export function PlanningHygieneCard({ hygiene }) {
  if (!hygiene) return null;
  const { badge } = bandStyle(hygiene.band);

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Planning Hygiene</p>
        <HygieneInfoButton />
      </div>
      <div className="flex items-end gap-2.5 mb-3">
        <span className="text-[32px] font-bold leading-none text-slate-900">{hygiene.score}</span>
        <span className="text-[14px] text-slate-400 mb-0.5">/ 100</span>
        <span className={`ml-1 mb-0.5 text-[12px] font-bold px-2.5 py-1 rounded-full border ${badge}`}>
          {hygiene.band}
        </span>
      </div>
      <p className="text-[13px] text-slate-500 leading-snug">{hygiene.driver}</p>
    </div>
  );
}

/**
 * The compact block shown inside the leave side drawer, matching the balance
 * block's styling. Renders nothing when `hygiene` is null.
 */
export function HygieneDetailBlock({ hygiene }) {
  if (!hygiene) return null;
  const { badge } = bandStyle(hygiene.band);
  const exceptionCount =
    (hygiene.hop_absences || 0) + (hygiene.exceptions || 0);

  return (
    <div className="bg-slate-50 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2.5">
        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Planning Hygiene</p>
        <HygieneInfoButton />
      </div>
      <div className="flex items-end gap-2.5 mb-1.5">
        <span className="text-[28px] font-bold leading-none text-slate-900">{hygiene.score}</span>
        <span className="text-[13.5px] text-slate-400 mb-0.5">/ 100</span>
        <span className={`ml-1 mb-0.5 text-[11.5px] font-bold px-2.5 py-1 rounded-full border ${badge}`}>
          {hygiene.band}
        </span>
      </div>
      <p className="text-[13px] text-slate-500 leading-snug">
        {exceptionCount === 0
          ? "All leaves planned and filed on time"
          : hygiene.driver}
      </p>
    </div>
  );
}

import { Fragment, useMemo } from "react";
import Tooltip from "../ui/Tooltip";
import { formatTimeOfDay, toISODate } from "../../lib/utils";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// A day is one of these. Weekends and days that have not happened yet are not
// absences, so they are neither counted nor coloured.
const KINDS = {
  office:  { label: "In office",  swatch: "bg-emerald-500", dot: "bg-emerald-500" },
  wfh:     { label: "WFH",        swatch: "bg-blue-500",    dot: "bg-blue-500" },
  leave:   { label: "Leave",      swatch: "bg-amber-400",   dot: "bg-amber-400" },
  holiday: { label: "Holiday",    swatch: "bg-violet-400",  dot: "bg-violet-400" },
  none:    { label: "No status",  swatch: "bg-slate-100 ring-1 ring-inset ring-slate-200", dot: "bg-slate-300" },
};
const COUNTED = ["office", "wfh", "leave", "holiday", "none"];

function mondayOf(d) {
  const monday = new Date(d);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7)); // Sunday is 0
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function statusToKind(status) {
  if (status === "IN") return "office";
  if (status === "WFH") return "wfh";
  return "none";
}

/** Whole weeks ending with the current one, oldest first. */
function buildDays(statusDays, leaveDates, holidaysByDate, weeks) {
  const byDate = new Map(statusDays.map((d) => [d.business_date, d]));
  const onLeave = new Set(leaveDates);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = mondayOf(today);
  start.setDate(start.getDate() - 7 * (weeks - 1));

  return Array.from({ length: weeks * 7 }, (_, i) => {
    const date = new Date(start);
    date.setDate(date.getDate() + i);

    const iso = toISODate(date);
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
    const entry = byDate.get(iso);
    const holiday = holidaysByDate.get(iso);

    // Non-working days win over anything the person reported: a status set on a
    // holiday says less about the day than the holiday does.
    let kind;
    if (date > today) kind = "future";
    else if (isWeekend) kind = "weekend";
    else if (holiday) kind = "holiday";
    else if (onLeave.has(iso)) kind = "leave";
    else kind = statusToKind(entry?.final_status);

    return {
      date, iso, kind, holiday,
      isToday: iso === toISODate(today),
      clockedInAt: entry?.clocked_in_at,
    };
  });
}

function chunkIntoWeeks(days) {
  return Array.from({ length: days.length / 7 }, (_, i) => days.slice(i * 7, i * 7 + 7));
}

/** A week belongs to the month its Monday falls in. */
function monthOf(week) {
  const monday = week[0].date;
  return `${monday.getFullYear()}-${monday.getMonth()}`;
}

function monthLabel(week) {
  const monday = week[0].date;
  const month = monday.toLocaleDateString("en-GB", { month: "short" });
  const thisYear = new Date().getFullYear();
  return monday.getFullYear() === thisYear ? month : `${month} ’${String(monday.getFullYear()).slice(2)}`;
}

function tooltipFor({ date, kind, holiday, clockedInAt }) {
  const day = date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  if (kind === "holiday") return `${day} · ${holiday}`;
  if (kind === "leave") return `${day} · On leave`;
  if (kind === "none") return `${day} · No status set`;
  const when = clockedInAt ? ` · clocked in ${formatTimeOfDay(clockedInAt)}` : "";
  return `${day} · ${KINDS[kind].label}${when}`;
}

function LegendChip({ kind, count }) {
  const { label, dot } = KINDS[kind];
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 pl-2.5 pr-3 py-1.5">
      <span className={`w-2.5 h-2.5 rounded-full ${dot}`} />
      <span className="text-[13px] text-slate-600">{label}</span>
      <span className="text-[13px] font-semibold text-slate-900">{count}</span>
    </span>
  );
}

function DaySquare({ day }) {
  if (day.kind === "future") return <span className="w-10 h-10" />;

  if (day.kind === "weekend") {
    return <span className="w-10 h-10 rounded-lg bg-slate-50" aria-hidden="true" />;
  }

  const ring = day.isToday ? "ring-2 ring-offset-2 ring-slate-900/20" : "";

  return (
    <Tooltip content={tooltipFor(day)}>
      <span
        tabIndex={0}
        role="img"
        aria-label={tooltipFor(day)}
        className={`w-10 h-10 rounded-lg transition-transform hover:scale-105
                    focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500
                    ${KINDS[day.kind].swatch} ${ring}`}
      />
    </Tooltip>
  );
}

export default function CheckInLog({ statusDays, leaveDates, holidays, weeks = 4 }) {
  const holidaysByDate = useMemo(
    () => new Map(holidays.map((h) => [h.date, h.name])),
    [holidays]
  );
  const days = useMemo(
    () => buildDays(statusDays, leaveDates, holidaysByDate, weeks),
    [statusDays, leaveDates, holidaysByDate, weeks]
  );
  const rows = useMemo(() => chunkIntoWeeks(days), [days]);

  const counts = useMemo(() => {
    const tally = Object.fromEntries(COUNTED.map((k) => [k, 0]));
    for (const d of days) if (d.kind in tally) tally[d.kind] += 1;
    return tally;
  }, [days]);

  // Averaged over weeks that have actually elapsed. A week made entirely of
  // future days contributes nothing, so the current week does not drag the
  // average down before it has been lived.
  const elapsedWeeks = rows.filter((week) => week.some((d) => d.kind in KINDS)).length;
  const wfhPerWeek = elapsedWeeks ? counts.wfh / elapsedWeeks : 0;

  return (
    <>
      <div className="flex flex-wrap gap-2 mb-6">
        {COUNTED.map((kind) => <LegendChip key={kind} kind={kind} count={counts[kind]} />)}
      </div>

      <div className="flex items-center gap-2 mb-2">
        <span className="w-10 shrink-0" />
        <div className="grid grid-cols-7 gap-2 justify-items-center">
          {WEEKDAYS.map((d) => (
            <span key={d} className="text-[11.5px] font-medium text-slate-400 w-10 text-center">{d}</span>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {rows.map((week, i) => {
          const startsMonth = i === 0 || monthOf(week) !== monthOf(rows[i - 1]);
          return (
            <Fragment key={week[0].iso}>
              {startsMonth && i > 0 && <div className="h-px bg-slate-200 !my-4" role="separator" />}
              <div className="flex items-center gap-2">
                <span className="w-10 shrink-0 pr-1 text-right text-[11.5px] font-semibold text-slate-400">
                  {startsMonth ? monthLabel(week) : ""}
                </span>
                <div className="grid grid-cols-7 gap-2 justify-items-center">
                  {week.map((day) => <DaySquare key={day.iso} day={day} />)}
                </div>
              </div>
            </Fragment>
          );
        })}
      </div>

      <p className="text-[12.5px] text-slate-400 mt-5">Hover a day for detail</p>

      {elapsedWeeks > 0 && (
        <p className="text-[13.5px] text-slate-600 mt-3 bg-slate-50 rounded-xl px-4 py-3">
          <span className="font-semibold text-slate-900">{wfhPerWeek.toFixed(1)}</span> WFH{" "}
          {wfhPerWeek === 1 ? "day" : "days"} per week on average, across {elapsedWeeks}{" "}
          {elapsedWeeks === 1 ? "week" : "weeks"}.
        </p>
      )}
    </>
  );
}

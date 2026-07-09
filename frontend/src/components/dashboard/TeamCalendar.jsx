import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Cake,
  Award,
  Video,
  Calendar,
  UserX,
  Filter,
  ExternalLink,
  FileText,
} from "lucide-react";
import Avatar from "../ui/Avatar";
import Spinner from "../ui/Spinner";
import { getCalendarEvents } from "../../lib/api";
import { LEAVE_TYPE_META, toISODate, eachDayISO, formatDate } from "../../lib/utils";

const DOWS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// One tint/ink pair per event type. Tints are Tailwind's 100 step pulled back
// to 75% chroma and darkened slightly: at full chroma a grid full of pills
// reads as candy. Ink is the 900 step, so every pair clears 7.5:1 (AAA).
//
// Muting costs hue separation, so it can't go further: at 75% chroma the
// tightest pair is holiday/leave at 9.9 dE, and by 50% catchup and anniversary
// collapse to 6.3 dE and become the same colour again.
//
// Anniversary is cyan rather than the teal its widget tile uses: teal and
// emerald are only 5.9 dE apart, so as adjacent filter chips catchup and
// anniversary read as the same green. With red, orange, emerald and violet
// spoken for, cyan is the last hue family that clears every other tint.
//
// Leaves deliberately share a single colour rather than using their per-type
// LEAVE_TYPE_META colour: seven hues are indistinguishable at this size, and
// two of them collide with the catchup and anniversary greens. The leave type
// is surfaced as a labelled chip in the day panel instead.
//
// Leave uses UserX — the same icon OnLeaveTodayWidget uses — because it is the
// one thing all seven leave types share: this person is not at work. Vacation
// imagery (a palm tree, a plane) would be plain wrong on bereavement or sick
// leave. Anniversary uses Award rather than a trophy or medal: nobody competed.
const EVENT_META = {
  holiday:     { tint: "#f0dbdb", ink: "#7f1d1d", icon: Calendar, label: "Holiday" },
  leave:       { tint: "#f3e5d3", ink: "#7c2d12", icon: UserX,    label: "Leave" },
  catchup:     { tint: "#d1efdf", ink: "#064e3b", icon: Video,    label: "Catchup" },
  birthday:    { tint: "#e4e1f1", ink: "#4c1d95", icon: Cake,     label: "Birthday" },
  anniversary: { tint: "#d0eff2", ink: "#164e63", icon: Award,    label: "Anniversary" },
};

// Stable chip order within a day. Leaves sit directly under holidays so their
// spans form uninterrupted horizontal bands across a week.
const TYPE_ORDER = { holiday: 0, leave: 1, catchup: 2, birthday: 3, anniversary: 4 };

const MAX_CHIPS = 2;

function monthKey(d) {
  return `${d.getFullYear()}-${d.getMonth()}`;
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** The ISO days an event occupies, clipped to the visible month. */
function daysOf(e, firstISO, lastISO) {
  if (e.type === "leave" && e.end_date !== e.start_date) {
    const from = e.start_date < firstISO ? firstISO : e.start_date;
    const to = e.end_date > lastISO ? lastISO : e.end_date;
    return eachDayISO(from, to);
  }
  return [e.start_date];
}

/** Bucket events onto every ISO day they occupy, clipped to the visible month. */
function bucketByDay(events, firstISO, lastISO) {
  const byDay = new Map();
  for (const e of events) {
    for (const iso of daysOf(e, firstISO, lastISO)) {
      if (!byDay.has(iso)) byDay.set(iso, []);
      byDay.get(iso).push(e);
    }
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type]);
  }
  return byDay;
}

/** Assign every event a lane that stays constant for the whole week row.
 *
 *  Without this, a leave sitting in the second lane jumps up to the first the
 *  moment a shorter leave above it ends, snapping the band in half. Lanes are
 *  repacked each week (rather than for the whole month) so a single long leave
 *  can't push every later event down a lane and out of view.
 *
 *  Returns Map<iso, sparse array indexed by lane>.
 */
function assignLanes(events, weeks, firstISO, lastISO) {
  const lanesByDay = new Map();
  const spans = new Map(events.map((e) => [e, daysOf(e, firstISO, lastISO)]));

  for (const week of weeks) {
    const inWeek = new Set(week);
    const weekEvents = events
      .filter((e) => spans.get(e).some((d) => inWeek.has(d)))
      .sort(
        (a, b) =>
          TYPE_ORDER[a.type] - TYPE_ORDER[b.type] ||
          a.start_date.localeCompare(b.start_date) ||
          spans.get(b).length - spans.get(a).length,
      );

    for (const e of weekEvents) {
      const days = spans.get(e).filter((d) => inWeek.has(d));
      let lane = 0;
      while (days.some((d) => (lanesByDay.get(d) ?? [])[lane])) lane++;
      for (const d of days) {
        if (!lanesByDay.has(d)) lanesByDay.set(d, []);
        lanesByDay.get(d)[lane] = e;
      }
    }
  }
  return lanesByDay;
}

/** Where this event sits within its visible run: controls rounding and labelling.
 *  A multi-day leave squares off its inner edges so consecutive days read as one
 *  continuous band, and re-labels at the start of each week row. */
function spanFlags(e, iso, dowIndex, firstISO, lastISO) {
  if (e.type !== "leave" || e.start_date === e.end_date) {
    return { isStart: true, isEnd: true, showLabel: true };
  }
  const from = e.start_date < firstISO ? firstISO : e.start_date;
  const to = e.end_date > lastISO ? lastISO : e.end_date;
  const isStart = iso === from;
  const isEnd = iso === to;
  return {
    isStart,
    isEnd,
    // Relabel on Mondays so a span crossing a week boundary stays identifiable.
    showLabel: isStart || dowIndex === 0,
  };
}

/** Doubles as the legend and the filter. Every type is on by default; clicking a
 *  chip hides that type, clicking again brings it back. */
function EventFilters({ counts, hidden, onToggle }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {/* Without this the chips read as a legend, and nobody discovers they click. */}
      <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-slate-400 mr-1 shrink-0">
        <Filter size={12} />
        Filter
      </span>
      {Object.entries(EVENT_META).map(([type, { tint, ink, icon: Icon, label }]) => {
        const off = hidden.has(type);
        const count = counts[type] ?? 0;
        return (
          <button
            key={type}
            onClick={() => onToggle(type)}
            aria-pressed={!off}
            title={off ? `Show ${label.toLowerCase()}s` : `Hide ${label.toLowerCase()}s`}
            className={`flex items-center gap-1 pl-1.5 pr-2 py-1 rounded-md border text-[11.5px] font-medium
              transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500
              ${off
                ? "bg-white border-slate-200 text-slate-400 hover:bg-slate-50"
                : "border-transparent hover:brightness-95"}
            `}
            style={off ? undefined : { background: tint, color: ink }}
          >
            <Icon size={11} strokeWidth={2.5} className={off ? "text-slate-300" : ""} />
            <span>{label}</span>
            <span
              className={`text-[10.5px] font-semibold tabular-nums
                ${off ? "text-slate-300" : "opacity-60"}`}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function LeaveTypeChip({ type }) {
  const meta = LEAVE_TYPE_META[type];
  if (!meta) return <span className="text-[12.5px] text-slate-400">{type}</span>;
  return (
    <span
      className="text-[12px] font-medium px-1.5 py-0.5 rounded"
      style={{ background: meta.bg, color: meta.text }}
    >
      {meta.label}
    </span>
  );
}

function Chip({ event, isStart, isEnd, showLabel }) {
  const { tint, ink, icon: Icon } = EVENT_META[event.type];
  const label = event.type === "holiday" ? event.title : event.user_name;

  // Squared inner edges let consecutive days of one leave read as a single band.
  // Only the capped ends are inset; continuation edges stay flush to the cell.
  const radius = `${isStart ? "4px" : "0"} ${isEnd ? "4px" : "0"} ${isEnd ? "4px" : "0"} ${isStart ? "4px" : "0"}`;

  return (
    <div
      title={label}
      className="h-[23px] flex items-center gap-1.5 min-w-0 px-2"
      style={{
        background: tint,
        color: ink,
        borderRadius: radius,
        marginLeft: isStart ? 5 : 0,
        marginRight: isEnd ? 5 : 0,
      }}
    >
      {showLabel && <Icon size={12} strokeWidth={2.5} className="shrink-0" />}
      {showLabel && <span className="text-[12.5px] font-medium leading-none truncate">{label}</span>}
    </div>
  );
}

function DayDetail({ iso, events, onClose }) {
  return (
    <div className="mt-5 pt-5 border-t border-slate-100">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-[15px] font-semibold text-slate-700">{formatDate(iso)}</h4>
        <button
          onClick={onClose}
          className="text-[13px] text-slate-400 hover:text-slate-600"
        >
          Close
        </button>
      </div>

      {events.length === 0 ? (
        <p className="text-[14px] text-slate-400">Nothing scheduled</p>
      ) : (
        <div className="space-y-3">
          {events.map((e, i) => {
            const { tint, ink, icon: Icon } = EVENT_META[e.type];
            return (
              <div key={`${e.type}-${e.catchup_id ?? e.user_id ?? e.title}-${i}`} className="flex items-start gap-3">
                {e.type === "holiday" ? (
                  <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ background: tint }}>
                    <Icon size={13} strokeWidth={2.5} style={{ color: ink }} />
                  </div>
                ) : (
                  <Avatar name={e.user_name} size="xs" />
                )}

                <div className="flex-1 min-w-0">
                  <p className="text-[14.5px] font-medium text-slate-700 truncate">
                    {e.type === "holiday" ? e.title : e.user_name}
                  </p>
                  {e.type === "leave" ? (
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <LeaveTypeChip type={e.leave_type} />
                      {e.start_date !== e.end_date && (
                        <span className="text-[12.5px] text-slate-400">
                          {formatDate(e.start_date)} → {formatDate(e.end_date)}
                        </span>
                      )}
                    </div>
                  ) : (
                    <p className="text-[12.5px] text-slate-400">
                      {e.type === "holiday" && "Company holiday"}
                      {e.type === "birthday" && "Birthday"}
                      {e.type === "anniversary" && `${e.years} year${e.years === 1 ? "" : "s"} at the company`}
                      {e.type === "catchup" && `Catchup · ${fmtTime(e.starts_at)}`}
                    </p>
                  )}
                </div>

                {e.type === "catchup" && (
                  <div className="flex items-center gap-2 shrink-0">
                    {e.meeting_link && (
                      <a href={e.meeting_link} target="_blank" rel="noreferrer"
                        className="flex items-center gap-1 text-[12.5px] text-blue-600 hover:text-blue-700">
                        <ExternalLink size={12} /> Meet
                      </a>
                    )}
                    {e.notes_doc_link && (
                      <a href={e.notes_doc_link} target="_blank" rel="noreferrer"
                        className="flex items-center gap-1 text-[12.5px] text-slate-500 hover:text-slate-700">
                        <FileText size={12} /> Notes
                      </a>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function TeamCalendar() {
  const today = useMemo(() => new Date(), []);
  const todayISO = toISODate(today);

  const [view, setView] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [hidden, setHidden] = useState(() => new Set());

  // Guards against a slow response for an earlier month landing after a fast
  // one for a later month (rapid ›› clicks).
  const latestRequest = useRef(null);

  const year = view.getFullYear();
  const month = view.getMonth();
  const firstISO = toISODate(new Date(year, month, 1));
  const lastISO = toISODate(new Date(year, month + 1, 0));

  useEffect(() => {
    const key = monthKey(view);
    latestRequest.current = key;
    setError(null);

    getCalendarEvents(firstISO, lastISO)
      .then((data) => {
        if (latestRequest.current !== key) return;
        setEvents(data.events);
        setLoading(false);
      })
      .catch(() => {
        if (latestRequest.current !== key) return;
        setError("Couldn't load calendar events.");
        setLoading(false);
      });
  }, [firstISO, lastISO, reloadKey]);

  // Selecting a day is meaningless once you've navigated away from its month.
  useEffect(() => setSelected(null), [firstISO]);

  // Counts label the chips, so they reflect the whole month regardless of what
  // is currently hidden — otherwise a hidden chip would always read 0.
  const counts = useMemo(() => {
    const c = {};
    for (const e of events) c[e.type] = (c[e.type] ?? 0) + 1;
    return c;
  }, [events]);

  // Filtering once, here, keeps the bands, the "+N more" count, the holiday cell
  // tint and the day panel consistent without each re-checking the filter.
  const shown = useMemo(() => events.filter((e) => !hidden.has(e.type)), [events, hidden]);

  const toggleType = (type) =>
    setHidden((prev) => {
      const next = new Set(prev);
      next.has(type) ? next.delete(type) : next.add(type);
      return next;
    });

  const byDay = useMemo(() => bucketByDay(shown, firstISO, lastISO), [shown, firstISO, lastISO]);

  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7; // Mon-first
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const trailingPad = (7 - ((firstDow + daysInMonth) % 7)) % 7;
  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth();

  // Week rows, Monday-first. Pad cells hold no events so they're left out.
  const weeks = useMemo(() => {
    const rows = [];
    let row = [];
    for (let d = 1; d <= daysInMonth; d++) {
      row.push(toISODate(new Date(year, month, d)));
      if ((new Date(year, month, d).getDay() + 6) % 7 === 6) {
        rows.push(row);
        row = [];
      }
    }
    if (row.length) rows.push(row);
    return rows;
  }, [year, month, daysInMonth]);

  const lanesByDay = useMemo(
    () => assignLanes(shown, weeks, firstISO, lastISO),
    [shown, weeks, firstISO, lastISO],
  );

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setView(new Date(year, month - 1, 1))}
            aria-label="Previous month"
            className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-50"
          >
            <ChevronLeft size={15} />
          </button>
          <button
            onClick={() => setView(new Date(year, month + 1, 1))}
            aria-label="Next month"
            className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-50"
          >
            <ChevronRight size={15} />
          </button>
          <span className="text-[16px] font-semibold text-slate-700 ml-1.5">
            {view.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
          </span>
          {!isCurrentMonth && (
            <button
              onClick={() => setView(new Date(today.getFullYear(), today.getMonth(), 1))}
              className="ml-2 text-[12.5px] font-medium text-blue-600 hover:text-blue-700"
            >
              Today
            </button>
          )}
          {loading && <Spinner className="ml-2" />}
        </div>
        <EventFilters counts={counts} hidden={hidden} onToggle={toggleType} />
      </div>

      {error ? (
        <div className="py-12 flex flex-col items-center gap-3">
          <p className="text-[14px] text-slate-400">{error}</p>
          <button
            onClick={() => setReloadKey((k) => k + 1)}
            className="text-[13px] font-medium text-blue-600 hover:text-blue-700"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          {/* Seven columns can't shrink below a readable pill, so scroll instead of crush. */}
          <div className="overflow-x-auto -mx-1 px-1">
            <div className="min-w-[680px]">
          <div className="grid grid-cols-7">
            {DOWS.map((d) => (
              <div key={d} className="text-center text-[11.5px] font-semibold text-slate-400 pb-2">
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-px bg-slate-200 border border-slate-200 rounded-lg overflow-hidden">
            {Array.from({ length: firstDow }).map((_, i) => (
              <div key={`pad-${i}`} className="bg-slate-50 min-h-[118px]" />
            ))}

            {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
              const iso = toISODate(new Date(year, month, day));
              const dayEvents = byDay.get(iso) ?? [];
              const isToday = iso === todayISO;
              const isSelected = iso === selected;
              const isHoliday = dayEvents.some((e) => e.type === "holiday");
              const dow = new Date(year, month, day).getDay();
              const dowIndex = (dow + 6) % 7; // 0 = Monday
              const isWeekend = dow === 0 || dow === 6;

              // Keep the lanes a band occupies, dropping trailing empties so a
              // cell never pads itself out with invisible spacers.
              const dayLanes = lanesByDay.get(iso) ?? [];
              let lastFilled = -1;
              for (let i = 0; i < MAX_CHIPS; i++) if (dayLanes[i]) lastFilled = i;
              const lanes = Array.from({ length: lastFilled + 1 }, (_, i) => dayLanes[i] ?? null);
              const overflow = dayEvents.length - lanes.filter(Boolean).length;

              return (
                <button
                  key={day}
                  onClick={() => setSelected(isSelected ? null : iso)}
                  aria-pressed={isSelected}
                  className={`min-h-[118px] py-1.5 text-left align-top flex flex-col gap-1 transition-colors
                    focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500
                    ${isHoliday ? "bg-red-50/40" : isWeekend ? "bg-slate-50/70" : "bg-white"}
                    ${isSelected ? "ring-2 ring-inset ring-blue-500" : "hover:bg-slate-50"}
                  `}
                >
                  <span
                    className={`text-[13.5px] w-[26px] h-[26px] ml-1.5 flex items-center justify-center rounded-full shrink-0
                      ${isToday ? "bg-[#2f6bff] text-white font-semibold" : "text-slate-500"}
                    `}
                  >
                    {day}
                  </span>

                  {/* Pills run edge to edge so a multi-day leave forms one band.
                      Empty lanes render as spacers to hold a band's vertical position. */}
                  <div className="flex flex-col gap-[3px] w-full min-w-0">
                    {lanes.map((e, laneIdx) =>
                      e ? (
                        <Chip
                          key={laneIdx}
                          event={e}
                          {...spanFlags(e, iso, dowIndex, firstISO, lastISO)}
                        />
                      ) : (
                        <div key={laneIdx} className="h-[23px]" aria-hidden />
                      ),
                    )}
                    {overflow > 0 && (
                      <span className="text-[12px] text-slate-400 font-medium pl-2 pt-px">+{overflow} more</span>
                    )}
                  </div>
                </button>
              );
            })}

            {Array.from({ length: trailingPad }).map((_, i) => (
              <div key={`tpad-${i}`} className="bg-slate-50 min-h-[118px]" />
            ))}
          </div>
            </div>
          </div>

          {selected && (
            <DayDetail iso={selected} events={byDay.get(selected) ?? []} onClose={() => setSelected(null)} />
          )}
        </>
      )}
    </div>
  );
}

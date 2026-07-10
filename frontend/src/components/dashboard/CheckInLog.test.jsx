import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CheckInLog from "./CheckInLog";
import { toISODate } from "../../lib/utils";

// A Wednesday, so the current week is partly in the future.
const TODAY = new Date(2026, 6, 8);

const iso = (offsetDays) => {
  const d = new Date(TODAY);
  d.setDate(d.getDate() - offsetDays);
  return toISODate(d);
};

const day = (offsetDays, final_status, clocked_in_at = `${iso(offsetDays)}T09:12:00`) => ({
  business_date: iso(offsetDays),
  final_status,
  clocked_in_at,
  events: [],
});

function renderLog({ statusDays = [], leaveDates = [], holidays = [], weeks } = {}) {
  return render(
    <CheckInLog statusDays={statusDays} leaveDates={leaveDates} holidays={holidays} weeks={weeks} />
  );
}

const countFor = (label) =>
  Number(screen.getByText(label).parentElement.querySelector("span:last-child").textContent);

beforeEach(() => {
  // shouldAdvanceTime keeps userEvent's internal waits from deadlocking.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(TODAY);
});
afterEach(() => vi.useRealTimers());

describe("CheckInLog", () => {
  it("renders a square for every past weekday in the window", () => {
    renderLog();
    // 4 weeks × 5 weekdays = 20, minus Thu and Fri of the current week (future).
    expect(screen.getAllByRole("img")).toHaveLength(18);
  });

  it("does not render future days", () => {
    renderLog();
    const tomorrow = new Date(TODAY);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const label = tomorrow.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
    expect(screen.queryByLabelText(new RegExp(label))).not.toBeInTheDocument();
  });

  it("counts an IN day as in office and a WFH day as WFH", () => {
    renderLog({ statusDays: [day(1, "IN"), day(2, "WFH")] });
    expect(countFor("In office")).toBe(1);
    expect(countFor("WFH")).toBe(1);
  });

  it("counts a past weekday with no entry as no status", () => {
    renderLog();
    expect(countFor("No status")).toBe(18);
  });

  it("counts a leave day and never double-counts it as no status", () => {
    renderLog({ leaveDates: [iso(1)] });
    expect(countFor("Leave")).toBe(1);
    expect(countFor("No status")).toBe(17);
  });

  it("lets leave win over a status set on the same day", () => {
    renderLog({ statusDays: [day(1, "IN")], leaveDates: [iso(1)] });
    expect(countFor("Leave")).toBe(1);
    expect(countFor("In office")).toBe(0);
  });

  it("never counts weekends", () => {
    const saturday = toISODate(new Date(2026, 6, 4));
    renderLog({ leaveDates: [saturday] });
    // The Saturday is inside the window but is not a working day.
    expect(countFor("Leave")).toBe(0);
  });

  it("surfaces the clock-in time on hover", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderLog({ statusDays: [day(1, "IN", `${iso(1)}T08:31:00`)] });

    await user.hover(screen.getByLabelText(/In office/));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("clocked in 8:31 AM");
  });

  it("says no status set rather than showing a phantom clock-in", () => {
    renderLog();
    expect(screen.getAllByLabelText(/No status set/).length).toBeGreaterThan(0);
  });

});

describe("CheckInLog holidays", () => {
  const holiday = (offsetDays, name) => ({ date: iso(offsetDays), name });

  it("counts a company holiday and not as no status", () => {
    renderLog({ holidays: [holiday(1, "Diwali")] });
    expect(countFor("Holiday")).toBe(1);
    expect(countFor("No status")).toBe(17);
  });

  it("names the holiday on hover", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderLog({ holidays: [holiday(1, "Diwali")] });

    await user.hover(screen.getByLabelText(/Diwali/));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Diwali");
  });

  it("lets a holiday win over a status set that day", () => {
    renderLog({ statusDays: [day(1, "IN")], holidays: [holiday(1, "Diwali")] });
    expect(countFor("Holiday")).toBe(1);
    expect(countFor("In office")).toBe(0);
  });

  it("lets a holiday win over a leave spanning it", () => {
    renderLog({ leaveDates: [iso(1)], holidays: [holiday(1, "Diwali")] });
    expect(countFor("Holiday")).toBe(1);
    expect(countFor("Leave")).toBe(0);
  });

  it("ignores a holiday that falls on a weekend", () => {
    const saturday = toISODate(new Date(2026, 6, 4));
    renderLog({ holidays: [{ date: saturday, name: "Republic Day" }] });
    expect(countFor("Holiday")).toBe(0);
  });

  it("ignores holidays outside the window", () => {
    renderLog({ holidays: [holiday(90, "Old Holiday")] });
    expect(countFor("Holiday")).toBe(0);
  });
});

describe("CheckInLog months and averages", () => {
  it("labels the first week of each month", () => {
    // TODAY is Wed 8 Jul 2026. Four weeks back reaches mid-June.
    renderLog();
    expect(screen.getByText("Jun")).toBeInTheDocument();
    expect(screen.getByText("Jul")).toBeInTheDocument();
  });

  it("labels each month exactly once", () => {
    renderLog({ weeks: 13 });
    expect(screen.getAllByText("Jul")).toHaveLength(1);
    expect(screen.getAllByText("Jun")).toHaveLength(1);
  });

  it("rules a line between months, not between weeks", () => {
    // 13 weeks spans Apr, May, Jun, Jul — three boundaries, and none before the first.
    renderLog({ weeks: 13 });
    expect(screen.getAllByRole("separator")).toHaveLength(3);
  });

  it("draws no separator when the window sits inside one month", () => {
    renderLog({ weeks: 1 });
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
  });

  it("reports the average WFH days per week", () => {
    // Two WFH days across the four weeks that have data.
    renderLog({ statusDays: [day(1, "WFH"), day(2, "WFH")] });
    expect(screen.getByText("0.5")).toBeInTheDocument();
    expect(screen.getByText(/WFH days per week on average, across 4 weeks/)).toBeInTheDocument();
  });

  it("averages over every elapsed week, including ones with no status set", () => {
    // All 13 weeks are in the past, so all 13 count — a week where nobody set a
    // status is still a week in which they worked from home zero times.
    renderLog({ weeks: 13, statusDays: [day(1, "WFH")] });
    expect(screen.getByText("0.1")).toBeInTheDocument();
    expect(screen.getByText(/across 13 weeks/)).toBeInTheDocument();
  });

  it("says day, not days, when the average is exactly one", () => {
    renderLog({ weeks: 1, statusDays: [day(1, "WFH")] });
    expect(screen.getByText(/WFH day per week on average, across 1 week\./)).toBeInTheDocument();
  });
});

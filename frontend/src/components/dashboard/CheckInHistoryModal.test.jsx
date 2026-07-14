import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toISODate } from "../../lib/utils";
import CheckInHistoryModal from "./CheckInHistoryModal";

vi.mock("../../lib/api", () => ({
  getStatusHistory: vi.fn(),
  getUserLeaveSummary: vi.fn(),
}));

import { getStatusHistory, getUserLeaveSummary } from "../../lib/api";

// A Wednesday.
const TODAY = new Date(2026, 6, 8);
const iso = (offset) => {
  const d = new Date(TODAY);
  d.setDate(d.getDate() - offset);
  return toISODate(d);
};
const day = (offset, final_status) => ({
  business_date: iso(offset),
  final_status,
  clocked_in_at: `${iso(offset)}T09:12:00`,
  events: [],
});

const MEMBER = { id: 5, name: "Siya Jain" };

// Jul 1,2,3,6,7 in office; Jul 8 (today) WFH. Weekends 4,5 skipped.
const STATUS = [day(0, "WFH"), day(1, "IN"), day(2, "IN"), day(5, "IN"), day(6, "IN"), day(7, "IN")];

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(TODAY);
  getStatusHistory.mockResolvedValue(STATUS);
  getUserLeaveSummary.mockResolvedValue({ leave_dates: [] });
});
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

const open = () =>
  render(<CheckInHistoryModal open member={MEMBER} holidays={[]} onClose={vi.fn()} />);

describe("CheckInHistoryModal", () => {
  it("tallies in-office and WFH days for the default (last month) range", async () => {
    open();
    // Stat card: the count sits next to its label.
    const officeCard = (await screen.findByText("In office")).closest("div").parentElement;
    expect(officeCard).toHaveTextContent("5");
    const wfhCard = screen.getByText("WFH").closest("div").parentElement;
    expect(wfhCard).toHaveTextContent("1");
  });

  it("switches to the list view and shows a dated row per working day", async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("tab", { name: "List" }));

    expect(await screen.findByText("08 Jul 2026")).toBeInTheDocument();
    expect(screen.getByText("01 Jul 2026")).toBeInTheDocument();
    // Weekend days never appear in the list.
    expect(screen.queryByText("04 Jul 2026")).not.toBeInTheDocument();
  });

  it("fetches history when opened for the member", async () => {
    open();
    await waitFor(() => expect(getStatusHistory).toHaveBeenCalledWith(5, 90));
    expect(getUserLeaveSummary).toHaveBeenCalledWith(5, 90);
  });
});

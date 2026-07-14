import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserContext } from "../../contexts/UserContext";
import ProfileSidebar from "./ProfileSidebar";

vi.mock("../../lib/api", () => ({
  getUserBalances: vi.fn(),
  getStatusHistory: vi.fn(),
  getUserLeaveSummary: vi.fn(),
  getHolidays: vi.fn(),
  getLeaveRules: vi.fn(),
  createLeave: vi.fn(),
  adminCreateLeave: vi.fn(),
}));

import {
  getUserBalances, getStatusHistory, getUserLeaveSummary,
  getHolidays, getLeaveRules, adminCreateLeave,
} from "../../lib/api";

const MEMBER = {
  id: 5, name: "Priya Sharma", role: "Engineer",
  manager: { name: "Arjun Desai" }, joining_date: "2022-06-01",
  birthday: null, email: "priya@x.ai", office_status: "IN",
};

const BALANCES = {
  earned: { taken: 2, limit: 18, remaining: 16 },
  sick_and_casual: { taken: 0, limit: 12, remaining: 12 },
  bereavement: { taken: 0, limit: 3, remaining: 3 },
  marriage: { taken: 0, limit: 10, remaining: 10 },
  maternity: { taken: 0, limit: 130, remaining: 130 },
  paternity: { taken: 0, limit: 14, remaining: 14 },
};

beforeEach(() => {
  vi.clearAllMocks();
  getUserBalances.mockResolvedValue(BALANCES);
  getStatusHistory.mockResolvedValue([]);
  getUserLeaveSummary.mockResolvedValue({ upcoming: [], leave_dates: [] });
  getHolidays.mockResolvedValue([]);
  getLeaveRules.mockResolvedValue({ earned_advance_notice: [], casual_advance_notice: [] });
  adminCreateLeave.mockResolvedValue({ id: 1 });
});

const renderSidebar = (isAdmin) =>
  render(
    <UserContext.Provider value={{ user: { id: 1, is_admin: isAdmin } }}>
      <ProfileSidebar member={MEMBER} onLeaveIds={new Set()} onClose={vi.fn()} />
    </UserContext.Provider>
  );

describe("ProfileSidebar add-leave button", () => {
  it("does not show the button to non-admins", async () => {
    renderSidebar(false);
    await screen.findByText("priya@x.ai"); // sidebar has rendered
    expect(screen.queryByRole("button", { name: /Add leave/i })).not.toBeInTheDocument();
  });

  it("lets an admin log a leave for the member through the shared modal", async () => {
    const user = userEvent.setup();
    renderSidebar(true);

    await user.click(await screen.findByRole("button", { name: /Add leave/i }));

    expect(await screen.findByText("Log leave for Priya Sharma")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Planned time off/i })); // Earned
    await user.click(screen.getByRole("button", { name: /select a date/i }));
    await user.click(screen.getByRole("button", { name: "20" }));
    await user.type(screen.getByPlaceholderText("Reason for leave…"), "Conference");
    await user.click(screen.getByRole("button", { name: "Log leave" }));

    await waitFor(() =>
      expect(adminCreateLeave).toHaveBeenCalledWith(
        5,
        expect.objectContaining({ leave_type: "earned", note: "Conference" })
      )
    );
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../lib/api", () => ({
  getLeaveLimits: vi.fn(),
  getLeaveRules: vi.fn(),
  updateLeaveLimits: vi.fn(),
  updateLeaveRules: vi.fn(),
  getHolidays: vi.fn(),
  addHoliday: vi.fn(),
  updateHoliday: vi.fn(),
  deleteHoliday: vi.fn(),
}));

import { getLeaveLimits, getLeaveRules, updateLeaveRules, getHolidays } from "../../lib/api";
import LeaveSettings from "./LeaveSettings";

const RULES = {
  earned_advance_notice: [
    { min: 1, max: 2, notice: 14 },
    { min: 3, max: 4, notice: 21 },
    { min: 5, max: null, notice: 30 },
  ],
  casual_advance_notice: [
    { min: 1, max: 1, notice: 3 },
    { min: 2, max: 2, notice: 7 },
    { min: 3, max: 3, notice: 14 },
    { min: 4, max: null, notice: 30 },
  ],
  sick_cutoff_hour: 10,
  sick_cutoff_min: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  getLeaveLimits.mockResolvedValue({ earned: 18, sick_and_casual: 12, lwp: null });
  getLeaveRules.mockResolvedValue(RULES);
  getHolidays.mockResolvedValue([]);
  updateLeaveRules.mockImplementation(async (body) => ({ ...RULES, ...body }));
});

/** The card whose heading matches `title`, so the two ladders don't collide. */
const card = (title) =>
  screen.getByRole("heading", { name: title }).closest("div.bg-white");

describe("Casual leave notice requirements", () => {
  it("renders the casual ladder from the server", async () => {
    render(<LeaveSettings />);
    const casual = await waitFor(() => card("Casual Leave Notice Requirements"));

    expect(within(casual).getByText("1 working day")).toBeInTheDocument();
    expect(within(casual).getByText("2 working days")).toBeInTheDocument();
    expect(within(casual).getByText("3 working days")).toBeInTheDocument();
    expect(within(casual).getByText("4+ working days")).toBeInTheDocument();

    const notices = within(casual).getAllByText(/^(3|7|14|30)$/).map((n) => n.textContent);
    expect(notices).toEqual(["3", "7", "14", "30"]);
  });

  it("renders the earned ladder independently, unaffected by casual", async () => {
    render(<LeaveSettings />);
    const earned = await waitFor(() => card("Earned Leave Notice Requirements"));

    expect(within(earned).getByText("1–2 working days")).toBeInTheDocument();
    expect(within(earned).getByText("5+ working days")).toBeInTheDocument();
  });

  it("saves an edited casual bracket under casual_advance_notice", async () => {
    render(<LeaveSettings />);
    const casual = await waitFor(() => card("Casual Leave Notice Requirements"));

    await userEvent.click(within(casual).getByRole("button", { name: /edit/i }));

    // Bump the single-day bracket from 3 to 5 calendar days notice.
    const noticeInput = within(casual).getByLabelText("Bracket 1 calendar days notice");
    await userEvent.clear(noticeInput);
    await userEvent.type(noticeInput, "5");
    await userEvent.click(within(casual).getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(updateLeaveRules).toHaveBeenCalledTimes(1));
    const body = updateLeaveRules.mock.calls[0][0];
    expect(body).toHaveProperty("casual_advance_notice");
    expect(body).not.toHaveProperty("earned_advance_notice");
    expect(body.casual_advance_notice[0]).toEqual({ min: 1, max: 1, notice: 5 });
  });

  it("saves an edited earned bracket under earned_advance_notice", async () => {
    render(<LeaveSettings />);
    const earned = await waitFor(() => card("Earned Leave Notice Requirements"));

    await userEvent.click(within(earned).getByRole("button", { name: /edit/i }));
    const noticeInput = within(earned).getByLabelText("Bracket 1 calendar days notice");
    await userEvent.clear(noticeInput);
    await userEvent.type(noticeInput, "10");
    await userEvent.click(within(earned).getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(updateLeaveRules).toHaveBeenCalledTimes(1));
    const body = updateLeaveRules.mock.calls[0][0];
    expect(body).toHaveProperty("earned_advance_notice");
    expect(body).not.toHaveProperty("casual_advance_notice");
  });

  it("adds and removes casual brackets", async () => {
    render(<LeaveSettings />);
    const casual = await waitFor(() => card("Casual Leave Notice Requirements"));

    await userEvent.click(within(casual).getByRole("button", { name: /edit/i }));
    await userEvent.click(within(casual).getByRole("button", { name: /add bracket/i }));
    expect(within(casual).getByLabelText("Bracket 5 calendar days notice")).toBeInTheDocument();

    await userEvent.click(within(casual).getByRole("button", { name: /remove bracket 5/i }));
    expect(within(casual).queryByLabelText("Bracket 5 calendar days notice")).toBeNull();
  });

  it("discards casual edits on cancel", async () => {
    render(<LeaveSettings />);
    const casual = await waitFor(() => card("Casual Leave Notice Requirements"));

    await userEvent.click(within(casual).getByRole("button", { name: /edit/i }));
    const noticeInput = within(casual).getByLabelText("Bracket 1 calendar days notice");
    await userEvent.clear(noticeInput);
    await userEvent.type(noticeInput, "99");
    await userEvent.click(within(casual).getByRole("button", { name: /cancel/i }));

    expect(updateLeaveRules).not.toHaveBeenCalled();
    expect(within(casual).getByText("1 working day")).toBeInTheDocument();
    expect(within(casual).queryByText("99")).toBeNull();
  });
});

describe("Sick cutoff", () => {
  it("describes the cutoff as sick-only", async () => {
    render(<LeaveSettings />);
    await waitFor(() => screen.getByRole("heading", { name: "Sick Auto-Approve Cutoff" }));
    expect(screen.getByText(/Casual leave is never auto-approved/i)).toBeInTheDocument();
  });
});

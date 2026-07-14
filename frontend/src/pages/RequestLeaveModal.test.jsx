import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../lib/api", () => ({
  createLeave: vi.fn(),
  adminCreateLeave: vi.fn(),
}));

import { createLeave, adminCreateLeave } from "../lib/api";
import { RequestLeaveModal } from "./Leaves";

const LEAVE_RULES = {
  earned_advance_notice: [
    { min: 1, max: 2, notice: 14 },
    { min: 3, max: 4, notice: 21 },
    { min: 5, notice: 30 },
  ],
  casual_advance_notice: [
    { min: 1, max: 1, notice: 3 },
    { min: 2, max: 2, notice: 7 },
    { min: 3, max: 3, notice: 14 },
    { min: 4, notice: 30 },
  ],
  sick_cutoff_hour: 10,
  sick_cutoff_min: 0,
};

// The API keys balances by pool, so there is no `sick` or `casual` entry.
const BALANCES = {
  earned: { taken: 0, limit: 18, remaining: 18 },
  sick_and_casual: { taken: 10, limit: 12, remaining: 2 },
};

const todayStr = () => new Date().toISOString().slice(0, 10);

function renderModal(props = {}) {
  return render(
    <RequestLeaveModal
      open
      onClose={vi.fn()}
      onSuccess={vi.fn()}
      holidays={[]}
      leaveRules={LEAVE_RULES}
      balances={BALANCES}
      {...props}
    />
  );
}

const pick = (name) => userEvent.click(screen.getByRole("button", { name: new RegExp(name, "i") }));

beforeEach(() => {
  vi.clearAllMocks();
  createLeave.mockResolvedValue({ id: 1 });
});

describe("RequestLeaveModal category picker", () => {
  it("offers Sick and Casual as separate choices", () => {
    renderModal();
    expect(screen.getByText("Sick")).toBeInTheDocument();
    expect(screen.getByText("Casual")).toBeInTheDocument();
    expect(screen.queryByText("Sick & Casual")).not.toBeInTheDocument();
    expect(screen.getByText("Earned")).toBeInTheDocument();
    expect(screen.getByText("Special")).toBeInTheDocument();
  });
});

describe("Sick", () => {
  it("pins the start date to today and does not offer a picker", async () => {
    renderModal();
    await pick("Sick");

    // No "Select a date" trigger — the field is inert.
    expect(screen.queryByText("Select a date")).not.toBeInTheDocument();
    expect(screen.getByText(/Start date must be today for sick leaves/i)).toBeInTheDocument();
  });

  it("submits leave_type 'sick' with today's date", async () => {
    renderModal();
    await pick("Sick");
    await userEvent.type(screen.getByPlaceholderText("Reason for leave…"), "Flu");
    await userEvent.click(screen.getByRole("button", { name: /Log sick leave|Submit request/i }));

    expect(createLeave).toHaveBeenCalledWith(
      expect.objectContaining({ leave_type: "sick", start_date: todayStr() })
    );
  });

  it("shows a duration stepper, since sick leave may span several days", async () => {
    renderModal();
    await pick("Sick");
    expect(screen.getByText("How long?")).toBeInTheDocument();
  });

  it("gives admins a real date picker, since the backend exempts them", async () => {
    renderModal({ unconstrained: true, isAdmin: true });
    await pick("Sick");
    expect(screen.getByText("Select a date")).toBeInTheDocument();
    expect(screen.queryByText(/must be today for sick leaves/i)).not.toBeInTheDocument();
  });
});

describe("Casual", () => {
  it("requires 3 working days notice for a single day", async () => {
    renderModal();
    await pick("Casual");
    expect(screen.getByText(/needs/i).textContent).toMatch(/3 working days/);
  });

  it("requires 7 working days notice for two days", async () => {
    renderModal();
    await pick("Casual");
    await userEvent.click(screen.getByRole("button", { name: "2" }));
    expect(screen.getByText(/needs/i).textContent).toMatch(/7 working days/);
  });

  it("requires 30 working days notice past the ladder's last rung", async () => {
    renderModal();
    await pick("Casual");
    await userEvent.click(screen.getByRole("button", { name: "5" }));
    expect(screen.getByText(/needs/i).textContent).toMatch(/30 working days/);
  });

  it("does not pin the date to today", async () => {
    renderModal();
    await pick("Casual");
    expect(screen.getByText("Select a date")).toBeInTheDocument();
    expect(screen.queryByText(/must be today for sick leaves/i)).not.toBeInTheDocument();
  });
});

describe("Shared Sick & Casual allowance", () => {
  // The warning text is split across <span>s, so match on the banner's flattened
  // textContent rather than on a single element.
  const alertText = () => document.querySelector(".bg-red-50")?.textContent ?? "";

  it("warns a casual request against the shared pool, naming the pool", async () => {
    // 2 days remain in the pool; ask for 3.
    renderModal();
    await pick("Casual");
    await userEvent.click(screen.getByRole("button", { name: "3" }));

    expect(alertText()).toMatch(/exceeds your Sick & Casual limit/i);
    expect(alertText()).toMatch(/You have 2 of 12 days remaining/i);
  });

  it("warns a sick request against the same pool", async () => {
    renderModal();
    await pick("Sick");
    await userEvent.click(screen.getByRole("button", { name: "3" }));

    expect(alertText()).toMatch(/exceeds your Sick & Casual limit/i);
  });

  it("does not warn when the request fits the remaining pool", async () => {
    renderModal();
    await pick("Casual");
    await userEvent.click(screen.getByRole("button", { name: "2" }));

    expect(document.querySelector(".bg-red-50")).toBeNull();
  });
});

describe("RequestLeaveModal admin employee picker", () => {
  const USERS = [
    { id: 7, name: "Priya Sharma", role: "Engineer" },
    { id: 9, name: "Arjun Desai", role: "PM" },
  ];
  const adminProps = { isAdmin: true, unconstrained: true, users: USERS, defaultTargetId: 7 };

  it("is hidden for non-admins", () => {
    renderModal({ users: USERS });
    expect(screen.queryByText("Who is this for?")).not.toBeInTheDocument();
  });

  it("defaults the selection to the admin themself", () => {
    renderModal(adminProps);
    expect(screen.getByText("Who is this for?")).toBeInTheDocument();
    expect(screen.getByText("Log leave for Priya Sharma")).toBeInTheDocument();
  });

  it("logs the leave for whichever employee is chosen", async () => {
    const user = userEvent.setup();
    renderModal(adminProps);

    // Switch away from the default to the other employee.
    await user.click(screen.getByRole("button", { name: /Priya Sharma/i }));
    await user.click(await screen.findByText("Arjun Desai"));
    expect(screen.getByText("Log leave for Arjun Desai")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Planned time off/i })); // Earned
    await user.click(screen.getByRole("button", { name: /select a date/i }));
    await user.click(screen.getByRole("button", { name: "20" }));
    await user.type(screen.getByPlaceholderText("Reason for leave…"), "Conference");
    await user.click(screen.getByRole("button", { name: "Log leave" }));

    await waitFor(() =>
      expect(adminCreateLeave).toHaveBeenCalledWith(
        9,
        expect.objectContaining({ leave_type: "earned", note: "Conference" })
      )
    );
  });
});

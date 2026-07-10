import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import UserManagement from "./UserManagement";

vi.mock("../../lib/api", () => ({
  getAdminUsers: vi.fn(),
  getHolidays: vi.fn(),
  getUserOverview: vi.fn(),
  adminDeleteUser: vi.fn(),
  adminDeleteLeave: vi.fn(),
  adminDeleteCatchup: vi.fn(),
  adminCreateUser: vi.fn(),
  adminUpdateUser: vi.fn(),
  adminCreateLeave: vi.fn(),
  adminUpdateLeave: vi.fn(),
  adminCreateCatchup: vi.fn(),
  adminUpdateCatchup: vi.fn(),
}));

import { getAdminUsers, getHolidays, getUserOverview } from "../../lib/api";

const USERS = [
  { id: 1, name: "Arjun Desai", role: "CEO", email: "arjun@x.ai" },
  { id: 2, name: "Priya Sharma", role: "Senior Engineer", email: "priya@x.ai" },
];

const OVERVIEW = {
  user: {
    id: 2, name: "Priya Sharma", role: "Senior Engineer", email: "priya@x.ai",
    manager: { id: 1, name: "Arjun Desai" }, is_admin: false,
    joining_date: "2022-06-01", birthday: null, slack_user_id: null, office_status: "IN",
  },
  balances: {
    earned: { taken: 20, limit: 18, remaining: -2 },
    sick_and_casual: { taken: 0, limit: 12, remaining: 12 },
    bereavement: { taken: 0, limit: 3, remaining: 3 },
    marriage: { taken: 0, limit: 10, remaining: 10 },
    maternity: { taken: 0, limit: 130, remaining: 130 },
    paternity: { taken: 0, limit: 14, remaining: 14 },
    lwp: { taken: 0, limit: null, remaining: null },
  },
  leaves: [{
    id: 7, leave_type: "earned", start_date: "2026-03-09", end_date: "2026-03-11",
    status: "approved", note: "Trip", is_exception: false, over_limit: false,
    approvals: [], created_at: "2026-02-01T10:00:00", user: { id: 2, name: "Priya Sharma" },
  }],
  catchups: [{
    id: 3, date_and_time: "2026-03-09T10:00:00", manager_id: 1,
    manager: { id: 1, name: "Arjun Desai" }, alternate_manager: null,
    employee: { id: 2, name: "Priya Sharma" }, meeting_link: "", notes_doc_link: "",
    background_creation_finished: true,
  }],
  status_days: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  getAdminUsers.mockResolvedValue(USERS);
  getHolidays.mockResolvedValue([]);
  getUserOverview.mockResolvedValue(OVERVIEW);
});

const renderPage = (path = "/admin/users") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <UserManagement />
    </MemoryRouter>
  );

async function selectPriya(user) {
  renderPage();
  await user.click(await screen.findByRole("button", { name: /select a user/i }));
  await user.click(await screen.findByRole("option", { name: /Priya/ }));
  await screen.findByRole("tab", { name: /^Leaves/ });
}

describe("UserManagement", () => {
  it("asks you to pick someone before showing anything", async () => {
    renderPage();
    expect(await screen.findByText(/pick someone/i)).toBeInTheDocument();
  });

  it("keeps the details visible on every tab", async () => {
    const user = userEvent.setup();
    await selectPriya(user);

    for (const label of ["Catchups", "Check-in Log"]) {
      await user.click(screen.getByRole("tab", { name: new RegExp(`^${label}`) }));
      expect(screen.getByText("priya@x.ai")).toBeInTheDocument();       // details email
      expect(screen.getAllByText("Arjun Desai").length).toBeGreaterThan(0); // "Reports to"
    }
  });

  it("counts the records on each tab", async () => {
    const user = userEvent.setup();
    await selectPriya(user);

    expect(screen.getByRole("tab", { name: /^Leaves\s*1$/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /^Catchups\s*1$/ })).toBeInTheDocument();
    // Nothing meaningful to count for a log of days.
    expect(screen.getByRole("tab", { name: "Check-in Log" })).toBeInTheDocument();
  });

  it("opens on the leaves tab and shows the leave table", async () => {
    const user = userEvent.setup();
    await selectPriya(user);

    expect(screen.getByRole("tab", { name: /^Leaves/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("columnheader", { name: "Approved by" })).toBeInTheDocument();
    expect(screen.getByText("Trip")).toBeInTheDocument();
  });

  it("names an over-drawn balance rather than showing a minus sign", async () => {
    const user = userEvent.setup();
    await selectPriya(user);

    expect(screen.getByText("over limit")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();     // 20 taken of 18
    expect(screen.queryByText("-2")).not.toBeInTheDocument();
  });

  it("shows a healthy balance as days left", async () => {
    const user = userEvent.setup();
    await selectPriya(user);

    // Six of the seven types are untouched; only `earned` is over limit.
    expect(screen.getAllByText("left")).toHaveLength(6);
    expect(screen.getByText("0 taken of 12")).toBeInTheDocument(); // sick & casual
  });

  it("keeps balances on the leaves tab only", async () => {
    const user = userEvent.setup();
    await selectPriya(user);
    expect(screen.getByText("Leave Balances")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /^Catchups/ }));
    expect(screen.queryByText("Leave Balances")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /^Check-in Log/ }));
    expect(screen.queryByText("Leave Balances")).not.toBeInTheDocument();
  });

  it("opens the leave drawer when a row is clicked", async () => {
    const user = userEvent.setup();
    await selectPriya(user);

    await user.click(screen.getByText("Trip"));

    expect(await screen.findByText("Applied on")).toBeInTheDocument();
    expect(screen.getByText("Duration")).toBeInTheDocument();
    // Once in the table row, once in the drawer — they agree.
    expect(screen.getAllByText("3 days")).toHaveLength(2);
    // The admin page owns editing, so the drawer offers no actions of its own.
    expect(screen.queryByRole("button", { name: /withdraw|approve|decline/i })).not.toBeInTheDocument();
  });

  it("shows the employee's balances in the drawer", async () => {
    const user = userEvent.setup();
    await selectPriya(user);

    await user.click(screen.getByText("Trip"));
    expect(await screen.findByText(/Priya's leave balance/)).toBeInTheDocument();
  });

  it("lets an admin edit a past approved leave, which the leaves page would not", async () => {
    const user = userEvent.setup();
    await selectPriya(user);

    // derivedStatus for a 2026-03-09 approved leave is "previous" once that date
    // has passed; the normal table hides edit for those.
    expect(screen.getByRole("button", { name: /Edit Earned leave/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Delete Earned leave/i })).toBeInTheDocument();
  });

  it("switches to catchups", async () => {
    const user = userEvent.setup();
    await selectPriya(user);

    await user.click(screen.getByRole("tab", { name: /^Catchups/ }));
    expect(screen.getByText(/with Arjun Desai/)).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Approved by" })).not.toBeInTheDocument();
  });

  it("switches to the check-in log and offers both ranges", async () => {
    const user = userEvent.setup();
    await selectPriya(user);

    await user.click(screen.getByRole("tab", { name: /^Check-in Log/ }));
    expect(screen.getByRole("tab", { name: "1 month" })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("tab", { name: "3 months" }));
    expect(screen.getByRole("tab", { name: "3 months" })).toHaveAttribute("aria-selected", "true");
  });

  it("surfaces an error when the overview cannot be loaded", async () => {
    getUserOverview.mockRejectedValue(new Error("500"));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /select a user/i }));
    await user.click(await screen.findByRole("option", { name: /Priya/ }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/couldn't load/i));
  });
});

describe("UserManagement remembers who you were looking at", () => {
  it("puts the selection in the URL", async () => {
    const user = userEvent.setup();
    await selectPriya(user);
    expect(getUserOverview).toHaveBeenCalledWith(2);
  });

  it("loads straight from a shared link", async () => {
    renderPage("/admin/users?user=2");
    await waitFor(() => expect(getUserOverview).toHaveBeenCalledWith(2));
  });

  it("restores the last person when you arrive with a bare URL", async () => {
    sessionStorage.setItem("admin:lastUser", "2");
    renderPage();
    await waitFor(() => expect(getUserOverview).toHaveBeenCalledWith(2));
  });

  it("lets the URL win over what was remembered", async () => {
    sessionStorage.setItem("admin:lastUser", "2");
    renderPage("/admin/users?user=1");
    await waitFor(() => expect(getUserOverview).toHaveBeenCalledWith(1));
    expect(getUserOverview).not.toHaveBeenCalledWith(2);
  });

  it("forgets someone who no longer exists", async () => {
    sessionStorage.setItem("admin:lastUser", "999");
    renderPage();

    await screen.findByText(/pick someone/i);
    expect(getUserOverview).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("admin:lastUser")).toBeNull();
  });

  it("clears the selection when the user is deleted underneath it", async () => {
    getUserOverview.mockRejectedValue({ response: { status: 404 } });
    renderPage("/admin/users?user=2");

    await screen.findByText(/pick someone/i);
    expect(sessionStorage.getItem("admin:lastUser")).toBeNull();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import UserHierarchy from "./UserHierarchy";

vi.mock("../../lib/api", () => ({
  getAdminUsers: vi.fn(),
  adminUpdateUser: vi.fn(),
}));

// React Flow needs layout APIs jsdom does not provide. The shell test only
// cares about the tabs, so stub the graph view out entirely.
vi.mock("../../components/hierarchy/HierarchyGraph", () => ({
  default: () => <div data-testid="graph-view" />,
}));

import { getAdminUsers } from "../../lib/api";

const USERS = [
  { id: 1, name: "Arjun Desai", role: "CEO", role_level: "l2_lead", email: "arjun@x.ai", manager_id: null },
  { id: 2, name: "Neel Mehta", role: "Eng Mgr", role_level: "l1_manager", email: "neel@x.ai", manager_id: 1 },
];

beforeEach(() => {
  getAdminUsers.mockResolvedValue(USERS);
});

const renderAt = (path = "/admin/hierarchy") =>
  render(<MemoryRouter initialEntries={[path]}><UserHierarchy /></MemoryRouter>);

describe("UserHierarchy shell", () => {
  it("defaults to the list view", async () => {
    renderAt();
    expect(await screen.findByText("Arjun Desai")).toBeInTheDocument();
    expect(screen.queryByTestId("graph-view")).not.toBeInTheDocument();
  });

  it("renders the graph view when ?view=chart", async () => {
    renderAt("/admin/hierarchy?view=chart");
    expect(await screen.findByTestId("graph-view")).toBeInTheDocument();
  });

  it("switches views via the tabs", async () => {
    const user = userEvent.setup();
    renderAt();
    await screen.findByText("Arjun Desai");
    await user.click(screen.getByRole("tab", { name: "Chart" }));
    expect(await screen.findByTestId("graph-view")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "List" }));
    await waitFor(() => expect(screen.queryByTestId("graph-view")).not.toBeInTheDocument());
  });

  it("marks the active tab with aria-selected", async () => {
    renderAt();
    await screen.findByText("Arjun Desai");
    expect(screen.getByRole("tab", { name: "List" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Chart" })).toHaveAttribute("aria-selected", "false");
  });
});

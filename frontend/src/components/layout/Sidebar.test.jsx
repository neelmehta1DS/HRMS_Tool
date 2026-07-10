import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { UserContext } from "../../contexts/UserContext";
import Sidebar from "./Sidebar";

function renderSidebar(path, user = { id: 1, name: "Arjun Desai", is_admin: true }) {
  return render(
    <UserContext.Provider value={{ user, setUser: () => {} }}>
      <MemoryRouter initialEntries={[path]}>
        <Sidebar />
      </MemoryRouter>
    </UserContext.Provider>
  );
}

describe("Sidebar admin submenu", () => {
  it("hides the admin section entirely from non-admins", () => {
    renderSidebar("/", { id: 2, name: "Priya", is_admin: false });
    expect(screen.queryByRole("button", { name: /admin/i })).not.toBeInTheDocument();
  });

  it("starts collapsed on a non-admin route", () => {
    renderSidebar("/");
    const toggle = screen.getByRole("button", { name: /admin/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "User Hierarchy" })).not.toBeInTheDocument();
  });

  it("expands on click and reveals both sub-pages", async () => {
    const user = userEvent.setup();
    renderSidebar("/");
    await user.click(screen.getByRole("button", { name: /admin/i }));
    expect(screen.getByRole("button", { name: /admin/i })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "User Hierarchy" })).toHaveAttribute("href", "/admin/hierarchy");
    expect(screen.getByRole("link", { name: "Leave Settings" })).toHaveAttribute("href", "/admin/leaves");
  });

  it("auto-expands when already on an admin route", () => {
    renderSidebar("/admin/leaves");
    expect(screen.getByRole("button", { name: /admin/i })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Leave Settings" })).toBeInTheDocument();
  });

  it("collapses on a second click", async () => {
    const user = userEvent.setup();
    renderSidebar("/");
    const toggle = screen.getByRole("button", { name: /admin/i });
    await user.click(toggle);
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("starts expanded on an admin route", () => {
    renderSidebar("/admin/leaves");
    const toggle = screen.getByRole("button", { name: /admin/i });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("lets the user collapse the submenu even on an admin route", async () => {
    const user = userEvent.setup();
    renderSidebar("/admin/leaves");
    const toggle = screen.getByRole("button", { name: /admin/i });
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "Leave Settings" })).not.toBeInTheDocument();
  });
});

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { UserContext } from "../../contexts/UserContext";
import AdminRoute from "./AdminRoute";

function renderAt(path, user) {
  return render(
    <UserContext.Provider value={{ user, setUser: () => {} }}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={<p>Dashboard</p>} />
          <Route path="/admin" element={<AdminRoute />}>
            <Route path="hierarchy" element={<p>Hierarchy Page</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </UserContext.Provider>
  );
}

describe("AdminRoute", () => {
  it("renders the nested admin page for an admin", () => {
    renderAt("/admin/hierarchy", { id: 1, name: "Arjun", is_admin: true });
    expect(screen.getByText("Hierarchy Page")).toBeInTheDocument();
  });

  it("redirects a non-admin to the dashboard", () => {
    renderAt("/admin/hierarchy", { id: 2, name: "Priya", is_admin: false });
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.queryByText("Hierarchy Page")).not.toBeInTheDocument();
  });
});

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import UserSelect from "./UserSelect";

const USERS = [
  { id: 1, name: "Arjun Desai", role: "CEO", email: "arjun@x.ai" },
  { id: 2, name: "Priya Sharma", role: "Senior Engineer", email: "priya@x.ai" },
  { id: 3, name: "Sneha Kapoor", role: "Design Lead", email: "sneha@x.ai" },
];

const renderSelect = (props = {}) => {
  const onChange = vi.fn();
  render(<UserSelect users={USERS} value={null} onChange={onChange} {...props} />);
  return { onChange };
};

describe("UserSelect", () => {
  it("shows the placeholder when nothing is chosen", () => {
    renderSelect({ placeholder: "Select a user" });
    expect(screen.getByText("Select a user")).toBeInTheDocument();
  });

  it("shows the chosen person's name and role", () => {
    renderSelect({ value: 2 });
    expect(screen.getByText("Priya Sharma")).toBeInTheDocument();
    expect(screen.getByText("Senior Engineer")).toBeInTheDocument();
  });

  it("opens on click and lists everyone", async () => {
    const user = userEvent.setup();
    renderSelect();
    await user.click(screen.getByRole("button"));
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("filters on name, role and email", async () => {
    const user = userEvent.setup();
    renderSelect();
    await user.click(screen.getByRole("button"));

    await user.type(screen.getByPlaceholderText(/search people/i), "design");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option", { name: /Sneha/ })).toBeInTheDocument();
  });

  it("reports the chosen id and closes", async () => {
    const user = userEvent.setup();
    const { onChange } = renderSelect();
    await user.click(screen.getByRole("button"));
    await user.click(screen.getByRole("option", { name: /Priya/ }));

    expect(onChange).toHaveBeenCalledWith(2);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("offers a none option only when allowed", async () => {
    const user = userEvent.setup();
    const { onChange } = renderSelect({ allowNone: true });
    await user.click(screen.getByRole("button"));
    await user.click(screen.getByRole("option", { name: /none/i }));

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("hides the none option by default", async () => {
    const user = userEvent.setup();
    renderSelect();
    await user.click(screen.getByRole("button"));
    expect(screen.queryByRole("option", { name: /none/i })).not.toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    renderSelect();
    await user.click(screen.getByRole("button"));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("tells you when nothing matches", async () => {
    const user = userEvent.setup();
    renderSelect();
    await user.click(screen.getByRole("button"));
    await user.type(screen.getByPlaceholderText(/search people/i), "zzzz");
    expect(screen.getByText(/no one matches/i)).toBeInTheDocument();
  });
});

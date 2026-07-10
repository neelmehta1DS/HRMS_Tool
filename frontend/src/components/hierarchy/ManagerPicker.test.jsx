import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ManagerPicker from "./ManagerPicker";

const USERS = [
  { id: 1, name: "Arjun Desai",  role: "CEO",             role_level: "l2_lead",    email: "arjun@x.ai", manager_id: null },
  { id: 2, name: "Neel Mehta",   role: "Engineering Mgr", role_level: "l1_manager", email: "neel@x.ai",  manager_id: 1 },
  { id: 3, name: "Sneha Kapoor", role: "Design Lead",     role_level: "l1_manager", email: "sneha@x.ai", manager_id: 1 },
  { id: 4, name: "Priya Sharma", role: "Senior Engineer", role_level: "ic",         email: "priya@x.ai", manager_id: 2 },
];

const anchorRect = { top: 100, bottom: 130, left: 200, right: 260, width: 60, height: 30 };

function renderPicker(subjectId, overrides = {}) {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  render(
    <ManagerPicker
      user={USERS.find((u) => u.id === subjectId)}
      users={USERS}
      anchorRect={anchorRect}
      onSelect={onSelect}
      onClose={onClose}
      {...overrides}
    />
  );
  return { onSelect, onClose };
}

describe("ManagerPicker", () => {
  it("lists only valid managers", () => {
    renderPicker(2); // Neel: cannot be managed by himself or Priya
    expect(screen.getByRole("option", { name: /Arjun Desai/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Sneha Kapoor/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Neel Mehta/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Priya Sharma/ })).not.toBeInTheDocument();
  });

  it("offers a no-manager option", () => {
    renderPicker(4);
    expect(screen.getByRole("option", { name: /no manager/i })).toBeInTheDocument();
  });

  it("marks the current manager and disables re-selecting them", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderPicker(4); // Priya reports to Neel
    const current = screen.getByRole("option", { name: /Neel Mehta/ });
    expect(current).toHaveAttribute("aria-current", "true");
    await user.click(current);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("moves aria-activedescendant with the arrow keys", async () => {
    const user = userEvent.setup();
    renderPicker(4);
    const input = screen.getByPlaceholderText(/search/i);
    // First option ("No manager") is active on open.
    expect(input).toHaveAttribute("aria-activedescendant", "manager-option-none");
    await user.keyboard("{ArrowDown}"); // moves to Arjun (id 1)
    expect(input).toHaveAttribute("aria-activedescendant", "manager-option-1");
  });

  it("filters as you type", async () => {
    const user = userEvent.setup();
    renderPicker(4);
    await user.type(screen.getByPlaceholderText(/search/i), "sneha");
    expect(screen.getByRole("option", { name: /Sneha Kapoor/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Arjun Desai/ })).not.toBeInTheDocument();
  });

  it("selects with a click", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderPicker(4);
    await user.click(screen.getByRole("option", { name: /Sneha Kapoor/ }));
    expect(onSelect).toHaveBeenCalledWith(3);
  });

  it("selects the active option with Enter after arrowing", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderPicker(4);
    await user.keyboard("{ArrowDown}{Enter}"); // first option is "No manager"
    expect(onSelect).toHaveBeenCalledWith(1);  // second is Arjun
  });

  it("passes null when No manager is chosen", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderPicker(4);
    await user.click(screen.getByRole("option", { name: /no manager/i }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    const { onClose } = renderPicker(4);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("autofocuses the search field", () => {
    renderPicker(4);
    expect(screen.getByPlaceholderText(/search/i)).toHaveFocus();
  });

  it("stays open when its own option list is scrolled", () => {
    const { onClose } = renderPicker(4);
    fireEvent.scroll(screen.getByRole("listbox"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes when the page behind it scrolls", () => {
    const { onClose } = renderPicker(4);
    fireEvent.scroll(document);
    expect(onClose).toHaveBeenCalled();
  });

  it("ignores a mousedown on the anchor button so the toggle can handle it", () => {
    const anchorEl = document.createElement("button");
    document.body.appendChild(anchorEl);
    const { onClose } = renderPicker(4, { anchorEl });
    fireEvent.mouseDown(anchorEl);
    expect(onClose).not.toHaveBeenCalled();
    anchorEl.remove();
  });

  it("still closes on an outside mousedown when no anchorEl is given", () => {
    const { onClose } = renderPicker(4);
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps the panel on screen on a narrow viewport", () => {
    const original = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { value: 300, configurable: true });
    renderPicker(4);
    const panel = screen.getByRole("dialog");
    expect(parseFloat(panel.style.left)).toBeGreaterThanOrEqual(8);
    Object.defineProperty(window, "innerWidth", { value: original, configurable: true });
  });
});

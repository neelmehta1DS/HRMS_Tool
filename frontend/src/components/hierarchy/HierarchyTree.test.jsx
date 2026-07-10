import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HierarchyTree from "./HierarchyTree";

const USERS = [
  { id: 1, name: "Arjun Desai",  role: "CEO",             role_level: "l2_lead",    email: "arjun@x.ai",  manager_id: null },
  { id: 2, name: "Neel Mehta",   role: "Engineering Mgr", role_level: "l1_manager", email: "neel@x.ai",   manager_id: 1 },
  { id: 3, name: "Sneha Kapoor", role: "Design Lead",     role_level: "l1_manager", email: "sneha@x.ai",  manager_id: 1 },
  { id: 4, name: "Priya Sharma", role: "Senior Engineer", role_level: "ic",         email: "priya@x.ai",  manager_id: 2 },
];

const renderTree = () => render(<HierarchyTree users={USERS} onChangeManager={vi.fn()} />);

describe("HierarchyTree", () => {
  it("renders every user, expanded by default", () => {
    renderTree();
    for (const u of USERS) expect(screen.getByText(u.name)).toBeInTheDocument();
  });

  it("exposes tree semantics", () => {
    renderTree();
    expect(screen.getByRole("tree")).toBeInTheDocument();
    expect(screen.getAllByRole("treeitem")).toHaveLength(4);
  });

  it("nests rows by depth via aria-level", () => {
    renderTree();
    const items = screen.getAllByRole("treeitem");
    expect(items[0]).toHaveAttribute("aria-level", "1"); // Arjun
    expect(items[1]).toHaveAttribute("aria-level", "2"); // Neel
    expect(items[2]).toHaveAttribute("aria-level", "3"); // Priya
  });

  it("collapses a subtree when its row is clicked", async () => {
    const user = userEvent.setup();
    renderTree();
    await user.click(screen.getByText("Neel Mehta"));
    expect(screen.queryByText("Priya Sharma")).not.toBeInTheDocument();
    expect(screen.getByText("Sneha Kapoor")).toBeInTheDocument();
  });

  it("re-expands on a second click", async () => {
    const user = userEvent.setup();
    renderTree();
    await user.click(screen.getByText("Neel Mehta"));
    await user.click(screen.getByText("Neel Mehta"));
    expect(screen.getByText("Priya Sharma")).toBeInTheDocument();
  });

  it("gives leaf rows no expand affordance", () => {
    renderTree();
    const priya = screen.getByText("Priya Sharma").closest('[role="treeitem"]');
    expect(priya).not.toHaveAttribute("aria-expanded");
  });

  it("filters on search and keeps the ancestor chain", async () => {
    const user = userEvent.setup();
    renderTree();
    await user.type(screen.getByPlaceholderText(/search/i), "Priya");
    expect(screen.getByText("Priya Sharma")).toBeInTheDocument();
    expect(screen.getByText("Neel Mehta")).toBeInTheDocument();   // ancestor
    expect(screen.getByText("Arjun Desai")).toBeInTheDocument();  // ancestor
    expect(screen.queryByText("Sneha Kapoor")).not.toBeInTheDocument();
  });

  it("shows an empty state when nothing matches", async () => {
    const user = userEvent.setup();
    renderTree();
    await user.type(screen.getByPlaceholderText(/search/i), "zzzzz");
    expect(screen.getByText(/no one matches/i)).toBeInTheDocument();
  });

  it("shows a loading state while users are still empty", () => {
    render(<HierarchyTree users={[]} onChangeManager={vi.fn()} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    expect(screen.queryByText(/no one matches/i)).not.toBeInTheDocument();
  });

  it("puts every move button in the keyboard tab order", async () => {
    const user = userEvent.setup();
    renderTree();
    await user.tab(); // search field
    await user.tab(); // the tree itself (a single roving tab stop — the focused row)
    await user.tab(); // first row's move button
    expect(screen.getByRole("button", { name: "Change manager for Arjun Desai" })).toHaveFocus();
  });

  it("is a single tab stop via roving tabindex", () => {
    renderTree();
    const items = screen.getAllByRole("treeitem");
    const tabbable = items.filter((el) => el.getAttribute("tabindex") === "0");
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toBe(items[0]); // first visible row
  });

  it("moves focus to the next row on ArrowDown", async () => {
    const user = userEvent.setup();
    renderTree();
    const items = screen.getAllByRole("treeitem");
    items[0].focus();
    await user.keyboard("{ArrowDown}");
    expect(items[1]).toHaveFocus(); // Neel
  });

  it("expands a collapsed row on ArrowRight", async () => {
    const user = userEvent.setup();
    renderTree();
    await user.click(screen.getByText("Neel Mehta")); // collapse
    expect(screen.queryByText("Priya Sharma")).not.toBeInTheDocument();
    const neel = screen.getByText("Neel Mehta").closest('[role="treeitem"]');
    neel.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByText("Priya Sharma")).toBeInTheDocument();
  });

  it("collapses an expanded row on ArrowLeft", async () => {
    const user = userEvent.setup();
    renderTree();
    const neel = screen.getByText("Neel Mehta").closest('[role="treeitem"]');
    neel.focus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.queryByText("Priya Sharma")).not.toBeInTheDocument();
  });

  it("moves focus to the parent on ArrowLeft from a leaf", async () => {
    const user = userEvent.setup();
    renderTree();
    const priya = screen.getByText("Priya Sharma").closest('[role="treeitem"]');
    priya.focus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByText("Neel Mehta").closest('[role="treeitem"]')).toHaveFocus();
  });

  it("toggles expansion on Enter", async () => {
    const user = userEvent.setup();
    renderTree();
    const neel = screen.getByText("Neel Mehta").closest('[role="treeitem"]');
    neel.focus();
    await user.keyboard("{Enter}");
    expect(screen.queryByText("Priya Sharma")).not.toBeInTheDocument();
  });

  it("opens the picker on Enter over the Move button without toggling the row", async () => {
    const user = userEvent.setup();
    renderTree();
    screen.getByRole("button", { name: "Change manager for Neel Mehta" }).focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog", { name: /change manager for neel/i })).toBeInTheDocument();
    expect(screen.getByText("Priya Sharma")).toBeInTheDocument(); // row stayed expanded
  });

  it("expands everything once an async users fetch resolves", () => {
    // The real shell mounts this component with [] and fills users later.
    const { rerender } = render(<HierarchyTree users={[]} onChangeManager={vi.fn()} />);
    rerender(<HierarchyTree users={USERS} onChangeManager={vi.fn()} />);
    expect(screen.getByText("Priya Sharma")).toBeInTheDocument(); // depth 2
  });
});

describe("HierarchyTree reassignment", () => {
  it("opens the picker from a row's Move button", async () => {
    const user = userEvent.setup();
    render(<HierarchyTree users={USERS} onChangeManager={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Change manager for Priya Sharma" }));
    expect(screen.getByRole("dialog", { name: /change manager for priya/i })).toBeInTheDocument();
  });

  it("closes the picker when Move is clicked again", async () => {
    const user = userEvent.setup();
    render(<HierarchyTree users={USERS} onChangeManager={vi.fn()} />);
    const move = screen.getByRole("button", { name: "Change manager for Priya Sharma" });
    await user.click(move);
    await user.click(move);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("saves the chosen manager", async () => {
    const user = userEvent.setup();
    const onChangeManager = vi.fn().mockResolvedValue(undefined);
    render(<HierarchyTree users={USERS} onChangeManager={onChangeManager} />);
    await user.click(screen.getByRole("button", { name: "Change manager for Priya Sharma" }));
    await user.click(screen.getByRole("option", { name: /Sneha Kapoor/ }));
    await waitFor(() => expect(onChangeManager).toHaveBeenCalledWith(4, 3));
  });

  it("saves null when promoted to no manager", async () => {
    const user = userEvent.setup();
    const onChangeManager = vi.fn().mockResolvedValue(undefined);
    render(<HierarchyTree users={USERS} onChangeManager={onChangeManager} />);
    await user.click(screen.getByRole("button", { name: "Change manager for Priya Sharma" }));
    await user.click(screen.getByRole("option", { name: /no manager/i }));
    await waitFor(() => expect(onChangeManager).toHaveBeenCalledWith(4, null));
  });

  it("closes the picker after a successful save", async () => {
    const user = userEvent.setup();
    render(<HierarchyTree users={USERS} onChangeManager={vi.fn().mockResolvedValue(undefined)} />);
    await user.click(screen.getByRole("button", { name: "Change manager for Priya Sharma" }));
    await user.click(screen.getByRole("option", { name: /Sneha Kapoor/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("shows an error when the save fails", async () => {
    const user = userEvent.setup();
    const onChangeManager = vi.fn().mockRejectedValue(new Error("500"));
    render(<HierarchyTree users={USERS} onChangeManager={onChangeManager} />);
    await user.click(screen.getByRole("button", { name: "Change manager for Priya Sharma" }));
    await user.click(screen.getByRole("option", { name: /Sneha Kapoor/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn.t change/i);
  });

  it("keeps the picker open after a failed save", async () => {
    const user = userEvent.setup();
    const onChangeManager = vi.fn().mockRejectedValue(new Error("500"));
    render(<HierarchyTree users={USERS} onChangeManager={onChangeManager} />);
    await user.click(screen.getByRole("button", { name: "Change manager for Priya Sharma" }));
    await user.click(screen.getByRole("option", { name: /Sneha Kapoor/ }));
    await screen.findByRole("alert");
    expect(screen.getByRole("dialog", { name: /change manager for priya/i })).toBeInTheDocument();
  });

  it("announces the change for screen readers", async () => {
    const user = userEvent.setup();
    render(<HierarchyTree users={USERS} onChangeManager={vi.fn().mockResolvedValue(undefined)} />);
    await user.click(screen.getByRole("button", { name: "Change manager for Priya Sharma" }));
    await user.click(screen.getByRole("option", { name: /Sneha Kapoor/ }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Priya Sharma now reports to Sneha Kapoor")
    );
  });

  it("announces promotion to no manager", async () => {
    const user = userEvent.setup();
    render(<HierarchyTree users={USERS} onChangeManager={vi.fn().mockResolvedValue(undefined)} />);
    await user.click(screen.getByRole("button", { name: "Change manager for Priya Sharma" }));
    await user.click(screen.getByRole("option", { name: /no manager/i }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Priya Sharma no longer reports to anyone")
    );
  });

  it("leaves the error showing nothing moved", async () => {
    const user = userEvent.setup();
    render(<HierarchyTree users={USERS} onChangeManager={vi.fn().mockRejectedValue(new Error("500"))} />);
    await user.click(screen.getByRole("button", { name: "Change manager for Priya Sharma" }));
    await user.click(screen.getByRole("option", { name: /Sneha Kapoor/ }));
    await screen.findByRole("alert");
    // The parent owns `users`; a rejected save must not have re-parented anyone locally.
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("expands a collapsed destination so the moved person is visible", async () => {
    const user = userEvent.setup();

    // The real shell owns `users` and reparents on save. Reproduce that here,
    // otherwise the tree never re-renders and the expansion is unobservable.
    function Harness() {
      const [users, setUsers] = useState(USERS);
      return (
        <HierarchyTree
          users={users}
          onChangeManager={async (id, managerId) =>
            setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, manager_id: managerId } : u)))
          }
        />
      );
    }
    render(<Harness />);

    await user.click(screen.getByText("Neel Mehta"));
    expect(screen.queryByText("Priya Sharma")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Change manager for Sneha Kapoor" }));
    await user.click(screen.getByRole("option", { name: /Neel Mehta/ }));

    // Landing under a collapsed manager would hide the person you just moved.
    await waitFor(() => expect(screen.getByText("Priya Sharma")).toBeInTheDocument());
    expect(screen.getByText("Sneha Kapoor")).toBeInTheDocument();
  });
});

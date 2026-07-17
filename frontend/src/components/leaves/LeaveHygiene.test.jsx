import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlanningHygieneCard, HygieneDetailBlock } from "./LeaveHygiene";

const EXCELLENT = { score: 100, band: "Excellent", exceptions: 0, hop_absences: 0, total_leaves: 6, driver: "All leaves planned and filed on time" };
const FAIR = { score: 65, band: "Fair", exceptions: 1, hop_absences: 1, total_leaves: 6, driver: "1 unapproved absence logged by HoP · 1 exception" };

describe("PlanningHygieneCard", () => {
  it("renders score, band and driver", () => {
    render(<PlanningHygieneCard hygiene={FAIR} />);
    expect(screen.getByText("65")).toBeInTheDocument();
    expect(screen.getByText("Fair")).toBeInTheDocument();
    expect(screen.getByText("1 unapproved absence logged by HoP · 1 exception")).toBeInTheDocument();
  });

  it("renders nothing when hygiene is null (L2 leads)", () => {
    const { container } = render(<PlanningHygieneCard hygiene={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the calculation note when the info button is clicked", async () => {
    render(<PlanningHygieneCard hygiene={EXCELLENT} />);
    expect(screen.queryByText(/How this is calculated/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByLabelText(/how planning hygiene is calculated/i));
    expect(screen.getByText(/How this is calculated/i)).toBeInTheDocument();
    expect(screen.getByText(/HoP-logged absences/i)).toBeInTheDocument();
  });
});

describe("HygieneDetailBlock", () => {
  it("renders the score inside the drawer block", () => {
    render(<HygieneDetailBlock hygiene={FAIR} />);
    expect(screen.getByText("65")).toBeInTheDocument();
    expect(screen.getByText("Fair")).toBeInTheDocument();
  });

  it("renders nothing when hygiene is null", () => {
    const { container } = render(<HygieneDetailBlock hygiene={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

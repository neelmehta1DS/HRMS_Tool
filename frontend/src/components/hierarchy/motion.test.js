import { describe, it, expect } from "vitest";
import { ease } from "./motion";

describe("ease", () => {
  it("is pinned at both ends", () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
  });

  it("is symmetric about the midpoint", () => {
    expect(ease(0.5)).toBeCloseTo(0.5, 5);
    expect(ease(0.25) + ease(0.75)).toBeCloseTo(1, 5);
  });
});

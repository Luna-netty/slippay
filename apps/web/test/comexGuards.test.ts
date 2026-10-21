import { describe, it, expect } from "vitest";
import { requiresApproval } from "../src/lib/comexGuards.ts";

describe("requiresApproval", () => {
  it("requires approval at or above the limit", () => {
    expect(requiresApproval("5000", "5000")).toBe(true);
    expect(requiresApproval("9000", "5000")).toBe(true);
  });
  it("does not require approval below the limit", () => {
    expect(requiresApproval("500", "5000")).toBe(false);
  });
  it("fails closed on non-numeric input", () => {
    expect(requiresApproval("abc", "5000")).toBe(true);
    expect(requiresApproval("100", "")).toBe(true);
  });
});

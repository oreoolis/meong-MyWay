import { describe, expect, it } from "vitest";
import { searchTokens } from "@/lib/agents/role-matching";

describe("searchTokens", () => {
  it("splits the multi-word job titles the planner emits", () => {
    expect(searchTokens(["Data Analyst", "Supply Chain Manager"]))
      .toEqual(["Data", "Analyst", "Supply", "Chain", "Manager"]);
  });

  it("dedupes the shared head noun across titles", () => {
    expect(searchTokens(["Data Analyst", "Business Analyst", "Credit Analyst"]))
      .toEqual(["Data", "Analyst", "Business", "Credit"]);
  });

  it("drops seniority modifiers and sub-3-character tokens", () => {
    expect(searchTokens(["Senior UX Designer", "Head of Marketing"]))
      .toEqual(["Designer", "Head", "Marketing"]);
  });

  it("never emits a token containing a space", () => {
    for (const t of searchTokens(["Chief Technology Officer", "R&D Lead"])) {
      expect(t).not.toContain(" ");
    }
  });
});

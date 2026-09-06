import { describe, expect, it } from "vitest";

import { findRoles } from "@/lib/agents/role-matching";
import { hasSsgCredentials } from "@/lib/ssg/oauth";
import { searchJobRoles, SsgApiError } from "@/lib/ssg/client";

/**
 * The Skills Framework contract, pinned against the live host.
 *
 * These exist because all four bugs they cover presented identically — as an
 * empty result — and an empty result is indistinguishable from an honest "no
 * matches" at every layer above. A unit test with a mocked fetch would have
 * kept passing through every one of them, because the mock would have been
 * written to the documented behaviour rather than the real one.
 */
const describeLive = hasSsgCredentials() ? describe : describe.skip;

describeLive("Skills Framework job role search", () => {
  it("returns roles for a single-word keyword", async () => {
    const { jobRoles } = await searchJobRoles({ keyword: "Analyst" });

    expect(jobRoles.length).toBeGreaterThan(0);
    expect(jobRoles.some((role) => /analyst/i.test(role.title))).toBe(true);
  });

  it("surfaces an API rejection instead of returning an empty list", async () => {
    // A keyword with a space is answered with HTTP 200 and an envelope
    // carrying `status: 500`. Before the envelope was inspected this returned
    // `[]`, which is how a broken search looked exactly like an empty market.
    await expect(searchJobRoles({ keyword: "Data Analyst" })).rejects.toBeInstanceOf(
      SsgApiError,
    );
  });

  it("normalises descriptions to an array and salary to numbers", async () => {
    const { jobRoles } = await searchJobRoles({ keyword: "Analyst" });

    for (const role of jobRoles) {
      if (role.descriptions !== undefined) {
        // The API sends a bare string here. Left unconverted, the matcher's
        // `.join(" ")` throws and every role is silently dropped from scoring.
        expect(Array.isArray(role.descriptions)).toBe(true);
      }
      for (const amount of [role.salary?.minimum, role.salary?.maximum]) {
        if (amount !== undefined) expect(typeof amount).toBe("number");
      }
    }
  });

  it("scopes to a sector by numeric id", async () => {
    // 15633 is Information and Communications Technology. The sector `code`
    // ("ICT") is accepted by the API and matches nothing.
    const { jobRoles } = await searchJobRoles({ keyword: "Engineer", sector: "15633" });

    expect(jobRoles.length).toBeGreaterThan(0);
    for (const role of jobRoles) expect(role.sector?.id).toBe("15633");
  });

  it("finds roles for the multi-word titles the planner actually emits", async () => {
    // The planner is prompted for real job titles, so this is the shape its
    // output really takes. Searched verbatim, every one of these returns
    // nothing; `findRoles` splits them into the tokens the endpoint accepts.
    const { roles, attempted } = await findRoles([
      "Data Analyst",
      "Product Manager",
      "Supply Chain Executive",
    ]);

    expect(attempted).toBeGreaterThan(0);
    expect(roles.length).toBeGreaterThan(0);

    // The point of searching outside one sector is reaching several of them.
    const sectors = new Set(roles.map((role) => role.sector?.id).filter(Boolean));
    expect(sectors.size).toBeGreaterThan(1);
  });
});

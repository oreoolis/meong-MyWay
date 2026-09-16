import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./oauth", () => ({
  getAccessToken: vi.fn().mockResolvedValue("test-token"),
  hasSsgCredentials: vi.fn(() => true),
  invalidateAccessToken: vi.fn(),
}));

import { searchCourses } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SkillsFuture course search", () => {
  it("preserves phrase keywords and omits the expired Skills Framework version", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 200,
          data: {
            courses: [
              {
                referenceNumber: "provider-1",
                externalReferenceNumber: "TGS-2026000001",
                title: "Data Visualisation for Decisions",
                objective: "Build decision-ready dashboards.",
              },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchCourses({
      keyword: "Data Visualisation",
      pageSize: 20,
    });

    expect(result.courses).toHaveLength(1);
    const [url, options] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe("/courses/directory");
    expect(url.searchParams.get("keyword")).toBe("Data Visualisation");
    expect(url.searchParams.get("pageSize")).toBe("20");
    expect(options.headers).toMatchObject({
      Accept: "application/json",
      Authorization: "Bearer test-token",
    });
    expect(options.headers).not.toHaveProperty("x-api-version");
  });

  it("drops malformed directory records before they reach ranking", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: 200,
            data: {
              courses: [
                { referenceNumber: "", title: "No reference" },
                { referenceNumber: "valid", title: "" },
              ],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(searchCourses({ keyword: "Analytics" })).resolves.toEqual({
      courses: [],
      total: 0,
    });
  });
});


import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  findRoles: vi.fn(),
  scoreRoles: vi.fn(),
  lookupCompetencies: vi.fn(),
}));
// Spread the original: only the three network-touching functions are mocked,
// so real constants like MAX_ROLES_TO_SCORE keep their values.
vi.mock("./role-matching", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./role-matching")>()),
  ...m,
}));

const { roleToolkit } = await import("./role-tools");

function role(id: string, sectorId: string, salary?: { minimum: number; maximum: number }) {
  return { id, title: `Role ${id}`, sector: { id: sectorId, title: `Sector ${sectorId}` }, salary };
}

beforeEach(() => {
  vi.resetAllMocks();
  m.lookupCompetencies.mockResolvedValue([]);
});

/**
 * `seen` is the load-bearing part. Both market agents bind the model's
 * rationale back onto framework facts by role ID, and drop anything naming an
 * ID that was never offered — that bind is what stops a hallucinated role
 * reaching the UI with a real-looking salary. If the toolkit does not record
 * what it surfaced, every destination is dropped and the agent silently falls
 * back to its reasoned tier.
 */
describe("roleToolkit", () => {
  it("records every scored role it surfaces, keyed by id", async () => {
    m.findRoles.mockResolvedValue({ roles: [role("a", "1"), role("b", "1")] });
    m.scoreRoles.mockResolvedValue([
      { role: role("a", "1", { minimum: 5000, maximum: 7000 }), score: 81 },
      { role: role("b", "1"), score: 60 },
    ]);

    const { tools, seen } = roleToolkit({ resumeVector: [1], competencyKind: "technical" });
    const text = await tools[0].run({ keyword: "Analyst" });

    expect([...seen.keys()]).toEqual(["a", "b"]);
    // The model can only cite an id it was shown.
    expect(text).toContain("id=a");
    expect(text).toContain("SGD 5000-7000 monthly (published)");
    expect(text).toContain("no published salary band");
  });

  it("accumulates across several searches rather than replacing", async () => {
    m.findRoles
      .mockResolvedValueOnce({ roles: [role("a", "1")] })
      .mockResolvedValueOnce({ roles: [role("b", "1")] });
    m.scoreRoles
      .mockResolvedValueOnce([{ role: role("a", "1"), score: 70 }])
      .mockResolvedValueOnce([{ role: role("b", "1"), score: 75 }]);

    const { tools, seen } = roleToolkit({ resumeVector: [1], competencyKind: "technical" });
    await tools[0].run({ keyword: "Analyst" });
    await tools[0].run({ keyword: "Engineer" });

    expect([...seen.keys()]).toEqual(["a", "b"]);
  });

  it("excludes the current sector for the swapper, and never records what it dropped", async () => {
    m.findRoles.mockResolvedValue({ roles: [role("home", "1"), role("away", "2")] });
    m.scoreRoles.mockResolvedValue([{ role: role("away", "2"), score: 66 }]);

    const { tools, seen } = roleToolkit({
      resumeVector: [1],
      excludeSectorId: "1",
      competencyKind: "generic",
    });
    await tools[0].run({ keyword: "Analyst" });

    expect(m.scoreRoles).toHaveBeenCalledWith([role("away", "2")], [1]);
    expect([...seen.keys()]).toEqual(["away"]);
  });

  it("never re-embeds a role a previous search already scored", async () => {
    // "Data" and "Analyst" both return Data Analyst. Its score cannot change —
    // the résumé vector is fixed — so the second search must not pay for it.
    m.findRoles
      .mockResolvedValueOnce({ roles: [role("shared", "1"), role("a", "1")] })
      .mockResolvedValueOnce({ roles: [role("shared", "1"), role("b", "1")] });
    m.scoreRoles
      .mockResolvedValueOnce([
        { role: role("shared", "1"), score: 90 },
        { role: role("a", "1"), score: 70 },
      ])
      .mockResolvedValueOnce([{ role: role("b", "1"), score: 80 }]);

    const { tools, seen } = roleToolkit({ resumeVector: [1], competencyKind: "technical" });
    await tools[0].run({ keyword: "Data" });
    const text = await tools[0].run({ keyword: "Analyst" });

    // Only the genuinely new role reached the embedder the second time.
    expect(m.scoreRoles).toHaveBeenNthCalledWith(2, [role("b", "1")], [1]);
    // The model still sees the shared role, ranked against the new one.
    expect(text.split("\n")[0]).toContain("id=shared");
    expect([...seen.keys()].sort()).toEqual(["a", "b", "shared"]);
  });

  it("stops embedding once the run budget is spent", async () => {
    const many = (prefix: string) =>
      Array.from({ length: 30 }, (_, i) => role(`${prefix}${i}`, "1"));
    m.findRoles.mockImplementation(async ({ length } = {}) => {
      void length;
      return { roles: many(m.findRoles.mock.calls.length === 1 ? "x" : "y") };
    });
    m.scoreRoles.mockImplementation(async (roles: { id: string }[]) =>
      roles.map((r) => ({ role: r, score: 50 })),
    );

    const { tools } = roleToolkit({ resumeVector: [1], competencyKind: "technical" });
    await tools[0].run({ keyword: "One" });
    await tools[0].run({ keyword: "Two" });
    const third = await tools[0].run({ keyword: "Three" });

    const totalEmbedded = m.scoreRoles.mock.calls.reduce<number>(
      (sum, call) => sum + (call[0] as unknown[]).length,
      0,
    );
    // 40 is the run ceiling. Reaching it is not a failure — the tool says so
    // and the model answers from what it has.
    expect(totalEmbedded).toBe(40);
    expect(third).toMatch(/budget spent|id=/);
  });

  it("tells the model to retry rather than recording nothing silently", async () => {
    m.findRoles.mockResolvedValue({ roles: [] });

    const { tools, seen } = roleToolkit({ resumeVector: [1], competencyKind: "technical" });

    expect(await tools[0].run({ keyword: "Nonexistent" })).toMatch(/different keyword/);
    expect(await tools[0].run({ keyword: "ab" })).toMatch(/three characters/);
    expect(seen.size).toBe(0);
    // A too-short keyword must never reach the endpoint.
    expect(m.findRoles).toHaveBeenCalledTimes(1);
  });
});

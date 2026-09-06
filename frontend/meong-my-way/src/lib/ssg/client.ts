import "server-only";

import { getAccessToken, hasSsgCredentials, invalidateAccessToken } from "./oauth";

/**
 * The SkillsFuture (SSG-WSG) Skills Framework API.
 *
 * Seven read-only endpoints back the two agents that need ground truth about
 * the Singapore job market — the Industry Advisor and the Career Swapper.
 * Everything here is a plain GET; the interesting work is upstream, in
 * choosing which keywords to look up.
 *
 * Every response is wrapped as `{ data: ..., meta?: { total }, status }`, so
 * `request()` unwraps `data` and the callers deal in the payload alone.
 *
 * Point `SSG_API_BASE_URL` at the mock host
 * (https://mock-public-api.ssg-wsg.sg) to develop against canned data without
 * touching the live service.
 */

const DEFAULT_BASE_URL = "https://public-api.ssg-wsg.sg";

/**
 * The portal treats the version as an optional header and defaults to latest.
 * Pinning it means a future default bump cannot silently reshape a response.
 */
const API_VERSIONS = {
  default: "v1",
  /** TSC and GSC autocomplete moved to v1.1; v1 support has ended. */
  competencies: "v1.1",
} as const;

/** The portal rejects autocomplete keywords shorter than this. */
export const MIN_KEYWORD_LENGTH = 3;

export class SsgApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
  ) {
    super(message);
    this.name = "SsgApiError";
  }
}

/**
 * Raised when the API rejects a call and no credentials were configured.
 *
 * Distinct from a generic failure because it is not transient and not the
 * network's fault: the operator has to paste keys into the environment. The
 * agents catch it and say so, rather than reporting "no matches found" for
 * what is really a configuration gap.
 */
export class SsgCredentialsError extends SsgApiError {
  constructor() {
    super(
      "The Skills Framework API requires OAuth credentials. Set SSG_CLIENT_ID " +
        "and SSG_CLIENT_SECRET from https://developer.swda.gov.sg.",
      401,
      "",
    );
    this.name = "SsgCredentialsError";
  }
}

/* -------------------------------------------------------------------------
 * Response shapes
 * ---------------------------------------------------------------------- */

export type SsgJobRole = {
  id: string;
  code: string;
  title: string;
  track?: string;
  /** Normalised to numbers; the API sends these as decimal strings. */
  salary?: { minimum?: number; maximum?: number };
  sector?: { id?: string; code?: string; title?: string };
  /** Normalised to an array; the API sends a bare string. */
  descriptions?: string[];
  fieldOfStudy?: { code?: string; description?: string };
  qualification?: { code?: string; lvl1?: string; description?: string };
  alternativeTitles?: string[];
  skillsMapFileName?: string;
};

export type SsgJobRoleTitle = {
  id: string;
  /** Relevance rank from the portal's own matcher. */
  score?: number;
  /** Matched substrings arrive wrapped in <em> tags. */
  title: string;
  AlternativeTitles?: string[];
};

export type SsgSector = {
  id: string;
  code: string;
  title: string;
  subSectors?: { id: string; title: string }[];
};

export type SsgOccupation = {
  id: string;
  title: string;
};

export type SsgSkillCode = {
  code: string;
  description: string;
};

/**
 * Every response arrives as HTTP 200. The real outcome is inside the body.
 *
 * A rejected request still answers `200 OK` with `{ data: {}, error: {...},
 * status: 404 }` — so `response.ok` proves nothing, and `data` is present
 * but empty rather than absent. Reading only the transport status turns every
 * API rejection into a silent empty result, which is precisely how a bad query
 * parameter went unnoticed while both market agents reported "no matches".
 */
type Envelope<T> = {
  data?: T;
  meta?: { total?: number };
  status?: number | string;
  error?: { code?: number; message?: string };
};

/* -------------------------------------------------------------------------
 * Transport
 * ---------------------------------------------------------------------- */

function baseUrl(): string {
  return (process.env.SSG_API_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(
    /\/+$/,
    "",
  );
}

async function authHeaders(version: string): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "x-api-version": version,
  };

  const token = await getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  return headers;
}

/**
 * GET `path`, unwrap the envelope, and return `data`.
 *
 * A 401 on a token we believed was good means the cached token died early, so
 * it is dropped and the call retried once. Every other failure surfaces.
 */
async function request<T>(
  path: string,
  params: Record<string, string | number | undefined>,
  version: string = API_VERSIONS.default,
  retryOnAuthFailure = true,
): Promise<T> {
  const url = new URL(`${baseUrl()}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }

  let response: Response;
  try {
    response = await fetch(url, {
      headers: await authHeaders(version),
      // Reference data, and the same keywords recur across users — an hour of
      // caching removes most of the traffic without going stale in any way a
      // user would notice.
      next: { revalidate: 3600 },
    });
  } catch (error) {
    throw new SsgApiError(
      `Could not reach the Skills Framework API: ${String(error)}`,
      0,
      path,
    );
  }

  if (response.status === 401) {
    // The portal documents these endpoints as "Authentication: Open", but they
    // answer 401 "Authorization field missing" without a bearer token. Treat a
    // missing credential as the diagnosis rather than retrying into the same
    // wall — this is the difference between "your keys are not set" and "your
    // keys were rejected", and the two need different fixes.
    if (!hasSsgCredentials()) {
      throw new SsgCredentialsError();
    }

    if (retryOnAuthFailure) {
      invalidateAccessToken();
      return request<T>(path, params, version, false);
    }
  }

  if (!response.ok) {
    throw new SsgApiError(
      `Skills Framework API returned HTTP ${response.status}.`,
      response.status,
      path,
    );
  }

  const payload = (await response.json()) as Envelope<T>;

  // The envelope's own status is the authoritative one — see `Envelope`.
  const innerStatus = Number(payload.status);
  if (Number.isFinite(innerStatus) && innerStatus >= 400) {
    throw new SsgApiError(
      `Skills Framework API rejected the request (${innerStatus}${
        payload.error?.message ? `: ${payload.error.message}` : ""
      }).`,
      innerStatus,
      path,
    );
  }

  if (payload.data === undefined) {
    throw new SsgApiError("Skills Framework API returned no data.", 200, path);
  }

  return payload.data;
}

/* -------------------------------------------------------------------------
 * The seven endpoints
 * ---------------------------------------------------------------------- */

export type JobRoleSearch = {
  /**
   * A SINGLE word. The endpoint answers `status: 500` for any keyword
   * containing a space — see `searchJobRoles`.
   */
  keyword?: string;
  /**
   * A sector's numeric `id` from `listSectors`, comma-delimited for several.
   * Not its `code`: `sector=ACC` is accepted and matches nothing, while
   * `sector=15614` returns the 25 Accountancy roles.
   */
  sector?: string;
  qualification?: string;
  fieldOfStudy?: string;
  track?: string;
  minSalary?: number;
  maxSalary?: number;
  page?: number;
  pageSize?: number;
};

/**
 * The API returns `salary: { minimum: "3796.0", maximum: "5062.0" }` — decimal
 * strings, or `null` where the framework publishes no band. Anything downstream
 * does arithmetic and currency formatting on these, and `"3796.0"` is truthy,
 * so an unconverted string reaches the UI looking like a number and formats as
 * garbage.
 */
function toAmount(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : undefined;
}

/**
 * Bring one role into the shape the rest of the app declares.
 *
 * `descriptions` is documented as a list but sent as a single string. The
 * matcher calls `.join(" ")` on it, which throws `descriptions.join is not a
 * function` — inside a `Promise.allSettled`, so every role is silently dropped
 * and the agent sees an empty candidate set rather than an error.
 */
type RawJobRole = Omit<SsgJobRole, "descriptions" | "alternativeTitles" | "salary"> & {
  descriptions?: unknown;
  alternativeTitles?: unknown;
  salary?: { minimum?: unknown; maximum?: unknown } | null;
};

function normaliseJobRole(raw: RawJobRole): SsgJobRole {
  const { descriptions } = raw;

  const salary = raw.salary
    ? { minimum: toAmount(raw.salary.minimum), maximum: toAmount(raw.salary.maximum) }
    : undefined;

  return {
    ...raw,
    descriptions: Array.isArray(descriptions)
      ? descriptions.filter((part): part is string => typeof part === "string")
      : typeof descriptions === "string" && descriptions.trim()
        ? [descriptions]
        : undefined,
    alternativeTitles: Array.isArray(raw.alternativeTitles)
      ? raw.alternativeTitles
      : undefined,
    salary: salary?.minimum || salary?.maximum ? salary : undefined,
  };
}

/**
 * Search job roles. The workhorse for both market-facing agents — it is the
 * only endpoint that filters by free-text keyword *and* returns salary,
 * sector, and qualification in one response.
 *
 * Two hard constraints, both established against the live host and neither
 * documented:
 *
 * 1. `sortDirection` must not be sent. Any value — even the `asc` the API
 *    reports as its own default in the `request` echo — makes it answer
 *    `status: 404, "Not Found"`. `sortby` is accepted but inert: the results
 *    are title-ascending whatever is passed. Re-ranking therefore has to
 *    happen on our side, which the resume embedding already does better than
 *    a keyword score would.
 * 2. `keyword` must be one word. A keyword containing a space answers
 *    `status: 500`, so "Data Analyst" returns nothing while "Analyst"
 *    returns 33 roles including Data Analyst. Callers pass single tokens;
 *    `role-matching.ts` splits phrases before it gets here.
 *
 * Both failures arrive as HTTP 200, which is why `request` inspects the
 * envelope's own status.
 */
export async function searchJobRoles(
  search: JobRoleSearch,
): Promise<{ jobRoles: SsgJobRole[]; total: number }> {
  const data = await request<{ jobRoles?: SsgJobRole[] }>(
    "/skillsFramework/jobRoles",
    {
      keyword: search.keyword,
      sector: search.sector,
      qualification: search.qualification,
      fieldOfStudy: search.fieldOfStudy,
      track: search.track,
      minSalary: search.minSalary,
      maxSalary: search.maxSalary,
      page: search.page ?? 0,
      // 20 is the practical ceiling: the endpoint returns 20 rows for
      // pageSize=20 but drops back to 8 for 50 or 100.
      pageSize: Math.min(search.pageSize ?? 20, 20),
    },
  );

  const jobRoles = (data.jobRoles ?? []).map(normaliseJobRole);
  return { jobRoles, total: jobRoles.length };
}

/**
 * Job role titles.
 *
 * NOT a keyword search, despite the parameter: the endpoint returns the same
 * ~1,457 titles whatever is passed, including for a keyword that matches
 * nothing. Verified against the live host — "Nurse", "Chef" and "zzzzqqq" all
 * return an identical list headed by "Engineer".
 *
 * Unused for that reason. Anything needing keyword filtering wants
 * `searchJobRoles`, which does honour it. Kept only because it is the one
 * endpoint that enumerates the whole taxonomy cheaply.
 */
export async function suggestJobRoleTitles(
  keyword: string,
): Promise<SsgJobRoleTitle[]> {
  if (keyword.trim().length < MIN_KEYWORD_LENGTH) return [];

  const data = await request<{ jobRoles?: SsgJobRoleTitle[] }>(
    "/skillsFramework/jobRoles/titles",
    { keyword: keyword.trim() },
  );

  return data.jobRoles ?? [];
}

/**
 * The sector taxonomy. Passing "0" for both IDs returns everything, which is
 * how the pipeline seeds the sector list it maps a resume onto.
 */
export async function listSectors(
  sectorId = "0",
  subSectorId = "0",
): Promise<SsgSector[]> {
  const data = await request<{ sectors?: SsgSector[] }>(
    `/skillsFramework/sectors/${encodeURIComponent(sectorId)}/subSectors/${encodeURIComponent(subSectorId)}`,
    {},
  );

  return data.sectors ?? [];
}

/** Occupations within one sector. */
export async function listOccupations(sectorId: string): Promise<SsgOccupation[]> {
  const data = await request<{ occupations?: SsgOccupation[] }>(
    "/skillsFramework/occupations",
    { sectorId },
  );

  return data.occupations ?? [];
}

/** The job roles that make up one occupation. */
export async function listJobRolesForOccupation(
  occupationId: string,
): Promise<{ occupation: SsgOccupation | null; jobRoles: SsgJobRole[] }> {
  const data = await request<{
    occupation?: SsgOccupation & { jobRoles?: SsgJobRole[] };
  }>(`/skillsFramework/${encodeURIComponent(occupationId)}/jobRoles`, {});

  const occupation = data.occupation ?? null;
  return {
    occupation: occupation ? { id: occupation.id, title: occupation.title } : null,
    jobRoles: occupation?.jobRoles ?? [],
  };
}

/** Technical Skills & Competencies matching a keyword. */
export async function autocompleteTechnicalSkills(
  keyword: string,
): Promise<SsgSkillCode[]> {
  if (keyword.trim().length < MIN_KEYWORD_LENGTH) return [];

  const data = await request<{ codes?: SsgSkillCode[] }>(
    "/skillsFramework/codes/skillsAndCompetencies/technical/autocomplete",
    { keyword: keyword.trim() },
    API_VERSIONS.competencies,
  );

  return data.codes ?? [];
}

/** Generic (transferable) Skills & Competencies matching a keyword. */
export async function autocompleteGenericSkills(
  keyword: string,
): Promise<SsgSkillCode[]> {
  if (keyword.trim().length < MIN_KEYWORD_LENGTH) return [];

  const data = await request<{ codes?: SsgSkillCode[] }>(
    "/skillsFramework/codes/skillsAndCompetencies/generic/autocomplete",
    { keyword: keyword.trim() },
    API_VERSIONS.competencies,
  );

  return data.codes ?? [];
}

/* -------------------------------------------------------------------------
 * Helpers the agents share
 * ---------------------------------------------------------------------- */

/** Autocomplete wraps matched substrings in <em>; models should not see tags. */
export function stripHighlight(title: string): string {
  return title.replace(/<\/?em>/g, "");
}

/**
 * Run several lookups and keep whatever came back.
 *
 * The market APIs are a best-effort input to reasoning, not a dependency: if
 * two of six keyword lookups fail, the agent should still get the other four
 * rather than the whole run failing. Rejections are swallowed by design.
 */
export async function gatherSettled<T>(
  tasks: Promise<T[]>[],
): Promise<{ results: T[]; failures: number }> {
  const settled = await Promise.allSettled(tasks);

  const results: T[] = [];
  let failures = 0;

  for (const outcome of settled) {
    if (outcome.status === "fulfilled") results.push(...outcome.value);
    else failures += 1;
  }

  return { results, failures };
}

/** De-duplicate job roles by ID, preserving the order they arrived in. */
export function dedupeJobRoles(roles: SsgJobRole[]): SsgJobRole[] {
  const seen = new Set<string>();
  return roles.filter((role) => {
    const key = role.id || role.code || role.title;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

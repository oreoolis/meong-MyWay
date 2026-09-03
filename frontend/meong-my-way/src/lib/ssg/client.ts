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
  salary?: { minimum?: number; maximum?: number };
  sector?: { id?: string; code?: string; title?: string };
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

type Envelope<T> = { data?: T; meta?: { total?: number }; status?: string };

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
  if (payload.data === undefined) {
    throw new SsgApiError("Skills Framework API returned no data.", 200, path);
  }

  return payload.data;
}

/* -------------------------------------------------------------------------
 * The seven endpoints
 * ---------------------------------------------------------------------- */

export type JobRoleSearch = {
  keyword?: string;
  /** Sector IDs, comma-delimited by the API's own convention. */
  sector?: string;
  qualification?: string;
  fieldOfStudy?: string;
  track?: string;
  minSalary?: number;
  maxSalary?: number;
  sortby?: "title" | "score";
  sortDirection?: "asc" | "desc";
  page?: number;
  pageSize?: number;
};

/**
 * Search job roles. The workhorse for both market-facing agents — it is the
 * only endpoint that filters by free-text keyword *and* returns salary,
 * sector, and qualification in one response.
 */
export async function searchJobRoles(
  search: JobRoleSearch,
): Promise<{ jobRoles: SsgJobRole[] }> {
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
      // Ranking by relevance rather than the API's alphabetical default —
      // the agents want the best matches, not the ones starting with "A".
      sortby: search.sortby ?? "score",
      sortDirection: search.sortDirection ?? "desc",
      page: search.page ?? 0,
      pageSize: search.pageSize ?? 20,
    },
  );

  return { jobRoles: data.jobRoles ?? [] };
}

/** Up to five title matches for a keyword. Cheap way to test a term lands. */
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

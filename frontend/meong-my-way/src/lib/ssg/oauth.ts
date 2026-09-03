import "server-only";

/**
 * OAuth 2.0 client-credentials against the SkillsFuture (SSG-WSG) developer
 * portal.
 *
 * Per the portal's Credentials guide, a token is obtained by POSTing
 * `grant_type=client_credentials` to the token endpoint with the client ID and
 * secret as HTTP Basic auth, and is then presented as a bearer token on each
 * API call.
 *
 * The portal labels the seven Skills Framework endpoints this app uses as
 * "Authentication: Open". That label is wrong in practice — calling any of
 * them without a bearer token returns 401 "Authorization field missing"
 * (verified against the live host). Credentials are therefore REQUIRED for the
 * Industry Advisor and Career Swapper to produce anything.
 *
 * The app still starts and runs without them: the parser, planner, and
 * improver have no framework dependency, so an unconfigured deployment
 * degrades to three working agents rather than a crash. The two that do depend
 * on it say why they are empty instead of reporting "no matches found".
 */

const TOKEN_URL = "https://public-api.ssg-wsg.sg/dp-oauth/oauth/token";

/**
 * Refresh this far before the token actually lapses, so a request that is
 * in flight when the clock runs out does not fail on a stale token.
 */
const EXPIRY_MARGIN_MS = 60_000;

/** Fallback lifetime when the response omits `expires_in`. */
const DEFAULT_TTL_SECONDS = 1800;

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
};

type CachedToken = {
  value: string;
  /** Epoch ms after which this token must not be reused. */
  expiresAt: number;
};

export class SsgAuthError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "SsgAuthError";
  }
}

/**
 * Cached across requests in the module scope. A token is good for the whole
 * process, so fetching one per API call would add a round trip to every
 * lookup for no benefit.
 */
let cached: CachedToken | undefined;

/**
 * Shared in-flight promise, so a burst of concurrent agent calls on a cold
 * cache mints one token rather than five.
 */
let inFlight: Promise<string> | undefined;

export function getSsgCredentials() {
  const clientId = process.env.SSG_CLIENT_ID?.trim();
  const clientSecret = process.env.SSG_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/** Whether the portal credentials are present. */
export function hasSsgCredentials(): boolean {
  return getSsgCredentials() !== null;
}

async function requestToken(clientId: string, clientSecret: string): Promise<string> {
  // Basic auth, per the guide: base64(Client_ID:Secret).
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "client_credentials" }),
      // A token this app holds for 30 minutes must never be served from an
      // HTTP cache layer.
      cache: "no-store",
    });
  } catch (error) {
    throw new SsgAuthError("Could not reach the SkillsFuture token endpoint.", error);
  }

  if (!response.ok) {
    // The body may carry the reason (bad client, inactive app), but it may
    // also echo the credentials — log the status only.
    throw new SsgAuthError(
      `SkillsFuture rejected the credentials (HTTP ${response.status}).`,
    );
  }

  let payload: TokenResponse;
  try {
    payload = (await response.json()) as TokenResponse;
  } catch (error) {
    throw new SsgAuthError("SkillsFuture returned a malformed token response.", error);
  }

  if (!payload.access_token) {
    throw new SsgAuthError("SkillsFuture returned no access token.");
  }

  const ttlSeconds = payload.expires_in ?? DEFAULT_TTL_SECONDS;
  cached = {
    value: payload.access_token,
    expiresAt: Date.now() + ttlSeconds * 1000 - EXPIRY_MARGIN_MS,
  };

  return payload.access_token;
}

/**
 * A usable access token, or `null` when no credentials are configured.
 *
 * Returning `null` rather than throwing keeps the decision with the caller:
 * `client.ts` sends the request anyway and converts the resulting 401 into a
 * `SsgCredentialsError`, which names the missing variables. Throwing here
 * would report a configuration problem before establishing there is one.
 */
export async function getAccessToken(): Promise<string | null> {
  const credentials = getSsgCredentials();
  if (!credentials) return null;

  if (cached && Date.now() < cached.expiresAt) return cached.value;
  if (inFlight) return inFlight;

  inFlight = requestToken(credentials.clientId, credentials.clientSecret).finally(
    () => {
      inFlight = undefined;
    },
  );

  return inFlight;
}

/** Drop the cached token. Used when the API answers 401 on a token we trusted. */
export function invalidateAccessToken(): void {
  cached = undefined;
}

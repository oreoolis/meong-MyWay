import "server-only";

import {
  CognitoServerConfigurationError,
  verifyCognitoSession,
} from "./server";

/**
 * Cognito auth for route handlers.
 *
 * Wraps `verifyCognitoSession` in the header convention already used by
 * `/api/auth/session`: a bearer access token plus the ID token in
 * `X-Cognito-Id-Token`. Handlers get either the caller's identity or a ready
 * -to-return error response, so no route re-implements the checks.
 */

export type AuthenticatedCaller = {
  userId: string;
  email: string;
  displayName: string;
};

export type AuthOutcome =
  | { ok: true; caller: AuthenticatedCaller }
  | { ok: false; response: Response };

function json(body: object, status: number) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function authenticateRequest(
  request: Request,
): Promise<AuthOutcome> {
  const authorization = request.headers.get("authorization");
  const idToken = request.headers.get("x-cognito-id-token");

  if (!authorization?.startsWith("Bearer ") || !idToken) {
    return { ok: false, response: json({ error: "Unauthorized" }, 401) };
  }

  const accessToken = authorization.slice("Bearer ".length).trim();
  if (!accessToken) {
    return { ok: false, response: json({ error: "Unauthorized" }, 401) };
  }

  try {
    const caller = await verifyCognitoSession(accessToken, idToken);
    return { ok: true, caller };
  } catch (error) {
    if (error instanceof CognitoServerConfigurationError) {
      return {
        ok: false,
        response: json({ error: "Authentication is not configured" }, 503),
      };
    }
    // Never leak verifier internals or token contents to the client.
    return { ok: false, response: json({ error: "Unauthorized" }, 401) };
  }
}

export { json as authJson };

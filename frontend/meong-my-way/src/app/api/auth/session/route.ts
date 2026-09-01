import {
  CognitoServerConfigurationError,
  verifyCognitoSession,
} from "@/lib/auth/server";

export const runtime = "nodejs";

function json(body: object, status: number) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  const idToken = request.headers.get("x-cognito-id-token");

  if (!authorization?.startsWith("Bearer ") || !idToken) {
    return json({ error: "Unauthorized" }, 401);
  }

  const accessToken = authorization.slice("Bearer ".length).trim();
  if (!accessToken) {
    return json({ error: "Unauthorized" }, 401);
  }

  try {
    return json(await verifyCognitoSession(accessToken, idToken), 200);
  } catch (error) {
    if (error instanceof CognitoServerConfigurationError) {
      return json({ error: "Authentication is not configured" }, 503);
    }

    // Do not return verifier details or token contents to the client.
    return json({ error: "Unauthorized" }, 401);
  }
}

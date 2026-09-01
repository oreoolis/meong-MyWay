import "server-only";

import { CognitoJwtVerifier } from "aws-jwt-verify";

export class CognitoServerConfigurationError extends Error {
  constructor() {
    super("Cognito server configuration is missing.");
    this.name = "CognitoServerConfigurationError";
  }
}

type Verifier = ReturnType<typeof CognitoJwtVerifier.create>;

let accessTokenVerifier: Verifier | undefined;
let idTokenVerifier: Verifier | undefined;

function getCognitoConfig() {
  const userPoolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID?.trim();
  const clientId =
    process.env.NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID?.trim();

  if (!userPoolId || !clientId) {
    throw new CognitoServerConfigurationError();
  }

  return { userPoolId, clientId };
}

function getVerifiers() {
  const { userPoolId, clientId } = getCognitoConfig();

  accessTokenVerifier ??= CognitoJwtVerifier.create({
    userPoolId,
    clientId,
    tokenUse: "access",
  });
  idTokenVerifier ??= CognitoJwtVerifier.create({
    userPoolId,
    clientId,
    tokenUse: "id",
  });

  return { accessTokenVerifier, idTokenVerifier };
}

export async function verifyCognitoSession(
  accessToken: string,
  idToken: string,
) {
  const verifiers = getVerifiers();
  const [accessPayload, idPayload] = await Promise.all([
    verifiers.accessTokenVerifier.verify(accessToken),
    verifiers.idTokenVerifier.verify(idToken),
  ]);

  if (!accessPayload.sub || accessPayload.sub !== idPayload.sub) {
    throw new Error("The Cognito access and ID tokens do not identify the same user.");
  }

  if (typeof idPayload.email !== "string" || idPayload.email_verified !== true) {
    throw new Error("The Cognito ID token does not contain a verified email.");
  }

  const displayName =
    typeof idPayload.name === "string" && idPayload.name.trim()
      ? idPayload.name.trim()
      : idPayload.email.split("@")[0];

  return {
    userId: accessPayload.sub,
    email: idPayload.email,
    displayName,
  };
}

"use client";

import { Amplify } from "aws-amplify";
import {
  confirmSignIn,
  confirmSignUp,
  fetchAuthSession,
  resendSignUpCode,
  signIn,
  signOut,
  signUp,
  type SignInOutput,
} from "aws-amplify/auth";
import { cognitoUserPoolsTokenProvider } from "aws-amplify/auth/cognito";
import { CookieStorage } from "aws-amplify/utils";

export type AuthenticatedUser = {
  userId: string;
  email: string;
  displayName: string;
};

export type SignInChallenge =
  | { type: "totp-code" }
  | { type: "email-code"; destination?: string }
  | { type: "sms-code"; destination?: string }
  | { type: "totp-setup"; sharedSecret: string; setupUri: string }
  | { type: "new-password" };

export type SignInResult =
  | { status: "authenticated"; user: AuthenticatedUser }
  | { status: "confirm-sign-up" }
  | { status: "challenge"; challenge: SignInChallenge };

export class AuthConfigurationError extends Error {
  constructor() {
    super(
      "Cognito is not configured yet. Add the user pool ID and public app client ID to .env.local.",
    );
    this.name = "AuthConfigurationError";
  }
}

export class UnsupportedAuthStepError extends Error {
  constructor(step: string) {
    super(`This Cognito sign-in step is not supported yet: ${step}.`);
    this.name = "UnsupportedAuthStepError";
  }
}

let configured = false;

function getPublicCognitoConfig() {
  const userPoolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID?.trim();
  const userPoolClientId =
    process.env.NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID?.trim();

  if (!userPoolId || !userPoolClientId) {
    throw new AuthConfigurationError();
  }

  return { userPoolId, userPoolClientId };
}

function configureAuth() {
  if (configured) return;

  const { userPoolId, userPoolClientId } = getPublicCognitoConfig();

  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId,
        userPoolClientId,
        loginWith: { email: true },
        signUpVerificationMethod: "code",
      },
    },
  });

  // Amplify must be able to read its own tokens, so these cookies cannot be
  // HttpOnly. SameSite=Strict limits cross-site sending; production uses HTTPS.
  cognitoUserPoolsTokenProvider.setKeyValueStorage(
    new CookieStorage({
      path: "/",
      sameSite: "strict",
      secure: window.location.protocol === "https:",
    }),
  );

  configured = true;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

async function createBackendSession(): Promise<AuthenticatedUser> {
  const { tokens } = await fetchAuthSession();
  const accessToken = tokens?.accessToken?.toString();
  const idToken = tokens?.idToken?.toString();

  if (!accessToken || !idToken) {
    throw new Error("Cognito did not return a complete authenticated session.");
  }

  const response = await fetch("/api/auth/session", {
    method: "POST",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-Cognito-Id-Token": idToken,
    },
  });

  if (!response.ok) {
    throw new Error(
      response.status === 503
        ? "The authentication backend is not configured yet."
        : "The authentication backend rejected the Cognito session.",
    );
  }

  return (await response.json()) as AuthenticatedUser;
}

async function handleSignInOutput(
  output: SignInOutput,
): Promise<SignInResult> {
  if (output.isSignedIn && output.nextStep.signInStep === "DONE") {
    return { status: "authenticated", user: await createBackendSession() };
  }

  switch (output.nextStep.signInStep) {
    case "CONFIRM_SIGN_UP":
      return { status: "confirm-sign-up" };
    case "CONFIRM_SIGN_IN_WITH_TOTP_CODE":
      return { status: "challenge", challenge: { type: "totp-code" } };
    case "CONFIRM_SIGN_IN_WITH_EMAIL_CODE":
      return {
        status: "challenge",
        challenge: {
          type: "email-code",
          destination: output.nextStep.codeDeliveryDetails?.destination,
        },
      };
    case "CONFIRM_SIGN_IN_WITH_SMS_CODE":
      return {
        status: "challenge",
        challenge: {
          type: "sms-code",
          destination: output.nextStep.codeDeliveryDetails?.destination,
        },
      };
    case "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED":
      return { status: "challenge", challenge: { type: "new-password" } };
    case "CONTINUE_SIGN_IN_WITH_TOTP_SETUP":
      return {
        status: "challenge",
        challenge: {
          type: "totp-setup",
          sharedSecret: output.nextStep.totpSetupDetails.sharedSecret,
          setupUri: output.nextStep.totpSetupDetails
            .getSetupUri("MyWay")
            .toString(),
        },
      };
    case "CONTINUE_SIGN_IN_WITH_MFA_SELECTION":
    case "CONTINUE_SIGN_IN_WITH_MFA_SETUP_SELECTION": {
      if (!output.nextStep.allowedMFATypes?.includes("TOTP")) {
        throw new UnsupportedAuthStepError(output.nextStep.signInStep);
      }
      return handleSignInOutput(
        await confirmSignIn({ challengeResponse: "TOTP" }),
      );
    }
    default:
      throw new UnsupportedAuthStepError(output.nextStep.signInStep);
  }
}

export async function registerWithEmail(email: string, password: string) {
  configureAuth();
  const username = normalizeEmail(email);
  const output = await signUp({
    username,
    password,
    options: {
      autoSignIn: false,
      userAttributes: { email: username },
    },
  });

  return {
    requiresConfirmation: output.nextStep.signUpStep === "CONFIRM_SIGN_UP",
    destination:
      output.nextStep.signUpStep === "CONFIRM_SIGN_UP"
        ? output.nextStep.codeDeliveryDetails.destination
        : undefined,
  };
}

export async function confirmEmailRegistration(email: string, code: string) {
  configureAuth();
  const output = await confirmSignUp({
    username: normalizeEmail(email),
    confirmationCode: code.trim(),
  });

  if (output.nextStep.signUpStep !== "DONE") {
    throw new UnsupportedAuthStepError(output.nextStep.signUpStep);
  }
}

export async function resendEmailRegistrationCode(email: string) {
  configureAuth();
  return resendSignUpCode({ username: normalizeEmail(email) });
}

export async function signInWithEmail(
  email: string,
  password: string,
): Promise<SignInResult> {
  configureAuth();
  const output = await signIn({
    username: normalizeEmail(email),
    password,
    options: { authFlowType: "USER_SRP_AUTH" },
  });
  return handleSignInOutput(output);
}

export async function answerSignInChallenge(
  response: string,
): Promise<SignInResult> {
  configureAuth();
  return handleSignInOutput(
    await confirmSignIn({ challengeResponse: response.trim() }),
  );
}

export async function restoreAuthenticatedUser() {
  try {
    configureAuth();
    return await createBackendSession();
  } catch {
    return null;
  }
}

export async function signOutCurrentUser() {
  configureAuth();
  await signOut();
}

export function getAuthErrorMessage(error: unknown) {
  if (error instanceof AuthConfigurationError) return error.message;
  if (error instanceof UnsupportedAuthStepError) return error.message;

  const name =
    typeof error === "object" && error && "name" in error
      ? String(error.name)
      : "";

  switch (name) {
    case "UsernameExistsException":
      return "An account already exists for this email. Sign in instead.";
    case "UserNotFoundException":
    case "NotAuthorizedException":
      return "The email or password is incorrect.";
    case "UserNotConfirmedException":
      return "Confirm your email before signing in.";
    case "CodeMismatchException":
      return "The confirmation code is incorrect.";
    case "ExpiredCodeException":
      return "That confirmation code has expired. Request a new code.";
    case "InvalidPasswordException":
      return "The password does not meet the Cognito password policy.";
    case "LimitExceededException":
    case "TooManyRequestsException":
      return "Too many attempts. Wait a moment and try again.";
    case "PasswordResetRequiredException":
      return "This account requires a password reset before signing in.";
    default:
      return error instanceof Error
        ? error.message
        : "Authentication failed. Please try again.";
  }
}

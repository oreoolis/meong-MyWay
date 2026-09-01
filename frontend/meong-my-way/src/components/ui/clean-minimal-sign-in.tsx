"use client";

import { useState } from "react";
import { KeyRound, LogIn, Lock, Mail } from "lucide-react";

import {
  answerSignInChallenge,
  confirmEmailRegistration,
  getAuthErrorMessage,
  registerWithEmail,
  resendEmailRegistrationCode,
  signInWithEmail,
  type AuthenticatedUser,
  type SignInChallenge,
  type SignInResult,
} from "@/lib/auth/client";

type AuthMode = "sign-in" | "register" | "confirm-sign-up" | "challenge";

function validateEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePassword(password: string) {
  return (
    password.length >= 12 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}

function challengeCopy(challenge: SignInChallenge | null) {
  switch (challenge?.type) {
    case "totp-code":
      return "Enter the code from your authenticator app.";
    case "email-code":
      return `Enter the sign-in code sent to ${challenge.destination ?? "your email"}.`;
    case "sms-code":
      return `Enter the sign-in code sent to ${challenge.destination ?? "your phone"}.`;
    case "totp-setup":
      return "Add MyWay to your authenticator app, then enter its six-digit code.";
    case "new-password":
      return "Choose a new password to finish signing in.";
    default:
      return "Complete the additional sign-in step.";
  }
}

export function SignIn2({
  onSignIn,
}: {
  onSignIn: (user: AuthenticatedUser) => void;
}) {
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [confirmationCode, setConfirmationCode] = useState("");
  const [challenge, setChallenge] = useState<SignInChallenge | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);

  function resetFeedback() {
    setError("");
    setNotice("");
  }

  function switchMode(nextMode: "sign-in" | "register") {
    setMode(nextMode);
    setPassword("");
    setConfirmPassword("");
    setConfirmationCode("");
    setChallenge(null);
    resetFeedback();
  }

  function applySignInResult(result: SignInResult) {
    if (result.status === "authenticated") {
      onSignIn(result.user);
      return;
    }

    if (result.status === "confirm-sign-up") {
      setMode("confirm-sign-up");
      setNotice("Confirm your email before signing in.");
      return;
    }

    setChallenge(result.challenge);
    setConfirmationCode("");
    setMode("challenge");
    setNotice(challengeCopy(result.challenge));
  }

  async function handleSubmit() {
    resetFeedback();

    if (mode === "confirm-sign-up") {
      if (!confirmationCode.trim()) {
        setError("Enter the confirmation code from your email.");
        return;
      }

      setPending(true);
      try {
        await confirmEmailRegistration(email, confirmationCode);
        setMode("sign-in");
        setConfirmationCode("");
        setPassword("");
        setNotice("Email confirmed. You can now sign in.");
      } catch (authError) {
        setError(getAuthErrorMessage(authError));
      } finally {
        setPending(false);
      }
      return;
    }

    if (mode === "challenge") {
      if (!confirmationCode.trim()) {
        setError(
          challenge?.type === "new-password"
            ? "Enter your new password."
            : "Enter the requested sign-in code.",
        );
        return;
      }
      if (
        challenge?.type === "new-password" &&
        !validatePassword(confirmationCode)
      ) {
        setError(
          "Use at least 12 characters with uppercase, lowercase, a number, and a symbol.",
        );
        return;
      }

      setPending(true);
      try {
        applySignInResult(await answerSignInChallenge(confirmationCode));
      } catch (authError) {
        setError(getAuthErrorMessage(authError));
      } finally {
        setPending(false);
      }
      return;
    }

    if (!email || !password) {
      setError("Please enter both email and password.");
      return;
    }
    if (!validateEmail(email)) {
      setError("Please enter a valid email address.");
      return;
    }

    if (mode === "register") {
      if (!validatePassword(password)) {
        setError(
          "Use at least 12 characters with uppercase, lowercase, a number, and a symbol.",
        );
        return;
      }
      if (password !== confirmPassword) {
        setError("The passwords do not match.");
        return;
      }

      setPending(true);
      try {
        const result = await registerWithEmail(email, password);
        if (result.requiresConfirmation) {
          setMode("confirm-sign-up");
          setConfirmationCode("");
          setNotice(
            `Enter the confirmation code sent to ${result.destination ?? email}.`,
          );
        } else {
          setMode("sign-in");
          setPassword("");
          setConfirmPassword("");
          setNotice("Account created. You can now sign in.");
        }
      } catch (authError) {
        setError(getAuthErrorMessage(authError));
      } finally {
        setPending(false);
      }
      return;
    }

    setPending(true);
    try {
      applySignInResult(await signInWithEmail(email, password));
    } catch (authError) {
      setError(getAuthErrorMessage(authError));
    } finally {
      setPending(false);
    }
  }

  async function handleResendCode() {
    resetFeedback();
    setPending(true);
    try {
      const delivery = await resendEmailRegistrationCode(email);
      setNotice(
        `A new code was sent to ${delivery.destination ?? "your email"}.`,
      );
    } catch (authError) {
      setError(getAuthErrorMessage(authError));
    } finally {
      setPending(false);
    }
  }

  const title =
    mode === "register"
      ? "Create your account"
      : mode === "confirm-sign-up"
        ? "Confirm your email"
        : mode === "challenge"
          ? "Complete sign in"
          : "Sign in with email";

  const submitLabel =
    mode === "register"
      ? "Create account"
      : mode === "confirm-sign-up"
        ? "Confirm email"
        : mode === "challenge"
          ? "Continue"
          : "Get Started";

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-white rounded-xl z-1 px-4 py-12">
      <div className="w-full max-w-sm bg-gradient-to-b from-sky-50/50 to-white rounded-3xl shadow-xl shadow-opacity-10 p-8 flex flex-col items-center border border-blue-100 text-black">
        <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-white mb-6 shadow-lg shadow-opacity-5">
          {mode === "confirm-sign-up" || mode === "challenge" ? (
            <KeyRound className="w-7 h-7 text-black" />
          ) : (
            <LogIn className="w-7 h-7 text-black" />
          )}
        </div>

        {(mode === "sign-in" || mode === "register") && (
          <div
            className="mb-5 grid w-full grid-cols-2 rounded-xl bg-gray-100 p-1 text-sm"
            aria-label="Authentication mode"
          >
            <button
              type="button"
              aria-pressed={mode === "sign-in"}
              onClick={() => switchMode("sign-in")}
              className={`rounded-lg px-3 py-2 font-medium transition ${
                mode === "sign-in" ? "bg-white shadow-sm" : "text-gray-500"
              }`}
            >
              Sign in
            </button>
            <button
              type="button"
              aria-pressed={mode === "register"}
              onClick={() => switchMode("register")}
              className={`rounded-lg px-3 py-2 font-medium transition ${
                mode === "register" ? "bg-white shadow-sm" : "text-gray-500"
              }`}
            >
              Register
            </button>
          </div>
        )}

        <h2 className="text-2xl font-semibold mb-2 text-center">{title}</h2>
        <p className="text-gray-500 text-sm mb-6 text-center">
          {mode === "confirm-sign-up"
            ? `We sent a verification code to ${email}.`
            : mode === "challenge"
              ? challengeCopy(challenge)
              : "Upload your resume and let MyWay map your next career move."}
        </p>

        <form
          className="w-full flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          {(mode === "sign-in" || mode === "register") && (
            <>
              <label className="relative">
                <span className="sr-only">Email</span>
                <Mail className="absolute left-3 top-1/2 w-4 h-4 -translate-y-1/2 text-gray-400" />
                <input
                  placeholder="Email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={email}
                  disabled={pending}
                  className="w-full pl-10 pr-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-200 bg-gray-50 text-black text-sm disabled:opacity-60"
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <label className="relative">
                <span className="sr-only">Password</span>
                <Lock className="absolute left-3 top-1/2 w-4 h-4 -translate-y-1/2 text-gray-400" />
                <input
                  placeholder="Password"
                  type="password"
                  autoComplete={
                    mode === "register" ? "new-password" : "current-password"
                  }
                  value={password}
                  disabled={pending}
                  className="w-full pl-10 pr-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-200 bg-gray-50 text-black text-sm disabled:opacity-60"
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              {mode === "register" && (
                <>
                  <label className="relative">
                    <span className="sr-only">Confirm password</span>
                    <Lock className="absolute left-3 top-1/2 w-4 h-4 -translate-y-1/2 text-gray-400" />
                    <input
                      placeholder="Confirm password"
                      type="password"
                      autoComplete="new-password"
                      value={confirmPassword}
                      disabled={pending}
                      className="w-full pl-10 pr-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-200 bg-gray-50 text-black text-sm disabled:opacity-60"
                      onChange={(event) =>
                        setConfirmPassword(event.target.value)
                      }
                    />
                  </label>
                  <p className="text-left text-xs leading-5 text-gray-500">
                    At least 12 characters with uppercase, lowercase, a number,
                    and a symbol.
                  </p>
                </>
              )}
            </>
          )}

          {(mode === "confirm-sign-up" || mode === "challenge") && (
            <>
              {challenge?.type === "totp-setup" && (
                <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-gray-700">
                  <p className="mb-1 font-medium">Authenticator setup key</p>
                  <code className="break-all select-all">
                    {challenge.sharedSecret}
                  </code>
                  <span className="sr-only">{challenge.setupUri}</span>
                </div>
              )}
              <label className="relative">
                <span className="sr-only">
                  {challenge?.type === "new-password"
                    ? "New password"
                    : "Confirmation code"}
                </span>
                <KeyRound className="absolute left-3 top-1/2 w-4 h-4 -translate-y-1/2 text-gray-400" />
                <input
                  placeholder={
                    challenge?.type === "new-password"
                      ? "New password"
                      : "Confirmation code"
                  }
                  type={
                    challenge?.type === "new-password" ? "password" : "text"
                  }
                  inputMode={
                    challenge?.type === "new-password" ? "text" : "numeric"
                  }
                  autoComplete={
                    challenge?.type === "new-password"
                      ? "new-password"
                      : "one-time-code"
                  }
                  value={confirmationCode}
                  disabled={pending}
                  className="w-full pl-10 pr-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-200 bg-gray-50 text-black text-sm disabled:opacity-60"
                  onChange={(event) =>
                    setConfirmationCode(event.target.value)
                  }
                />
              </label>
            </>
          )}

          {error ? (
            <p role="alert" className="text-sm text-red-600 text-left">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p role="status" className="text-sm text-blue-700 text-left">
              {notice}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={pending}
            className="w-full bg-gradient-to-b from-gray-700 to-gray-900 text-white font-medium py-2 rounded-xl shadow hover:brightness-105 cursor-pointer transition mt-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "Please wait…" : submitLabel}
          </button>

          {mode === "confirm-sign-up" && (
            <div className="flex justify-between text-xs font-medium">
              <button
                type="button"
                disabled={pending}
                onClick={() => switchMode("register")}
                className="hover:underline disabled:opacity-60"
              >
                Use another email
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => void handleResendCode()}
                className="hover:underline disabled:opacity-60"
              >
                Resend code
              </button>
            </div>
          )}

          {mode === "challenge" && (
            <button
              type="button"
              disabled={pending}
              onClick={() => switchMode("sign-in")}
              className="text-xs font-medium hover:underline disabled:opacity-60"
            >
              Cancel and sign in again
            </button>
          )}
        </form>

        {(mode === "sign-in" || mode === "register") && (
          <p className="mt-5 text-center text-xs text-gray-400">
            Social sign-in will be enabled after the Cognito providers are
            configured.
          </p>
        )}
      </div>
    </div>
  );
}

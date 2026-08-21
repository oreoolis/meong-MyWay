"use client";

import { useState } from "react";

import { Button, Card, SectionLabel } from "@/components/ui/primitives";
import { ArrowRightIcon, LockIcon, RouteIcon, SparkIcon } from "@/components/ui/icons";

const VALUE_PROPS = [
  {
    icon: <SparkIcon className="h-4 w-4" />,
    title: "Your resume, actually read",
    body: "The parser agent pulls out your skills, seniority and domain — not just keywords.",
  },
  {
    icon: <RouteIcon className="h-4 w-4" />,
    title: "Paths, not job listings",
    body: "The planner agent maps where you are against where you could realistically go.",
  },
  {
    icon: <LockIcon className="h-4 w-4" />,
    title: "You stay in control",
    body: "Your resume and its embeddings are stored against your account, and only yours.",
  },
];

export function SignInStage({
  onSignIn,
}: {
  onSignIn: (email: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Enter a valid email address.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setError(null);
    setPending(true);
    // Stands in for the auth round-trip.
    await new Promise((r) => setTimeout(r, 600));
    onSignIn(email);
  }

  return (
    <div className="mw-rise grid gap-10 lg:grid-cols-[1fr_minmax(0,26rem)] lg:items-center lg:gap-16">
      <div className="max-w-lg">
        <SectionLabel>Career switching, with an agent that reads</SectionLabel>
        <h1 className="mt-3 text-[34px] font-semibold leading-[1.15] tracking-tight text-ink sm:text-[40px]">
          Find the next role your resume already qualifies you for.
        </h1>
        <p className="mt-4 text-[15px] leading-relaxed text-ink-2">
          Upload your CV once. Two agents work in sequence — one to understand
          what you have done, one to map where it can take you.
        </p>

        <ul className="mt-8 space-y-5">
          {VALUE_PROPS.map((prop) => (
            <li key={prop.title} className="flex gap-3.5">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-wash text-accent">
                {prop.icon}
              </span>
              <div>
                <p className="text-[14px] font-medium text-ink">{prop.title}</p>
                <p className="mt-0.5 text-[13.5px] leading-relaxed text-ink-2">
                  {prop.body}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <Card className="p-6 sm:p-7">
        <h2 className="text-[17px] font-semibold text-ink">Sign in to continue</h2>
        <p className="mt-1 text-[13px] text-ink-2">
          You need an account before a resume can be stored against it.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
          <Field
            id="email"
            label="Email"
            type="email"
            value={email}
            placeholder="you@example.com"
            autoComplete="email"
            onChange={setEmail}
          />
          <Field
            id="password"
            label="Password"
            type="password"
            value={password}
            placeholder="At least 6 characters"
            autoComplete="current-password"
            onChange={setPassword}
          />

          {error ? (
            <p role="alert" className="text-[13px] text-critical">
              {error}
            </p>
          ) : null}

          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Signing in…" : "Continue"}
            {pending ? null : <ArrowRightIcon className="h-4 w-4" />}
          </Button>
        </form>

        <p className="mt-5 border-t border-hairline pt-4 text-[12px] leading-relaxed text-ink-muted">
          Demo build — no account is created and no credentials leave your
          browser. Any valid-looking email will sign you in.
        </p>
      </Card>
    </div>
  );
}

function Field({
  id,
  label,
  type,
  value,
  placeholder,
  autoComplete,
  onChange,
}: {
  id: string;
  label: string;
  type: string;
  value: string;
  placeholder: string;
  autoComplete: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full rounded-lg border border-hairline bg-plane px-3.5 text-[14px] text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
      />
    </div>
  );
}

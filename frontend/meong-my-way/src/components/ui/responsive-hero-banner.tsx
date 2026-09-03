"use client";

import { useState } from "react";
import Image from "next/image";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  FileText,
  GitBranch,
  Menu,
  Sparkles,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";

type NavLink = { label: string; href: string; isActive?: boolean };
type Segment = { label: string };

type ResponsiveHeroBannerProps = {
  backgroundImageUrl?: string;
  navLinks?: NavLink[];
  ctaButtonText?: string;
  onCtaClick?: () => void;
  badgeText?: string;
  title?: string;
  titleLine2?: string;
  description?: string;
  primaryButtonText?: string;
  onPrimaryClick?: () => void;
  secondaryButtonText?: string;
  secondaryButtonHref?: string;
  segmentsTitle?: string;
  segments?: Segment[];
};

/**
 * Landing hero. The animated process map is intentionally the only prominent
 * motion: it shows the actual handoff from resume to agents to career routes.
 */
export function ResponsiveHeroBanner({
  backgroundImageUrl = "/hero-architecture.jpg",
  navLinks = [
    { label: "Home", href: "#", isActive: true },
    { label: "How it works", href: "#how-it-works" },
  ],
  ctaButtonText = "Sign in",
  onCtaClick,
  badgeText = "Agentic Powered Resume and Career Analysis",
  title = "Advance Your Career",
  titleLine2 = "With Data-Backed Confidence",
  description = "Get real, agentic suggestions on where to head next in your career, backed by latest up-to-date job data.",
  primaryButtonText = "Upload your resume",
  onPrimaryClick,
  secondaryButtonText = "See how it works",
  secondaryButtonHref = "#how-it-works",
  segmentsTitle = "Built for professionals moving forward in:",
  segments = [
    { label: "Technology" },
    { label: "Finance" },
    { label: "Healthcare" },
    { label: "Consulting" },
    { label: "Retail & E-commerce" },
  ],
}: ResponsiveHeroBannerProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <section id="top" className="relative isolate min-h-[760px] scroll-mt-0 overflow-hidden bg-slate-950 text-white lg:min-h-screen">
      <Image
        src={backgroundImageUrl}
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover object-center opacity-45 saturate-[0.7]"
      />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(2,6,23,.96)_0%,rgba(2,6,23,.82)_43%,rgba(2,6,23,.4)_100%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_78%_44%,rgba(59,130,246,.22),transparent_32%)]" />
      <div className="mw-grid pointer-events-none absolute inset-0 opacity-30" />

      <header className="relative z-20">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <div className="flex h-20 items-center justify-between border-b border-white/10">
            <a
              href="#top"
              className="group inline-flex items-center gap-3 rounded-lg text-white"
              aria-label="Go to MyWay home"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500 shadow-[0_0_30px_rgba(59,130,246,.35)] transition-transform duration-300 group-hover:-rotate-3 group-hover:scale-105">
                <ArrowUpRight className="h-4 w-4" strokeWidth={2.25} />
              </span>
              <span className="text-[15px] font-semibold tracking-tight">MyWay</span>
            </a>

            <nav className="hidden items-center gap-1 md:flex" aria-label="Main navigation">
              {navLinks.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  className={cn(
                    "rounded-full px-4 py-2 text-sm font-medium transition-colors",
                    link.isActive
                      ? "text-white"
                      : "text-white/60 hover:bg-white/5 hover:text-white",
                  )}
                >
                  {link.label}
                </a>
              ))}
              <button
                type="button"
                onClick={onCtaClick}
                className="ml-2 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur-md transition-all hover:border-white/35 hover:bg-white/15"
              >
                {ctaButtonText}
                <ArrowUpRight className="h-4 w-4" />
              </button>
            </nav>

            <button
              type="button"
              onClick={() => setMobileMenuOpen((open) => !open)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/10 backdrop-blur md:hidden"
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-navigation"
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>

          {mobileMenuOpen ? (
            <div
              id="mobile-navigation"
              className="mw-rise mt-3 flex flex-col gap-1 rounded-2xl border border-white/10 bg-slate-950/90 p-2 shadow-2xl backdrop-blur-xl md:hidden"
            >
              {navLinks.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="rounded-xl px-3 py-2.5 text-sm font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                >
                  {link.label}
                </a>
              ))}
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  onCtaClick?.();
                }}
                className="mt-1 inline-flex items-center justify-center gap-2 rounded-xl bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-950"
              >
                {ctaButtonText}
                <ArrowUpRight className="h-4 w-4" />
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <div className="relative z-10 mx-auto grid min-h-[610px] max-w-7xl items-center gap-16 px-5 pb-14 pt-16 sm:px-8 md:pt-20 lg:grid-cols-[1.08fr_.92fr] lg:py-20">
        <div className="max-w-3xl">
          <div className="mw-rise mb-7 inline-flex items-center gap-2.5 rounded-full border border-blue-300/20 bg-blue-400/10 px-3 py-2 backdrop-blur-md">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-300 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-300" />
            </span>
            <span className="text-xs font-medium tracking-wide text-blue-100 sm:text-[13px]">
              {badgeText}
            </span>
          </div>

          <h1 className="mw-rise mw-delay-1 text-balance text-[3.25rem] font-semibold leading-[.94] tracking-[-0.055em] text-white sm:text-[4.5rem] lg:text-[5.35rem]">
            <span className="block">{title}</span>
            <span className="mw-display mt-2 block font-normal tracking-[-0.045em] text-blue-200">
              {titleLine2}
            </span>
          </h1>

          <p className="mw-rise mw-delay-2 mt-7 max-w-xl text-base leading-7 text-slate-300 sm:text-[17px]">
            {description}
          </p>

          <div className="mw-rise mw-delay-3 mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={onPrimaryClick}
              className="group inline-flex items-center justify-center gap-2 rounded-full bg-blue-500 px-5 py-3.5 text-sm font-semibold text-white shadow-[0_12px_36px_-12px_rgba(59,130,246,.8)] transition-all duration-300 hover:-translate-y-0.5 hover:bg-blue-400 hover:shadow-[0_16px_42px_-12px_rgba(59,130,246,.9)]"
            >
              {primaryButtonText}
              <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
            </button>
            <a
              href={secondaryButtonHref}
              className="group inline-flex items-center justify-center gap-2 rounded-full px-5 py-3.5 text-sm font-medium text-white/75 transition-colors hover:text-white"
            >
              {secondaryButtonText}
              <ArrowUpRight className="h-4 w-4 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </a>
          </div>
        </div>

        <div className="mw-route-card relative mx-auto hidden w-full max-w-[480px] lg:block">
          <div className="absolute -inset-10 -z-10 rounded-full bg-blue-500/15 blur-3xl" />
          <div className="overflow-hidden rounded-[2rem] border border-white/15 bg-slate-950/55 shadow-[0_30px_100px_-30px_rgba(2,6,23,.9)] backdrop-blur-xl">
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-5">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/15 text-blue-200 ring-1 ring-blue-300/20">
                  <FileText className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-medium text-white">Career route</p>
                  <p className="mt-0.5 text-xs text-white/45">Built from your experience</p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-2.5 py-1 text-[11px] font-medium text-emerald-200 ring-1 ring-emerald-300/15">
                <Sparkles className="h-3 w-3" />
                Live analysis
              </span>
            </div>

            <div className="relative px-6 py-6">
              <p className="mb-4 text-xs leading-5 text-white/50">
                One resume moves through two specialist agents, then branches into
                realistic directions.
              </p>

              <div className="mw-flow-node mw-flow-node-1 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[.055] p-3.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-blue-100">
                  <FileText className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-white/35">
                    Input
                  </p>
                  <p className="mt-0.5 text-sm font-medium text-white">Your resume</p>
                </div>
                <span className="rounded-full bg-white/5 px-2.5 py-1 text-[10px] text-white/45 ring-1 ring-white/10">
                  PDF or DOCX
                </span>
              </div>

              <div className="mw-flow-connector mw-flow-connector-1 relative ml-[31px] h-5 w-px bg-white/15" />

              <div className="mw-flow-node mw-flow-node-2 flex items-center gap-3 rounded-2xl border border-blue-300/15 bg-blue-400/[.07] p-3.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-400/15 font-mono text-[11px] font-semibold text-blue-200 ring-1 ring-blue-300/15">
                  01
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-white">Parser agent</p>
                  <p className="mt-0.5 truncate text-[11px] text-white/45">
                    Reads skills, seniority and domain
                  </p>
                </div>
                <ArrowDown className="h-4 w-4 text-blue-300/60" />
              </div>

              <div className="mw-flow-connector mw-flow-connector-2 relative ml-[31px] h-5 w-px bg-white/15" />

              <div className="mw-flow-node mw-flow-node-3 flex items-center gap-3 rounded-2xl border border-blue-300/15 bg-blue-400/[.07] p-3.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-400/15 font-mono text-[11px] font-semibold text-blue-200 ring-1 ring-blue-300/15">
                  02
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-white">Planner agent</p>
                  <p className="mt-0.5 truncate text-[11px] text-white/45">
                    Maps your fit against current job data
                  </p>
                </div>
                <GitBranch className="h-4 w-4 text-blue-300/60" />
              </div>

              <div className="mw-flow-connector mw-flow-connector-3 relative ml-[31px] h-5 w-px bg-white/15" />

              <div className="mw-flow-node mw-flow-node-4">
                <div className="mb-2.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.16em] text-white/35">
                  <GitBranch className="h-3.5 w-3.5 text-blue-300" />
                  Realistic career routes
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-xl border border-blue-300/15 bg-blue-400/[.08] px-3 py-2.5">
                    <span className="mb-2 block h-1.5 w-1.5 rounded-full bg-blue-400" />
                    <p className="text-[11px] font-medium text-white/85">Progression</p>
                  </div>
                  <div className="rounded-xl border border-orange-300/15 bg-orange-400/[.07] px-3 py-2.5">
                    <span className="mb-2 block h-1.5 w-1.5 rounded-full bg-orange-400" />
                    <p className="text-[11px] font-medium text-white/85">Adjacent</p>
                  </div>
                  <div className="rounded-xl border border-emerald-300/15 bg-emerald-400/[.07] px-3 py-2.5">
                    <span className="mb-2 block h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    <p className="text-[11px] font-medium text-white/85">Pivot</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {segments.length > 0 ? (
        <div className="relative z-10 border-t border-white/10 bg-slate-950/20 backdrop-blur-sm">
          <div className="mx-auto flex max-w-7xl flex-col items-center gap-4 px-5 py-5 sm:px-8 lg:flex-row lg:justify-between">
            <p className="text-xs font-medium uppercase tracking-[.16em] text-white/45">
              {segmentsTitle}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 lg:justify-end">
              {segments.map((segment) => (
                <span key={segment.label} className="text-[13px] font-medium text-white/70">
                  {segment.label}
                </span>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

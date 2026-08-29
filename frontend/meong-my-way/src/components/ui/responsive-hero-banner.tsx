"use client";

import { useState } from "react";
import Image from "next/image";
import { ArrowRight, ArrowUpRight, Menu, X } from "lucide-react";

import { cn } from "@/lib/utils";

type NavLink = {
  label: string;
  href: string;
  isActive?: boolean;
};

type Segment = {
  label: string;
};

type ResponsiveHeroBannerProps = {
  backgroundImageUrl?: string;
  navLinks?: NavLink[];
  ctaButtonText?: string;
  onCtaClick?: () => void;
  badgeText?: string;
  badgeLabel?: string;
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
 * Full-bleed corporate hero for the landing page. The nav's "Sign in" pill
 * and the primary CTA hand off to the caller (they move the app to the
 * separate sign-in stage); only the secondary CTA stays an in-page anchor,
 * since it just scrolls to the "how it works" section further down this page.
 */
export function ResponsiveHeroBanner({
  backgroundImageUrl = "https://images.unsplash.com/photo-1487958449943-2429e8be8625?q=80&w=2400&auto=format&fit=crop",
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
    <section className="w-full isolate min-h-screen overflow-hidden relative bg-slate-950">
      <Image
        src={backgroundImageUrl}
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover"
      />
      <div className="pointer-events-none absolute inset-0 bg-slate-950/70" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-950/80 via-slate-950/30 to-slate-950/50" />
      <div className="pointer-events-none absolute inset-0 ring-1 ring-black/30" />
      {/* Blends the hero into the light section below instead of cutting to it. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-gradient-to-b from-transparent to-white" />

      <header className="z-10 xl:top-4 relative">
        <div className="mx-6">
          <div className="flex items-center justify-between pt-4">
            <a href="#" className="inline-flex items-center gap-2 text-white">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-slate-900">
                <ArrowUpRight className="h-4 w-4" strokeWidth={2.25} />
              </span>
              <span className="text-[15px] font-semibold tracking-tight">MyWay</span>
            </a>

            <nav className="hidden md:flex items-center gap-2">
              <div className="flex items-center gap-1 rounded-full bg-white/5 px-1 py-1 ring-1 ring-white/10 backdrop-blur">
                {navLinks.map((link, index) => (
                  <a
                    key={index}
                    href={link.href}
                    className={cn(
                      "px-3 py-2 text-sm font-medium hover:text-white font-sans transition-colors",
                      link.isActive ? "text-white/90" : "text-white/80",
                    )}
                  >
                    {link.label}
                  </a>
                ))}
                <button
                  type="button"
                  onClick={onCtaClick}
                  className="ml-1 inline-flex items-center gap-2 rounded-full bg-white px-3.5 py-2 text-sm font-medium text-slate-900 hover:bg-white/90 font-sans transition-colors"
                >
                  {ctaButtonText}
                  <ArrowUpRight className="h-4 w-4" />
                </button>
              </div>
            </nav>

            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/15 backdrop-blur"
              aria-expanded={mobileMenuOpen}
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? (
                <X className="h-5 w-5 text-white/90" />
              ) : (
                <Menu className="h-5 w-5 text-white/90" />
              )}
            </button>
          </div>

          {mobileMenuOpen ? (
            <div className="md:hidden mt-3 flex flex-col gap-1 rounded-2xl bg-white/5 p-2 ring-1 ring-white/10 backdrop-blur">
              {navLinks.map((link, index) => (
                <a
                  key={index}
                  href={link.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="rounded-xl px-3 py-2.5 text-sm font-medium text-white/85 hover:bg-white/10 hover:text-white font-sans transition-colors"
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
                className="mt-1 inline-flex items-center justify-center gap-2 rounded-xl bg-white px-3.5 py-2.5 text-sm font-medium text-slate-900 font-sans"
              >
                {ctaButtonText}
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <div className="z-10 relative">
        <div className="sm:pt-28 md:pt-32 lg:pt-40 max-w-7xl mx-auto pt-28 px-6 pb-16">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-6 inline-flex items-center gap-3 rounded-full bg-white/10 px-2.5 py-2 ring-1 ring-white/15 backdrop-blur">
              <span className="text-sm font-medium text-white/90 font-sans">{badgeText}</span>
            </div>

            <h1 className="sm:text-5xl md:text-6xl lg:text-7xl leading-tight text-4xl text-white tracking-tight font-sans font-semibold">
              {title}
              <br className="hidden sm:block" />
              {titleLine2}
            </h1>

            <p className="sm:text-lg text-base text-white/80 max-w-2xl mt-6 mx-auto">
              {description}
            </p>

            <div className="flex flex-col sm:flex-row sm:gap-4 mt-10 gap-3 items-center justify-center">
              <button
                type="button"
                onClick={onPrimaryClick}
                className="inline-flex items-center gap-2 hover:bg-white/15 text-sm font-medium text-white bg-white/10 ring-white/15 ring-1 rounded-full py-3 px-5 font-sans transition-colors"
              >
                {primaryButtonText}
                <ArrowRight className="h-4 w-4" />
              </button>
              <a
                href={secondaryButtonHref}
                className="inline-flex items-center gap-2 rounded-full bg-transparent px-5 py-3 text-sm font-medium text-white/90 hover:text-white font-sans transition-colors"
              >
                {secondaryButtonText}
                <ArrowUpRight className="w-4 h-4" />
              </a>
            </div>
          </div>

          {segments.length > 0 ? (
            <div className="mx-auto mt-20 max-w-4xl">
              <p className="text-md text-white/100 text-center">{segmentsTitle}</p>
              <div className="flex flex-wrap items-center justify-center gap-3 mt-6">
                {segments.map((segment, index) => (
                  <span
                    key={index}
                    className="inline-flex items-center rounded-full bg-black/10 px-4 py-2 text-sm font-medium text-white/80 ring-1 ring-white/10 backdrop-blur box-shadow-md"
                  >
                    {segment.label}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

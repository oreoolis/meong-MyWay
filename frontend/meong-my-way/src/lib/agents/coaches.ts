import type { CareerCoach } from "@/lib/contracts";

/**
 * Where a person can actually talk to a career coach about a switch.
 *
 * Deliberately a hand-maintained constant rather than model output. Everything
 * else on the transitioner page is generated, and generated text is allowed to
 * be wrong in ways the reader can absorb — a match score that flatters, a
 * timeline that proves optimistic. A referral is different: someone acting on
 * it leaves the app. An invented agency, a dead link, or a hallucinated phone
 * number wastes a real afternoon and is the one failure here with a cost
 * outside the browser.
 *
 * So the model never writes this list. It is only allowed to say what to ask
 * once the user gets there, which is the part that genuinely depends on their
 * destinations — see \`CoachBrief\`.
 *
 * No phone numbers by design. Hotline numbers move between campaigns and there
 * is no way to revalidate one from here, whereas each landing page below
 * carries the current contact route. Every URL was checked to resolve; if one
 * starts 404ing, fix it here rather than letting the page ship a dead link.
 *
 * All four are publicly funded and free to Singaporeans and PRs, which is why
 * no private coaching practices are listed: recommending a paid service on the
 * strength of an automated résumé read is not a judgement this app has
 * grounds to make.
 */
export const CAREER_COACHES = [
  {
    id: "wsg-careers-connect",
    organisation: "Workforce Singapore (WSG)",
    service: "Careers Connect",
    description:
      "The government's own career matching service. Coaches work through a switch with you in person or over video, and can put you into the placement and reskilling programmes that carry a training allowance.",
    url: "https://www.wsg.gov.sg/home/individuals",
    bestFor:
      "A structured switch where you want the funded programmes surfaced alongside the advice.",
    cost: "Free for Singapore citizens and PRs",
    pros: [
      "Structured one-to-one guidance for planning a career switch.",
      "Can connect eligible users with placement, reskilling and training-allowance programmes.",
    ],
    cons: [
      "Less sector-specific than a service built around direct employer relationships.",
      "Free coaching is aimed at Singapore citizens and permanent residents.",
    ],
  },
  {
    id: "e2i",
    organisation: "NTUC's e2i",
    service: "Employment and Employability Institute",
    description:
      "The labour movement's employability arm. Strong on employer relationships in specific sectors, so the conversation tends to be concrete about who is hiring rather than only about what to study.",
    url: "https://www.e2i.com.sg/individuals/",
    bestFor:
      "Testing whether a target sector is actually hiring people with your background right now.",
    cost: "Free; some programmes are union-member priority",
    pros: [
      "Strong employer relationships make conversations concrete about current hiring demand.",
      "Useful for testing whether a target sector will value the user's existing background.",
    ],
    cons: [
      "Some programmes give priority to union members.",
      "Less focused on comparing credentials and training subsidies than SkillsFuture Advice.",
    ],
  },
  {
    id: "skillsfuture-advice",
    organisation: "SkillsFuture Singapore",
    service: "SkillsFuture Advice",
    description:
      "Short guided sessions on planning a mid-career move, and the route into the Mid-Career Support and conversion programmes that subsidise retraining for a switch.",
    url: "https://www.skillsfuture.gov.sg/initiatives/mid-career/advice",
    bestFor:
      "Working out which credential is worth the time, and what it will actually cost you after subsidy.",
    cost: "Free; training subsidies apply separately",
    pros: [
      "Strongest option for comparing credentials, conversion programmes and training subsidies.",
      "Short guided sessions suit users validating a mid-career retraining plan.",
    ],
    cons: [
      "Less focused on direct employer matching than e2i.",
      "Course fees and subsidy eligibility still need to be checked separately.",
    ],
  },
  {
    id: "myskillsfuture",
    organisation: "MySkillsFuture",
    service: "Skills and course planning portal",
    description:
      "The national portal behind the Skills Framework this analysis draws on. Useful before a coaching session: it lists the courses attached to each job role, so you can arrive with specific options rather than an open question.",
    url: "https://www.myskillsfuture.gov.sg/content/portal/en/index.html",
    bestFor: "Preparing for a session, or self-serving if you would rather not book one.",
    cost: "Free",
    pros: [
      "Self-service access to courses aligned with Skills Framework job roles.",
      "Useful for preparing specific options before speaking with a coach, without booking first.",
    ],
    cons: [
      "It is a planning portal, not a human coaching service.",
      "Users must compare course options and apply them to their own situation themselves.",
    ],
  },
] satisfies Array<CareerCoach & { pros: string[]; cons: string[] }>;

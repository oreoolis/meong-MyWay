/**
 * Canned agent output for the MVP.
 *
 * Nothing here is derived from the uploaded file beyond the candidate's name
 * and the file metadata — the point is to exercise the UI with realistic,
 * richly-shaped data until the real agents exist.
 */

import type { CareerPath, CurrentTrajectory, ExtractedSkill } from "./contracts";

export const SAMPLE_SKILLS: ExtractedSkill[] = [
  {
    name: "SQL",
    category: "technical",
    confidence: 0.96,
    evidence: "Built and maintained 40+ production queries feeding the revenue dashboard",
  },
  {
    name: "Python",
    category: "technical",
    confidence: 0.91,
    evidence: "Automated weekly cohort reporting with pandas, cutting manual prep by 6 hours",
  },
  {
    name: "Tableau",
    category: "technical",
    confidence: 0.88,
    evidence: "Owned the executive Tableau workspace used by 3 business units",
  },
  {
    name: "dbt",
    category: "technical",
    confidence: 0.64,
    evidence: "Migrated legacy transforms into dbt models alongside the data engineering team",
  },
  {
    name: "Experiment design",
    category: "analytical",
    confidence: 0.87,
    evidence: "Designed and read out 12 A/B tests on the checkout funnel",
  },
  {
    name: "Cohort & retention analysis",
    category: "analytical",
    confidence: 0.9,
    evidence: "Identified a 14% retention drop isolated to the mobile onboarding flow",
  },
  {
    name: "Forecasting",
    category: "analytical",
    confidence: 0.72,
    evidence: "Maintained rolling 13-week demand forecast for the regional supply team",
  },
  {
    name: "E-commerce / retail",
    category: "domain",
    confidence: 0.85,
    evidence: "Three years supporting marketplace and fulfilment teams",
  },
  {
    name: "Financial services",
    category: "domain",
    confidence: 0.58,
    evidence: "Six-month secondment to the payments risk analytics pod",
  },
  {
    name: "Stakeholder management",
    category: "leadership",
    confidence: 0.83,
    evidence: "Ran fortnightly metric reviews with marketing, ops and finance leads",
  },
  {
    name: "Mentoring",
    category: "leadership",
    confidence: 0.69,
    evidence: "Onboarded and mentored two junior analysts through their first quarter",
  },
];

export const SAMPLE_TRAJECTORY: CurrentTrajectory = {
  currentTitle: "Senior Data Analyst",
  nextRole: "Analytics Lead",
  timeline: "12–18 months",
  note: "Your resume already evidences most of what a lead role screens for. The gap is scope, not skill: you own analyses, but not yet a team or a roadmap.",
};

export const SAMPLE_PATHS: CareerPath[] = [
  {
    id: "analytics-lead",
    title: "Analytics Lead",
    kind: "progression",
    matchScore: 91,
    summary:
      "Own an analytics function end to end — roadmap, headcount and the metrics layer the rest of the business argues over.",
    rationale:
      "This is the highest-similarity match to your embedding. Your last two roles show increasing ownership of the metric definitions themselves, which is the single strongest predictor of a successful move into analytics leadership.",
    salary: { low: 108000, high: 145000, currency: "SGD" },
    demand: "high",
    timeToReady: "12–18 months",
    transferableSkills: ["SQL", "Experiment design", "Stakeholder management", "Mentoring"],
    gaps: [
      {
        skill: "Managing analysts directly",
        severity: "serious",
        remedy: "Ask to formally line-manage the two juniors you already mentor informally.",
      },
      {
        skill: "Headcount & budget planning",
        severity: "moderate",
        remedy: "Shadow your current lead through one planning cycle.",
      },
    ],
    milestones: [
      {
        phase: "Take visible ownership",
        duration: "Months 1–4",
        actions: [
          "Convert your mentoring into a formal reporting line",
          "Own the definition doc for one company-level metric",
        ],
      },
      {
        phase: "Run a roadmap",
        duration: "Months 5–10",
        actions: [
          "Publish and defend a quarterly analytics roadmap",
          "Lead one cross-functional measurement project end to end",
        ],
      },
      {
        phase: "Move",
        duration: "Months 11–18",
        actions: ["Interview internally first — lead roles rarely go to outside hires"],
      },
    ],
    sampleEmployers: ["Shopee", "GovTech", "Grab", "DBS"],
  },
  {
    id: "product-manager-data",
    title: "Product Manager, Data Products",
    kind: "adjacent",
    matchScore: 78,
    summary:
      "Build the internal tools and data products other teams run on, trading depth of analysis for breadth of ownership.",
    rationale:
      "Your embedding sits close to data-PM postings because of how much of your resume is about stakeholders and decisions rather than pipelines. The evidence of running metric reviews across three functions is exactly the signal these roles screen for.",
    salary: { low: 95000, high: 138000, currency: "SGD" },
    demand: "high",
    timeToReady: "9–15 months",
    transferableSkills: ["Stakeholder management", "Experiment design", "SQL", "E-commerce / retail"],
    gaps: [
      {
        skill: "Product discovery & user research",
        severity: "serious",
        remedy: "Run structured discovery interviews with the dashboard users you already support.",
      },
      {
        skill: "Roadmapping and prioritisation frameworks",
        severity: "moderate",
        remedy: "Take one internal tool and publish a prioritised backlog for it.",
      },
      {
        skill: "Writing product specs",
        severity: "moderate",
        remedy: "Rewrite your next analysis request as a spec before building it.",
      },
    ],
    milestones: [
      {
        phase: "Reframe what you already do",
        duration: "Months 1–5",
        actions: [
          "Treat your Tableau workspace as a product: users, adoption, roadmap",
          "Interview 8 dashboard users and write up the findings",
        ],
      },
      {
        phase: "Ship as a PM, titled or not",
        duration: "Months 6–11",
        actions: [
          "Own one internal data tool end to end",
          "Partner with an engineer on delivery, not just requirements",
        ],
      },
      {
        phase: "Move",
        duration: "Months 12–15",
        actions: ["Target data-platform PM roles, where analyst background is an advantage"],
      },
    ],
    sampleEmployers: ["Sea Group", "Stripe", "Atlassian", "Ninja Van"],
  },
  {
    id: "ml-engineer",
    title: "Machine Learning Engineer",
    kind: "pivot",
    matchScore: 64,
    summary:
      "Move from describing what happened to shipping models that act on it, in a production codebase.",
    rationale:
      "Your Python and dbt evidence carries real weight here, but the resume shows analysis code rather than production code. This is a genuine switch: the similarity comes from the tooling, not from the day-to-day work.",
    salary: { low: 115000, high: 168000, currency: "SGD" },
    demand: "high",
    timeToReady: "18–30 months",
    transferableSkills: ["Python", "dbt", "Forecasting", "Experiment design"],
    gaps: [
      {
        skill: "Production software engineering",
        severity: "critical",
        remedy: "Testing, code review and CI are the hard prerequisite — not the modelling.",
      },
      {
        skill: "ML systems & deployment",
        severity: "critical",
        remedy: "Ship one model behind an API with monitoring, however small.",
      },
      {
        skill: "Deep learning fundamentals",
        severity: "moderate",
        remedy: "Only needed for a subset of roles; classical ML clears most job descriptions.",
      },
    ],
    milestones: [
      {
        phase: "Become an engineer first",
        duration: "Months 1–9",
        actions: [
          "Move your analysis code into a tested, reviewed repository",
          "Learn the team's deployment path by shipping something trivial through it",
        ],
      },
      {
        phase: "Add the ML",
        duration: "Months 10–20",
        actions: [
          "Take one forecasting task you already own and productionise it",
          "Add monitoring and a retraining path",
        ],
      },
      {
        phase: "Move",
        duration: "Months 21–30",
        actions: ["Target applied-ML roles at your current employer before the open market"],
      },
    ],
    sampleEmployers: ["TikTok", "Visa", "A*STAR", "Grab"],
  },
  {
    id: "ux-researcher",
    title: "Quantitative UX Researcher",
    kind: "pivot",
    matchScore: 52,
    summary:
      "Answer why users behave the way they do, combining the behavioural data you know with qualitative methods you don't yet.",
    rationale:
      "The lowest-similarity path shown, and included deliberately: your experiment-design and cohort work map cleanly onto quant research, but nothing in the resume evidences qualitative method. Treat this as a direction to test, not a plan.",
    salary: { low: 88000, high: 125000, currency: "SGD" },
    demand: "emerging",
    timeToReady: "18–24 months",
    transferableSkills: ["Experiment design", "Cohort & retention analysis", "Stakeholder management"],
    gaps: [
      {
        skill: "Qualitative research methods",
        severity: "critical",
        remedy: "Formal training here is non-negotiable; most quant researchers still run interviews.",
      },
      {
        skill: "Survey design & psychometrics",
        severity: "serious",
        remedy: "A short course plus one real survey shipped end to end.",
      },
      {
        skill: "Research operations",
        severity: "moderate",
        remedy: "Learnable on the job once you are in seat.",
      },
    ],
    milestones: [
      {
        phase: "Test the interest cheaply",
        duration: "Months 1–6",
        actions: [
          "Shadow your product team's researcher for a full study",
          "Run one survey end to end, from instrument design to readout",
        ],
      },
      {
        phase: "Build the missing half",
        duration: "Months 7–16",
        actions: ["Take a formal qualitative methods course", "Build a portfolio of three studies"],
      },
      {
        phase: "Move",
        duration: "Months 17–24",
        actions: ["Target mixed-methods roles that explicitly want a quant background"],
      },
    ],
    sampleEmployers: ["Google", "Shopee", "GovTech", "Zendesk"],
  },
];

export const SAMPLE_EXPERIENCE = [
  {
    company: "Lazada",
    title: "Senior Data Analyst",
    start: "2022",
    end: "Present",
    highlights: [
      "Owned marketplace retention reporting across 3 regional business units",
      "Designed and read out 12 checkout-funnel experiments, 4 of which shipped",
      "Migrated legacy SQL transforms into dbt with the data engineering team",
    ],
  },
  {
    company: "Circles.Life",
    title: "Data Analyst",
    start: "2020",
    end: "2022",
    highlights: [
      "Built the executive Tableau workspace still used by marketing and ops",
      "Automated weekly cohort reporting, cutting 6 hours of manual prep per week",
    ],
  },
  {
    company: "PwC Singapore",
    title: "Analytics Associate",
    start: "2019",
    end: "2020",
    highlights: ["Six-month secondment to the payments risk analytics pod"],
  },
];

export const SAMPLE_EDUCATION = [
  {
    school: "Singapore Management University",
    credential: "BSc Information Systems",
    year: "2019",
  },
];

export const SAMPLE_CERTIFICATIONS = [
  "Google Advanced Data Analytics",
  "dbt Analytics Engineering",
];

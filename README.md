## MyWay: Agentic AI Platform for Career Switching

Upload a resume, and two agents work in sequence: a **Resume Parser** that reads the
document into a structured profile, and a **Career Planner** that maps that profile
against a realistic current trajectory plus alternative career paths.

> **Status: frontend MVP.** The agents are mocked in the browser and nothing is
> persisted — there is no database or backend wired up yet. The UI is complete and
> demoable end to end.

---

## Repo layout

```
meong-MyWay/
├── backend/                 # empty for now
└── frontend/
    └── meong-my-way/        # the Next.js app — everything below lives here
```

---

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 20.9 or newer (22.x recommended) |
| npm | 10 or newer |

Check with `node -v && npm -v`.

---

## Running the frontend

```bash
cd frontend/meong-my-way
npm install
npm run dev
```

Then open **http://localhost:3000**.

If port 3000 is already taken, pick another one explicitly:

```bash
npm run dev -- -p 3000
```

### Scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | Dev server with hot reload (Turbopack) |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |

---

## Walking through the demo

The whole app is a **single route** (`/`) — the URL never changes. Each phase is a
state of the `<Workspace/>` machine, which keeps the uploaded `File` object alive
for the entire flow.

1. **Sign in** — authentication is faked. Any valid-looking email and a password of
   6+ characters will get you in. No account is created and nothing leaves the browser.
2. **Upload a resume** — drag and drop, or browse. Accepts PDF/DOC/DOCX up to 5 MB.
   Any real file works; its name, size and type are read client-side and carried
   through the rest of the flow.
3. **Watch the agents run** — the parser's steps stream in (tokenizing, embedding,
   extracting), then it hands a structured profile to the planner. The handoff
   payload is shown explicitly so you can see what agent 2 actually receives.
4. **Read the plan** — current trajectory, then four alternative paths ranked by
   match score, each expandable into transferable skills, skill gaps and a milestone
   route. Filter by path type at the top.

---

## How the mocking works

The two agents live in `src/lib/mock-agents.ts` and expose the same shape a real
network call would:

```ts
parseResume(file, report, signal): Promise<ResumeProfile>
planCareers(profile, report, signal): Promise<CareerPlan>
```

Both are `async`, cancellable via `AbortSignal`, and report progress through a
`report(agent, steps)` callback that drives the live trace UI. The canned output
they return comes from `src/lib/fixtures.ts`.

**To swap in the real backend later:** replace the bodies of those two functions
with `fetch` calls and keep the signatures. The payload types in
`src/lib/contracts.ts` are the contract — have the backend serialize exactly those
shapes and nothing in `src/components/` needs to change.

One thing to note: the parser's `Storing resume and vectors` step deliberately
reports *"Skipped — no database connected in this build"* rather than pretending to
persist. Update that once storage exists.

---

## Source layout

```
src/
├── app/
│   ├── globals.css          # design tokens (light/dark), motion, focus ring
│   ├── layout.tsx           # root layout + metadata
│   └── page.tsx             # renders <Workspace/>
├── components/
│   ├── workspace.tsx        # the stage machine — all pipeline state lives here
│   ├── app-header.tsx       # header + progress stepper
│   ├── stages/              # one component per phase of the flow
│   │   ├── sign-in-stage.tsx
│   │   ├── upload-stage.tsx
│   │   ├── analysis-stage.tsx
│   │   └── results-stage.tsx
│   └── ui/                  # primitives, icons, stepper, agent trace, path card
└── lib/
    ├── contracts.ts         # shared types — the future API contract
    ├── mock-agents.ts       # the two stand-in agents + file validation
    ├── fixtures.ts          # canned agent output
    └── utils.ts             # formatting helpers
```

### Styling

Tailwind v4, configured entirely in `src/app/globals.css` — there is no
`tailwind.config.js`. Colors are CSS custom properties on `:root`, mapped to
utilities through `@theme inline`, so `bg-surface`, `text-ink-2`, `border-hairline`
and friends resolve in both light and dark mode. Dark mode follows the OS setting
and also honours an explicit `data-theme="dark"` stamp on `<html>`.

Status colors (`--status-critical`, `--status-serious`, `--status-warning`,
`--status-good`) are fixed across both modes and are always paired with an icon and
a text label, so severity never depends on color alone.

---

## Not done yet

- [ ] Backend service and the real agent implementations
- [ ] Database: user accounts, resume file storage, embedding vectors
- [ ] Real authentication
- [ ] Live salary and demand data (currently illustrative fixture values)

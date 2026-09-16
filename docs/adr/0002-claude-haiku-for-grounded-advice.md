# ADR-0002: Claude Haiku 4.5 as the reasoning model

**Status:** Accepted
**Date:** 2026-09-04
**Supersedes:** [ADR-0001](0001-cheapest-bedrock-model-that-still-reasons.md)

## Context

ADR-0001 chose `amazon.nova-lite-v1:0` and named the condition for reopening
the decision:

> users report the advice as generic (the signal that Nova Lite is the limiting
> factor rather than the prompts)

That condition has been met. Run against a real resume, the Career Swapper
returns destinations that read as a list of adjacent job titles rather than an
argument about *this* candidate — the failure ADR-0001 anticipated, in exactly
the place it predicted. Nova Lite can name a plausible destination; it cannot
hold a specific line of the resume in mind while justifying one.

That matters more here than anywhere else in the pipeline. A career switch is
the most consequential thing the product suggests, and an ungrounded
recommendation is worse than none — the swapper's own system prompt already
demands "if they have never managed anyone, 'stakeholder management' is not
transferable for them," and the model was not able to honour it.

The budget has not changed. Total inference spend must stay under $20.

## Decision

**Reasoning: `us.anthropic.claude-haiku-4-5-20251001-v1:0`** at $1.00 / $5.00
per million input / output tokens on Bedrock.

Embeddings remain `amazon.titan-embed-text-v2:0`. Embedding quality was never
the constraint, and ADR-0001's reasoning there stands unchanged.

Note the `us.` prefix: it is part of the ID the runtime invokes, not a
deployment detail. See *Consequences*.

### This fits the budget, with a ceiling rather than an average

Measured against a real resume, one Converse call with the PDF attached as a
document block costs 2,377 input / 722 output tokens. Extrapolated across the
five agents, a full run is roughly **11,800 input / 7,400 output tokens ≈
$0.049**.

The more important number is the ceiling. Every agent already passes an
explicit `maxTokens`, which ADR-0001 introduced as a per-agent cost ceiling and
which now does real work: output is capped at 4096 + 4096 + 3072 + 2048 + 4096
= **17,408 tokens per run**, whatever the model does. With a generous 15,000
input tokens that bounds a run at **$0.102**.

> **Corrected 2026-09-06.** Both figures above are wrong, in two ways.
>
> First, the sum counts the advisor and the swapper once each. Both run a
> grounded tier and fall back to a reasoned one, and the fallback is not
> exclusive — a grounded call that returns a reply naming no valid framework
> role ID has already been paid for by the time the reasoned call fires. The
> honest ceiling at the original per-agent numbers was 23,552 output tokens,
> or **$0.133**, not $0.102.
>
> Second, 4096 was too small for the swapper. Measured, its reasoned tier
> needs **5,227–6,293 output tokens** to emit four destinations with
> rationales, gaps, milestones and a coach brief — so it returned
> `stopReason: max_tokens`, `reasonJson` threw, and the Transitioner card
> rendered as unreachable while the rest of the run succeeded. Both swapper
> tiers now run at 8192 (`DESTINATION_CEILING` in `career-swapper.ts`).
>
> That 1,000-token spread between two similar resumes is why the ceiling is
> 8192 rather than something snug above the first measurement: the cost of
> this reply tracks how much the resume gives the model to work with, so a
> ceiling set to the last figure observed is a ceiling that breaks on the next
> candidate. 6,293 is 77% of 8192.
>
> The corrected ceiling is 4096 + 4096 + 3072 + (2048 × 2) + (8192 × 2) =
> **31,744 output tokens ≈ $0.174 per run**, against a measured typical of
> **~$0.078**. The budget therefore cannot be spent in fewer than **~115**
> analyses, with ~256 the realistic figure. The table below is corrected to
> match, and `orchestrator.itest.ts` asserts the new bound.
>
> **Corrected 2026-09-16.** Two more agents' ceilings were too small, both
> caught the same way: production logs showed `stopReason: max_tokens` —
> `reasonJson` threw, and the agent's half of the run failed outright.
>
> The industry advisor's schema grew (per-role `strengths`/`gaps` were added
> so match scores could explain themselves) without its 2048 ceiling moving
> with it; both its tiers now run at 4096.
>
> The general planner asks for exactly 4 `CareerPath` objects — the same
> per-item shape (rationale, gaps, milestones, employers) the swapper's 8192
> was set for, minus the swapper's smaller `portableSkills`/`note`/
> `coachBrief` extras. It had been at 4096 since this ADR's original figure
> and had simply never been re-measured against that shape; it now runs at
> 8192 too, matching the swapper rather than guessing a smaller number that
> only moves the failure to the next verbose resume.
>
> The corrected ceiling is 4096 + 8192 + 3072 + (4096 × 2) + (8192 × 2) =
> **39,936 output tokens ≈ $0.215 per run**. The typical figure is not
> re-measured here — nothing about a *typical* reply changed, only the cap on
> a verbose one — so it stays the prior **~$0.078** until a run is actually
> measured against the new ceilings. The budget therefore cannot be spent in
> fewer than **~93** analyses at the worst case, with ~256 still the realistic
> figure. The table below is corrected to match, and `orchestrator.itest.ts`
> asserts the new bound.

| | per run | runs within $20 |
|---|---|---|
| Nova Lite (ADR-0001) | ~$0.0025 | ~8,000 |
| Haiku 4.5, typical | ~$0.078 | ~256 |
| Haiku 4.5, every agent at its token ceiling | ~$0.215 | ~93 |

So the honest statement is not "it fits" but **"it cannot exceed ~$0.17 per
run, so the budget cannot be spent in fewer than ~115 analyses"** — and the
realistic figure is more than twice that. For a project that has run in the low
hundreds of analyses, the unit cost buys the one capability the product is
actually sold on.

## Alternatives considered

**Staying on Nova Lite and improving the prompts.** Rejected because
ADR-0001 already named this as the discriminating test: the prompts are
specific and already state the grounding rule the output violates. The
limiting factor is the model.

**A two-tier split** — Nova Lite for the parser (pure extraction, and the
largest single input because the PDF rides along), Haiku for the four
reasoning agents. This is a real ~15% saving and remains available. Rejected
for now because it doubles the number of model IDs in play, and the budget is
not tight enough to pay for that complexity. It is the first lever to pull if
it becomes tight.

**Nova Pro** ($0.80 / $3.20) sits between the two on price and was rejected on
evidence: no measurement showed it closing the grounding gap, and at 80% of
Haiku's input price the saving does not justify the uncertainty.

## Consequences

**The runtime model ID is an inference profile, not a foundation model.**
Anthropic's 4.x models on Bedrock publish `INFERENCE_PROFILE` as their only
supported inference type; invoking `anthropic.claude-haiku-4-5-20251001-v1:0`
directly returns a `ValidationException`. The `us.` prefix turns it into the
cross-region profile that on-demand invocation accepts, routing across
us-east-1, us-east-2 and us-west-2.

This splits one ID into two, and the Terraform reflects that: the
`aws_bedrock_foundation_model` data source resolves the *bare* ID (it 404s on a
profile ID), while a new `aws_bedrock_inference_profile` data source resolves
the prefixed one. `terraform output bedrock_reasoning_model_id` emits the
runtime ID, so `sync-env.sh` keeps writing the correct value.

**IAM grew a dimension.** Invocation through a cross-region profile is
authorised against the profile *and* against the foundation model in whichever
region the request lands. The policy in `bedrock.tf` now expands to the profile
ARN plus each regional model ARN, read from the profile's own `models` list
rather than a hand-kept region list. Granting only the profile ARN produces an
`AccessDeniedException` that looks intermittent, because it depends on routing.

**The normalisation code stays.** It was written as "the tax for the price
point" and might have looked removable at a higher one. It is not: the measured
Haiku call still wrapped its JSON in a ```json fence, which `extractJson` exists
to strip. The clamping and enum-defaulting in the agent modules should be left
alone until something demonstrates it is dead.

**The cost table's fallback rate is now the expensive one.** `cost.ts` falls
back to Haiku's rate for an unrecognised model ID rather than Nova Lite's. An
unknown ID means the table is stale, and under-reporting a run's cost by 20x is
the failure that quietly spends the budget.

**PDF/DOCX parsing stays out of the tree.** This was ADR-0001's main structural
consequence and the reason to check before switching families. Verified against
a real resume: Claude reads Converse `document` blocks on Bedrock, so there is
still no `pdf-parse` or `mammoth` dependency.

**Temperature stays 0**, for the reason ADR-0001 gives.

## Revisiting

Reopen if the budget is materially reduced (pull the two-tier split first, then
fall back to Nova Lite — `bedrock_reasoning_model_id` plus
`bedrock_inference_profile_prefix = ""` is the whole change); if measured cost
per run drifts above the $0.10 ceiling, which would mean an agent's `maxTokens`
was raised without re-checking this ADR; or if the advice is still reported as
generic, which would move the limiting factor back to the prompts.

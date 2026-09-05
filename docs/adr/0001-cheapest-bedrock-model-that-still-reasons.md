# ADR-0001: Amazon Nova Lite as the reasoning model, Titan V2 for embeddings

**Status:** Superseded by [ADR-0002](0002-claude-haiku-for-grounded-advice.md)
**Date:** 2026-09-02

> Superseded on 2026-09-04. The "Revisiting" condition below — users reporting
> the advice as generic — was met: the Career Swapper's destinations were not
> grounded in the resume. The reasoning model is now Claude Haiku 4.5. The
> embedding decision (Titan V2) and the consequences about normalisation,
> Skills Framework ground truth, and temperature 0 all still hold.

## Context

MyWay runs five agents over every uploaded resume — parser, career planner,
resume improver, industry advisor, career swapper. The product is meant to stay
free to its users, and the total inference budget for the project is under $20.

That makes cost the binding architectural constraint rather than a
consideration, but it cannot be satisfied by simply picking the cheapest number
on the price list: the planner has to hold a multi-step argument about someone's
career, and the improver has to quote a resume line and rewrite it without
inventing an achievement. A model that cannot do those two things produces
output that is worse than no output, because it is confidently wrong about
someone's livelihood.

Two separate model choices follow from this: what reasons, and what embeds.

## Decision

**Reasoning: `amazon.nova-lite-v1:0`** at $0.06 / $0.24 per million input /
output tokens.

**Embeddings: `amazon.titan-embed-text-v2:0`** at roughly $0.02 per million
input tokens, 1024 dimensions, normalised.

Both are configurable through `BEDROCK_REASONING_MODEL_ID` and
`BEDROCK_EMBEDDING_MODEL_ID`, and all model access goes through the Converse
API (`lib/bedrock/reason.ts`) rather than `InvokeModel`, so switching families
is an environment change rather than a rewrite.

A measured run costs about **$0.005**, which is roughly 4,000 full analyses
inside the budget. Every run reports its own cost via `lib/agents/cost.ts`, so
a prompt change that doubles token use is visible immediately rather than at
the end of a billing cycle.

## Alternatives considered

**Nova Micro** ($0.035 / $0.14) is genuinely cheaper and was rejected on
capability, not price. It is text-only, so it cannot accept the resume as a
document block — which would reintroduce the PDF/DOCX parsing dependency this
design removes — and its rationales are noticeably thinner in exactly the place
the product's value sits.

**Claude Haiku 4.5** reasons better and is the right upgrade if advice quality
ever matters more than the bill, but at roughly 15x the cost it does not fit the
stated budget. It remains a one-variable switch.

**Self-hosted HuggingFace embeddings** (`sentence-transformers`) are the only
option genuinely cheaper than Titan V2 at the API level. Rejected because the
saving is a rounding error against a real cost: an inference endpoint to keep
warm, a second vendor, and another credential to rotate. Titan is already
inside Bedrock and needs none of that.

## Consequences

**The parser has no text-extraction dependency.** Nova Lite reads PDF and DOCX
natively through Converse document blocks, so there is no `pdf-parse` or
`mammoth` in the tree, no parser to keep patched, and no malformed-PDF crash
path in the request handler.

**The embedding is taken over model-written prose, not raw extraction.** The
parser produces an `embeddingText` summary and that is what gets vectorised, so
page headers, footers, and two-column artefacts never reach the vector.

**Small-model output must be normalised, not trusted.** Every agent coerces
what it gets back — clamping confidences, defaulting enum fields, dropping
rewrites that do not quote the resume. `reasonJson` brace-scans for the JSON
object rather than assuming a clean reply. This is the tax for the price point
and it is paid in the agent modules, not at the call site.

**Ground truth comes from the Skills Framework, never the model.** Salary bands,
sector names, and role titles come from the SSG-WSG API and are joined back onto
the model's commentary by role ID. A role the API never returned is dropped
rather than displayed — a cheap model is exactly the kind that would otherwise
invent a plausible salary.

**Temperature is 0 everywhere.** Career advice that changes between two runs of
the same resume reads as guesswork.

## Revisiting

Reopen this if any of the following becomes true: the budget changes materially;
users report the advice as generic (the signal that Nova Lite is the limiting
factor rather than the prompts); or the normalisation code in the agent modules
starts growing faster than the features it supports, which would mean the model
is costing more in defensive code than it saves in tokens.

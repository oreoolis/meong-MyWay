# Post-upload résumé questionnaire

The flow is upload → parse → optional questions → final evidence embedding → planner and specialists → results → deferred swapper.

## Contracts and evidence

The flow is **Resume Parser → parsed profile → Context Agent → optional questions → user answers or skip → Resume Parser (final embedding only) → Career Planner → specialists**. The document is parsed once.

`generateResumeContext(profile)` in `src/lib/agents/resume-context.ts` owns the two Bedrock calls (`context` and `context-review`). Its only input is the parsed profile; its output is reviewed questions plus token usage. It depends on Bedrock reasoning and canonical question templates, not storage, user submissions, retrieval or embeddings. Intake persists the questions and resolves submitted IDs; `embedParsedResume` combines the base text with that resolved evidence.

Both loading pages share the seven-station diagram: store, parser extraction, Context Agent, user, parser embedding, planner, specialists. The Context Agent and completion endpoints optionally stream NDJSON phases when requested. The browser follows server phase events rather than timers. Downstream cards stay gray until embedding completes; Career Swapper remains deferred to results.

`POST /api/analysis/intake` accepts `{ resumeId }`. Verified Cognito authentication determines the user. The server reads that user's current stored document, parses without embedding, and persists its profile and base evidence text. Successful generation returns two or three optional questions. A generation error or fewer than two approved questions returns an empty questionnaire; the browser automatically continues with résumé-only analysis.

`POST /api/analysis` now requires `{ intakeId, resumeId, version: 1, selections: [{ questionId, optionId }] }`. It rejects client evidence, labels, profile fields, preferences and user IDs, as well as unknown, duplicate, mismatched and stale selections. Empty selections and skip options add no evidence. A factual “never used” answer remains distinct from an unanswered question.

The model identifies gaps by source index and facet; it cannot supply executable option prose. Canonical server templates cover hands-on responsibility, recency, usage context and coordination scope. Each provides four substantive choices plus the standard “Not applicable / Prefer not to answer” option. Calendar intervals and scope boundaries are disjoint. Invalid selectors, duplicate source anchors and already-demonstrated proficiency are dropped. A second model call reviews the rendered questions against the entire profile to reject established facts, redundant gaps, assumptions and aspirational skill claims. Fewer than two survivors means no questionnaire.

The parser excludes preferences and desired roles from embedding text. Selected responses stay under `questionnaireEvidence`, with the exact question, selected answer, source, and question/option IDs; original résumé-derived fields remain intact. The final vector embeds the base text plus selected factual statements once each. There are no score bonuses or inferred services/tools. Empty evidence preserves the base text exactly. All downstream agents receive the validated question-and-answer pairs in a separate self-reported section of their profile digest; the advisor and deferred swapper also use the same enriched vector. Specialist partial failures retain the existing `Promise.allSettled` behavior.

## Persistence and deployment

- The existing analyses table gains an `intake` artifact and short-lived `intakeLock` row. No table/key migration is needed. The intake stores its random ID, version, résumé ID, profile, base text, questions, model usage, submission identity, completion lease and cached result.
- Intake and analysis artifacts retain a 30-day TTL. Reads reject expired items immediately, without waiting for DynamoDB cleanup. Completion/retries use the intake's original expiry.
- A 330-second intake lock prevents concurrent parsing. A separate completion lease prevents competing submissions and fences late workers. A terminated process can be retried after lease expiry. Failed requests release only their own lease.
- Identical submissions replay the cached result; selection ordering does not change identity. The first submitted answer set is immutable. A different answer set requires a new upload. Recoverable retries reuse parsing but may repeat embedding and downstream calls.
- Every derived write transaction checks the current résumé and, during completion, the worker lease. Replacement/deletion invalidate old questionnaires immediately and conditionally clean their rows. Deferred swap writes also check the résumé ID.
- Pre-feature analysis rows without a résumé ID are not served because they cannot be safely bound to a document. Their existing TTL remains; users can generate fresh analyses. Deploy client and server contract changes together.
- `iac/bedrock.tf` adds `dynamodb:ConditionCheckItem` on both tables. Apply this execution-role policy change before deployment. No infrastructure was applied during implementation. See [AWS transaction IAM documentation](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis-iam.html).

## UX and validation

The dedicated context stage has native labelled radio groups, visible keyboard focus, per-question clearing, Continue and Skip for now. It preserves answers and the uploaded/parsed intake across recoverable retries and prevents duplicate clicks. Before submission, the UI reports only uploading, parsing and question preparation. Agent transitions follow server-streamed phases; the segmented bar indicates milestones, not measured completion time. Browser cancellation stops local work and requests; it cannot revoke an AWS invocation already running, so retry safely retrieves or resumes that submission.

Validation at implementation time:

- 94 unit tests passed, including the existing suite and normalization, ID validation, provenance, authentication, stale versions, expiry, transaction guards, retries, cancellation, fallback, specialist failures and deferred-vector handoff.
- TypeScript `--noEmit` and the production build passed.
- ESLint passed with two pre-existing unused-code warnings in the analysis stage.
- Two live AWS tests passed: synthetic upload/intake/completion/replay/deferred-swap/replacement, and a fixed-fixture Titan ranking evaluation. Test records were deleted afterward.
- Browser checks covered keyboard radio navigation, ID-only selections, clearing and whole-stage skip. Desktop and 390px layouts were inspected with no mobile horizontal overflow. The temporary preview route was removed.

From `frontend/meong-my-way`:

```sh
npm test
npx tsc --noEmit
npm run lint
npm run build
npx vitest run --project integration src/lib/resume/intake.itest.ts src/lib/resume/questionnaire-quality.itest.ts
```

## Ranking evaluation

The [recorded Titan evaluation](questionnaire-quality-results.json) uses a synthetic operations analyst and seven fixed role descriptions, isolating evidence effects from retrieval variability. Values below are raw cosine similarities, not proof of qualification.

| Evidence | Cloud operations rank | Cloud operations | Reporting | Cloud governance | Pastry chef |
|---|---:|---:|---:|---:|---:|
| Résumé only | 4 | 0.3372 | 0.6460 | 0.1132 | 0.0086 |
| Skip | 4 | 0.3372 | 0.6460 | 0.1132 | 0.0086 |
| Independent AWS use | 3 | 0.4127 | 0.6223 | 0.1531 | 0.0100 |
| AWS guidance/governance | 3 | 0.4035 | 0.6284 | 0.1772 | 0.0115 |

AWS responsibility moves cloud operations above data-quality administration. Independent AWS use changes unrelated pastry similarity by only 0.0014. Governance responsibility improves governance relevance but lowers cloud-operations similarity compared with independent use; seniority is not a universal score multiplier. Skipping reproduces all seven baseline values and ranks exactly. An unsupported target-title option ID is rejected before embedding.

This is one fixture, not population-wide ranking validation. Broader labelled résumé/Skills Framework benchmarks are still needed. Self-reports are unverified, semantic review is probabilistic, and embeddings may respond unexpectedly to negation or extra context. Canonical templates deliberately limit variety; unsupported evidence gaps fall back instead of accepting unconstrained generated claims.

## Files changed

Paths below are relative to `frontend/meong-my-way` unless noted.

- `src/lib/resume/questionnaire-types.ts`, `questionnaire.ts`: contracts, canonical question templates, ID validation and enrichment.
- `src/lib/agents/resume-context.ts`: Context Agent gap selection, review and fallback.
- `src/lib/resume/intake.ts`, `intake-store.ts`: intake orchestration, locking, completion and replay.
- `src/lib/agents/resume-parser.ts`, `digest.ts`, `orchestrator.ts`, `store.ts`, `src/lib/contracts.ts`: split parsing/embedding, provenance, downstream handoff and persistence.
- `src/app/api/analysis/intake/route.ts`, `src/app/api/analysis/route.ts`, `src/app/api/resume/route.ts`, `src/lib/resume/store.ts`: authenticated endpoints and invalidation.
- `src/lib/analysis/progress.ts`, `src/lib/analysis/client.ts`, `src/lib/resume/pipeline.ts`, `src/components/workspace.tsx`, `src/components/stages/questionnaire-stage.tsx`, `analysis-stage.tsx`, `src/components/app-header.tsx`: UX, progress and retries.
- Colocated questionnaire/intake/route/handoff tests, `pipeline.test.ts`, and `test/fixtures/questionnaire.ts`: regression/live coverage.
- Repository `iac/bedrock.tf`, both READMEs, and `docs/resume-questionnaire.md` / `docs/questionnaire-quality-results.json`: deployment and documentation.

The pre-existing deletion of `scripts/gen-architecture.js` was left untouched.

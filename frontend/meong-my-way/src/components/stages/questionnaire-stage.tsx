"use client";
import type { PublicQuestionnaire, QuestionnaireSelection } from "@/lib/resume/questionnaire-types";
import { Button, SectionLabel } from "@/components/ui/primitives";

export function QuestionnaireStage({ questionnaire, selections, onChange, onContinue, busy, error }: {
  questionnaire: PublicQuestionnaire;
  selections: Record<string, string>;
  onChange: (selections: Record<string, string>) => void;
  onContinue: (selections: QuestionnaireSelection[]) => void;
  busy: boolean;
  error: string | null;
}) {
  return <section className="mw-rise mx-auto max-w-3xl" aria-labelledby="questionnaire-title">
    <SectionLabel>Step 2 · Résumé addendum</SectionLabel>
    <h1 id="questionnaire-title" className="mt-2 text-3xl font-semibold tracking-tight text-ink">A little context your résumé may have missed</h1>
    <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-2">These questions help surface experience omitted from your résumé. Choose what reflects your work, or leave any question unanswered. Your answers add context to matching; a different similarity score does not mean your qualifications changed.</p>
    <form className="mt-8" onSubmit={event => { event.preventDefault(); onContinue(Object.entries(selections).map(([questionId, optionId]) => ({ questionId, optionId }))); }}>
      <div className="space-y-7">
        {questionnaire.questions.map(question => <fieldset key={question.id} disabled={busy} className="min-w-0 rounded-2xl border border-hairline bg-surface p-5 sm:p-6">
          <legend className="max-w-full px-2 text-base font-medium leading-relaxed text-ink">{question.prompt}</legend>
          <div className="mt-3 space-y-2">
            {question.options.map(option => <label key={option.id} className="flex cursor-pointer items-start gap-3 rounded-lg border border-hairline px-4 py-3 text-sm leading-relaxed text-ink has-[:checked]:border-accent has-[:checked]:bg-accent-wash has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent">
              <input type="radio" name={question.id} value={option.id} checked={selections[question.id] === option.id} onChange={() => onChange({ ...selections, [question.id]: option.id })} className="mt-1 size-4 shrink-0 accent-accent" />
              <span>{option.label}</span>
            </label>)}
          </div>
          <button type="button" disabled={busy || !selections[question.id]} onClick={() => { const next = { ...selections }; delete next[question.id]; onChange(next); }} className="mt-3 rounded px-1 py-1 text-xs text-ink-2 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50">Leave unanswered</button>
        </fieldset>)}
      </div>
      {error ? <p role="alert" className="mt-5 text-sm text-critical">{error}</p> : null}
      <div className="mt-7 flex flex-wrap items-center gap-3 border-t border-hairline pt-6">
        <Button type="submit" disabled={busy}>{busy ? "Continuing…" : "Continue"}</Button>
        <Button type="button" variant="secondary" disabled={busy} onClick={() => onContinue([])}>Skip for now</Button>
        <span className="text-xs text-ink-2">All questions are optional.</span>
      </div>
    </form>
  </section>;
}

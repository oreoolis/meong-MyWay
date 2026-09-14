import type { AnalysisBundle, ResumeProfile } from "@/lib/contracts";
import type { ModelUsage } from "@/lib/bedrock/reason";

export type EvidenceCategory = "proficiency" | "recency" | "context" | "scope";
export type ResumeQuestionOption = {
  id: string;
  label: string;
  evidence: string;
  contributesEvidence: boolean;
  category?: EvidenceCategory;
};
export type ResumeQuestion = {
  id: string;
  prompt: string;
  reference: string;
  options: ResumeQuestionOption[];
};
export type ResumeQuestionnaire = {
  intakeId: string;
  resumeId: string;
  version: 1;
  expiresAt: number;
  questions: ResumeQuestion[];
};
export type PublicQuestionnaire = Omit<ResumeQuestionnaire, "questions"> & {
  questions: (Omit<ResumeQuestion, "options"> & {
    options: Pick<ResumeQuestionOption, "id" | "label">[];
  })[];
};
export type QuestionnaireSelection = { questionId: string; optionId: string };
export type QuestionnaireSubmission = {
  intakeId: string;
  resumeId: string;
  version: 1;
  selections: QuestionnaireSelection[];
};
export type QuestionnaireEvidence = QuestionnaireSelection & {
  source: "questionnaire";
  /** The exact server-stored prompt shown to the candidate. */
  question?: string;
  /** The exact canonical option label selected by the candidate. */
  answer?: string;
  statement: string;
  category?: EvidenceCategory;
};
export type ParsedResume = {
  profile: Omit<ResumeProfile, "embedding" | "questionnaireEvidence">;
  embeddingText: string;
  usage: ModelUsage;
};
export type PendingResumeIntake = {
  questionnaire: ResumeQuestionnaire;
  parsed: ParsedResume;
  generationUsage: ModelUsage;
  /** False while the parsed-profile checkpoint is waiting for question generation. */
  questionsGenerated?: boolean;
  /** Invalidates cached questionnaires when generation/review behavior changes. */
  questionGenerationVersion?: number;
  submissionKey?: string;
  leaseToken?: string;
  leaseUntil?: number;
  result?: AnalysisBundle;
};
export type IntakeResponse = { profile: ParsedResume["profile"]; questionnaire: PublicQuestionnaire };

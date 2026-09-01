/**
 * The stored-resume record, as it crosses the network.
 *
 * Kept separate from `lib/contracts.ts` (which describes the agent payloads)
 * because this is the persistence layer's shape: what S3 and DynamoDB hold for
 * a user between sessions.
 */

import type { ResumeFormat } from "./file-policy";

export type StoredResume = {
  /** Cognito `sub`. Partition key — one active resume per user. */
  userId: string;
  /** Changes on every upload, so clients can tell a replacement apart. */
  resumeId: string;
  fileName: string;
  format: ResumeFormat;
  contentType: string;
  sizeBytes: number;
  /** Where the bytes live in the uploads bucket. */
  s3Key: string;
  /** ISO-8601. */
  uploadedAt: string;
  /**
   * How far the agent pipeline has got with this resume. `stored` means the
   * bytes and metadata are safe but nothing has read them yet.
   */
  status: "stored" | "parsed" | "planned";
};

/** The upload response: the record, plus whether it displaced an earlier one. */
export type ResumeUploadResult = {
  resume: StoredResume;
  replacedResumeId: string | null;
};

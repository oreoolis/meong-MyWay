import "server-only";

import { randomUUID } from "node:crypto";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";

import { getDocumentClient, getS3Client, getStorageConfig } from "@/lib/aws/clients";
import { RESUME_FORMATS, type ResumeFormat } from "./file-policy";
import type { ResumeUploadResult, StoredResume } from "./types";

/**
 * CRUD for a user's stored resume.
 *
 * The bytes go to S3; the metadata goes to DynamoDB keyed by `userId`, so each
 * user has exactly one active resume and re-uploading replaces it. Callers are
 * responsible for validating the upload before calling `putResume` — this
 * module assumes what it is given has already passed the file policy.
 */

/** S3 keys are namespaced per user so one user's prefix can be listed alone. */
function s3KeyFor(userId: string, resumeId: string, format: ResumeFormat) {
  return `resumes/${userId}/${resumeId}.${RESUME_FORMATS[format].extension}`;
}

export async function getResume(userId: string): Promise<StoredResume | null> {
  const { resumesTable } = getStorageConfig();

  const { Item } = await getDocumentClient().send(
    new GetCommand({ TableName: resumesTable, Key: { userId } }),
  );

  return (Item as StoredResume | undefined) ?? null;
}

/**
 * Store `bytes` as this user's resume, replacing any earlier one.
 *
 * Order matters: the new object is written and the metadata pointer flipped
 * before the old object is deleted, so an interruption leaves a readable
 * resume rather than a dangling pointer. A failed cleanup of the superseded
 * object is not fatal — it leaves an orphan, not a broken record.
 */
export async function putResume(input: {
  userId: string;
  fileName: string;
  format: ResumeFormat;
  contentType: string;
  bytes: Uint8Array;
}): Promise<ResumeUploadResult> {
  const { bucket, resumesTable } = getStorageConfig();
  const previous = await getResume(input.userId);

  const resumeId = randomUUID();
  const s3Key = s3KeyFor(input.userId, resumeId, input.format);

  await getS3Client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      Body: input.bytes,
      ContentType: input.contentType,
      // The original name, so a download can restore it. Encoded because S3
      // metadata is ASCII-only and resume filenames often are not.
      Metadata: {
        "original-filename": encodeURIComponent(input.fileName),
        "user-id": input.userId,
      },
    }),
  );

  const resume: StoredResume = {
    userId: input.userId,
    resumeId,
    fileName: input.fileName,
    format: input.format,
    contentType: input.contentType,
    sizeBytes: input.bytes.byteLength,
    s3Key,
    uploadedAt: new Date().toISOString(),
    status: "stored",
  };

  await getDocumentClient().send(
    new PutCommand({ TableName: resumesTable, Item: resume }),
  );

  if (previous && previous.s3Key !== s3Key) {
    try {
      await getS3Client().send(
        new DeleteObjectCommand({ Bucket: bucket, Key: previous.s3Key }),
      );
    } catch {
      // The pointer already moved; an orphaned object is not worth failing on.
    }
  }

  return { resume, replacedResumeId: previous?.resumeId ?? null };
}

/** Remove the stored resume entirely. No-op when there is nothing stored. */
export async function deleteResume(userId: string): Promise<boolean> {
  const { bucket, resumesTable } = getStorageConfig();
  const existing = await getResume(userId);
  if (!existing) return false;

  await getDocumentClient().send(
    new DeleteCommand({ TableName: resumesTable, Key: { userId } }),
  );

  try {
    await getS3Client().send(
      new DeleteObjectCommand({ Bucket: bucket, Key: existing.s3Key }),
    );
  } catch {
    // Metadata is gone, so the resume is unreachable either way.
  }

  return true;
}

/**
 * The raw bytes back out of S3 — what the parser agent will read once the
 * real pipeline replaces the mock.
 */
export async function readResumeBytes(resume: StoredResume): Promise<Uint8Array> {
  const { bucket } = getStorageConfig();

  const { Body } = await getS3Client().send(
    new GetObjectCommand({ Bucket: bucket, Key: resume.s3Key }),
  );

  if (!Body) throw new Error(`Resume object ${resume.s3Key} has no body.`);
  return new Uint8Array(await Body.transformToByteArray());
}

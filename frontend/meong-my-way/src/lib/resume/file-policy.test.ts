import { describe, expect, it } from "vitest";

import {
  MAX_RESUME_BYTES,
  resolveResumeFormat,
  resumeContentProblem,
  sniffResumeFormat,
  validateResumeUpload,
  type ParsedDocumentSignals,
} from "./file-policy";

/**
 * The two gates, tested as one story: what the bytes claim to be, and what
 * reading them turned up. Both return a message on rejection and `null` on a
 * pass, so every assertion here is either "explains itself" or "lets it
 * through".
 */

const pdf = { name: "resume.pdf", size: 200_000, type: "application/pdf" };

/** A parse that found a real person's history. */
const parsedResume: ParsedDocumentSignals = {
  kind: "resume",
  skillCount: 12,
  experienceCount: 3,
  educationCount: 1,
};

describe("validateResumeUpload", () => {
  it("accepts a PDF within the size limit", () => {
    expect(validateResumeUpload(pdf)).toBeNull();
  });

  it("accepts a DOCX whose MIME type is missing, as drag-and-drop often sends", () => {
    expect(
      validateResumeUpload({ name: "cv.docx", size: 40_000, type: "" }),
    ).toBeNull();
  });

  it("rejects legacy .doc, which the parser pipeline cannot read", () => {
    const problem = validateResumeUpload({
      name: "resume.doc",
      size: 40_000,
      type: "application/msword",
    });
    expect(problem).toMatch(/only pdf or word/i);
  });

  it("rejects an executable wearing a .pdf extension", () => {
    expect(
      validateResumeUpload({
        name: "resume.pdf",
        size: 40_000,
        type: "application/x-msdownload",
      }),
    ).toMatch(/only pdf or word/i);
  });

  it("rejects an empty file", () => {
    expect(validateResumeUpload({ ...pdf, size: 0 })).toMatch(/empty/i);
  });

  it("rejects a file over the size limit and names the limit", () => {
    expect(validateResumeUpload({ ...pdf, size: MAX_RESUME_BYTES + 1 })).toMatch(
      /larger than 5 MB/i,
    );
  });
});

describe("sniffResumeFormat", () => {
  it("reads a PDF by its magic number", () => {
    expect(sniffResumeFormat(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe(
      "pdf",
    );
  });

  it("reads a DOCX as the ZIP container it is", () => {
    expect(sniffResumeFormat(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe("docx");
  });

  it("refuses bytes that are neither", () => {
    expect(sniffResumeFormat(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toBeNull();
  });

  it("refuses a file too short to carry either signature", () => {
    expect(sniffResumeFormat(new Uint8Array([0x25]))).toBeNull();
  });
});

describe("resolveResumeFormat", () => {
  it("trusts the extension when the declared MIME type is generic", () => {
    expect(
      resolveResumeFormat({
        name: "resume.pdf",
        size: 1,
        type: "application/octet-stream",
      }),
    ).toBe("pdf");
  });

  it("refuses an extension its MIME type contradicts", () => {
    expect(
      resolveResumeFormat({ name: "resume.pdf", size: 1, type: "image/png" }),
    ).toBeNull();
  });
});

describe("resumeContentProblem", () => {
  it("lets a parsed resume through", () => {
    expect(resumeContentProblem(parsedResume)).toBeNull();
  });

  it("lets through a resume with experience but no education section", () => {
    expect(
      resumeContentProblem({ ...parsedResume, educationCount: 0 }),
    ).toBeNull();
  });

  it("rejects a document the parser called something else, and says what", () => {
    const problem = resumeContentProblem({
      kind: "other",
      description: "a quarterly marketing report",
      skillCount: 0,
      experienceCount: 0,
      educationCount: 0,
    });
    expect(problem).toBe(
      "That file looks like a quarterly marketing report, not a resume. " +
        "Upload your resume or CV and try again.",
    );
  });

  it("rejects it in general terms when the parser did not say what it was", () => {
    const problem = resumeContentProblem({
      kind: "other",
      skillCount: 0,
      experienceCount: 0,
      educationCount: 0,
    });
    expect(problem).toBe(
      "That file does not look like a resume. Upload your resume or CV and try again.",
    );
  });

  it("rejects a non-resume even when the parser extracted something anyway", () => {
    // The instruction is to leave the fields empty; a model that ignores it
    // must not buy its way past the verdict it already gave.
    expect(
      resumeContentProblem({ ...parsedResume, kind: "invoice" }),
    ).toMatch(/does not look like a resume/i);
  });

  it("drops a description too long to sit inside the sentence", () => {
    const problem = resumeContentProblem({
      kind: "other",
      description:
        "a sixty page annual report covering the group's performance across every region it operates in",
      skillCount: 0,
      experienceCount: 0,
      educationCount: 0,
    });
    expect(problem).toBe(
      "That file does not look like a resume. Upload your resume or CV and try again.",
    );
  });

  it("flattens a multi-line description and drops its trailing stop", () => {
    const problem = resumeContentProblem({
      kind: "other",
      description: "  an invoice\n  from a supplier.  ",
      skillCount: 0,
      experienceCount: 0,
      educationCount: 0,
    });
    expect(problem).toContain("looks like an invoice from a supplier, not a resume");
  });

  it("rejects a document it called a resume but found nothing in", () => {
    // A scan with no text layer looks exactly like this.
    expect(
      resumeContentProblem({
        kind: "resume",
        skillCount: 0,
        experienceCount: 0,
        educationCount: 0,
      }),
    ).toMatch(/could not find any work history/i);
  });

  it("rejects an empty parse even when the parser omitted its verdict", () => {
    expect(
      resumeContentProblem({ skillCount: 0, experienceCount: 0, educationCount: 0 }),
    ).toMatch(/could not find any work history/i);
  });

  it("accepts a resume whose only evidence is one job", () => {
    expect(
      resumeContentProblem({
        kind: "resume",
        skillCount: 0,
        experienceCount: 1,
        educationCount: 0,
      }),
    ).toBeNull();
  });
});

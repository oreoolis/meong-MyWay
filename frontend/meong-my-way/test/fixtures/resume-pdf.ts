/**
 * A real, minimal PDF built by hand.
 *
 * The integration test needs a document Bedrock will actually parse, and
 * pulling in a PDF library to make one would add a production-weight
 * dependency for a fixture. This writes the handful of objects a one-page
 * text PDF needs, with a correct cross-reference table — Bedrock rejects a PDF
 * whose xref offsets are wrong, so they are computed rather than guessed.
 */

/** Characters that terminate a PDF string literal if not escaped. */
function escapePdfText(text: string): string {
  return text.replace(/([\\()])/g, "\\$1");
}

/**
 * Build a single-page PDF containing `lines` in 10pt Helvetica.
 *
 * Deliberately plain: no images, no embedded fonts, no compression. The point
 * is to exercise the pipeline, and a fixture that is itself complicated makes
 * a failure ambiguous.
 */
export function buildTextPdf(lines: string[]): Uint8Array {
  const content =
    `BT\n/F1 10 Tf\n50 750 Td\n14 TL\n` +
    lines.map((line) => `(${escapePdfText(line)}) Tj T*`).join("\n") +
    `\nET\n`;

  const objects = [
    `<< /Type /Catalog /Pages 2 0 R >>`,
    `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`,
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];

  objects.forEach((body, index) => {
    // Byte offset of each object, which the xref table below must point at
    // exactly. Latin-1 keeps one character to one byte, so string length is
    // the byte offset.
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += `0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefStart}\n%%EOF\n`;

  // latin1, not utf8: the offsets above assume one byte per character.
  return new Uint8Array(Buffer.from(pdf, "latin1"));
}

/**
 * A fictional candidate with a deliberately unambiguous shape.
 *
 * Singapore-based and clearly in one sector, so the planner has an obvious
 * sector to pin and the swapper has an obvious set of sectors to avoid. The
 * assertions downstream check that structure came back, not that the model
 * reached a particular opinion about it.
 */
export const SAMPLE_RESUME_LINES = [
  "PRIYA RAMASWAMY",
  "Singapore  |  priya.r@example.com  |  +65 8000 0000",
  "",
  "SUMMARY",
  "Data analyst with 6 years in retail banking. Builds reporting pipelines",
  "and credit risk dashboards used by frontline lending teams.",
  "",
  "EXPERIENCE",
  "Senior Data Analyst — Meridian Bank, Singapore (2021 - Present)",
  "  - Rebuilt the credit risk reporting pipeline in Python and SQL,",
  "    cutting month-end close from 6 days to 2.",
  "  - Led migration of 40 Excel models onto a governed Snowflake warehouse.",
  "  - Mentored three junior analysts through the bank's graduate programme.",
  "",
  "Data Analyst — Kestrel Financial, Singapore (2019 - 2021)",
  "  - Built Tableau dashboards tracking loan portfolio performance.",
  "  - Automated regulatory MAS 610 submissions, removing manual rework.",
  "",
  "EDUCATION",
  "BSc Information Systems, Singapore Management University, 2019",
  "",
  "SKILLS",
  "Python, SQL, Snowflake, Tableau, dbt, credit risk modelling,",
  "stakeholder management, regulatory reporting",
  "",
  "CERTIFICATIONS",
  "Tableau Desktop Specialist (2022)",
];

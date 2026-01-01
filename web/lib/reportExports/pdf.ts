import type { ReportExportRow } from "./csv";

type PdfOptions = {
  title?: string;
};

export function generatePdf(rows: ReportExportRow[], options: PdfOptions = {}) {
  const title = options.title ?? "Report";
  const header = `${title}\n\n`;
  const body = rows
    .map((row) => Object.entries(row).map(([key, value]) => `${key}: ${value ?? ""}`).join(" | "))
    .join("\n");

  // Placeholder PDF representation until a full PDF library is integrated.
  // TODO: Add pagination, table styling, and watermarking for sensitive exports.
  const content = `${header}${body}`;
  return new Blob([content], { type: "application/pdf" });
}

export function downloadPdf(filename: string, rows: ReportExportRow[], options: PdfOptions = {}) {
  const blob = generatePdf(rows, options);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

import * as XLSX from "xlsx";

import type { ReportExportRow } from "./csv";

type XlsxOptions = {
  sheetName?: string;
};

export function generateXlsx(rows: ReportExportRow[], options: XlsxOptions = {}) {
  const sheetName = options.sheetName ?? "Report";
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

  // TODO: Add styling, column widths, and multi-sheet support.
  const arrayBuffer = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  return new Blob([arrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export function downloadXlsx(filename: string, rows: ReportExportRow[], options: XlsxOptions = {}) {
  const blob = generateXlsx(rows, options);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

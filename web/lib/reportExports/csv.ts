export type ReportExportRow = Record<string, string | number | boolean | null | undefined>;

type CsvOptions = {
  headers?: string[];
};

function escapeCsvValue(value: string) {
  const escaped = value.replace(/"/g, '""');
  return `"${escaped}"`;
}

export function generateCsv(rows: ReportExportRow[], options: CsvOptions = {}) {
  const headers = options.headers ?? (rows[0] ? Object.keys(rows[0]) : []);
  const lines = [headers.map(escapeCsvValue).join(",")];

  rows.forEach((row) => {
    const values = headers.map((header) => {
      const rawValue = row[header];
      if (rawValue === null || rawValue === undefined) return "";
      if (typeof rawValue === "number" || typeof rawValue === "boolean") {
        return escapeCsvValue(String(rawValue));
      }
      return escapeCsvValue(String(rawValue));
    });
    lines.push(values.join(","));
  });

  return lines.join("\n");
}

export function downloadCsv(filename: string, rows: ReportExportRow[], options: CsvOptions = {}) {
  const csv = generateCsv(rows, options);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

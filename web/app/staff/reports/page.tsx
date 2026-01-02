"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { loadSessionAndRole, useAuthStore } from "../../../lib/auth";
import { isStaffRole, roleRedirectPath } from "../../../lib/roles";
import { supabaseBrowser } from "../../../lib/supabase-browser";
import { downloadCsv } from "../../../lib/reportExports/csv";
import { downloadXlsx } from "../../../lib/reportExports/xlsx";
import { downloadPdf } from "../../../lib/reportExports/pdf";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

type ReportRow = {
  id: string;
  name: string;
  description: string | null;
  entity_type: string;
  created_at: string;
};

type RunReportResponse = {
  rows: Record<string, string | number | boolean | null>[];
  metadata: { columns: string[]; name: string };
};

function ReportsView() {
  const router = useRouter();
  const { session, role, loading } = useAuthStore();
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    loadSessionAndRole();
  }, []);

  useEffect(() => {
    if (!loading && (!session || !isStaffRole(role))) {
      router.replace(roleRedirectPath(role));
    }
  }, [loading, role, router, session]);

  useEffect(() => {
    const loadReports = async () => {
      const { data } = await supabaseBrowser
        .from("reports")
        .select("id, name, description, entity_type, created_at")
        .order("created_at", { ascending: false });
      setReports((data ?? []) as ReportRow[]);
      setLoadingData(false);
    };

    loadReports();
  }, []);

  const runReport = async (reportId: string) => {
    setRunning(reportId);
    const { data, error } = await supabaseBrowser.functions.invoke<RunReportResponse>("run-report", {
      body: { report_id: reportId },
    });
    setRunning(null);

    if (!error && data?.rows) {
      return data;
    }

    return null;
  };

  const handleDownload = async (reportId: string, format: "csv" | "xlsx" | "pdf") => {
    const result = await runReport(reportId);
    if (!result) return;

    const filename = `${result.metadata.name.replace(/\s+/g, "-").toLowerCase()}.${format}`;
    if (format === "csv") {
      downloadCsv(filename, result.rows, { headers: result.metadata.columns });
    } else if (format === "xlsx") {
      downloadXlsx(filename, result.rows, { sheetName: result.metadata.name });
    } else {
      downloadPdf(filename, result.rows, { title: result.metadata.name });
    }
  };

  if (loading || loadingData) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <main className="mx-auto max-w-6xl px-6 py-10 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold">Custom Reports</h1>
            <p className="text-sm text-slate-400">Run, download, or schedule saved reports.</p>
          </div>
          <Link
            className="rounded-md bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950"
            href="/staff/reports/builder"
          >
            New report
          </Link>
        </div>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2 text-left">Report</th>
                  <th className="py-2 text-left">Dataset</th>
                  <th className="py-2 text-left">Created</th>
                  <th className="py-2 text-left">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {reports.map((report) => (
                  <tr key={report.id}>
                    <td className="py-3 text-white">
                      <div className="font-medium">{report.name}</div>
                      <div className="text-xs text-slate-400">{report.description ?? "No description"}</div>
                    </td>
                    <td className="py-3 text-slate-300">{report.entity_type}</td>
                    <td className="py-3 text-slate-300">{new Date(report.created_at).toLocaleDateString()}</td>
                    <td className="py-3 text-slate-300">
                      <div className="flex flex-wrap gap-2">
                        <button
                          className="rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-200"
                          onClick={() => runReport(report.id)}
                          disabled={running === report.id}
                        >
                          {running === report.id ? "Running..." : "Run now"}
                        </button>
                        <button
                          className="rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-200"
                          onClick={() => handleDownload(report.id, "csv")}
                        >
                          CSV
                        </button>
                        <button
                          className="rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-200"
                          onClick={() => handleDownload(report.id, "xlsx")}
                        >
                          XLSX
                        </button>
                        <button
                          className="rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-200"
                          onClick={() => handleDownload(report.id, "pdf")}
                        >
                          PDF
                        </button>
                        <Link
                          className="rounded-md border border-cyan-500/60 px-3 py-1 text-xs text-cyan-200"
                          href={`/staff/reports/${report.id}/schedule`}
                        >
                          Manage schedule
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
                {reports.length === 0 ? (
                  <tr>
                    <td className="py-4 text-slate-400" colSpan={4}>
                      No reports saved yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}

export default function ReportsPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <ReportsView />
    </QueryClientProvider>
  );
}

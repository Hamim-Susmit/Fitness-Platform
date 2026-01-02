"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { loadSessionAndRole, useAuthStore } from "../../../../../lib/auth";
import { isStaffRole, roleRedirectPath } from "../../../../../lib/roles";
import { supabaseBrowser } from "../../../../../lib/supabase-browser";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

type ScheduleRow = {
  id: string;
  cadence: "daily" | "weekly" | "monthly";
  timezone: string;
  delivery_emails: string[];
  format: "csv" | "pdf" | "xlsx";
  is_active: boolean;
  next_run_at: string | null;
};

function computeNextRun(cadence: ScheduleRow["cadence"]) {
  const now = new Date();
  if (cadence === "daily") {
    now.setDate(now.getDate() + 1);
  } else if (cadence === "weekly") {
    now.setDate(now.getDate() + 7);
  } else {
    now.setMonth(now.getMonth() + 1);
  }
  return now.toISOString();
}

function ScheduleEditorView() {
  const router = useRouter();
  const params = useParams();
  const reportId = params?.reportId as string | undefined;
  const { session, role, loading } = useAuthStore();
  const [schedule, setSchedule] = useState<ScheduleRow | null>(null);
  const [cadence, setCadence] = useState<ScheduleRow["cadence"]>("monthly");
  const [timezone, setTimezone] = useState("UTC");
  const [format, setFormat] = useState<ScheduleRow["format"]>("csv");
  const [recipients, setRecipients] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
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
    const loadSchedule = async () => {
      if (!reportId) return;
      const { data } = await supabaseBrowser
        .from("report_schedules")
        .select("id, cadence, timezone, delivery_emails, format, is_active, next_run_at")
        .eq("report_id", reportId)
        .maybeSingle();

      if (data) {
        const row = data as ScheduleRow;
        setSchedule(row);
        setCadence(row.cadence);
        setTimezone(row.timezone);
        setFormat(row.format);
        setRecipients(row.delivery_emails.join(", "));
        setIsActive(row.is_active);
      }
      setLoadingData(false);
    };

    loadSchedule();
  }, [reportId]);

  const saveSchedule = async () => {
    if (!reportId) return;
    setSaving(true);
    const payload = {
      report_id: reportId,
      cadence,
      timezone,
      delivery_emails: recipients
        .split(",")
        .map((email) => email.trim())
        .filter(Boolean),
      format,
      is_active: isActive,
      next_run_at: isActive ? computeNextRun(cadence) : null,
    };

    const { error } = schedule
      ? await supabaseBrowser.from("report_schedules").update(payload).eq("id", schedule.id)
      : await supabaseBrowser.from("report_schedules").insert(payload);

    setSaving(false);

    if (!error) {
      router.push("/staff/reports");
    }
  };

  if (loading || loadingData) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <main className="mx-auto max-w-4xl px-6 py-10 space-y-6">
        <div>
          <h1 className="text-3xl font-semibold">Schedule Report</h1>
          <p className="text-sm text-slate-400">Set delivery cadence and recipients for exports.</p>
        </div>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="text-xs text-slate-400">Cadence</label>
              <select
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                value={cadence}
                onChange={(event) => setCadence(event.target.value as ScheduleRow["cadence"])}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-400">Timezone</label>
              <input
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-400">Recipients</label>
            <input
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
              placeholder="finance@gym.com, ops@gym.com"
              value={recipients}
              onChange={(event) => setRecipients(event.target.value)}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="text-xs text-slate-400">Format</label>
              <select
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                value={format}
                onChange={(event) => setFormat(event.target.value as ScheduleRow["format"])}
              >
                <option value="csv">CSV</option>
                <option value="xlsx">XLSX</option>
                <option value="pdf">PDF</option>
              </select>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(event) => setIsActive(event.target.checked)}
              />
              <span className="text-sm text-slate-300">Schedule active</span>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              className="rounded-md bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60"
              onClick={saveSchedule}
              disabled={saving}
            >
              {saving ? "Saving..." : "Save schedule"}
            </button>
            <button
              className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200"
              onClick={() => router.push("/staff/reports")}
            >
              Cancel
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}

export default function ScheduleEditorPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <ScheduleEditorView />
    </QueryClientProvider>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { loadSessionAndRole, useAuthStore } from "../../../../lib/auth";
import { isStaffRole, roleRedirectPath } from "../../../../lib/roles";
import { supabaseBrowser } from "../../../../lib/supabase-browser";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

type DatasetOption = {
  label: string;
  value: "members" | "attendance" | "revenue" | "classes";
  columns: string[];
  table: string;
};

type FilterRule = {
  column: string;
  operator: "eq" | "neq" | "gte" | "lte" | "ilike";
  value: string;
};

const datasets: DatasetOption[] = [
  {
    label: "Members",
    value: "members",
    table: "members",
    columns: ["id", "user_id", "gym_id", "status", "joined_at"],
  },
  {
    label: "Attendance",
    value: "attendance",
    table: "gym_daily_attendance_mv",
    columns: ["gym_id", "day", "total_checkins", "unique_members"],
  },
  {
    label: "Revenue",
    value: "revenue",
    table: "revenue_by_plan_mv",
    columns: ["plan_id", "gym_id", "month", "mrr_total", "arr_contribution", "active_subscriptions"],
  },
  {
    label: "Classes",
    value: "classes",
    table: "class_instance_attendance_mv",
    columns: [
      "class_instance_id",
      "class_id",
      "gym_id",
      "start_time",
      "capacity",
      "booked_count",
      "attended_count",
      "no_show_count",
    ],
  },
];

function ReportBuilderView() {
  const router = useRouter();
  const { session, role, loading } = useAuthStore();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [dataset, setDataset] = useState<DatasetOption>(datasets[0]);
  const [selectedColumns, setSelectedColumns] = useState<string[]>(datasets[0].columns.slice(0, 4));
  const [filters, setFilters] = useState<FilterRule[]>([]);
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadSessionAndRole();
  }, []);

  useEffect(() => {
    if (!loading && (!session || !isStaffRole(role))) {
      router.replace(roleRedirectPath(role));
    }
  }, [loading, role, router, session]);

  useEffect(() => {
    setSelectedColumns(dataset.columns.slice(0, 4));
    setFilters([]);
  }, [dataset]);

  const preview = async () => {
    setLoadingPreview(true);
    let query = supabaseBrowser.from(dataset.table).select(selectedColumns.join(", ")).limit(20);

    filters
      .filter((rule) => rule.column && rule.operator && rule.value)
      .forEach((rule) => {
        if (rule.operator === "eq") query = query.eq(rule.column, rule.value);
        if (rule.operator === "neq") query = query.neq(rule.column, rule.value);
        if (rule.operator === "gte") query = query.gte(rule.column, rule.value);
        if (rule.operator === "lte") query = query.lte(rule.column, rule.value);
        if (rule.operator === "ilike") query = query.ilike(rule.column, rule.value);
      });

    const { data } = await query;
    setPreviewRows((data ?? []) as Record<string, unknown>[]);
    setLoadingPreview(false);
  };

  const saveReport = async () => {
    if (!session?.user.id) return;
    setSaving(true);
    const payload = {
      owner_user_id: session.user.id,
      name,
      description: description || null,
      entity_type: dataset.value,
      filters: { rules: filters },
      columns: selectedColumns,
      visualization: null,
    };

    const { error } = await supabaseBrowser.from("reports").insert(payload);
    setSaving(false);

    if (!error) {
      router.push("/staff/reports");
    }
  };

  const addFilter = () => {
    setFilters((prev) => [...prev, { column: dataset.columns[0], operator: "eq", value: "" }]);
  };

  const updateFilter = (index: number, next: Partial<FilterRule>) => {
    setFilters((prev) => prev.map((rule, idx) => (idx === index ? { ...rule, ...next } : rule)));
  };

  const columnsOptions = useMemo(() => dataset.columns, [dataset]);

  if (loading) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <main className="mx-auto max-w-6xl px-6 py-10 space-y-6">
        <div>
          <h1 className="text-3xl font-semibold">Report Builder</h1>
          <p className="text-sm text-slate-400">Create reusable templates for scheduled exports.</p>
        </div>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="text-xs text-slate-400">Report name</label>
              <input
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-slate-400">Dataset</label>
              <select
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                value={dataset.value}
                onChange={(event) => {
                  const next = datasets.find((item) => item.value === event.target.value);
                  if (next) setDataset(next);
                }}
              >
                {datasets.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-400">Description (optional)</label>
            <textarea
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <div>
            <label className="text-xs text-slate-400">Columns</label>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {columnsOptions.map((column) => (
                <label key={column} className="flex items-center gap-2 text-sm text-slate-300">
                  <input
                    type="checkbox"
                    checked={selectedColumns.includes(column)}
                    onChange={(event) => {
                      setSelectedColumns((prev) =>
                        event.target.checked ? [...prev, column] : prev.filter((item) => item !== column)
                      );
                    }}
                  />
                  {column}
                </label>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs text-slate-400">Filters</label>
              <button
                className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300"
                onClick={addFilter}
              >
                Add filter
              </button>
            </div>
            <div className="mt-2 space-y-2">
              {filters.map((filter, index) => (
                <div key={index} className="grid gap-2 md:grid-cols-3">
                  <select
                    className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                    value={filter.column}
                    onChange={(event) => updateFilter(index, { column: event.target.value })}
                  >
                    {columnsOptions.map((column) => (
                      <option key={column} value={column}>
                        {column}
                      </option>
                    ))}
                  </select>
                  <select
                    className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                    value={filter.operator}
                    onChange={(event) => updateFilter(index, { operator: event.target.value as FilterRule["operator"] })}
                  >
                    {[
                      { label: "Equals", value: "eq" },
                      { label: "Not equal", value: "neq" },
                      { label: "Greater than", value: "gte" },
                      { label: "Less than", value: "lte" },
                      { label: "Contains", value: "ilike" },
                    ].map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <input
                    className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                    value={filter.value}
                    onChange={(event) => updateFilter(index, { value: event.target.value })}
                  />
                </div>
              ))}
              {filters.length === 0 ? <p className="text-xs text-slate-500">No filters yet.</p> : null}
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200"
              onClick={preview}
            >
              Preview
            </button>
            <button
              className="rounded-md bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60"
              onClick={saveReport}
              disabled={!name || selectedColumns.length === 0 || saving}
            >
              {saving ? "Saving..." : "Save report"}
            </button>
          </div>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <h2 className="text-lg font-semibold">Preview</h2>
          <p className="text-xs text-slate-400">Preview is limited to 20 rows.</p>
          <div className="mt-4 overflow-x-auto">
            {loadingPreview ? (
              <div className="h-24 animate-pulse rounded-xl bg-slate-900" />
            ) : (
              <table className="min-w-full text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    {selectedColumns.map((column) => (
                      <th key={column} className="py-2 text-left">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {previewRows.map((row, index) => (
                    <tr key={index}>
                      {selectedColumns.map((column) => (
                        <td key={column} className="py-2 text-slate-300">
                          {String(row[column] ?? "—")}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {previewRows.length === 0 ? (
                    <tr>
                      <td className="py-4 text-slate-400" colSpan={selectedColumns.length}>
                        Run preview to see data.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

export default function ReportBuilderPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <ReportBuilderView />
    </QueryClientProvider>
  );
}

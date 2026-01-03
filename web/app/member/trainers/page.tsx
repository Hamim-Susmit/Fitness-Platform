"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { loadSessionAndRole, useAuthStore } from "../../../lib/auth";
import { roleRedirectPath } from "../../../lib/roles";
import { supabaseBrowser } from "../../../lib/supabase-browser";

type TrainerRow = {
  id: string;
  user_id: string;
  bio: string;
  certifications: string[];
  specialties: string[];
  hourly_rate: number;
  profile_photo_url: string | null;
  rating_avg: number;
  rating_count: number;
  users?: { full_name: string | null } | null;
};

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

function TrainerDirectoryView() {
  const router = useRouter();
  const { session, role, loading } = useAuthStore();
  const [trainers, setTrainers] = useState<TrainerRow[]>([]);
  const [specialtyFilter, setSpecialtyFilter] = useState("");
  const [certFilter, setCertFilter] = useState("");
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    loadSessionAndRole();
  }, []);

  useEffect(() => {
    if (!loading && (!session || role !== "member")) {
      router.replace(roleRedirectPath(role));
    }
  }, [loading, role, router, session]);

  useEffect(() => {
    const loadData = async () => {
      setLoadingData(true);
      let query = supabaseBrowser
        .from("personal_trainers")
        .select("id, user_id, bio, certifications, specialties, hourly_rate, profile_photo_url, rating_avg, rating_count, users(full_name)")
        .order("rating_avg", { ascending: false });

      if (specialtyFilter) {
        query = query.contains("specialties", [specialtyFilter]);
      }
      if (certFilter) {
        query = query.contains("certifications", [certFilter]);
      }

      const { data } = await query;
      setTrainers((data ?? []) as TrainerRow[]);
      setLoadingData(false);
    };

    loadData();
  }, [certFilter, specialtyFilter]);

  const specialties = useMemo(() => {
    return Array.from(new Set(trainers.flatMap((trainer) => trainer.specialties ?? []))).sort();
  }, [trainers]);

  const certifications = useMemo(() => {
    return Array.from(new Set(trainers.flatMap((trainer) => trainer.certifications ?? []))).sort();
  }, [trainers]);

  if (loading || loadingData) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <main className="mx-auto max-w-5xl px-6 py-10 space-y-6">
        <div>
          <h1 className="text-3xl font-semibold">Trainer Directory</h1>
          <p className="text-sm text-slate-400">Find a coach based on specialties and certifications.</p>
        </div>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 grid gap-4 md:grid-cols-2">
          <div>
            <label className="text-xs text-slate-400">Filter by specialty</label>
            <select
              className="mt-2 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
              value={specialtyFilter}
              onChange={(event) => setSpecialtyFilter(event.target.value)}
            >
              <option value="">All specialties</option>
              {specialties.map((specialty) => (
                <option key={specialty} value={specialty}>
                  {specialty}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400">Filter by certification</label>
            <select
              className="mt-2 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
              value={certFilter}
              onChange={(event) => setCertFilter(event.target.value)}
            >
              <option value="">All certifications</option>
              {certifications.map((certification) => (
                <option key={certification} value={certification}>
                  {certification}
                </option>
              ))}
            </select>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          {trainers.map((trainer) => (
            <div key={trainer.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-2">
              <h2 className="text-lg font-semibold">{trainer.users?.full_name ?? "Trainer"}</h2>
              <p className="text-sm text-slate-300">{trainer.bio || "No bio yet."}</p>
              <div className="text-xs text-slate-400">Specialties: {(trainer.specialties ?? []).join(", ") || "—"}</div>
              <div className="text-xs text-slate-400">Certifications: {(trainer.certifications ?? []).join(", ") || "—"}</div>
              <div className="text-sm text-slate-200">${trainer.hourly_rate}/hr</div>
              <button
                className="rounded-md border border-cyan-500/60 px-3 py-2 text-sm text-cyan-200"
                onClick={() => window.alert("Training request sent. We'll follow up soon.")}
              >
                Request training
              </button>
            </div>
          ))}
          {trainers.length === 0 ? <p className="text-sm text-slate-400">No trainers found.</p> : null}
        </section>
      </main>
    </div>
  );
}

export default function TrainerDirectoryPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <TrainerDirectoryView />
    </QueryClientProvider>
  );
}

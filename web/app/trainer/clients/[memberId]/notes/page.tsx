"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { loadSessionAndRole, useAuthStore } from "../../../../../lib/auth";
import { roleRedirectPath } from "../../../../../lib/roles";
import { supabaseBrowser } from "../../../../../lib/supabase-browser";

type TrainerRow = {
  id: string;
};

type NoteRow = {
  id: string;
  note: string;
  visibility: "TRAINER_ONLY" | "SHARED_WITH_MEMBER";
  created_at: string;
};

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

function MemberNotesView() {
  const router = useRouter();
  const params = useParams();
  const memberId = params?.memberId as string | undefined;
  const { session, loading } = useAuthStore();
  const [trainer, setTrainer] = useState<TrainerRow | null>(null);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [noteText, setNoteText] = useState("");
  const [visibility, setVisibility] = useState<NoteRow["visibility"]>("TRAINER_ONLY");
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    loadSessionAndRole();
  }, []);

  useEffect(() => {
    if (!loading && !session) {
      router.replace(roleRedirectPath(null));
    }
  }, [loading, router, session]);

  useEffect(() => {
    const loadData = async () => {
      if (!session?.user.id || !memberId) return;
      setLoadingData(true);
      const { data: trainerRow } = await supabaseBrowser
        .from("personal_trainers")
        .select("id")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (!trainerRow) {
        router.replace("/member");
        return;
      }

      const { data: noteRows } = await supabaseBrowser
        .from("trainer_progress_notes")
        .select("id, note, visibility, created_at")
        .eq("trainer_id", trainerRow.id)
        .eq("member_id", memberId)
        .order("created_at", { ascending: false });

      setTrainer(trainerRow as TrainerRow);
      setNotes((noteRows ?? []) as NoteRow[]);
      setLoadingData(false);
    };

    loadData();
  }, [memberId, router, session?.user.id]);

  const addNote = async () => {
    if (!trainer || !memberId || !noteText.trim()) return;
    const { data } = await supabaseBrowser
      .from("trainer_progress_notes")
      .insert({
        trainer_id: trainer.id,
        member_id: memberId,
        note: noteText,
        visibility,
      })
      .select("id, note, visibility, created_at")
      .maybeSingle();

    if (data) {
      setNotes((prev) => [data as NoteRow, ...prev]);
      setNoteText("");
    }
  };

  if (loading || loadingData) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <main className="mx-auto max-w-4xl px-6 py-10 space-y-6">
        <div>
          <h1 className="text-3xl font-semibold">Progress Notes</h1>
          <p className="text-sm text-slate-400">Add coaching notes and control visibility.</p>
        </div>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
          <textarea
            className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
            value={noteText}
            onChange={(event) => setNoteText(event.target.value)}
            placeholder="Write a coaching note..."
          />
          <div className="flex flex-wrap gap-3 items-center">
            <select
              className="rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
              value={visibility}
              onChange={(event) => setVisibility(event.target.value as NoteRow["visibility"])}
            >
              <option value="TRAINER_ONLY">Trainer only</option>
              <option value="SHARED_WITH_MEMBER">Shared with member</option>
            </select>
            <button className="rounded-md bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950" onClick={addNote}>
              Add note
            </button>
          </div>
        </section>

        <section className="space-y-3">
          {notes.map((note) => (
            <div key={note.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="text-xs text-slate-500">{new Date(note.created_at).toLocaleString()}</div>
              <div className="text-sm text-slate-200 mt-2">{note.note}</div>
              <div className="text-xs text-slate-500 mt-2">Visibility: {note.visibility}</div>
            </div>
          ))}
          {notes.length === 0 ? <p className="text-sm text-slate-400">No notes yet.</p> : null}
        </section>
      </main>
    </div>
  );
}

export default function MemberNotesPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <MemberNotesView />
    </QueryClientProvider>
  );
}

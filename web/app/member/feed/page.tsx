"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { loadSessionAndRole, useAuthStore } from "../../../lib/auth";
import { roleRedirectPath } from "../../../lib/roles";
import { supabaseBrowser } from "../../../lib/supabase-browser";

type FeedEventRow = {
  id: string;
  member_id: string;
  event_type: string;
  related_id: string | null;
  payload_json: Record<string, unknown>;
  created_at: string;
};

type LikeRow = { event_id: string; member_id: string };

type CommentRow = { event_id: string; member_id: string; comment_text: string; created_at: string };
type ProfileRow = { id: string; full_name: string | null };

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

function FeedView() {
  const router = useRouter();
  const { session, role, loading } = useAuthStore();
  const [events, setEvents] = useState<FeedEventRow[]>([]);
  const [likes, setLikes] = useState<LikeRow[]>([]);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [page, setPage] = useState(0);
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    loadSessionAndRole();
  }, []);

  useEffect(() => {
    if (!loading && (!session || role !== "member")) {
      router.replace(roleRedirectPath(role));
    }
  }, [loading, role, router, session]);

  const loadEvents = async (pageIndex: number) => {
    setLoadingData(true);
    const { data } = await supabaseBrowser
      .from("activity_feed_events")
      .select("id, member_id, event_type, related_id, payload_json, created_at")
      .order("created_at", { ascending: false })
      .range(pageIndex * 10, pageIndex * 10 + 9);

    const eventRows = (data ?? []) as FeedEventRow[];
    const eventIds = eventRows.map((row) => row.id);

    const [{ data: likeRows }, { data: commentRows }, { data: profileRows }] = await Promise.all([
      eventIds.length ? supabaseBrowser.from("feed_likes").select("event_id, member_id").in("event_id", eventIds) : Promise.resolve({ data: [] }),
      eventIds.length
        ? supabaseBrowser
            .from("feed_comments")
            .select("event_id, member_id, comment_text, created_at")
            .in("event_id", eventIds)
            .order("created_at", { ascending: true })
        : Promise.resolve({ data: [] }),
      eventIds.length
        ? supabaseBrowser
            .from("users")
            .select("id, full_name")
            .in("id", eventRows.map((row) => row.member_id))
        : Promise.resolve({ data: [] }),
    ]);

    setEvents((prev) => (pageIndex === 0 ? eventRows : [...prev, ...eventRows]));
    setLikes((prev) => (pageIndex === 0 ? (likeRows ?? []) as LikeRow[] : [...prev, ...((likeRows ?? []) as LikeRow[])]));
    setComments((prev) => (pageIndex === 0 ? (commentRows ?? []) as CommentRow[] : [...prev, ...((commentRows ?? []) as CommentRow[])]));
    if (profileRows) {
      const mapped = (profileRows as ProfileRow[]).reduce<Record<string, string>>((acc, row) => {
        acc[row.id] = row.full_name ?? "Member";
        return acc;
      }, {});
      setProfiles((prev) => ({ ...prev, ...mapped }));
    }
    setLoadingData(false);
  };

  useEffect(() => {
    loadEvents(0);
  }, []);

  const likeEvent = async (eventId: string) => {
    if (!session?.user.id) return;
    const { data } = await supabaseBrowser
      .from("feed_likes")
      .insert({ event_id: eventId, member_id: session.user.id })
      .select("event_id, member_id")
      .maybeSingle();

    if (data) {
      setLikes((prev) => [...prev, data as LikeRow]);
    }
  };

  const addComment = async (eventId: string, text: string) => {
    if (!session?.user.id || !text.trim()) return;
    const { data } = await supabaseBrowser
      .from("feed_comments")
      .insert({ event_id: eventId, member_id: session.user.id, comment_text: text })
      .select("event_id, member_id, comment_text, created_at")
      .maybeSingle();

    if (data) {
      setComments((prev) => [...prev, data as CommentRow]);
    }
  };

  const groupedComments = useMemo(() => {
    return comments.reduce<Record<string, CommentRow[]>>((acc, row) => {
      acc[row.event_id] = acc[row.event_id] ?? [];
      acc[row.event_id].push(row);
      return acc;
    }, {});
  }, [comments]);

  const likeCounts = useMemo(() => {
    return likes.reduce<Record<string, number>>((acc, row) => {
      acc[row.event_id] = (acc[row.event_id] ?? 0) + 1;
      return acc;
    }, {});
  }, [likes]);

  if (loading || (loadingData && page === 0)) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <main className="mx-auto max-w-4xl px-6 py-10 space-y-6">
        <div>
          <h1 className="text-3xl font-semibold">Activity Feed</h1>
          <p className="text-sm text-slate-400">Encourage friends and celebrate milestones.</p>
        </div>

        <section className="space-y-4">
          {events.map((event) => (
            <div key={event.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
              <div className="text-xs text-slate-500">{profiles[event.member_id] ?? "Member"} • {new Date(event.created_at).toLocaleString()}</div>
              <div className="text-sm text-slate-200">{event.event_type.replace(/_/g, " ")}</div>
              <div className="text-xs text-slate-400">{event.payload_json?.title ?? "Activity"}</div>
              <div className="flex items-center gap-3 text-xs">
                <button className="rounded-md border border-slate-700 px-2 py-1 text-slate-200" onClick={() => likeEvent(event.id)}>
                  Like ({likeCounts[event.id] ?? 0})
                </button>
                {event.related_id ? (
                  <button
                    className="rounded-md border border-slate-700 px-2 py-1 text-slate-200"
                    onClick={() => {
                      if (event.event_type === "WORKOUT_COMPLETED") {
                        router.push(`/member/workouts/${event.related_id}/log`);
                      } else if (event.event_type === "GOAL_COMPLETED") {
                        router.push(`/member/goals/${event.related_id}`);
                      } else if (event.event_type === "ACHIEVEMENT_EARNED") {
                        router.push(`/member/achievements`);
                      }
                    }}
                  >
                    View
                  </button>
                ) : null}
              </div>
              <div className="space-y-2">
                {(groupedComments[event.id] ?? []).map((comment, index) => (
                  <div key={`${comment.event_id}-${index}`} className="text-xs text-slate-400">{comment.comment_text}</div>
                ))}
                <CommentInput onSubmit={(text) => addComment(event.id, text)} />
              </div>
            </div>
          ))}
          {events.length === 0 ? <p className="text-sm text-slate-400">No activity yet.</p> : null}
        </section>

        <button
          className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200"
          onClick={() => {
            const nextPage = page + 1;
            setPage(nextPage);
            loadEvents(nextPage);
          }}
        >
          Load more
        </button>
      </main>
    </div>
  );
}

function CommentInput({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="flex gap-2">
      <input
        className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs"
        placeholder="Write a comment"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <button
        className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-200"
        onClick={() => {
          onSubmit(value);
          setValue("");
        }}
      >
        Post
      </button>
    </div>
  );
}

export default function FeedPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <FeedView />
    </QueryClientProvider>
  );
}

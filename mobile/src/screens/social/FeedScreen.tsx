import { useEffect, useMemo, useState } from "react";
import { Button, FlatList, Text, TextInput, View } from "react-native";
import { supabase } from "../../lib/supabase";

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

export default function FeedScreen() {
  const [events, setEvents] = useState<FeedEventRow[]>([]);
  const [likes, setLikes] = useState<LikeRow[]>([]);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);

  const loadEvents = async (pageIndex: number) => {
    setLoading(true);
    const { data } = await supabase
      .from("activity_feed_events")
      .select("id, member_id, event_type, related_id, payload_json, created_at")
      .order("created_at", { ascending: false })
      .range(pageIndex * 10, pageIndex * 10 + 9);

    const rows = (data ?? []) as FeedEventRow[];
    const ids = rows.map((row) => row.id);

    const [{ data: likeRows }, { data: commentRows }] = await Promise.all([
      ids.length ? supabase.from("feed_likes").select("event_id, member_id").in("event_id", ids) : Promise.resolve({ data: [] }),
      ids.length
        ? supabase
            .from("feed_comments")
            .select("event_id, member_id, comment_text, created_at")
            .in("event_id", ids)
            .order("created_at", { ascending: true })
        : Promise.resolve({ data: [] }),
    ]);

    setEvents((prev) => (pageIndex === 0 ? rows : [...prev, ...rows]));
    setLikes((prev) => (pageIndex === 0 ? (likeRows ?? []) as LikeRow[] : [...prev, ...((likeRows ?? []) as LikeRow[])]));
    setComments((prev) => (pageIndex === 0 ? (commentRows ?? []) as CommentRow[] : [...prev, ...((commentRows ?? []) as CommentRow[])]));
    setLoading(false);
  };

  useEffect(() => {
    loadEvents(0);
  }, []);

  const likeEvent = async (eventId: string) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.from("feed_likes").insert({ event_id: eventId, member_id: user.id }).select("event_id, member_id").maybeSingle();
    if (data) {
      setLikes((prev) => [...prev, data as LikeRow]);
    }
  };

  const addComment = async (eventId: string, text: string) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || !text.trim()) return;
    const { data } = await supabase
      .from("feed_comments")
      .insert({ event_id: eventId, member_id: user.id, comment_text: text })
      .select("event_id, member_id, comment_text, created_at")
      .maybeSingle();
    if (data) {
      setComments((prev) => [...prev, data as CommentRow]);
    }
  };

  const commentMap = useMemo(() => {
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

  if (loading && page === 0) {
    return (
      <View style={{ flex: 1, padding: 20 }}>
        <Text>Loading feed...</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 20 }}>
      <Text style={{ fontSize: 20, fontWeight: "600", marginBottom: 12 }}>Activity Feed</Text>
      <FlatList
        data={events}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#e2e8f0" }}>
            <Text>{item.event_type.replace(/_/g, " ")}</Text>
            <Text>{String(item.payload_json?.title ?? "Activity")}</Text>
            <Text>{new Date(item.created_at).toLocaleString()}</Text>
            <Button title={`Like (${likeCounts[item.id] ?? 0})`} onPress={() => likeEvent(item.id)} />
            <CommentInput onSubmit={(text) => addComment(item.id, text)} />
            {(commentMap[item.id] ?? []).map((comment, index) => (
              <Text key={`${comment.event_id}-${index}`}>{comment.comment_text}</Text>
            ))}
          </View>
        )}
        ListEmptyComponent={<Text>No feed activity yet.</Text>}
      />
      <Button title="Load more" onPress={() => {
        const next = page + 1;
        setPage(next);
        loadEvents(next);
      }} />
    </View>
  );
}

function CommentInput({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
      <TextInput
        placeholder="Comment"
        value={value}
        onChangeText={setValue}
        style={{ borderWidth: 1, borderColor: "#cbd5f5", padding: 8, flex: 1 }}
      />
      <Button title="Post" onPress={() => { onSubmit(value); setValue(""); }} />
    </View>
  );
}

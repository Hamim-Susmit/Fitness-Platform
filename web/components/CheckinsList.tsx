"use client";

import type { Checkin } from "../lib/types";

const formatTime = (timestamp: string) => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

type CheckinsListProps = {
  checkins: Checkin[];
  title?: string;
};

export default function CheckinsList({ checkins, title }: CheckinsListProps) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">{title ?? "Recent Check-ins"}</h2>
        <span className="text-xs text-slate-400">{checkins.length} total</span>
      </div>
      <div className="space-y-3">
        {checkins.length === 0 ? (
          <p className="text-sm text-slate-400">No check-ins yet.</p>
        ) : (
          checkins.map((checkin) => (
            <div
              key={checkin.id}
              className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950 px-4 py-3"
            >
              <div>
                <p className="text-sm text-white">Member #{checkin.member_id.slice(0, 6)}</p>
                <p className="text-xs text-slate-500">{checkin.source.toUpperCase()} check-in</p>
              </div>
              <p className="text-sm text-slate-300">{formatTime(checkin.checked_in_at)}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

"use client";

import type { ClassInstance } from "../lib/useClassSchedule";

type ClassInstanceCardProps = {
  instance: ClassInstance;
  spotsLeft: number;
  isBooked: boolean;
  isWaitlisted: boolean;
  onBook: () => void;
  onCancel: () => void;
  onWaitlist: () => void;
  disabled: boolean;
  pending: boolean;
};

export default function ClassInstanceCard({
  instance,
  spotsLeft,
  isBooked,
  isWaitlisted,
  onBook,
  onCancel,
  onWaitlist,
  disabled,
  pending,
}: ClassInstanceCardProps) {
  const instructorName = instance.class_schedules?.instructors?.users?.full_name ?? "Staff";
  const className = instance.class_schedules?.class_types?.name ?? "Class";
  const startTime = new Date(instance.start_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const endTime = new Date(instance.end_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const isFull = spotsLeft <= 0;

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white">{className}</h3>
          <p className="text-sm text-slate-400">{instructorName}</p>
        </div>
        <span className="text-xs text-slate-400">
          {startTime} - {endTime}
        </span>
      </div>
      <div className="mt-3 flex items-center gap-3 text-xs">
        {isBooked ? (
          <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-emerald-300">Booked</span>
        ) : null}
        {isWaitlisted ? (
          <span className="rounded-full bg-amber-500/10 px-2 py-1 text-amber-300">Waitlist</span>
        ) : null}
        {isFull && !isBooked ? (
          <span className="rounded-full bg-rose-500/10 px-2 py-1 text-rose-300">Full</span>
        ) : (
          <span className="rounded-full bg-slate-800 px-2 py-1 text-slate-300">
            {spotsLeft} spots left
          </span>
        )}
      </div>
      <div className="mt-4 flex gap-3">
        {isBooked ? (
          <button
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
            onClick={onCancel}
            disabled={pending}
          >
            {pending ? "Canceling..." : "Cancel"}
          </button>
        ) : isFull ? (
          <button
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
            onClick={onWaitlist}
            disabled={pending || isWaitlisted}
          >
            {isWaitlisted ? "Waitlisted" : pending ? "Joining..." : "Join Waitlist"}
          </button>
        ) : (
          <button
            className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60"
            onClick={onBook}
            disabled={disabled || pending}
          >
            {pending ? "Booking..." : "Book"}
          </button>
        )}
      </div>
    </div>
  );
}

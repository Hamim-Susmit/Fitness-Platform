"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { loadSessionAndRole, useAuthStore, useToastStore } from "../../../../../lib/auth";
import { isStaffRole, roleRedirectPath } from "../../../../../lib/roles";
import {
  getUserRoleContext,
  canManageGymSettings,
  getGymRoleLabel,
} from "../../../../../lib/permissions/gymPermissions";
import {
  useAddGymNote,
  useAuditLog,
  useGymAmenities,
  useGymHolidays,
  useGymHours,
  useGymMetadata,
  useGymNotes,
  useGymStaff,
  useManageAmenities,
  useManageHolidays,
  useManageStaffActions,
  useUpdateGymMetadata,
  useUpdateHours,
} from "../../../../../lib/hooks/useGymManagement";

// TODO: add soft-delete gyms with archival view.
// TODO: add location image gallery support.
// TODO: add bulk import/export for location hours.

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 2, refetchOnWindowFocus: false },
  },
});

const weekdayLabels = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function describeAuditEvent(eventType: string, payload: Record<string, unknown>) {
  switch (eventType) {
    case "GYM_UPDATED":
      return "Gym metadata updated.";
    case "HOURS_UPDATED":
      return `Hours updated (${payload.count ?? 0} entries).`;
    case "HOLIDAY_ADDED":
      return `Holiday added (${payload.label ?? payload.date ?? "unknown"}).`;
    case "HOLIDAY_REMOVED":
      return `Holiday removed (${payload.label ?? payload.date ?? "unknown"}).`;
    case "AMENITY_ADDED":
      return `Amenity added (${payload.label ?? "unknown"}).`;
    case "AMENITY_REMOVED":
      return `Amenity removed (${payload.label ?? "unknown"}).`;
    case "STAFF_ASSIGNED":
      return `Staff assigned (${payload.role ?? "role updated"}).`;
    case "STAFF_ROLE_CHANGED":
      return `Staff role updated (${payload.role ?? "role updated"}).`;
    case "STAFF_REMOVED":
      return "Staff removed.";
    case "NOTE_ADDED":
      return "Internal note added.";
    default:
      return "Activity logged.";
  }
}

function LocationManagementConsole() {
  const router = useRouter();
  const params = useParams();
  const gymId = params?.gymId as string | undefined;
  const { session, role, loading } = useAuthStore();
  const { message, status } = useToastStore();
  const { data: metadata, isLoading: metadataLoading } = useGymMetadata(gymId);
  const { data: hours } = useGymHours(gymId);
  const { data: holidays } = useGymHolidays(gymId);
  const { data: amenities } = useGymAmenities(gymId);
  const { data: staff } = useGymStaff(gymId);
  const { data: notes } = useGymNotes(gymId);
  const { data: auditEvents } = useAuditLog(gymId);
  const updateGym = useUpdateGymMetadata();
  const updateHours = useUpdateHours();
  const { addHoliday, removeHoliday } = useManageHolidays();
  const { addAmenity, removeAmenity } = useManageAmenities();
  const { assignStaff, updateRole, removeStaff } = useManageStaffActions();
  const addNote = useAddGymNote();
  const [readOnly, setReadOnly] = useState(true);
  const [roleLabel, setRoleLabel] = useState("Read-Only");

  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [hoursDraft, setHoursDraft] = useState(
    weekdayLabels.map((_label, index) => ({
      day_of_week: index,
      open_time: "",
      close_time: "",
      closed: true,
    }))
  );
  const [holidayDate, setHolidayDate] = useState("");
  const [holidayLabel, setHolidayLabel] = useState("");
  const [amenityLabel, setAmenityLabel] = useState("");
  const [amenityIcon, setAmenityIcon] = useState("");
  const [staffUserId, setStaffUserId] = useState("");
  const [staffRole, setStaffRole] = useState("STAFF");
  const [noteText, setNoteText] = useState("");

  useEffect(() => {
    loadSessionAndRole();
  }, []);

  useEffect(() => {
    if (!loading && (!session || !isStaffRole(role))) {
      router.replace(roleRedirectPath(role));
    }
  }, [loading, role, router, session]);

  useEffect(() => {
    const resolvePermissions = async () => {
      if (!session?.user.id || !gymId) return;
      await getUserRoleContext(session.user.id);
      setReadOnly(!canManageGymSettings(gymId));
      setRoleLabel(getGymRoleLabel(gymId));
    };
    resolvePermissions();
  }, [gymId, session?.user.id]);

  useEffect(() => {
    if (!metadata) return;
    setName(metadata.name ?? "");
    setTimezone(metadata.timezone ?? "UTC");
    const address = (metadata.address ?? {}) as {
      line1?: string;
      line2?: string;
      city?: string;
      region?: string;
      postal_code?: string;
    };
    setLine1(address.line1 ?? "");
    setLine2(address.line2 ?? "");
    setCity(address.city ?? "");
    setRegion(address.region ?? "");
    setPostalCode(address.postal_code ?? "");
    setLatitude(metadata.latitude?.toString() ?? "");
    setLongitude(metadata.longitude?.toString() ?? "");
  }, [metadata]);

  useEffect(() => {
    if (!hours) return;
    setHoursDraft((prev) =>
      prev.map((draft) => {
        const match = hours.find((hour) => hour.day_of_week === draft.day_of_week);
        if (!match) {
          return { ...draft, open_time: "", close_time: "", closed: true };
        }
        return { ...draft, open_time: match.open_time, close_time: match.close_time, closed: false };
      })
    );
  }, [hours]);

  const isReady = !loading && !metadataLoading && !!session && !!gymId;

  const addressPayload = useMemo(
    () => ({
      line1,
      line2: line2 || null,
      city,
      region,
      postal_code: postalCode,
    }),
    [city, line1, line2, postalCode, region]
  );

  const handleMetadataSave = () => {
    if (!gymId) return;
    updateGym.mutate({
      gymId,
      name,
      address: addressPayload,
      timezone,
      latitude: latitude ? Number(latitude) : null,
      longitude: longitude ? Number(longitude) : null,
    });
  };

  const handleHoursSave = () => {
    if (!gymId) return;
    const payloadHours = hoursDraft
      .filter((hour) => !hour.closed)
      .map((hour) => ({
        day_of_week: hour.day_of_week,
        open_time: hour.open_time,
        close_time: hour.close_time,
      }));
    updateHours.mutate({ gymId, hours: payloadHours });
  };

  const handleHolidayAdd = () => {
    if (!gymId || !holidayDate) return;
    addHoliday.mutate({ gymId, date: holidayDate, label: holidayLabel || undefined });
    setHolidayDate("");
    setHolidayLabel("");
  };

  const handleAmenityAdd = () => {
    if (!gymId || !amenityLabel) return;
    addAmenity.mutate({ gymId, label: amenityLabel, icon: amenityIcon || undefined });
    setAmenityLabel("");
    setAmenityIcon("");
  };

  const handleStaffAssign = () => {
    if (!gymId || !staffUserId) return;
    assignStaff.mutate({ gymId, userId: staffUserId, role: staffRole });
    setStaffUserId("");
  };

  const handleNoteAdd = () => {
    if (!gymId || !noteText.trim()) return;
    addNote.mutate({ gymId, note: noteText.trim() });
    setNoteText("");
  };

  if (!isReady) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white px-6 py-10">
      <div className="max-w-6xl mx-auto space-y-6">
        {message ? (
          <div
            className={`rounded-lg px-4 py-3 text-sm ${
              status === "success" ? "bg-emerald-500/20 text-emerald-200" : "bg-rose-500/20 text-rose-200"
            }`}
          >
            {message}
          </div>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold">{metadata?.name ?? "Gym"}</h1>
            <p className="text-slate-400 text-sm">
              {line1} {line2 ? `• ${line2}` : ""} {city ? `• ${city}` : ""} {region ? `• ${region}` : ""}{" "}
              {postalCode}
            </p>
          </div>
          <span className="inline-flex items-center rounded-full bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-200">
            {roleLabel}
          </span>
        </div>

        {readOnly ? (
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm text-slate-200">
            You are viewing this gym in read-only mode.
          </div>
        ) : null}

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Overview</h2>
            <button
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold disabled:opacity-50"
              onClick={handleMetadataSave}
              disabled={readOnly || updateGym.isPending}
            >
              {updateGym.isPending ? "Saving..." : "Edit"}
            </button>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex flex-col text-sm gap-2">
              Gym name
              <input
                className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-white"
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={readOnly}
              />
            </label>
            <label className="flex flex-col text-sm gap-2">
              Timezone
              <input
                className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-white"
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
                disabled={readOnly}
              />
            </label>
            <label className="flex flex-col text-sm gap-2">
              Address line 1
              <input
                className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-white"
                value={line1}
                onChange={(event) => setLine1(event.target.value)}
                disabled={readOnly}
              />
            </label>
            <label className="flex flex-col text-sm gap-2">
              Address line 2
              <input
                className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-white"
                value={line2}
                onChange={(event) => setLine2(event.target.value)}
                disabled={readOnly}
              />
            </label>
            <label className="flex flex-col text-sm gap-2">
              City
              <input
                className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-white"
                value={city}
                onChange={(event) => setCity(event.target.value)}
                disabled={readOnly}
              />
            </label>
            <label className="flex flex-col text-sm gap-2">
              Region
              <input
                className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-white"
                value={region}
                onChange={(event) => setRegion(event.target.value)}
                disabled={readOnly}
              />
            </label>
            <label className="flex flex-col text-sm gap-2">
              Postal code
              <input
                className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-white"
                value={postalCode}
                onChange={(event) => setPostalCode(event.target.value)}
                disabled={readOnly}
              />
            </label>
            <label className="flex flex-col text-sm gap-2">
              Latitude
              <input
                className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-white"
                value={latitude}
                onChange={(event) => setLatitude(event.target.value)}
                disabled={readOnly}
              />
            </label>
            <label className="flex flex-col text-sm gap-2">
              Longitude
              <input
                className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-white"
                value={longitude}
                onChange={(event) => setLongitude(event.target.value)}
                disabled={readOnly}
              />
            </label>
          </div>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Hours & Holidays</h2>
            <button
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold disabled:opacity-50"
              onClick={handleHoursSave}
              disabled={readOnly || updateHours.isPending}
            >
              {updateHours.isPending ? "Saving..." : "Save hours"}
            </button>
          </div>
          <div className="grid gap-3">
            {hoursDraft.map((hour) => (
              <div key={hour.day_of_week} className="flex flex-wrap items-center gap-3 text-sm">
                <span className="w-24 text-slate-300">{weekdayLabels[hour.day_of_week]}</span>
                <label className="flex items-center gap-2 text-xs text-slate-400">
                  <input
                    type="checkbox"
                    checked={!hour.closed}
                    onChange={() =>
                      setHoursDraft((prev) =>
                        prev.map((row) =>
                          row.day_of_week === hour.day_of_week ? { ...row, closed: !row.closed } : row
                        )
                      )
                    }
                    disabled={readOnly}
                  />
                  Open
                </label>
                <input
                  type="time"
                  className="rounded-md bg-slate-900 border border-slate-700 px-2 py-1 text-white"
                  value={hour.open_time}
                  onChange={(event) =>
                    setHoursDraft((prev) =>
                      prev.map((row) =>
                        row.day_of_week === hour.day_of_week ? { ...row, open_time: event.target.value } : row
                      )
                    )
                  }
                  disabled={readOnly || hour.closed}
                />
                <span className="text-slate-500">to</span>
                <input
                  type="time"
                  className="rounded-md bg-slate-900 border border-slate-700 px-2 py-1 text-white"
                  value={hour.close_time}
                  onChange={(event) =>
                    setHoursDraft((prev) =>
                      prev.map((row) =>
                        row.day_of_week === hour.day_of_week ? { ...row, close_time: event.target.value } : row
                      )
                    )
                  }
                  disabled={readOnly || hour.closed}
                />
              </div>
            ))}
          </div>
          <div className="border-t border-slate-800 pt-4 space-y-3">
            <h3 className="text-lg font-semibold">Holidays</h3>
            <div className="flex flex-wrap gap-3">
              <input
                type="date"
                className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-white text-sm"
                value={holidayDate}
                onChange={(event) => setHolidayDate(event.target.value)}
                disabled={readOnly}
              />
              <input
                type="text"
                placeholder="Holiday label"
                className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-white text-sm"
                value={holidayLabel}
                onChange={(event) => setHolidayLabel(event.target.value)}
                disabled={readOnly}
              />
              <button
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold disabled:opacity-50"
                onClick={handleHolidayAdd}
                disabled={readOnly || addHoliday.isPending}
              >
                Add holiday
              </button>
            </div>
            <div className="space-y-2">
              {holidays?.length ? (
                holidays.map((holiday) => (
                  <div key={holiday.id} className="flex items-center justify-between text-sm text-slate-200">
                    <span>
                      {holiday.date} {holiday.label ? `• ${holiday.label}` : ""}
                    </span>
                    <button
                      className="text-xs text-rose-300 hover:text-rose-200 disabled:opacity-50"
                      onClick={() => removeHoliday.mutate({ gymId: gymId!, holidayId: holiday.id })}
                      disabled={readOnly || removeHoliday.isPending}
                    >
                      Remove
                    </button>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-500">No holidays added.</p>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Amenities</h2>
          </div>
          <div className="flex flex-wrap gap-3">
            <input
              type="text"
              placeholder="Amenity label"
              className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-white text-sm"
              value={amenityLabel}
              onChange={(event) => setAmenityLabel(event.target.value)}
              disabled={readOnly}
            />
            <input
              type="text"
              placeholder="Icon (optional)"
              className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-white text-sm"
              value={amenityIcon}
              onChange={(event) => setAmenityIcon(event.target.value)}
              disabled={readOnly}
            />
            <button
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold disabled:opacity-50"
              onClick={handleAmenityAdd}
              disabled={readOnly || addAmenity.isPending}
            >
              Add amenity
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {amenities?.length ? (
              amenities.map((amenity) => (
                <span key={amenity.id} className="inline-flex items-center gap-2 rounded-full bg-slate-800 px-3 py-1 text-xs">
                  {amenity.icon ? <span>{amenity.icon}</span> : null}
                  {amenity.label}
                  <button
                    className="text-rose-300 hover:text-rose-200 disabled:opacity-50"
                    onClick={() => removeAmenity.mutate({ gymId: gymId!, amenityId: amenity.id })}
                    disabled={readOnly || removeAmenity.isPending}
                  >
                    ✕
                  </button>
                </span>
              ))
            ) : (
              <p className="text-sm text-slate-500">No amenities configured.</p>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Staff & Roles</h2>
          </div>
          <div className="flex flex-wrap gap-3">
            <input
              type="text"
              placeholder="User ID"
              className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-white text-sm"
              value={staffUserId}
              onChange={(event) => setStaffUserId(event.target.value)}
              disabled={readOnly}
            />
            <select
              className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-white text-sm"
              value={staffRole}
              onChange={(event) => setStaffRole(event.target.value)}
              disabled={readOnly}
            >
              <option value="STAFF">Staff</option>
              <option value="MANAGER">Manager</option>
              <option value="ADMIN">Admin</option>
            </select>
            <button
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold disabled:opacity-50"
              onClick={handleStaffAssign}
              disabled={readOnly || assignStaff.isPending}
            >
              Assign staff
            </button>
          </div>
          <div className="overflow-hidden rounded-lg border border-slate-800">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-900/80 text-slate-300">
                <tr>
                  <th className="px-4 py-2 text-left">Name</th>
                  <th className="px-4 py-2 text-left">Email</th>
                  <th className="px-4 py-2 text-left">Role</th>
                  <th className="px-4 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {staff?.length ? (
                  staff.map((member) => (
                    <tr key={member.id}>
                      <td className="px-4 py-2">{member.users?.full_name ?? "Unknown"}</td>
                      <td className="px-4 py-2 text-slate-400">Not available</td>
                      <td className="px-4 py-2">
                        <select
                          className="rounded-md bg-slate-900 border border-slate-700 px-2 py-1 text-white text-sm"
                          value={member.role}
                          onChange={(event) =>
                            updateRole.mutate({ gymId: gymId!, staffRoleId: member.id, role: event.target.value })
                          }
                          disabled={readOnly || updateRole.isPending}
                        >
                          <option value="STAFF">Staff</option>
                          <option value="MANAGER">Manager</option>
                          <option value="ADMIN">Admin</option>
                        </select>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <button
                          className="text-xs text-rose-300 hover:text-rose-200 disabled:opacity-50"
                          onClick={() => removeStaff.mutate({ gymId: gymId!, staffRoleId: member.id })}
                          disabled={readOnly || removeStaff.isPending}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="px-4 py-4 text-center text-slate-500">
                      No staff assigned.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Notes</h2>
          </div>
          <div className="flex flex-col gap-3">
            <textarea
              rows={3}
              className="rounded-md bg-slate-900 border border-slate-700 px-3 py-2 text-white text-sm"
              placeholder="Add an internal note..."
              value={noteText}
              onChange={(event) => setNoteText(event.target.value)}
              disabled={readOnly}
            />
            <button
              className="self-start rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold disabled:opacity-50"
              onClick={handleNoteAdd}
              disabled={readOnly || addNote.isPending}
            >
              Add note
            </button>
          </div>
          <div className="space-y-3">
            {notes?.length ? (
              notes.map((note) => (
                <div key={note.id} className="rounded-md border border-slate-800 bg-slate-900 px-4 py-3 text-sm">
                  <div className="text-slate-300">
                    {note.users?.full_name ?? "Staff member"} •{" "}
                    {new Date(note.created_at).toLocaleString()}
                  </div>
                  <p className="text-slate-200 mt-2">{note.note}</p>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-500">No notes yet.</p>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Audit Log</h2>
          </div>
          <div className="overflow-hidden rounded-lg border border-slate-800">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-900/80 text-slate-300">
                <tr>
                  <th className="px-4 py-2 text-left">Timestamp</th>
                  <th className="px-4 py-2 text-left">Actor</th>
                  <th className="px-4 py-2 text-left">Event</th>
                  <th className="px-4 py-2 text-left">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {auditEvents?.length ? (
                  auditEvents.map((event) => (
                    <tr key={event.id}>
                      <td className="px-4 py-2 text-slate-300">
                        {new Date(event.created_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-slate-300">{event.users?.full_name ?? "Staff member"}</td>
                      <td className="px-4 py-2 text-slate-400">{event.event_type}</td>
                      <td className="px-4 py-2 text-slate-400">{describeAuditEvent(event.event_type, event.payload)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="px-4 py-4 text-center text-slate-500">
                      No audit activity yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

export default function LocationManagementPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <LocationManagementConsole />
    </QueryClientProvider>
  );
}

/*
Manual test scenarios:
- manager updates hours → succeeds & audit event logged
- staff tries to update → denied
- corporate admin views in read-only → UI disabled
- assign staff → role visible & logged
- remove manager when only one admin left → blocked
*/

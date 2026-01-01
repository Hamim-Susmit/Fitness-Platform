"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useActiveGym } from "../lib/useActiveGym";

// Manual test scenarios (Phase 4 — Step 4)
// - Single-gym member → selector hidden.
// - Multi-gym member → can switch.
// - Staff with 2 gyms → switcher works across dashboards.
// - Remove access → fallback logic works.
// - Switch gym → queries refresh successfully.

export default function LocationSwitcher() {
  const { activeGym, activeGymId, gyms, setActiveGym, isMultiGymUser, accessNotice, loading } = useActiveGym();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!accessNotice) {
      return;
    }
    setToastMessage(accessNotice);
  }, [accessNotice]);

  useEffect(() => {
    if (!toastMessage) {
      return;
    }
    const timeout = window.setTimeout(() => setToastMessage(null), 3000);
    return () => window.clearTimeout(timeout);
  }, [toastMessage]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredGyms = useMemo(() => {
    if (!query.trim()) {
      return gyms;
    }
    const normalized = query.toLowerCase();
    return gyms.filter((gym) => `${gym.name} ${gym.code ?? ""}`.toLowerCase().includes(normalized));
  }, [gyms, query]);

  const handleSelect = (gymId: string) => {
    setActiveGym(gymId);
    setToastMessage("Location updated.");
    setOpen(false);
  };

  if (loading) {
    return null;
  }

  if (!gyms.length) {
    return (
      <div className="rounded-lg border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
        No active gym access — contact support.
      </div>
    );
  }

  if (!isMultiGymUser) {
    return null;
  }

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        className="flex items-center gap-2 rounded-full border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:border-slate-500"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="text-slate-400">Location</span>
        <span className="font-semibold">{activeGym?.name ?? "Select gym"}</span>
        <span aria-hidden>▾</span>
      </button>

      {open ? (
        <div className="absolute right-0 z-20 mt-2 w-72 rounded-xl border border-slate-800 bg-slate-950/95 p-3 shadow-xl">
          {gyms.length > 6 ? (
            <div className="mb-2">
              <label htmlFor="location-search" className="sr-only">
                Search locations
              </label>
              <input
                id="location-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search locations..."
                className="w-full rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
              />
            </div>
          ) : null}
          <ul role="listbox" aria-label="Select a gym location" className="max-h-64 overflow-auto">
            {filteredGyms.map((gym) => {
              const selected = gym.id === activeGymId;
              return (
                <li key={gym.id} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    onClick={() => handleSelect(gym.id)}
                    className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-xs transition ${
                      selected ? "bg-cyan-500/10 text-cyan-200" : "text-slate-200 hover:bg-slate-900"
                    }`}
                  >
                    <span className="flex flex-col">
                      <span className="font-semibold">{gym.name}</span>
                      {gym.code ? <span className="text-[11px] text-slate-400">{gym.code}</span> : null}
                    </span>
                    {selected ? <span className="text-cyan-300">Active</span> : null}
                  </button>
                </li>
              );
            })}
            {!filteredGyms.length ? (
              <li className="px-3 py-2 text-xs text-slate-500">No matching locations.</li>
            ) : null}
          </ul>
        </div>
      ) : null}

      {toastMessage ? (
        <div
          role="status"
          aria-live="polite"
          className="absolute right-0 top-12 rounded-md border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-100 shadow-lg"
        >
          {toastMessage}
        </div>
      ) : null}
    </div>
  );
}

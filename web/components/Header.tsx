"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "../lib/supabase-browser";
import { useAuthStore } from "../lib/auth";
import LocationSwitcher from "./LocationSwitcher";

export default function Header() {
  const router = useRouter();
  const role = useAuthStore((state) => state.role);

  const handleSignOut = async () => {
    await supabaseBrowser.auth.signOut();
    router.replace("/login");
  };

  return (
    <header className="w-full border-b border-slate-800 bg-slate-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
        <div className="flex flex-col">
          <p className="text-lg font-semibold text-white">Gym Membership</p>
          <p className="text-xs text-slate-400">{role === "member" ? "Member" : "Staff"} Dashboard</p>
        </div>
        <div className="flex items-center gap-4">
          <LocationSwitcher />
          <nav className="flex items-center gap-4 text-sm">
            {role === "member" ? (
              <Link className="text-slate-300 hover:text-white" href="/member">
                Member
              </Link>
            ) : (
              <Link className="text-slate-300 hover:text-white" href="/staff">
                Staff
              </Link>
            )}
            <button
              onClick={handleSignOut}
              className="rounded-md border border-slate-700 px-3 py-2 text-slate-200 hover:bg-slate-800"
            >
              Sign out
            </button>
          </nav>
        </div>
      </div>
    </header>
  );
}

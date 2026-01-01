"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "../../../lib/supabase-browser";
import { fetchUserRole, loadSessionAndRole, useAuthStore } from "../../../lib/auth";
import { roleRedirectPath } from "../../../lib/roles";

export default function LoginPage() {
  const router = useRouter();
  const { session, role, loading, setLoading, setRole, setSession } = useAuthStore();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadSessionAndRole();
    const { data } = supabaseBrowser.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession);
      if (newSession?.user) {
        const nextRole = await fetchUserRole(newSession.user.id);
        setRole(nextRole);
      } else {
        setRole(null);
      }
      setLoading(false);
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }, [setLoading, setRole, setSession]);

  useEffect(() => {
    if (loading) return;
    if (!session || !role) return;
    router.replace(roleRedirectPath(role));
  }, [loading, role, router, session]);

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const { data, error: signInError } = await supabaseBrowser.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError || !data.session) {
      setError(signInError?.message ?? "Unable to sign in");
      setSubmitting(false);
      return;
    }

    const nextRole = await fetchUserRole(data.session.user.id);
    setRole(nextRole);
    setSession(data.session);
    setSubmitting(false);

    router.replace(roleRedirectPath(nextRole));
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center px-6">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-lg">
        <h1 className="text-2xl font-semibold mb-2">Gym Membership Platform</h1>
        <p className="text-slate-400 mb-6">Sign in to access your dashboard.</p>
        <form className="space-y-4" onSubmit={handleLogin}>
          <div>
            <label className="text-sm text-slate-300">Email</label>
            <input
              className="mt-2 w-full rounded-lg bg-slate-950 border border-slate-700 px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <div>
            <label className="text-sm text-slate-300">Password</label>
            <input
              className="mt-2 w-full rounded-lg bg-slate-950 border border-slate-700 px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-cyan-500 text-slate-950 font-semibold py-3 hover:bg-cyan-400 transition disabled:opacity-60"
          >
            {submitting ? "Signing in..." : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}

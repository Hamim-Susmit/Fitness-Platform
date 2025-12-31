import { create } from "zustand";
import { supabaseBrowser } from "./supabase-browser";
import type { UserRole } from "./types";
import type { Session } from "@supabase/supabase-js";

type AuthState = {
  session: Session | null;
  role: UserRole | null;
  loading: boolean;
  setSession: (session: Session | null) => void;
  setRole: (role: UserRole | null) => void;
  setLoading: (loading: boolean) => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  role: null,
  loading: true,
  setSession: (session) => set({ session }),
  setRole: (role) => set({ role }),
  setLoading: (loading) => set({ loading }),
}));

type ToastState = {
  message: string | null;
  status: "success" | "error" | null;
  setToast: (message: string | null, status: "success" | "error" | null) => void;
};

export const useToastStore = create<ToastState>((set) => ({
  message: null,
  status: null,
  setToast: (message, status) => set({ message, status }),
}));

type TokenState = {
  token: string | null;
  expiresAt: string | null;
  setToken: (token: string | null, expiresAt: string | null) => void;
};

export const useTokenStore = create<TokenState>((set) => ({
  token: null,
  expiresAt: null,
  setToken: (token, expiresAt) => set({ token, expiresAt }),
}));

export async function fetchUserRole(userId: string): Promise<UserRole | null> {
  const { data, error } = await supabaseBrowser
    .from("users")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data.role as UserRole;
}

export async function loadSessionAndRole() {
  const { data } = await supabaseBrowser.auth.getSession();
  const session = data.session ?? null;
  useAuthStore.getState().setSession(session);

  if (!session?.user) {
    useAuthStore.getState().setRole(null);
    useAuthStore.getState().setLoading(false);
    return;
  }

  const role = await fetchUserRole(session.user.id);
  useAuthStore.getState().setRole(role);
  useAuthStore.getState().setLoading(false);
}

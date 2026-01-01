import { create } from "zustand";
import type { Session } from "@supabase/supabase-js";
import type { UserRole } from "../lib/types";

type SessionState = {
  session: Session | null;
  role: UserRole | null;
  loading: boolean;
  setSession: (session: Session | null) => void;
  setRole: (role: UserRole | null) => void;
  setLoading: (loading: boolean) => void;
};

export const useSessionStore = create<SessionState>((set) => ({
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

import type { UserRole } from "./types";

export function roleRedirectPath(role: UserRole | null) {
  if (!role) return "/login";
  return role === "member" ? "/member" : "/staff";
}

export function isStaffRole(role: UserRole | null) {
  return role === "staff" || role === "owner";
}

import type { UserRole } from "./types";

export function isStaffRole(role: UserRole | null) {
  return role === "staff" || role === "owner";
}

export function roleRootRoute(role: UserRole | null) {
  if (!role) return "Auth";
  return role === "member" ? "MemberRoot" : "StaffRoot";
}

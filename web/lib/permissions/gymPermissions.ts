import { supabaseBrowser } from "../supabase-browser";

export type RoleContext = {
  staffGymIds: string[];
  staffRoles: Array<{ gym_id: string; role: string }>;
  managerGymIds: string[];
  effectiveGymIds: string[];
  organizationRoles: Array<{ chain_id: string; role: string }>;
  isCorporateAdmin: boolean;
  isRegionalManager: boolean;
};

let cachedContext: RoleContext | null = null;

// Fetch and cache the user role context to drive UI gating.
// NOTE: Server + RLS are the source of truth; UI should only assist.
export async function getUserRoleContext(userId: string): Promise<RoleContext> {
  const [{ data: staffRoles }, { data: legacyStaff }, { data: orgRoles }] = await Promise.all([
    supabaseBrowser.from("staff_roles").select("gym_id, role").eq("user_id", userId),
    supabaseBrowser.from("staff").select("gym_id").eq("user_id", userId),
    supabaseBrowser.from("organization_roles").select("chain_id, role").eq("user_id", userId),
  ]);

  const staffGymIds = Array.from(
    new Set([...(staffRoles ?? []).map((row) => row.gym_id), ...(legacyStaff ?? []).map((row) => row.gym_id)])
  );
  const normalizedStaffRoles = (staffRoles ?? []) as Array<{ gym_id: string; role: string }>;
  const managerGymIds = Array.from(
    new Set(normalizedStaffRoles.filter((row) => ["MANAGER", "ADMIN"].includes(row.role)).map((row) => row.gym_id))
  );

  const { data: effectiveGyms } = await supabaseBrowser.rpc("resolve_user_effective_gyms", {
    p_user_id: userId,
  });

  const effectiveGymIds = Array.from(new Set((effectiveGyms ?? []).map((row: { gym_id: string }) => row.gym_id)));

  const isCorporateAdmin = (orgRoles ?? []).some((role) => role.role === "CORPORATE_ADMIN");
  const isRegionalManager = (orgRoles ?? []).some((role) => role.role === "REGIONAL_MANAGER");

  cachedContext = {
    staffGymIds,
    staffRoles: normalizedStaffRoles,
    managerGymIds,
    effectiveGymIds,
    organizationRoles: orgRoles ?? [],
    isCorporateAdmin,
    isRegionalManager,
  };

  return cachedContext;
}

export function canManageGym(gymId: string) {
  if (!cachedContext) return false;
  return cachedContext.staffGymIds.includes(gymId);
}

export function canManageGymSettings(gymId: string) {
  if (!cachedContext) return false;
  return cachedContext.managerGymIds.includes(gymId);
}

export function getGymRoleLabel(gymId: string) {
  if (!cachedContext) return "Read-Only";
  const staffRole = cachedContext.staffRoles.find((role) => role.gym_id === gymId)?.role;
  if (staffRole === "ADMIN") return "Local Admin";
  if (staffRole === "MANAGER") return "Local Manager";
  if (staffRole) return "Local Staff";
  if (cachedContext.isCorporateAdmin) return "Corporate Read-Only";
  if (cachedContext.isRegionalManager) return "Regional Read-Only";
  return "Read-Only";
}

export function canViewAnalytics(gymId: string) {
  if (!cachedContext) return false;
  return cachedContext.effectiveGymIds.includes(gymId) || cachedContext.staffGymIds.includes(gymId);
}

export function isCorporateAdmin() {
  return cachedContext?.isCorporateAdmin ?? false;
}

export function isRegionalManager() {
  return cachedContext?.isRegionalManager ?? false;
}

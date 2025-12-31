export type UserRole = "owner" | "staff" | "member";

export type Checkin = {
  id: string;
  member_id: string;
  gym_id: string;
  checked_in_at: string;
  source: "qr" | "manual";
  staff_id: string | null;
};

export type MemberProfile = {
  id: string;
  user_id: string;
  gym_id: string;
  status: "active" | "inactive" | "paused";
};

export type StaffProfile = {
  id: string;
  user_id: string;
  gym_id: string;
  staff_role: "staff" | "manager";
};
